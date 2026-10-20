'use strict';
/**
 * Publicação por FTP / FTPS / SFTP (sites antigos) usando o curl.exe que já vem no Windows 10/11.
 *  - Só envia o que MUDOU desde a última publicação (manifesto local com hash SHA-1); a primeira vez envia tudo
 *    ou você marca "já está igual no servidor" (baseline).
 *  - Prévia obrigatória: novos / alterados / removidos localmente. Nada é apagado no servidor sem confirmação explícita.
 *  - Arquivos .env NUNCA sobem (não há opção para mudar isso) e .git / node_modules ficam de fora por padrão.
 *  - A senha fica cifrada (DPAPI) e vai ao curl pela entrada padrão (arquivo de configuração via stdin), nunca na linha de comando.
 *  - SFTP: usa um dos servidores SSH já cadastrados (chave + impressão digital confirmada, sftp.exe do Windows). FTP simples é avisado como inseguro.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const core = require('./core');
const secrets = require('./secrets');
const { P, IS_WIN, cfg, save, log, exists, isDir } = core;

const notify = () => require('./notify');
const uid = () => crypto.randomBytes(5).toString('hex');
const CURL = IS_WIN ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'curl.exe') : 'curl';
const SSHDIR = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'OpenSSH');
const SFTP = IS_WIN ? path.join(SSHDIR, 'sftp.exe') : 'sftp';
const deploy = () => require('./deploy');
const HOST_RE = /^(?!-)[A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/;
const USER_RE = /^[^\s:"\\'`$;|&<>\0-\x1f]{1,64}$/;
const DEFAULT_EXCLUDES = ['.git/', 'node_modules/', '.idea/', '.vscode/', '.DS_Store', 'Thumbs.db'];
const MAX_FILES = 30000;
const DIR = path.join(P.data, 'ftp');
const BAD_NAME = /[\0-\x1f"\\]/; // nomes que não conseguimos passar com segurança ao curl

const haveCurl = () => (IS_WIN ? exists(CURL) : spawnSync(CURL, ['-V']).status === 0);
const getT = (id) => { const t = (cfg.ftpTargets || []).find((x) => x.id === id); if (!t) throw new Error('Destino não encontrado.'); return t; };
const pass = (t) => secrets.getProtected('ftp:' + t.id) || '';

// ---------- cadastro ----------
function cleanDir(d) {
  let s = String(d || '').trim().replace(/\\/g, '/').replace(/\/+/g, '/');
  if (s === '/' || s === '') return s;
  s = s.replace(/\/$/, '');
  if (s.split('/').includes('..') || BAD_NAME.test(s) || s.length > 300) throw new Error('Pasta remota inválida.');
  return s;
}
function cleanExcludes(list) {
  return (Array.isArray(list) ? list : String(list || '').split('\n')).map((x) => String(x).trim()).filter((x) => x && !x.startsWith('#') && x.length < 120 && !BAD_NAME.test(x)).slice(0, 100);
}
function save_(i) {
  cfg.ftpTargets = cfg.ftpTargets || [];
  const cur = i.id ? cfg.ftpTargets.find((t) => t.id === i.id) : null; if (i.id && !cur) throw new Error('Destino não encontrado.');
  const name = String(i.name || '').trim().slice(0, 60); if (!name) throw new Error('Dê um nome ao destino.');
  if (cfg.ftpTargets.some((t) => t.name === name && (!cur || t.id !== cur.id))) throw new Error('Já existe um destino com esse nome.');
  const protocol = ['ftp', 'ftps', 'sftp'].includes(i.protocol) ? i.protocol : 'ftps';
  let host = '', port = 0, user = '', serverId = '';
  if (protocol === 'sftp') {
    serverId = String(i.serverId || ''); const s = cfg.servers.find((x) => x.id === serverId); if (!s) throw new Error('Para SFTP escolha um servidor SSH cadastrado (página Publicar → Servidores).');
    host = s.host; port = s.port; user = s.user;
  } else {
    host = String(i.host || '').trim().toLowerCase(); if (!HOST_RE.test(host)) throw new Error('Host inválido.');
    port = Number(i.port || 21); if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Porta inválida.');
    user = String(i.user || '').trim(); if (!USER_RE.test(user)) throw new Error('Usuário inválido.');
  }
  const siteId = String(i.siteId || ''); const site = cfg.sites.find((s) => s.id === siteId); if (!site || !site.path) throw new Error('Escolha o site (pasta local) a publicar.');
  const localSub = String(i.localSub || '').trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (localSub.split('/').includes('..') || BAD_NAME.test(localSub)) throw new Error('Subpasta local inválida.');
  const remoteDir = cleanDir(i.remoteDir);
  const changedHost = cur && (cur.host !== host || cur.port !== port || cur.protocol !== protocol || cur.remoteDir !== remoteDir);
  const v = { name, protocol, host, port, user, serverId, siteId, localSub, remoteDir, excludes: cleanExcludes(i.excludes), insecureTls: protocol === 'ftps' && !!i.insecureTls };
  const t = cur || { id: uid(), last: null };
  Object.assign(t, v);
  if (!cur) cfg.ftpTargets.push(t);
  if (protocol !== 'sftp') {
    if (i.password) { if (/[\r\n\0]/.test(i.password) || i.password.length > 256) throw new Error('Senha inválida.'); secrets.setProtected('ftp:' + t.id, String(i.password)); }
    if (!pass(t)) { if (!cur) cfg.ftpTargets.pop(); throw new Error('Informe a senha.'); }
  }
  if (changedHost) { try { fs.rmSync(path.join(DIR, t.id + '.json'), { force: true }); } catch (_) { /* ok */ } }
  save(); return pub(t);
}
function remove(id) {
  getT(id); cfg.ftpTargets = cfg.ftpTargets.filter((t) => t.id !== id); secrets.setProtected('ftp:' + id, ''); save();
  try { fs.rmSync(path.join(DIR, id + '.json'), { force: true }); } catch (_) { /* ok */ }
}
const pub = (t) => ({ id: t.id, name: t.name, protocol: t.protocol, host: t.host, port: t.port, user: t.user, siteId: t.siteId, localSub: t.localSub, remoteDir: t.remoteDir, excludes: t.excludes, insecureTls: t.insecureTls, serverId: t.serverId || '', trusted: t.protocol !== 'sftp' || !!((cfg.servers.find((s) => s.id === t.serverId) || {}).fingerprint), last: t.last, synced: exists(path.join(DIR, t.id + '.json')) });
const lists = () => ({ curl: haveCurl(), targets: (cfg.ftpTargets || []).map(pub) });

