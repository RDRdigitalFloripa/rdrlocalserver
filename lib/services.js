// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 RDR Digital - https://github.com/RDRdigitalFloripa/rdrlocalserver
'use strict';
/** Serviços: Web (Caddy + PHP-CGI), MariaDB, PostgreSQL, Redis, Mailpit. */
const fs = require('fs');
const path = require('path');
const core = require('./core');
const comps = require('./components');
const sites = require('./sites');
const { P, IS_WIN, cfg, save, log, exists, fwd, sleep, run, spawnLogged, tail, portFree } = core;

const dns = require('./dns');
const LABELS = { dns: 'DNS local', web: 'Servidor Web', mariadb: 'MariaDB', postgres: 'PostgreSQL', redis: 'Redis', mailpit: 'Mailpit', meilisearch: 'Meilisearch' };
const procs = {};          // id -> ChildProcess
const phpProcs = {};       // versão -> ChildProcess[]
const busy = new Set();    // serviços em transição

const caddyEnv = () => ({ ...process.env, XDG_DATA_HOME: path.join(P.data, 'caddy') });
const dataDir = (n) => path.join(P.data, n);

function track(id, child) {
  procs[id] = child;
  child.on('exit', (code) => {
    if (procs[id] === child) { delete procs[id]; log(`${LABELS[id]} encerrou (código ${code}).`); }
  });
}

async function checkPorts(ports) {
  for (const p of ports) {
    if (!(await portFree(p))) throw new Error(`Porta ${p} já está em uso (outro ServBay/XAMPP/serviço?). Pare o outro ou mude a porta em Configurações.`);
  }
}
async function aliveAfter(id, ms = 1200) {
  await sleep(ms);
  if (!procs[id]) {
    const lines = tail(path.join(P.logs, id + '.log'), 1500).split('\n').slice(-8).join('\n');
    const hint = id === 'meilisearch' && /incompatible with your current engine version/i.test(lines)
      ? '\n\nO banco foi criado por outra versão do Meilisearch. O RDR Local migra sozinho (com cópia de segurança em data\\meilisearch\\backup-…) quando o banco é MAIS ANTIGO que o programa; se o seu é mais novo, atualize o Meilisearch em Componentes e PHP. Se a migração falhou, a cópia continua lá: renomeie data.ms e a pasta backup-… para restaurar.'
      : '';
    throw new Error(`${LABELS[id]} não iniciou. Últimas linhas do log:\n${lines}${hint}`);
  }
}

// ---------- definições dos serviços de dados ----------
const SV = {
  mariadb: {
    installed: () => comps.isInstalled.mariadb(),
    ports: () => [cfg.ports.mariadb],
    async prepare() {
      const base = comps.dir('mariadb'); const data = dataDir('mariadb');
      const ini = path.join(P.conf, 'my.ini');
      fs.writeFileSync(ini, [
        '[mysqld]', `basedir=${fwd(base)}`, `datadir=${fwd(data)}`, `port=${cfg.ports.mariadb}`, 'bind-address=127.0.0.1',
        'character-set-server=utf8mb4', 'collation-server=utf8mb4_unicode_ci', 'max_allowed_packet=256M', 'skip-name-resolve',
        'innodb_buffer_pool_size=256M', '', '[client]', `port=${cfg.ports.mariadb}`, 'default-character-set=utf8mb4', '',
      ].join('\n'));
      if (!exists(path.join(data, 'mysql'))) {
        log('MariaDB: inicializando o diretório de dados (primeira vez)...');
        fs.mkdirSync(data, { recursive: true });
        const r = await run(comps.bins.mariadbInstallDb(), [`--datadir=${data}`, `--port=${cfg.ports.mariadb}`], { timeout: 180000 });
        if (!r.ok) throw new Error('Falha ao inicializar o MariaDB: ' + r.out.slice(-400));
      }
    },
    cmd: () => comps.bins.mariadbd(),
    args: () => [`--defaults-file=${path.join(P.conf, 'my.ini')}`, '--console'],
    stop: () => run(comps.bins.mariadbAdmin(), ['-h127.0.0.1', `-P${cfg.ports.mariadb}`, '-uroot', '--protocol=tcp', 'shutdown']),
  },
  postgres: {
    installed: () => comps.isInstalled.postgres(),
    ports: () => [cfg.ports.postgres],
    async prepare() {
      const data = dataDir('postgres');
      if (!exists(path.join(data, 'PG_VERSION'))) {
        log('PostgreSQL: inicializando o cluster (primeira vez)...');
        fs.mkdirSync(data, { recursive: true });
        const r = await run(comps.bins.pg('initdb'), ['-D', data, '-U', 'postgres', '-A', 'trust', '-E', 'UTF8', '--no-locale'], { timeout: 180000 });
        if (!r.ok) throw new Error('Falha no initdb: ' + r.out.slice(-400));
      }
    },
    cmd: () => comps.bins.pg('postgres'),
    args: () => ['-D', dataDir('postgres'), '-p', String(cfg.ports.postgres), '-c', 'listen_addresses=127.0.0.1'],
    stop: () => run(comps.bins.pg('pg_ctl'), ['stop', '-D', dataDir('postgres'), '-m', 'fast']),
  },
  redis: {
    installed: () => comps.isInstalled.redis(),
    ports: () => [cfg.ports.redis],
    prepare() { fs.mkdirSync(dataDir('redis'), { recursive: true }); },
    cmd: () => comps.bins.redisServer(),
    args: () => ['--port', String(cfg.ports.redis), '--bind', '127.0.0.1', '--dir', dataDir('redis'), '--appendonly', 'no'],
    cwd: () => dataDir('redis'),
    stop: () => run(comps.bins.redisCli(), ['-p', String(cfg.ports.redis), 'shutdown', 'save']),
  },
  mailpit: {
    installed: () => comps.isInstalled.mailpit(),
    ports: () => [cfg.ports.mailpitSmtp, cfg.ports.mailpitUi],
    prepare() { fs.mkdirSync(dataDir('mailpit'), { recursive: true }); },
    cmd: () => comps.bins.mailpit(),
    args: () => ['--smtp', `127.0.0.1:${cfg.ports.mailpitSmtp}`, '--listen', `127.0.0.1:${cfg.ports.mailpitUi}`, '--database', path.join(dataDir('mailpit'), 'mailpit.db')],
  },
};

