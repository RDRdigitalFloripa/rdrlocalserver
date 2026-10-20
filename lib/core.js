'use strict';
/** Núcleo: caminhos, config, log, jobs, rede, utilidades. Zero dependências. */
const fs = require('fs');
const path = require('path');
const net = require('net');
const https = require('https');
const { execFile, spawn } = require('child_process');

const APP_DIR = path.resolve(__dirname, '..');
const ROOT = process.env.RDR_HOME ? path.resolve(process.env.RDR_HOME) : APP_DIR;
const IS_WIN = process.platform === 'win32';
const P = {
  app: APP_DIR,
  root: ROOT,
  bin: path.join(ROOT, 'bin'),
  data: path.join(ROOT, 'data'),
  logs: path.join(ROOT, 'logs'),
  conf: path.join(ROOT, 'config'),
};
for (const d of [P.bin, P.data, P.logs, P.conf, path.join(P.logs, 'sites')]) fs.mkdirSync(d, { recursive: true });

const HOSTS_FILE = process.env.RDR_HOSTS || (IS_WIN
  ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'drivers', 'etc', 'hosts')
  : '/etc/hosts');

const exists = (p) => { try { fs.accessSync(p); return true; } catch (_) { return false; } };
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch (_) { return false; } };
const fwd = (s) => String(s).replace(/\\/g, '/');
const X = (p) => p + (IS_WIN ? '.exe' : '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const slug = (s) => String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// ---------- config ----------
const CFG_FILE = path.join(P.conf, 'config.json');
const DEFAULTS = {
  tld: 'test',
  projectsRoot: '',
  phpDefault: '',
  // Portas dos bancos diferentes das padrão para conviver com ServBay/XAMPP.
  ports: { http: 80, https: 443, mariadb: 3307, postgres: 5433, redis: 6380, mailpitSmtp: 1026, mailpitUi: 8026, meilisearch: 7710 },
  phpPorts: {},
  autoStartServices: false,
  backup: { enabled: false, freq: 'daily', time: '03:00', keep: 7, last: 0, lastMsg: '' },
  cloud: { enabled: false, remote: '', path: 'RDR-Local-Backup', encrypt: false, includeConfig: true, projects: 'none', retainDays: 0, last: 0, lastOk: null, lastMsg: '', lastVerify: '' },
  notify: { onFail: true, onOk: false, telegramChatId: '' },
  github: { clientId: '', user: '', privateRepos: false },
  servers: [], sshKeys: [], recipes: [], ftpTargets: [],
  sites: [],
};
function loadCfg() {
  let j = {};
  try { j = JSON.parse(fs.readFileSync(CFG_FILE, 'utf8')); } catch (_) { /* primeiro uso */ }
  const out = { ...DEFAULTS, ...j, ports: { ...DEFAULTS.ports, ...(j.ports || {}) }, phpPorts: j.phpPorts || {}, backup: { ...DEFAULTS.backup, ...(j.backup || {}) }, cloud: { ...DEFAULTS.cloud, ...(j.cloud || {}) }, notify: { ...DEFAULTS.notify, ...(j.notify || {}) }, github: { ...DEFAULTS.github, ...(j.github || {}) }, servers: j.servers || [], sshKeys: j.sshKeys || [], recipes: j.recipes || [], ftpTargets: j.ftpTargets || [], sites: j.sites || [] };
  // v2: Mailpit saiu de 1025/8025 (portas do ServBay) para 1026/8026
  if ((j.v || 1) < 2) {
    if (out.ports.mailpitSmtp === 1025) out.ports.mailpitSmtp = 1026;
    if (out.ports.mailpitUi === 8025) out.ports.mailpitUi = 8026;
  }
  out.v = 2;
  return out;
}
const cfg = loadCfg();
const save = () => fs.writeFileSync(CFG_FILE, JSON.stringify(cfg, null, 2));

// ---------- log do painel ----------
const panelLog = [];
function log(msg) {
  const line = `[${new Date().toLocaleTimeString('pt-BR')}] ${msg}`;
  panelLog.push(line);
  if (panelLog.length > 300) panelLog.shift();
  console.log(line);
}

// ---------- jobs (tarefas longas: instalar, criar projeto) ----------
const jobs = [];
let jobSeq = 0;
function startJob(title, fn, lock) {
  const running = jobs.find((j) => j.status === 'running' && lock && j.lock === lock);
  if (running) throw new Error(`Já existe uma tarefa em andamento: ${running.title}`);
  const job = { id: ++jobSeq, title, lock, status: 'running', log: [] };
  jobs.push(job);
  if (jobs.length > 15) jobs.shift();
  const jl = (m) => { job.log.push(String(m)); if (job.log.length > 500) job.log.shift(); };
  Promise.resolve().then(() => fn(jl)).then(
    () => { job.status = 'done'; jl('Concluído.'); log(`✔ ${title}`); },
    (e) => { job.status = 'error'; jl('ERRO: ' + e.message); log(`✖ ${title}: ${e.message}`); },
  );
  return job;
}

// ---------- processos ----------
// Mensagens de programas do Windows saem em CP850 (console). Decodifica sem virar "�".
const CP850 = 'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜø£Ø×ƒáíóúñÑªº¿®¬½¼¡«»░▒▓│┤ÁÂÀ©╣║╗╝¢¥┐└┴┬├─┼ãÃ╚╔╩╦╠═╬¤ðÐÊËÈıÍÎÏ┘┌█▄¦Ì▀ÓßÔÒõÕµþÞÚÛÙýÝ¯´\u00AD±‗¾¶§÷¸°¨·¹³²■\u00A0';
function decode(buf) {
  if (!buf || !buf.length) return '';
  if (typeof buf === 'string') return buf;
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch (_) { /* não é UTF-8 */ }
  if (!IS_WIN) return buf.toString('latin1');
  let s = '';
  for (const b of buf) s += b < 0x80 ? String.fromCharCode(b) : CP850[b - 0x80];
  return s;
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, timeout: 120000, maxBuffer: 8 * 1024 * 1024, encoding: 'buffer', ...opts }, (err, stdout, stderr) => {
      resolve({ ok: !err, code: err ? err.code : 0, out: `${decode(stdout)}${decode(stderr)}`.trim() });
    });
  });
}