// ---------- curl ----------
const q = (s) => '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
function scheme(t) { return t.protocol === 'ftps' && t.port === 990 ? 'ftps' : 'ftp'; }
const enc = (p) => p.split('/').filter(Boolean).map(encodeURIComponent);
function rootUrl(t) {
  const abs = t.remoteDir.startsWith('/'); const h = `${scheme(t)}://${t.host}:${t.port}/`;
  return h + (abs ? '%2F' : '');
}
/** URL de um caminho relativo à pasta remota ('' = a própria pasta, com / no fim). */
function urlFor(t, rel, dir) {
  const abs = t.remoteDir.startsWith('/'); const segs = [...enc(t.remoteDir), ...enc(rel)];
  const tail = segs.join('/') + (dir && segs.length ? '/' : '');
  const h = `${scheme(t)}://${t.host}:${t.port}/`;
  return h + (abs ? '%2F' : '') + tail;
}
function common(t) {
  const l = ['silent', 'show-error', 'fail', 'connect-timeout = 20', 'max-time = 900', `user = ${q(t.user + ':' + pass(t))}`, 'ftp-create-dirs'];
  if (t.protocol === 'ftps') { l.push('ssl-reqd'); if (t.insecureTls) l.push('insecure'); }
  return l;
}
function curl(config, timeoutMs = 960000) {
  return new Promise((resolve) => {
    let out = '', err = '';
    const c = spawn(CURL, ['-K', '-'], { windowsHide: true });
    const to = setTimeout(() => { try { c.kill(); } catch (_) { /* ok */ } }, timeoutMs);
    c.stdout.on('data', (d) => { out += d; if (out.length > 1e6) out = out.slice(-5e5); });
    c.stderr.on('data', (d) => { err += d; if (err.length > 2e4) err = err.slice(-1e4); });
    c.on('error', (e) => { clearTimeout(to); resolve({ code: -1, out, err: e.message }); });
    c.on('close', (code) => { clearTimeout(to); resolve({ code, out, err: err.trim() }); });
    c.stdin.on('error', () => {}); c.stdin.end(config);
  });
}
const redact = (t, s) => { const p = pass(t); return p ? String(s).split(p).join('***') : String(s); };
function explain(t, e) {
  const s = redact(t, e);
  if (t.protocol === 'sftp') return s || 'Falha desconhecida.';
  if (/\(67\)|login denied|530|authentication/i.test(s)) return 'Usuário ou senha recusados pelo servidor.';
  if (/\(60\)|\(35\)|certificate|SSL/i.test(s) && t.protocol === 'ftps') return 'Certificado do servidor FTPS não confere com o domínio. Se o provedor usa certificado de outro nome, marque "Aceitar certificado (inseguro)" sabendo do risco. ' + s;
  if (/\(6\)|resolve/i.test(s)) return 'Não encontrei o host (nome errado ou sem internet).';
  if (/\(7\)|refused|timed out|\(28\)/i.test(s)) return 'Não consegui conectar (porta errada, firewall ou servidor fora do ar).';
  return s || 'Falha desconhecida.';
}

