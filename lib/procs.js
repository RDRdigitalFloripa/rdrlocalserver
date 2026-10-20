'use strict';
/** Processos por site: fila (queue:work), agendador (schedule:work) e Vite (npm run dev). Mais leitura do laravel.log. */
const fs = require('fs');
const path = require('path');
const core = require('./core');
const comps = require('./components');
const sites = require('./sites');
const { P, IS_WIN, cfg, log, exists, spawnLogged, killTree, tail } = core;

const running = new Map(); // "siteId:kind" -> ChildProcess
const hasArtisan = (s) => !!s.path && exists(path.join(s.path, 'artisan'));
const KINDS = {
  queue: { label: 'Fila (queue:work)', ok: hasArtisan, php: ['artisan', 'queue:work', '--tries=3', '--sleep=1'] },
  schedule: { label: 'Agendador (schedule:work)', ok: hasArtisan, php: ['artisan', 'schedule:work'] },
  vite: { label: 'Vite (npm run dev)', ok: (s) => !!s.path && exists(path.join(s.path, 'package.json')), npm: ['run', 'dev'] },
  tunnel: { label: 'Túnel público (Cloudflared)', ok: () => comps.isInstalled.cloudflared(), tunnel: true },
};
const tunnelStart = new Map(); // siteId -> posição do log no início da execução
const TUNNEL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;
const ID_RE = /^[a-z0-9]{3,20}$/;
const logName = (id, kind) => `proc-${id}-${kind}`;

function site(id) { const s = cfg.sites.find((x) => x.id === id); if (!s) throw new Error('Site não encontrado'); return s; }
const status = (id) => Object.fromEntries(Object.keys(KINDS).map((k) => [k, running.has(`${id}:${k}`)]));
const capabilities = (s) => Object.fromEntries(Object.keys(KINDS).map((k) => [k, KINDS[k].ok(s)]));

function start(id, kind) {
  const s = site(id); const def = KINDS[kind]; if (!def) throw new Error('Processo desconhecido');
  const key = `${id}:${kind}`; if (running.has(key)) return;
  if (!def.ok(s)) throw new Error(kind === 'tunnel' ? 'Instale o Cloudflared na aba Componentes.' : kind === 'vite' ? 'Este projeto não tem package.json.' : 'Este projeto não é Laravel (sem artisan).');
  let child;
  if (def.tunnel) {
    const name = logName(id, kind); const lf = path.join(P.logs, name + '.log');
    try { tunnelStart.set(id, fs.statSync(lf).size); } catch (_) { tunnelStart.set(id, 0); }
    child = spawnLogged(name, comps.bins.cloudflared(), ['tunnel', '--no-autoupdate', '--url', `https://127.0.0.1:${cfg.ports.https}`, '--no-tls-verify', '--origin-server-name', s.domain, '--http-host-header', s.domain], { cwd: P.root });
  } else if (def.php) {
    const ver = sites.resolvePhp(s); if (!ver) throw new Error('Este site está sem PHP.');
    child = spawnLogged(logName(id, kind), comps.bins.phpCli(ver), def.php, { cwd: s.path, env: sites.terminalEnv(s) });
  } else {
    child = spawnLogged(logName(id, kind), IS_WIN ? 'npm.cmd' : 'npm', def.npm, { cwd: s.path, env: sites.terminalEnv(s), shell: IS_WIN });
  }
  running.set(key, child);
  child.on('exit', (code) => { if (running.get(key) === child) { running.delete(key); log(`${def.label} de ${s.name} encerrou (código ${code}).`); } });
  log(`${def.label} iniciado para ${s.name}.`);
}
/** Endereço público do túnel (lido do log da execução atual) ou ''. */
function tunnelUrl(id) {
  if (!running.has(`${id}:tunnel`)) return '';
  try {
    const buf = fs.readFileSync(path.join(P.logs, logName(id, 'tunnel') + '.log'));
    const m = buf.slice(tunnelStart.get(id) || 0).toString('utf8').match(TUNNEL_RE);
    return m ? m[0] : '';
  } catch (_) { return ''; }
}
function stop(id, kind) { const key = `${id}:${kind}`; const c = running.get(key); if (c) { running.delete(key); killTree(c); } }
function stopSite(id) { Object.keys(KINDS).forEach((k) => stop(id, k)); }
function stopAll() { for (const key of [...running.keys()]) { const [id, k] = key.split(':'); stop(id, k); } }

/** Último arquivo .log em storage/logs do projeto Laravel. */
function laravelLogFile(s) {
  const d = path.join(s.path, 'storage', 'logs');
  try {
    const f = fs.readdirSync(d).filter((n) => n.endsWith('.log')).map((n) => ({ n, t: fs.statSync(path.join(d, n)).mtimeMs })).sort((a, b) => b.t - a.t)[0];
    return f ? path.join(d, f.n) : '';
  } catch (_) { return ''; }
}

/** Texto de um log "especial": laravel:<id> ou proc:<id>:<kind>. */
function readSpecial(name) {
  let m = name.match(/^laravel:([a-z0-9]+)$/);
  if (m) {
    if (!ID_RE.test(m[1])) throw new Error('Nome inválido');
    const f = laravelLogFile(site(m[1]));
    return f ? tail(f, 40000) : '(nenhum arquivo em storage/logs ainda)';
  }
  m = name.match(/^proc:([a-z0-9]+):(queue|schedule|vite|tunnel)$/);
  if (m) { if (!ID_RE.test(m[1])) throw new Error('Nome inválido'); return tail(path.join(P.logs, logName(m[1], m[2]) + '.log')); }
  return null;
}

// ---------- comandos rápidos (viram tarefa com log) ----------
const COMMANDS = {
  migrate: { label: 'artisan migrate', laravel: true, args: ['artisan', 'migrate', '--force'] },
  'migrate-fresh': { label: 'artisan migrate:fresh --seed', laravel: true, args: ['artisan', 'migrate:fresh', '--seed', '--force'] },
  clear: { label: 'artisan optimize:clear', laravel: true, args: ['artisan', 'optimize:clear'] },
  'storage-link': { label: 'artisan storage:link', laravel: true, args: ['artisan', 'storage:link'] },
  'composer-install': { label: 'composer install', laravel: false, composer: true, args: ['install'] },
};
function runCommand(id, cmd, jl) {
  const s = site(id); const c = COMMANDS[cmd]; if (!c) throw new Error('Comando desconhecido');
  if (!s.path) throw new Error('Este site não tem pasta de projeto.');
  if (c.laravel && !hasArtisan(s)) throw new Error('Este projeto não é Laravel (sem artisan).');
  if (c.composer && !exists(path.join(s.path, 'composer.json'))) throw new Error('Este projeto não tem composer.json.');
  const ver = sites.resolvePhp(s); if (!ver) throw new Error('Este site está sem PHP.');
  const args = c.composer ? [comps.bins.composerPhar(), ...c.args] : c.args;
  jl(`> php ${args.join(' ')}   (em ${s.path})`);
  return core.runStreamed(comps.bins.phpCli(ver), args, jl, { cwd: s.path, env: sites.terminalEnv(s) });
}

module.exports = { tunnelUrl, COMMANDS, runCommand, KINDS, status, capabilities, start, stop, stopSite, stopAll, readSpecial, laravelLogFile };
