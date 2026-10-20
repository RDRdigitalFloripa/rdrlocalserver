'use strict';
/**
 * Importa bancos MySQL/MariaDB de outro ambiente local (ServBay, Laragon, XAMPP...) que esteja em execução neste PC.
 * O servidor de origem só é LIDO (mariadb-dump). Cada banco é copiado para o MariaDB do RDR Local e conferido
 * (nº de tabelas e linhas por tabela). O .sql gerado fica em data/backups/mariadb como cópia de segurança.
 * A senha de origem vai só por variável de ambiente do processo (MYSQL_PWD): não é gravada nem aparece em log ou argumentos.
 */
const fs = require('fs');
const path = require('path');
const core = require('./core');
const comps = require('./components');
const { cfg, log, run, exists, portFree } = core;

const SYSTEM = ['information_schema', 'mysql', 'performance_schema', 'sys'];
const NAME_RE = /^[A-Za-z0-9_]{1,64}$/;
const services = () => require('./services');
const backup = () => require('./backup');
const dbm = () => require('./db');

function cleanConn(c = {}) {
  const host = String(c.host || '127.0.0.1').trim().toLowerCase();
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) throw new Error('Por segurança, só é possível importar de um servidor deste mesmo PC (127.0.0.1).');
  const port = Number(c.port);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Porta de origem inválida.');
  if (port === cfg.ports.mariadb) throw new Error(`A porta ${port} é a do MariaDB do RDR Local, não a da origem.`);
  const user = String(c.user || 'root').trim();
  if (!/^[A-Za-z0-9_.-]{1,32}$/.test(user)) throw new Error('Usuário inválido.');
  const password = String(c.password || '');
  if (password.length > 200 || /\0/.test(password)) throw new Error('Senha inválida.');
  return { host: '127.0.0.1', port, user, password };
}
const baseArgs = (c) => [`-h${c.host}`, `-P${c.port}`, `-u${c.user}`, '--protocol=tcp'];
const env = (c) => ({ ...process.env, MYSQL_PWD: c.password });
const sql = (c, q) => run(comps.bins.mariadbCli(), [...baseArgs(c), '--connect-timeout=8', '-N', '-B', '-e', q], { env: env(c), timeout: 60000 });
const sqlLocal = (q) => run(comps.bins.mariadbCli(), ['-h127.0.0.1', `-P${cfg.ports.mariadb}`, '-uroot', '--protocol=tcp', '-N', '-B', '-e', q], { timeout: 600000 });
const safe = (m) => String(m).replace(/(password|pwd)[^\s]*/gi, '$1=***');

/** Portas onde há algo escutando e que costumam ser de MySQL/MariaDB (exceto a do RDR Local). */
async function detectPorts() {
  const out = [];
  for (const p of [3306, 3308, 3309, 3310, 3311, 3312, 33060]) if (p !== cfg.ports.mariadb && !(await portFree(p))) out.push(p);
  return out;
}

async function probe(raw) {
  const c = cleanConn(raw);
  const v = await sql(c, 'SELECT VERSION()');
  if (!v.ok) throw new Error('Não consegui conectar à origem: ' + safe(v.out).slice(0, 300) + ' (confira porta, usuário e senha, e se o servidor está ligado).');
  const version = v.out.trim(); const flavor = /mariadb/i.test(version) ? 'mariadb' : 'mysql';
  const r = await sql(c, `SELECT s.schema_name, COUNT(t.table_name), ROUND(COALESCE(SUM(t.data_length+t.index_length),0)/1048576,2)
    FROM information_schema.schemata s LEFT JOIN information_schema.tables t ON t.table_schema=s.schema_name AND t.table_type='BASE TABLE'
    GROUP BY s.schema_name ORDER BY 1`);
  if (!r.ok) throw new Error('Não consegui listar os bancos: ' + safe(r.out).slice(0, 300));
  let local = []; let localUp = true;
  try { local = (await dbm().list('mariadb')).map((d) => d.name); } catch (_) { localUp = false; }
  const databases = r.out.split('\n').filter(Boolean).map((l) => { const [name, tables, mb] = l.split('\t'); return { name, tables: Number(tables), mb: Number(mb), system: SYSTEM.includes(name), validName: NAME_RE.test(name), existsHere: local.includes(name) }; });
  return { version, flavor, localUp, databases };
}

// MySQL 8 usa collations que o MariaDB não conhece: troca por equivalentes ao copiar o dump.
const COLL = [[/utf8mb4_0900_ai_ci/g, 'utf8mb4_unicode_ci'], [/utf8mb4_0900_as_ci/g, 'utf8mb4_unicode_ci'], [/utf8mb4_0900_as_cs/g, 'utf8mb4_bin'], [/utf8mb4_0900_bin/g, 'utf8mb4_bin']];
function fixCollations(file) {
  return new Promise((resolve, reject) => {
    const out = file + '.fix'; const ws = fs.createWriteStream(out); let tail = ''; let n = 0;
    const rs = fs.createReadStream(file, { encoding: 'utf8', highWaterMark: 1 << 20 });
    const fix = (t) => { for (const [re, to] of COLL) t = t.replace(re, () => { n++; return to; }); return t; };
    rs.on('data', (chunk) => { const t = tail + chunk; const cut = Math.max(0, t.length - 40); ws.write(fix(t.slice(0, cut))); tail = t.slice(cut); });
    rs.on('end', () => { ws.end(fix(tail)); });
    rs.on('error', reject); ws.on('error', reject);
    ws.on('finish', () => { try { fs.renameSync(out, file); resolve(n); } catch (e) { reject(e); } });
  });
}