// O Meilisearch não abre um banco criado por uma versão anterior (muda a cada versão menor: 1.55 -> 1.56): sem esta etapa,
// atualizar o programa em "Componentes e PHP" deixava o serviço sem iniciar ("Your database version is incompatible...").
const meiliMinor = (v) => { const m = /^(\d+)\.(\d+)/.exec(String(v || '').trim().replace(/^v/i, '')); return m ? [Number(m[1]), Number(m[2])] : null; };
/** 'none' (mesma versão menor ou sem dado), 'upgrade' (banco mais antigo que o programa) ou 'downgrade' (banco mais novo). */
function meiliMigration(dbVersion, binVersion) {
  const d = meiliMinor(dbVersion); const b = meiliMinor(binVersion); if (!d || !b) return 'none';
  const diff = (b[0] - d[0]) || (b[1] - d[1]);
  return diff > 0 ? 'upgrade' : diff < 0 ? 'downgrade' : 'none';
}
let meiliUpgrade = false; // vale para a próxima partida: liga --upgrade-db
const meiliDbVersion = () => { try { return fs.readFileSync(path.join(dataDir('meilisearch'), 'data.ms', 'VERSION'), 'utf8').trim(); } catch (_) { return ''; } };
function meiliPrepare() {
  const root = dataDir('meilisearch'); fs.mkdirSync(root, { recursive: true });
  meiliUpgrade = false;
  const dbv = meiliDbVersion(); const binv = comps.version('meilisearch');
  const what = meiliMigration(dbv, binv);
  if (what === 'downgrade') throw new Error(`O banco do Meilisearch foi criado pela versão ${dbv}, mais nova que a instalada (${binv}); o Meilisearch não volta a versão antiga de um banco. Atualize o Meilisearch em Componentes e PHP. (Nada foi alterado.)`);
  if (what !== 'upgrade') return;
  // cópia de segurança ANTES de migrar (a migração não tem volta): data.ms -> backup-<versão antiga>-<data>; mantém só as 2 mais novas
  const now = new Date(); const p2 = (n) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${p2(now.getMonth() + 1)}${p2(now.getDate())}-${p2(now.getHours())}${p2(now.getMinutes())}${p2(now.getSeconds())}`; // hora local, a mesma dos logs
  const bak = path.join(root, `backup-${dbv}-${stamp}`);
  log(`Meilisearch: o banco é da versão ${dbv} e o programa é ${binv}. Fazendo a cópia de segurança em ${bak}...`);
  try { fs.cpSync(path.join(root, 'data.ms'), path.join(bak, 'data.ms'), { recursive: true }); } catch (e) {
    try { fs.rmSync(bak, { recursive: true, force: true }); } catch (_) { /* ok */ }
    throw new Error(`Não consegui fazer a cópia de segurança do banco do Meilisearch (${String(e.message).slice(0, 120)}). Nada foi migrado. Libere espaço em disco e tente de novo.`);
  }
  try { for (const n of fs.readdirSync(root).filter((x) => /^backup-/.test(x)).sort().slice(0, -2)) fs.rmSync(path.join(root, n), { recursive: true, force: true }); } catch (_) { /* limpeza é só conveniência */ }
  meiliUpgrade = true;
  log(`Meilisearch: migrando o banco ${dbv} -> ${binv} (--upgrade-db). Se algo der errado, a cópia está em ${bak}.`);
}
SV.meilisearch = {
  installed: () => comps.isInstalled.meilisearch(),
  ports: () => [cfg.ports.meilisearch],
  prepare: meiliPrepare,
  cmd: () => comps.bins.meilisearch(),
  args: () => ['--http-addr', `127.0.0.1:${cfg.ports.meilisearch}`, '--db-path', path.join(dataDir('meilisearch'), 'data.ms'), '--env', 'development', '--no-analytics',
    '--dump-dir', path.join(dataDir('meilisearch'), 'dumps'), '--snapshot-dir', path.join(dataDir('meilisearch'), 'snapshots'), ...(meiliUpgrade ? ['--upgrade-db'] : [])],
  cwd: () => dataDir('meilisearch'),
};

async function gracefulStop(id) {
  const child = procs[id]; if (!child) return;
  const exited = new Promise((r) => child.once('exit', () => r('exit')));
  if (SV[id] && SV[id].stop) { try { await SV[id].stop(); } catch (_) { /* cai no kill */ } } else { try { child.kill(); } catch (_) { /* ok */ } }
  const res = await Promise.race([exited, sleep(12000).then(() => 'timeout')]);
  if (res === 'timeout') { try { child.kill(); } catch (_) { /* ok */ } await Promise.race([exited, sleep(3000)]); }
}

// ---------- PostgreSQL via pg_ctl ----------
// postgres.exe recusa rodar como Administrador; o pg_ctl no Windows rebaixa o privilégio sozinho.
let pgUp = false;
async function pgStatus() {
  if (!comps.isInstalled.postgres()) { pgUp = false; return; }
  pgUp = (await run(comps.bins.pg('pg_ctl'), ['status', '-D', dataDir('postgres')])).ok;
}
pgStatus().catch(() => {});
setInterval(() => { pgStatus().catch(() => {}); }, 4000).unref();

async function startPg() {
  await pgStatus();
  if (pgUp) return;
  await checkPorts(SV.postgres.ports());
  await SV.postgres.prepare();
  const logf = path.join(P.logs, 'postgres.log');
  const r = await run(comps.bins.pg('pg_ctl'), ['start', '-D', dataDir('postgres'), '-w', '-t', '40', '-l', logf, '-o', `-p ${cfg.ports.postgres} -c listen_addresses=127.0.0.1`], { timeout: 60000 });
  await pgStatus();
  if (!r.ok || !pgUp) throw new Error(`PostgreSQL não iniciou. ${r.out.slice(-300)}\n${tail(logf, 1500).split('\n').slice(-6).join('\n')}`.trim());
  log('PostgreSQL ativo.');
}
async function stopPg() {
  await run(comps.bins.pg('pg_ctl'), ['stop', '-D', dataDir('postgres'), '-m', 'fast', '-w', '-t', '30'], { timeout: 45000 });
  await pgStatus();
}
const up = (id) => (id === 'postgres' ? pgUp : id === 'dns' ? dns.isRunning() : !!procs[id]);

// ---------- web ----------
function startPhpWorkers() {
  for (const ver of sites.usedPhpVersions()) {
    if (phpProcs[ver] && phpProcs[ver].length) continue;
    phpProcs[ver] = sites.workerPorts(ver).map((port) => {
      const c = spawnLogged(`php-${ver}`, comps.bins.phpCgi(ver), ['-b', `127.0.0.1:${port}`, '-c', comps.bins.phpDir(ver)], {
        env: { ...process.env, PHP_FCGI_MAX_REQUESTS: '0' },
      });
      c.on('exit', () => { if (phpProcs[ver]) phpProcs[ver] = phpProcs[ver].filter((x) => x !== c); });
      return c;
    });
    log(`PHP ${ver}: ${sites.WORKERS} workers (portas ${sites.workerPorts(ver)[0]}-${sites.workerPorts(ver)[sites.WORKERS - 1]}).`);
  }
  // encerra versões que ninguém mais usa
  const used = new Set(sites.usedPhpVersions());
  for (const ver of Object.keys(phpProcs)) {
    if (!used.has(ver)) { phpProcs[ver].forEach((c) => { try { c.kill(); } catch (_) { /* ok */ } }); delete phpProcs[ver]; }
  }
}

/** Para os workers de uma versão do PHP (antes de trocar os arquivos dela). */
async function stopPhp(ver) {
  (phpProcs[ver] || []).forEach((c) => { try { c.kill(); } catch (_) { /* ok */ } });
  delete phpProcs[ver];
  await sleep(700);
}

/** Reinicia os workers de uma versão do PHP (depois de mudar o php.ini). */
async function restartPhp(ver) {
  const list = phpProcs[ver]; if (!list || !list.length) return;
  list.forEach((c) => { try { c.kill(); } catch (_) { /* ok */ } });
  delete phpProcs[ver];
  await sleep(700);
  startPhpWorkers();
}

async function caddyValidate() {
  sites.writeCaddyfile();
  const r = await run(comps.bins.caddy(), ['validate', '--config', sites.CADDYFILE, '--adapter', 'caddyfile'], { env: caddyEnv() });
  if (!r.ok) throw new Error('Caddyfile inválido: ' + r.out.slice(-500));
}

async function startWeb() {
  if (!comps.isInstalled.caddy()) throw new Error('Instale o Caddy em Componentes.');
  if (!comps.phpInstalled().length) log('Aviso: nenhum PHP instalado — os sites serão servidos como estáticos.');
  await checkPorts([cfg.ports.http, cfg.ports.https]);
  comps.ensureAllPhpIni();
  comps.ensureTools();
  sites.syncHosts();
  await caddyValidate();
  startPhpWorkers();
  track('web', spawnLogged('web', comps.bins.caddy(), ['run', '--config', sites.CADDYFILE, '--adapter', 'caddyfile'], { cwd: P.data, env: caddyEnv() }));
  await aliveAfter('web', 900);
  log('Servidor Web ativo.');
  require('./apps').startAll().catch((e) => log('Apps: ' + e.message));
  if (IS_WIN && !cfg.caTrusted) trustCa().catch((e) => log('Confiar na CA: ' + e.message));
}

async function stopWeb() {
  await require('./apps').stopAll().catch(() => {});
  for (const ver of Object.keys(phpProcs)) phpProcs[ver].forEach((c) => { try { c.kill(); } catch (_) { /* ok */ } });
  for (const k of Object.keys(phpProcs)) delete phpProcs[k];
  const c = procs.web;
  if (c) { const ex = new Promise((r) => c.once('exit', r)); try { c.kill(); } catch (_) { /* ok */ } await Promise.race([ex, sleep(4000)]); }
}

/** Chamado quando sites mudam: atualiza hosts, PHP workers e recarrega o Caddy sem derrubar. */
async function reloadWeb() {
  sites.writeCaddyfile();
  sites.syncHosts();
  if (!procs.web) return;
  await caddyValidate();
  startPhpWorkers();
  const r = await run(comps.bins.caddy(), ['reload', '--config', sites.CADDYFILE, '--adapter', 'caddyfile', '--address', '127.0.0.1:20190'], { env: caddyEnv(), cwd: P.data });
  if (!r.ok) throw new Error('Falha ao recarregar o Caddy: ' + r.out.slice(-300));
}

// ---------- CA local ----------
const rootCrt = () => path.join(P.data, 'caddy', 'caddy', 'pki', 'authorities', 'local', 'root.crt');

/** Instala a CA local do Caddy no Windows (loja "Raízes Confiáveis"). Precisa de administrador. */
async function trustCa() {
  if (!IS_WIN) throw new Error(`Confiar na CA automaticamente só funciona no Windows. Importe manualmente: ${rootCrt()}`);
  if (!exists(rootCrt())) {
    if (!procs.web) throw new Error('Inicie o Servidor Web (com pelo menos um site) para gerar a CA e tente de novo.');
    for (let i = 0; i < 20 && !exists(rootCrt()); i++) await sleep(500);
  }
  if (!exists(rootCrt())) throw new Error('A CA ainda não foi gerada. Adicione um site, reinicie o Servidor Web e tente de novo.');
  const r = await run('certutil', ['-addstore', '-f', 'Root', rootCrt()]);
  if (!r.ok) throw new Error('Falha ao instalar o certificado (abra o RDR Local como Administrador): ' + r.out.slice(-200));
  cfg.caTrusted = true; save();
  log('CA local instalada como confiável (Chrome/Edge). No Firefox, ative security.enterprise_roots.enabled em about:config.');
}

// ---------- API ----------
async function start(id) {
  if (!LABELS[id]) throw new Error('Serviço desconhecido');
  if (busy.has(id)) return;
  busy.add(id);
  try {
    if (id === 'dns') { await dns.start(); await dns.ensureNrpt().catch((e) => log('DNS local: ' + e.message)); log(`DNS local ativo (*.${cfg.tld} → 127.0.0.1).`); return; }
    if (id === 'web') { if (!procs.web) await startWeb(); return; }
    const d = SV[id];
    if (!d.installed()) throw new Error(`${LABELS[id]} não está instalado (aba Componentes).`);
    if (id === 'postgres') { await startPg(); return; }
    if (procs[id]) return;
    await checkPorts(d.ports());
    await d.prepare();
    track(id, spawnLogged(id, d.cmd(), d.args(), { cwd: d.cwd ? d.cwd() : P.root }));
    await aliveAfter(id);
    log(`${LABELS[id]} ativo.`);
  } finally { busy.delete(id); }
}

async function stop(id) {
  if (busy.has(id)) return;
  busy.add(id);
  try {
    if (id === 'dns') { dns.stop(); await dns.removeNrpt().catch(() => {}); } else if (id === 'web') await stopWeb(); else if (id === 'postgres') await stopPg(); else await gracefulStop(id);
    log(`${LABELS[id]} parado.`);
  } finally { busy.delete(id); }
}

async function restart(id) { await stop(id); await start(id); }

async function all(action) {
  const order = [...(cfg.dnsMode ? ['dns'] : []), 'mailpit', 'redis', 'meilisearch', 'mariadb', 'postgres', 'web'];
  const errors = [];
  for (const id of action === 'stop' ? [...order].reverse() : order) {
    const installed = id === 'web' ? comps.isInstalled.caddy() : id === 'dns' ? true : SV[id].installed();
    if (!installed) continue;
    try { if (action === 'stop') await stop(id); else await start(id); } catch (e) { errors.push(`${LABELS[id]}: ${e.message}`); log(`ERRO ${LABELS[id]}: ${e.message}`); }
  }
  if (errors.length) throw new Error(errors.join('\n'));
}

function status() {
  const inst = (id) => (id === 'web' ? comps.isInstalled.caddy() : id === 'dns' ? true : SV[id].installed());
  const ports = {
    dns: [dns.PORT()], web: [cfg.ports.http, cfg.ports.https], mariadb: [cfg.ports.mariadb], postgres: [cfg.ports.postgres],
    redis: [cfg.ports.redis], mailpit: [cfg.ports.mailpitSmtp, cfg.ports.mailpitUi], meilisearch: [cfg.ports.meilisearch],
  };
  const ver = { dns: '', web: comps.version('caddy'), mariadb: comps.version('mariadb'), postgres: comps.version('postgres'), redis: comps.version('redis'), mailpit: comps.version('mailpit'), meilisearch: comps.version('meilisearch') };
  return Object.keys(LABELS).filter((id) => (id !== 'dns' || cfg.dnsMode) && (id !== 'meilisearch' || comps.isInstalled.meilisearch())).map((id) => ({
    id, label: LABELS[id], installed: inst(id), running: up(id), busy: busy.has(id), ports: ports[id], version: ver[id],
  }));
}
const isRunning = (id) => up(id);

async function shutdownAll() {
  if (dns.isRunning()) { dns.stop(); await dns.removeNrpt().catch(() => {}); }
  if (pgUp) await stopPg();
  for (const id of ['mariadb', 'redis', 'mailpit', 'meilisearch']) if (procs[id]) await gracefulStop(id);
  await stopWeb();
}

module.exports = { trustCa, rootCrt, start, stop, restart, all, status, isRunning, reloadWeb, restartPhp, stopPhp, shutdownAll, caddyEnv, SV, meiliMigration };