// ---------- SFTP (sftp.exe do Windows, com a chave e a impressão digital do servidor SSH cadastrado) ----------
const sftpServer = (t) => { const s = cfg.servers.find((x) => x.id === t.serverId); if (!s) throw new Error('O servidor SSH deste destino foi removido.'); if (!s.fingerprint) throw new Error('Confirme a identidade do servidor em Publicar → Servidores antes.'); return s; };
const remPath = (t, rel) => { const base = t.remoteDir.replace(/\/$/, ''); return base ? (rel ? base + '/' + rel : base) : (rel || '.'); };
async function sftpRun(t, commands, timeoutMs = 900000) {
  const s = sftpServer(t); const d = deploy(); const key = d.tmpKeyFile(s.keyId);
  const bf = path.join(P.data, 'tmp', 'b-' + uid()); fs.writeFileSync(bf, commands.join('\n') + '\n');
  const a = d.sshArgs(s, key); const dest = a.pop(); a.pop(); a.pop(); // remove "-p porta" e "usuário@host"
  const args = [...a, '-P', String(s.port), '-b', bf, dest];
  try {
    return await new Promise((resolve) => {
      let out = '', err = ''; const c = spawn(SFTP, args, { windowsHide: true });
      const to = setTimeout(() => { try { c.kill(); } catch (_) { /* ok */ } }, timeoutMs);
      c.stdout.on('data', (x) => { out += x; if (out.length > 1e6) out = out.slice(-5e5); }); c.stderr.on('data', (x) => { err += x; if (err.length > 2e4) err = err.slice(-1e4); });
      c.on('error', (e) => { clearTimeout(to); resolve({ code: -1, out, err: e.message }); }); c.on('close', (code) => { clearTimeout(to); resolve({ code, out, err: err.trim() }); });
    });
  } finally { d.wipeFile(key); try { fs.rmSync(bf, { force: true }); } catch (_) { /* ok */ } }
}
const sq = (s) => '"' + String(s) + '"'; // nomes com aspas/controle já foram recusados (BAD_NAME)
function mkdirCmds(t, rels) {
  const dirs = new Set(); const add = (p) => { const parts = p.split('/').filter(Boolean); const abs = p.startsWith('/'); for (let i = 1; i <= parts.length; i++) dirs.add((abs ? '/' : '') + parts.slice(0, i).join('/')); };
  if (t.remoteDir) add(t.remoteDir); for (const r of rels) { const d = r.split('/').slice(0, -1).join('/'); if (d) add(remPath(t, d)); }
  return [...dirs].sort((x, y) => x.split('/').length - y.split('/').length || x.localeCompare(y)).map((d) => '-mkdir ' + sq(d));
}