async function tableCounts(runner, db) {
  const t = await runner(`SELECT table_name FROM information_schema.tables WHERE table_schema='${db}' AND table_type='BASE TABLE' ORDER BY 1`);
  if (!t.ok) throw new Error(t.out);
  const names = t.out.split('\n').filter((x) => x && !/[`\0]/.test(x)); const counts = {};
  for (let i = 0; i < names.length; i += 40) {
    const q = names.slice(i, i + 40).map((n) => `SELECT '${n.replace(/'/g, "''")}', COUNT(*) FROM \`${db}\`.\`${n}\``).join(' UNION ALL ');
    const r = await runner(q); if (!r.ok) throw new Error(r.out);
    for (const l of r.out.split('\n').filter(Boolean)) { const k = l.lastIndexOf('\t'); counts[l.slice(0, k)] = Number(l.slice(k + 1)); }
  }
  return { names, counts };
}

async function importDbs(raw, items, jl = () => {}) {
  const c = cleanConn(raw);
  if (!services().isRunning('mariadb')) throw new Error('Inicie o MariaDB do RDR Local antes de importar (painel → Iniciar tudo).');
  const info = await probe(c); const res = [];
  for (const it of items) {
    const name = String(it.name || ''); const target = String(it.target || name);
    try {
      const src = info.databases.find((d) => d.name === name);
      if (!src || src.system) throw new Error('banco não encontrado na origem ou é do sistema');
      if (!NAME_RE.test(name) || !NAME_RE.test(target)) throw new Error('nome fora do padrão (letras, números e _)');
      if (SYSTEM.includes(target)) throw new Error('destino é banco do sistema');
      const hit = info.databases.length && (await dbm().list('mariadb')).find((d) => d.name === target);
      if (hit && !it.overwrite) throw new Error(`já existe um banco "${target}" aqui (marque substituir para trocar; é feita cópia de segurança antes)`);
      jl(`\n== ${name} → ${target} ==`);
      // o dump vai para uma pasta temporária: o backup de segurança do restore usa a pasta de backups e poderia ter o mesmo nome
      const tmpDir = path.join(core.P.data, 'tmp'); fs.mkdirSync(tmpDir, { recursive: true });
      const file = path.join(tmpDir, `import-${target}-${Date.now()}.sql`);
      jl('Copiando da origem (mariadb-dump)...');
      const dump = await run(comps.bins.mariadbDump(), [...baseArgs(c), '--routines', '--triggers', '--events', '--single-transaction', '--default-character-set=utf8mb4', `--result-file=${file}`, name], { env: env(c), timeout: 3600000 });
      if (!dump.ok || !exists(file) || !fs.statSync(file).size) { try { fs.rmSync(file, { force: true }); } catch (_) { /* ok */ } throw new Error('falha no dump: ' + safe(dump.out).slice(-300)); }
      jl(`Dump: ${(fs.statSync(file).size / 1048576).toFixed(2)} MB`);
      if (info.flavor === 'mysql') { const n = await fixCollations(file); if (n) jl(`Ajustadas ${n} collation(s) do MySQL 8 para equivalentes do MariaDB.`); }
      await backup().restore('mariadb', file, target, hit ? target : '', jl);
      jl('Conferindo tabelas e linhas...');
      const a = await tableCounts((q) => sql(c, q), name); const b = await tableCounts(sqlLocal, target);
      const diff = a.names.filter((n) => a.counts[n] !== b.counts[n]); const missing = a.names.filter((n) => !(n in b.counts));
      if (missing.length || diff.length) throw new Error(`conferência falhou: ${missing.length} tabela(s) ausente(s), ${diff.length} com contagem diferente (${[...missing, ...diff].slice(0, 5).join(', ')})`);
      const rows = Object.values(a.counts).reduce((s, x) => s + x, 0);
      jl(`OK: ${a.names.length} tabela(s) e ${rows} linha(s) conferidas.`);
      // guarda o dump como cópia de segurança junto dos backups (nome único)
      const bdir = path.join(backup().ROOT, 'mariadb'); fs.mkdirSync(bdir, { recursive: true });
      let t = Date.now(); let keep; const p2 = (n) => String(n).padStart(2, '0');
      do { const d = new Date(t); keep = path.join(bdir, `${target}__${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}.sql`); t += 1000; } while (exists(keep));
      fs.renameSync(file, keep); jl(`Cópia do dump guardada em Bancos → Backups (${path.basename(keep)}).`);
      res.push({ name, target, ok: true, tables: a.names.length, rows });
    } catch (e) { try { for (const f of fs.readdirSync(path.join(core.P.data, 'tmp'))) if (f.startsWith(`import-${target}-`)) fs.rmSync(path.join(core.P.data, 'tmp', f), { force: true }); } catch (_) { /* ok */ }
      jl(`✖ ${name}: ${e.message}`); res.push({ name, target, ok: false, error: e.message }); }
  }
  const ok = res.filter((r) => r.ok).length; log(`Importação de bancos: ${ok}/${res.length} ok.`);
  jl(`\nResumo: ${ok} de ${res.length} banco(s) importado(s) e conferido(s).${res.some((r) => !r.ok) ? ' Veja os erros acima.' : ''} A origem não foi alterada.`);
  if (res.some((r) => !r.ok)) throw new Error('Alguns bancos não foram importados (veja o log).');
  return res;
}

module.exports = { detectPorts, probe, importDbs, cleanConn, fixCollations };
