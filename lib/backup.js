'use strict';
/** Backup e restauração de bancos (MariaDB via mariadb-dump, PostgreSQL via pg_dump/psql). Arquivos .sql em data/backups/<motor>/. */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const core = require('./core');
const comps = require('./components');
const { P, cfg, log, run, decode, exists } = core;

const ROOT = path.join(P.data, 'backups');
const NAME_RE = /^[A-Za-z0-9_]{1,64}$/;
const FILE_RE = /^([A-Za-z0-9_]{1,64})__(\d{8}-\d{6})(-auto)?\.sql$/;
const ENGINES = ['mariadb', 'postgres'];
const services = () => require('./services');
const dbm = () => require('./db');

const pad = (n) => String(n).padStart(2, '0');
const stamp = () => { const d = new Date(); return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`; };
function dirFor(engine) {
  if (!ENGINES.includes(engine)) throw new Error('Motor desconhecido');
  const d = path.join(ROOT, engine); fs.mkdirSync(d, { recursive: true }); return d;
}
function assertUp(engine) {
  if (!services().isRunning(engine)) throw new Error(`${engine === 'mariadb' ? 'MariaDB' : 'PostgreSQL'} não está em execução.`);
}

/** Gera o backup de um banco. Retorna o caminho do arquivo. */
async function dump(engine, name, jl = () => {}, auto = false) {
  assertUp(engine);
  if (!NAME_RE.test(String(name || ''))) throw new Error('Nome de banco inválido.');
  const file = path.join(dirFor(engine), `${name}__${stamp()}${auto ? '-auto' : ''}.sql`);
  jl(`Fazendo backup de ${name}...`);
  const r = engine === 'mariadb'
    ? await run(comps.bins.mariadbDump(), ['-h127.0.0.1', `-P${cfg.ports.mariadb}`, '-uroot', '--protocol=tcp', '--routines', '--triggers', '--events',
      '--single-transaction', '--default-character-set=utf8mb4', `--result-file=${file}`, name], { timeout: 3600000 })
    : await run(comps.bins.pg('pg_dump'), ['-h', '127.0.0.1', '-p', String(cfg.ports.postgres), '-U', 'postgres', '--no-owner', '--no-privileges', '-f', file, name], { timeout: 3600000 });
  if (!r.ok || !exists(file) || fs.statSync(file).size === 0) {
    try { fs.rmSync(file, { force: true }); } catch (_) { /* ok */ }
    throw new Error('Falha no backup: ' + (r.out || 'arquivo vazio').slice(-400));
  }
  jl(`Backup salvo: ${file} (${(fs.statSync(file).size / 1048576).toFixed(2)} MB)`);
  log(`Backup de ${name} (${engine}) salvo.`);
  return file;
}

function list() {
  const out = [];
  for (const engine of ENGINES) {
    let files = [];
    try { files = fs.readdirSync(path.join(ROOT, engine)); } catch (_) { /* sem backups */ }
    for (const f of files) {
      const m = f.match(FILE_RE); if (!m) continue;
      const st = fs.statSync(path.join(ROOT, engine, f));
      out.push({ engine, file: f, db: m[1], mb: Number((st.size / 1048576).toFixed(2)), at: st.mtimeMs, auto: !!m[3] });
    }
  }
  return out.sort((a, b) => b.at - a.at);
}

function resolveSource(engine, source) {
  const s = String(source || '');
  if (FILE_RE.test(s)) {
    const f = path.join(dirFor(engine), s);
    if (!exists(f)) throw new Error('Backup não encontrado.');
    return f;
  }
  if (path.isAbsolute(s) && /\.sql$/i.test(s) && exists(s) && fs.statSync(s).isFile()) return s;
  throw new Error('Arquivo inválido: escolha um backup da lista ou informe o caminho completo de um arquivo .sql.');
}

function remove(engine, file) {
  if (!FILE_RE.test(String(file || ''))) throw new Error('Arquivo inválido.');
  fs.rmSync(path.join(dirFor(engine), file), { force: true });
}

/** Valida tudo que dá para validar antes de iniciar a tarefa longa. */
async function prepareRestore(engine, source, target, confirm) {
  assertUp(engine);
  if (!NAME_RE.test(String(target || ''))) throw new Error('Nome do banco de destino inválido (letras, números e _).');
  const file = resolveSource(engine, source);
  const dbs = await dbm().list(engine);
  const hit = dbs.find((d) => d.name === target);
  if (hit && hit.system) throw new Error('Não é permitido restaurar sobre banco do sistema.');
  if (hit && confirm !== target) throw new Error(`O banco "${target}" já existe e será SUBSTITUÍDO. Digite o nome dele para confirmar.`);
  return { file, exists: !!hit };
}

function pipeSql(cmd, args, file) {
  return new Promise((resolve, reject) => {
    const c = spawn(cmd, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let err = '';
    c.stderr.on('data', (d) => { err += decode(d); }); c.stdout.on('data', () => {});
    c.on('error', reject);
    c.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`Falha ao importar (código ${code}): ${err.slice(-500)}`))));
    const rs = fs.createReadStream(file); rs.on('error', reject); c.stdin.on('error', () => {});
    rs.pipe(c.stdin);
  });
}

async function restore(engine, source, target, confirm, jl = () => {}) {
  const { file, exists: had } = await prepareRestore(engine, source, target, confirm);
  if (had) {
    jl(`Banco ${target} já existe: fazendo cópia de segurança antes de substituir...`);
    await dump(engine, target, jl);
    jl('Removendo o banco atual...');
    await dbm().dropRaw(engine, target);
  }
  jl(`Criando ${target}...`);
  await dbm().create(engine, target);
  jl(`Importando ${path.basename(file)} (pode demorar)...`);
  if (engine === 'mariadb') {
    await pipeSql(comps.bins.mariadbCli(), ['-h127.0.0.1', `-P${cfg.ports.mariadb}`, '-uroot', '--protocol=tcp', '--default-character-set=utf8mb4', target], file);
  } else {
    const r = await run(comps.bins.pg('psql'), ['-h', '127.0.0.1', '-p', String(cfg.ports.postgres), '-U', 'postgres', '-d', target, '-q', '-v', 'ON_ERROR_STOP=1', '-f', file], { timeout: 3600000 });
    if (!r.ok) throw new Error('Falha ao importar: ' + r.out.slice(-500));
  }
  jl('Restauração concluída.');
  log(`Banco ${target} (${engine}) restaurado.`);
}

// ---------- backup agendado ----------
const FREQ_MS = { daily: 864e5, weekly: 7 * 864e5, monthly: 30 * 864e5 };
function normalize(o = {}) {
  const cur = cfg.backup;
  const freq = o.freq !== undefined ? o.freq : cur.freq;
  if (!FREQ_MS[freq]) throw new Error('Frequência inválida.');
  const time = o.time !== undefined ? String(o.time) : cur.time;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('Horário inválido (use HH:MM).');
  const keep = o.keep !== undefined ? Number(o.keep) : cur.keep;
  if (!Number.isInteger(keep) || keep < 1 || keep > 365) throw new Error('Quantidade a manter: de 1 a 365.');
  return { enabled: o.enabled !== undefined ? !!o.enabled : cur.enabled, freq, time, keep };
}
function setSchedule(o) { Object.assign(cfg.backup, normalize(o)); core.save(); }

/** Mantém só os N backups automáticos mais recentes de cada banco (os manuais nunca são apagados). */
function prune(keep) {
  const groups = {};
  for (const b of list().filter((x) => x.auto)) (groups[`${b.engine}/${b.db}`] ||= []).push(b);
  let n = 0;
  for (const g of Object.values(groups)) for (const old of g.slice(keep)) { try { remove(old.engine, old.file); n++; } catch (_) { /* ok */ } }
  return n;
}

/** Faz backup de todos os bancos (não-sistema) dos motores que estão ligados. */
async function runAll(jl = () => {}) {
  let ok = 0; let fail = 0; let skipped = [];
  for (const engine of ENGINES) {
    if (!services().isRunning(engine)) { skipped.push(engine === 'mariadb' ? 'MariaDB' : 'PostgreSQL'); continue; }
    let dbs = [];
    try { dbs = (await dbm().list(engine)).filter((d) => !d.system); } catch (e) { jl(`Não consegui listar ${engine}: ${e.message}`); fail++; continue; }
    for (const d of dbs) {
      try { await dump(engine, d.name, jl, true); ok++; } catch (e) { fail++; jl(`Falhou ${d.name}: ${e.message.slice(0, 200)}`); }
    }
  }
  const pruned = prune(cfg.backup.keep);
  const msg = `${new Date().toLocaleString('pt-BR')}: ${ok} backup(s) feito(s)${fail ? `, ${fail} falha(s)` : ''}${pruned ? `, ${pruned} antigo(s) removido(s)` : ''}${skipped.length ? ` (${skipped.join(' e ')} desligado)` : ''}.`;
  cfg.backup.last = Date.now(); cfg.backup.lastMsg = msg; core.save();
  jl(msg); log('Backup automático: ' + msg);
  if (fail) require('./notify').event('fail', 'RDR Local: backup com falhas', msg);
  if (cfg.cloud && cfg.cloud.enabled) { try { await require('./cloud').sync(jl); } catch (e) { jl('Envio para a nuvem falhou: ' + e.message.slice(0, 200)); } }
  return { ok, fail };
}

function isDue(now = new Date()) {
  const b = cfg.backup; if (!b.enabled) return false;
  const [h, m] = b.time.split(':').map(Number);
  const slot = new Date(now); slot.setHours(h, m, 0, 0);
  if (now < slot) return false;
  if (!b.last) return true;
  if (b.freq === 'daily') return b.last < slot.getTime();
  return now.getTime() - b.last >= FREQ_MS[b.freq] - 36e5;
}
let busy = false;
function startScheduler() {
  setInterval(async () => {
    if (busy || !isDue()) return;
    if (!ENGINES.some((e) => services().isRunning(e))) return; // espera algum banco ligar
    busy = true; try { await runAll(() => {}); } catch (e) { log('Backup automático falhou: ' + e.message); } busy = false;
  }, 60000);
}

module.exports = { setSchedule, runAll, startScheduler, isDue, prune, dump, restore, prepareRestore, list, remove, ROOT };