/** Testa o login listando a pasta remota. */
async function test(id) {
  const t = getT(id);
  if (t.protocol === 'sftp') {
    if (!exists(SFTP) && IS_WIN) throw new Error('O Cliente OpenSSH (sftp.exe) não está instalado.');
    const r = await sftpRun(t, ['ls ' + sq(remPath(t, ''))], 60000);
    if (r.code !== 0) return { ok: false, error: /Permission denied/i.test(r.err) ? 'Chave recusada pelo servidor: coloque a chave pública no authorized_keys deste usuário.' : (/No such file|not found/i.test(r.err + r.out) ? 'A pasta remota não existe (ela será criada ao publicar).' : r.err || 'Falha ao conectar.') };
    const l = r.out.split('\n').filter((x) => x && !x.startsWith('sftp>'));
    return { ok: true, info: `Conectou. ${l.length} item(ns) na pasta remota.`, sample: l.slice(0, 12) };
  }
  if (!haveCurl()) throw new Error('curl.exe não encontrado (Windows 10 1803+ ou 11 traz por padrão).');
  const r = await curl([...common(t), `url = ${q(urlFor(t, '', true))}`, 'list-only'].join('\n') + '\n', 60000);
  if (r.code !== 0) return { ok: false, error: explain(t, r.err) };
  const l = r.out.split('\n').filter(Boolean); return { ok: true, info: `Conectou. ${l.length} item(ns) na pasta remota.`, sample: l.slice(0, 12) };
}