/** Roda comando mostrando a saída no log do job. */
function runStreamed(cmd, args, jl, opts = {}) {
  return new Promise((resolve, reject) => {
    const c = spawn(cmd, args, { windowsHide: true, ...opts });
    const pipe = (d) => decode(d).split(/\r?\n/).filter(Boolean).forEach((l) => jl(l));
    c.stdout.on('data', pipe); c.stderr.on('data', pipe);
    c.on('error', reject);
    c.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${path.basename(cmd)} terminou com código ${code}`))));
  });
}

function spawnLogged(name, cmd, args, opts = {}) {
  const file = path.join(P.logs, name + '.log');
  try { if (fs.statSync(file).size > 5 * 1024 * 1024) fs.renameSync(file, file + '.old'); } catch (_) { /* ok */ }
  const fd = fs.openSync(file, 'a');
  const child = spawn(cmd, args, { cwd: opts.cwd || P.root, env: opts.env || process.env, windowsHide: true, shell: !!opts.shell, detached: !IS_WIN && !!opts.detached, stdio: ['ignore', fd, fd] });
  fs.closeSync(fd);
  child.on('error', (e) => log(`${name}: ${e.message}`));
  return child;
}

function tail(file, bytes = 16384) {
  try {
    const st = fs.statSync(file);
    const fd = fs.openSync(file, 'r');
    const len = Math.min(bytes, st.size);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, st.size - len);
    fs.closeSync(fd);
    return decode(buf);
  } catch (_) { return ''; }
}

function portFree(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.once('listening', () => s.close(() => resolve(true)));
    s.listen(port);
  });
}

// ---------- download / arquivos ----------
function get(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 8) return reject(new Error('Muitos redirecionamentos'));
    https.get(url, { headers: { 'User-Agent': 'rdr-local', Accept: '*/*' } }, (r) => {
      if ([301, 302, 303, 307, 308].includes(r.statusCode)) {
        r.resume(); return resolve(get(new URL(r.headers.location, url).href, redirects + 1));
      }
      if (r.statusCode !== 200) { r.resume(); return reject(new Error(`HTTP ${r.statusCode} — ${url}`)); }
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => resolve(Buffer.concat(chunks)));
      r.on('error', reject);
    }).on('error', reject);
  });
}
const getJson = async (url) => JSON.parse((await get(url)).toString('utf8'));

function download(url, dest, jl, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 8) return reject(new Error('Muitos redirecionamentos'));
    https.get(url, { headers: { 'User-Agent': 'rdr-local', Accept: '*/*' } }, (r) => {
      if ([301, 302, 303, 307, 308].includes(r.statusCode)) {
        r.resume(); return resolve(download(new URL(r.headers.location, url).href, dest, jl, redirects + 1));
      }
      if (r.statusCode !== 200) { r.resume(); return reject(new Error(`HTTP ${r.statusCode} — ${url}`)); }
      const total = Number(r.headers['content-length']) || 0;
      let got = 0; let next = 0.2;
      const f = fs.createWriteStream(dest);
      r.on('data', (c) => {
        got += c.length;
        if (jl && total && got / total >= next) { jl(`  ${Math.round((got / total) * 100)}% de ${(total / 1048576).toFixed(0)} MB`); next += 0.2; }
      });
      r.pipe(f);
      f.on('finish', () => f.close(() => resolve(dest)));
      f.on('error', reject); r.on('error', reject);
    }).on('error', reject);
  });
}

/** Se a pasta tem só uma subpasta (ex.: "pgsql/"), sobe o conteúdo um nível. */
function flatten(dir) {
  const items = fs.readdirSync(dir);
  if (items.length === 1 && isDir(path.join(dir, items[0]))) {
    const sub = path.join(dir, items[0]);
    for (const n of fs.readdirSync(sub)) fs.renameSync(path.join(sub, n), path.join(dir, n));
    fs.rmdirSync(sub);
  }
}

async function unzip(zip, dest) {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  const r = await run('tar', ['-xf', zip, '-C', dest], { timeout: 600000 }); // bsdtar já vem no Windows 10+
  if (!r.ok) throw new Error('Falha ao extrair o arquivo: ' + r.out.slice(-300));
  flatten(dest);
}

function findFile(dir, name, depth = 4) {
  if (depth < 0 || !isDir(dir)) return null;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isFile() && e.name.toLowerCase() === name.toLowerCase()) return full;
  }
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { const f = findFile(path.join(dir, e.name), name, depth - 1); if (f) return f; }
  }
  return null;
}

/** Encerra um processo e seus filhos (npm, cmd...). */
function killTree(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  if (IS_WIN) { try { require('child_process').execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {}); } catch (_) { /* ok */ } return; }
  try { process.kill(-child.pid, 'SIGTERM'); return; } catch (_) { /* não é líder de grupo */ }
  try { child.kill(); } catch (_) { /* ok */ }
}

module.exports = {
  killTree, P, IS_WIN, HOSTS_FILE, cfg, save, log, panelLog, jobs, startJob,
  exists, isDir, fwd, X, sleep, slug,
  run, runStreamed, spawnLogged, tail, portFree, decode,
  get, getJson, download, unzip, flatten, findFile,
};