// ---------- plano (prévia) ----------
const never = (rel) => { const b = rel.split('/').pop().toLowerCase(); return b === '.env' || (b.startsWith('.env.') && !/\.(example|sample|dist|template)$/.test(b)); };
function matcher(patterns) {
  const rx = patterns.map((p) => {
    const dirOnly = p.endsWith('/'); const body = p.replace(/\/$/, '').replace(/^\//, ''); const anchored = p.startsWith('/') || body.includes('/');
    const re = new RegExp('^' + body.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]').replace(/\u0000/g, '.*') + '$', 'i');
    return { re, dirOnly, anchored };
  });
  return (rel, isDirectory) => rx.some((m) => {
    if (m.dirOnly && !isDirectory) { return rel.split('/').slice(0, -1).some((_, i, a) => m.re.test(m.anchored ? a.slice(0, i + 1).join('/') : a[i])); }
    return m.re.test(m.anchored ? rel : rel.split('/').pop()) || (m.anchored && m.re.test(rel));
  });
}
const manifestFile = (t) => path.join(DIR, t.id + '.json');
function loadManifest(t) { try { return JSON.parse(fs.readFileSync(manifestFile(t), 'utf8')); } catch (_) { return null; } }
function saveManifest(t, m) { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(manifestFile(t) + '.tmp', JSON.stringify(m)); fs.renameSync(manifestFile(t) + '.tmp', manifestFile(t)); }
function sha1(file) { return new Promise((res, rej) => { const h = crypto.createHash('sha1'); fs.createReadStream(file).on('data', (d) => h.update(d)).on('end', () => res(h.digest('hex'))).on('error', rej); }); }
function localRoot(t) {
  const s = cfg.sites.find((x) => x.id === t.siteId); if (!s || !s.path) throw new Error('O site deste destino foi removido.');
  const root = path.resolve(s.path, t.localSub || '.'); if (!isDir(root)) throw new Error('Pasta local não existe: ' + root);
  if (path.relative(s.path, root).startsWith('..')) throw new Error('Subpasta fora do site.'); return root;
}
async function scanLocal(t, prev) {
  const root = localRoot(t); const ex = matcher([...DEFAULT_EXCLUDES, ...(t.excludes || [])]);
  const files = new Map(); const skipped = []; const stack = [''];
  while (stack.length) {
    const rel = stack.pop(); let ents; try { ents = fs.readdirSync(path.join(root, rel), { withFileTypes: true }); } catch (_) { continue; }
    for (const e of ents) {
      const r = rel ? rel + '/' + e.name : e.name;
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) { if (!ex(r, true)) stack.push(r); continue; }
      if (!e.isFile()) continue;
      if (never(r)) { skipped.push({ path: r, why: '.env nunca é enviado' }); continue; }
      if (ex(r, false)) continue;
      if (BAD_NAME.test(r)) { skipped.push({ path: r, why: 'nome com caractere não suportado' }); continue; }
      if (files.size >= MAX_FILES) throw new Error(`Mais de ${MAX_FILES} arquivos: refine as exclusões (ex.: vendor/, storage/).`);
      const st = fs.statSync(path.join(root, r)); const old = prev && prev.files[r];
      const sha = old && old.size === st.size && old.mtime === Math.round(st.mtimeMs) ? old.sha : await sha1(path.join(root, r));
      files.set(r, { size: st.size, mtime: Math.round(st.mtimeMs), sha });
    }
  }
  return { root, files, skipped };
}
async function plan(id) {
  const t = getT(id); const prev = loadManifest(t); const { root, files, skipped } = await scanLocal(t, prev);
  const add = [], chg = [], same = [], del = [];
  for (const [r, f] of files) { const o = prev && prev.files[r]; if (!o) add.push(r); else if (o.sha !== f.sha) chg.push(r); else same.push(r); }
  if (prev) for (const r of Object.keys(prev.files)) if (!files.has(r)) del.push(r);
  const bytes = [...add, ...chg].reduce((n, r) => n + files.get(r).size, 0);
  const warns = [];
  if (t.protocol === 'ftp') warns.push('FTP simples não é criptografado: senha e arquivos trafegam abertos. Prefira FTPS ou SFTP se o servidor oferecer.');
  if (!prev) warns.push('Primeira publicação deste destino: o RDR não sabe o que já existe no servidor. Enviar tudo SOBRESCREVE arquivos de mesmo nome. Se o servidor já está igual à pasta local, use "Já está igual" para só registrar o ponto de partida.');
  return { root, firstRun: !prev, add: add.sort(), chg: chg.sort(), del: del.sort(), same: same.length, skipped: skipped.slice(0, 50), bytes, warns, total: files.size };
}
async function baseline(id) {
  const t = getT(id); const { files } = await scanLocal(t, loadManifest(t));
  saveManifest(t, { at: Date.now(), files: Object.fromEntries(files) }); log(`FTP ${t.name}: ponto de partida registrado (${files.size} arquivos).`); return { files: files.size };
}

// ---------- publicar ----------
async function uploadBatch(t, root, rels) {
  if (t.protocol === 'sftp') {
    const cmds = [...mkdirCmds(t, rels), ...rels.map((r) => `put ${sq(path.join(root, ...r.split('/')))} ${sq(remPath(t, r))}`)];
    return sftpRun(t, cmds);
  }
  const parts = rels.map((r) => [...common(t), `url = ${q(urlFor(t, r, false))}`, `upload-file = ${q(path.join(root, ...r.split('/')))}`].join('\n'));
  return curl(parts.join('\nnext\n') + '\n');
}
async function deleteRemote(t, rel) {
  if (t.protocol === 'sftp') return sftpRun(t, ['rm ' + sq(remPath(t, rel))], 60000);
  const full = (t.remoteDir ? t.remoteDir.replace(/\/$/, '') + '/' : '') + rel;
  return curl([...common(t), `url = ${q(rootUrl(t))}`, 'list-only', `quote = ${q('DELE ' + full)}`].join('\n') + '\n', 60000);
}
const FATAL = /login|530|Permission denied|\(67\)|\(7\)|\(6\)|Connection (closed|refused|timed out)|Could not resolve/i;
async function publish(id, jl = () => {}, opts = {}) {
  const t = getT(id);
  if (t.protocol === 'sftp') { sftpServer(t); if (IS_WIN && !exists(SFTP)) throw new Error('O Cliente OpenSSH (sftp.exe) não está instalado.'); } else if (!haveCurl()) throw new Error('curl.exe não encontrado.');
  const p = await plan(id);
  if (p.firstRun && !opts.confirmFirst) throw new Error('Primeira publicação precisa de confirmação (sobrescreve arquivos existentes).');
  const prev = loadManifest(t); const { root, files } = await scanLocal(t, prev);
  const man = prev || { at: 0, files: {} }; const todo = [...p.add, ...p.chg];
  jl(`Destino: ${t.name} (${t.protocol.toUpperCase()} ${t.user}@${t.host}${t.remoteDir ? ' ' + t.remoteDir : ''})`);
  jl(`Enviar ${todo.length} arquivo(s) (${p.add.length} novos, ${p.chg.length} alterados). ${p.del.length ? `${p.del.length} removido(s) localmente` + (opts.deleteRemoved ? ' serão apagados no servidor.' : ' ficam no servidor.') : ''}`);
  const t0 = Date.now(); let ok = 0; const failed = []; let fatal = false;
  for (let i = 0; i < todo.length && !fatal; i += 40) {
    const batch = todo.slice(i, i + 40); const r = await uploadBatch(t, root, batch);
    if (r.code === 0) { for (const f of batch) man.files[f] = files.get(f); ok += batch.length; }
    else {
      for (const f of batch) {
        const one = await uploadBatch(t, root, [f]);
        if (one.code === 0) { man.files[f] = files.get(f); ok++; } else {
          failed.push(f); jl(`✖ ${f}: ${explain(t, one.err)}`);
          if (FATAL.test(one.err)) { fatal = true; jl('Parando: o servidor recusou ou ficou inacessível.'); break; }
        }
      }
    }
    man.at = Date.now(); saveManifest(t, man); jl(`  ${Math.min(i + 40, todo.length)}/${todo.length}`);
  }
  let deleted = 0;
  if (opts.deleteRemoved && !failed.length) {
    for (const r of p.del) {
      const res = await deleteRemote(t, r);
      if (res.code === 0 || /550|No such file|not found|\(78\)/i.test(res.err)) { delete man.files[r]; deleted++; jl(`  apagado: ${r}`); } else jl(`✖ não apagou ${r}: ${explain(t, res.err)}`);
    }
    saveManifest(t, man);
  }
  const msg = failed.length ? `${ok} enviado(s), ${failed.length} falhou(aram)` : `${ok} enviado(s)${deleted ? `, ${deleted} apagado(s)` : ''} em ${Math.round((Date.now() - t0) / 1000)}s`;
  t.last = { at: Date.now(), ok: !failed.length, msg }; save();
  notify().event(failed.length ? 'fail' : 'ok', `Publicação ${failed.length ? 'COM FALHAS' : 'concluída'}: ${t.name}`, `${t.name}: ${msg}`);
  if (failed.length) throw new Error(`${failed.length} arquivo(s) não foram enviados (veja o log). O que subiu ficou registrado; rode de novo para tentar o resto.`);
  jl(`\nPublicado: ${msg}.`); log(`FTP "${t.name}": ${msg}.`);
}

module.exports = { lists, save: save_, remove, test, plan, baseline, publish, urlFor, rootUrl, matcher, never, DEFAULT_EXCLUDES };
