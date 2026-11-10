// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 RDR Digital - https://github.com/RDRdigitalFloripa/rdrlocalserver
'use strict';
/** Diagnóstico do ambiente: confere instalação, extensões do PHP, portas, hosts, CA, bancos e o .env dos projetos. */
const fs = require('fs');
const path = require('path');
const core = require('./core');
const comps = require('./components');
const sites = require('./sites');
const net = require('net');
const tcpUp = (host, port) => new Promise((res) => { const c = net.connect({ host, port, timeout: 1500 }); c.once('connect', () => { c.destroy(); res(true); }); c.once('error', () => res(false)); c.once('timeout', () => { c.destroy(); res(false); }); });
const services = require('./services');
const { IS_WIN, cfg, run, exists, portFree } = core;

const NEEDED = ['mbstring', 'openssl', 'curl', 'fileinfo', 'zip', 'intl', 'gd', 'pdo_mysql', 'pdo_pgsql', 'sodium'];
const DRIVER_EXT = { mysql: 'pdo_mysql', mariadb: 'pdo_mysql', pgsql: 'pdo_pgsql', sqlite: 'pdo_sqlite' };
const DRIVER_ENGINE = { mysql: 'mariadb', mariadb: 'mariadb', pgsql: 'postgres' };

function parseEnv(file) {
  const out = {};
  let txt = ''; try { txt = fs.readFileSync(file, 'utf8'); } catch (_) { return null; }
  for (const l of txt.split(/\r?\n/)) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/); if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, ''); }
  return out;
}

async function phpModules(v) {
  const r = await run(comps.bins.phpCli(v), ['-m'], { timeout: 20000 });
  if (!r.ok) return null;
  return new Set(r.out.split(/\r?\n/).map((x) => x.trim().toLowerCase()).filter((x) => x && !x.startsWith('[')));
}

async function check() {
  const out = [];
  const add = (id, group, label, status, detail, fix) => out.push({ id, group, label, status, detail: detail || '', fix: fix || null });

  // Ambiente
  if (IS_WIN) add('admin', 'Ambiente', 'Executando como Administrador', sites.isAdmin() ? 'ok' : 'warn', sites.isAdmin() ? '' : 'Sem administrador o RDR Local não consegue editar o hosts nem instalar a CA. Abra pelo start.bat.');
  const hostsErr = sites.getHostsError();
  add('hosts', 'Ambiente', 'Arquivo hosts', hostsErr ? 'bad' : 'ok', hostsErr || 'Domínios dos sites gravados.');
  add('ca', 'Ambiente', 'CA local de HTTPS', cfg.caTrusted ? 'ok' : 'warn', cfg.caTrusted ? 'Instalada como confiável.' : 'Ainda não confiável: use Certificado SSL > Confiar na CA local.', cfg.caTrusted ? null : { action: 'trust', label: 'Confiar na CA' });
  if (cfg.dnsMode) {
    const dns = require('./dns');
    const nrpt = await dns.nrptStatus();
    add('dns', 'Ambiente', 'DNS local (*.' + cfg.tld + ')', dns.isRunning() && nrpt !== false ? 'ok' : 'warn',
      dns.isRunning() ? (nrpt === false ? 'DNS ativo, mas falta a regra do Windows (NRPT): reinicie o RDR Local como Administrador.' : 'Respondendo 127.0.0.1 para qualquer nome .' + cfg.tld + '.') : 'Ligado nas Configurações, mas parado: clique em “Iniciar tudo”.');
  }
  const rtm = require('./runtimes'); const nv = rtm.defaultVersion('node');
  const nenv = nv ? { ...process.env, PATH: [...rtm.pathParts('node', nv), process.env.PATH || ''].join(IS_WIN ? ';' : ':') } : process.env;
  const nodeR = await run(IS_WIN ? 'npm.cmd' : 'npm', ['-v'], { timeout: 20000, shell: IS_WIN, env: nenv });
  add('npm', 'Ambiente', 'Node.js / npm (starter kits e Vite)', nodeR.ok ? 'ok' : 'warn', nodeR.ok ? `npm ${nodeR.out.split('\n')[0]}${nv ? ` (Node.js ${nv} do RDR Local)` : ''}` : 'npm não encontrado: kits com React/Vue/Livewire precisam dele. Instale o Node.js em Componentes e PHP > Linguagens.');

  // Componentes
  for (const c of comps.listComponents()) {
    const optional = ['postgres', 'adminer', 'phpmyadmin', 'meilisearch', 'cloudflared', 'rclone', 'git'].includes(c.id);
    add(`comp-${c.id}`, 'Componentes', c.name, c.installed ? 'ok' : optional ? 'warn' : 'bad', c.installed ? (c.version ? `versão ${c.version}` : '') : 'Não instalado (aba Componentes).');
  }

  if (comps.isInstalled.phpmyadmin() && comps.pmaPhp() && parseFloat(comps.pmaPhp()) > 8.3) {
    add('pma-php', 'Componentes', 'phpMyAdmin com PHP ' + comps.pmaPhp(), 'warn', 'A versão 5.2 do phpMyAdmin só declara suporte até o PHP 8.3. Funciona na maioria dos casos (avisos de depreciação ficam ocultos), mas instale também o PHP 8.3 em Componentes e PHP e o RDR Local passará a usá-lo para o phpMyAdmin.');
  }

  // PHP
  const phps = comps.phpInstalled();
  if (!phps.length) add('php-none', 'PHP', 'Nenhum PHP instalado', 'bad', 'Instale uma versão em Componentes e PHP.');
  let iniProblem = false;
  for (const v of phps) {
    const mods = await phpModules(v);
    if (!mods) { add(`php-${v}`, 'PHP', `PHP ${v}`, 'bad', 'Não consegui executar o php.exe (veja se falta o Visual C++ Redistributable).'); continue; }
    const missing = NEEDED.filter((e) => !mods.has(e) && exists(path.join(comps.bins.phpDir(v), 'ext', `php_${e}.dll`)));
    const absent = NEEDED.filter((e) => !mods.has(e) && !missing.includes(e));
    if (missing.length) iniProblem = true;
    add(`php-${v}`, 'PHP', `PHP ${v} — extensões`, missing.length ? 'bad' : absent.length ? 'warn' : 'ok',
      missing.length ? `Desligadas no php.ini: ${missing.join(', ')}.` : absent.length ? `Sem a DLL: ${absent.join(', ')}.` : 'Todas as extensões comuns ativas (incluindo MySQL e PostgreSQL).',
      missing.length ? { action: 'ini', label: 'Ligar extensões' } : null);
  }

  // Serviços e portas
  for (const s of services.status()) {
    if (!s.installed) continue;
    if (s.running) { add(`svc-${s.id}`, 'Serviços', s.label, 'ok', 'Em execução.'); continue; }
    let busyPort = 0;
    for (const p of s.ports) if (!(await portFree(p))) busyPort = p;
    add(`svc-${s.id}`, 'Serviços', s.label, busyPort ? 'bad' : 'warn', busyPort ? `Parado, e a porta ${busyPort} está ocupada por outro programa (ServBay/XAMPP?). Mude a porta em Configurações.` : 'Parado.');
  }

  // Quem realmente atende as portas web (detecta ServBay/XAMPP/outra cópia do RDR Local)
  if (IS_WIN && services.isRunning('web')) {
    const ports = [cfg.ports.http, cfg.ports.https, 53].filter(Boolean);
    const ps = `$o=@(); foreach($p in ${ports.join(',')}){ foreach($c in (Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue)){ $pr=Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue; $o+=("{0}|{1}|{2}" -f $p,$pr.ProcessName,$pr.Path) } }; $o -join "\`n"`;
    const r = await run('powershell.exe', ['-NoProfile', '-Command', ps], { timeout: 15000 });
    if (r.ok) {
      const mine = path.resolve(core.P.bin).toLowerCase();
      const rows = r.out.split(/\r?\n/).map((l) => l.trim().split('|')).filter((x) => x.length >= 2 && x[0]);
      const foreign = rows.filter((x) => !(x[2] || '').toLowerCase().startsWith(mine) && !/node/i.test(x[1]));
      const list = [...new Set(foreign.map((x) => `porta ${x[0]}: ${x[1]}${x[2] ? ' (' + x[2] + ')' : ''}`))];
      add('port-owners', 'Ambiente', 'Quem atende as portas 80/443/53', list.length ? 'bad' : 'ok',
        list.length ? `Outro programa está nas portas do RDR Local: ${list.join('; ')}. Por isso um domínio pode abrir o site de outro servidor (ex.: ServBay). Feche esse programa ou mude as portas em Configurações.` : 'Somente o RDR Local atende as portas.');
    }
  }

  // Conectividade com os bancos
  const dbm = require('./db');
  for (const [engine, label] of [['mariadb', 'MariaDB'], ['postgres', 'PostgreSQL']]) {
    if (!services.isRunning(engine)) continue;
    try { const l = await dbm.list(engine); add(`conn-${engine}`, 'Bancos', `Conexão com ${label}`, 'ok', `${l.length} banco(s) encontrados.`); } catch (e) { add(`conn-${engine}`, 'Bancos', `Conexão com ${label}`, 'bad', e.message.slice(0, 200)); }
  }

  // Projetos
  for (const s of cfg.sites.filter((x) => x.enabled !== false)) {
    if (sites.isNet(s)) {
      if (s.type === 'proxy') {
        const u = new URL(s.target); const port = Number(u.port) || (u.protocol === 'https:' ? 443 : 80);
        const up = await tcpUp(u.hostname === 'localhost' ? '127.0.0.1' : u.hostname, port);
        add(`site-${s.id}`, 'Sites', `${s.name} — proxy`, up ? 'ok' : 'warn', up ? `${s.target} respondendo.` : `Nada ouvindo em ${s.target}: suba o app (npm run dev, docker…) para o site funcionar.`);
      }
      continue;
    }
    if (s.type === 'app') {
      const apps = require('./apps');
      if (!core.isDir(s.path)) { add(`site-${s.id}`, 'Apps', s.name, 'bad', `Pasta não encontrada: ${s.path}`); continue; }
      const prob = apps.runtimeProblem(s);
      if (prob) { add(`site-${s.id}`, 'Apps', `${s.name} — runtime`, 'bad', prob); continue; }
      const st = apps.status(s.id);
      if (st.running) { const up = await tcpUp('127.0.0.1', s.appPort); add(`site-${s.id}`, 'Apps', `${s.name} — ${s.runtime === 'custom' ? 'app' : s.runtime}`, up ? 'ok' : 'warn', up ? `Respondendo na porta ${s.appPort}.` : `Processo ligado, mas nada ouvindo na porta ${s.appPort}. O app precisa escutar em 127.0.0.1:${s.appPort} (use a variável PORT ou {PORT} no comando).`); }
      else add(`site-${s.id}`, 'Apps', `${s.name} — parado`, 'warn', st.gaveUp ? 'O app caiu várias vezes seguidas e não foi religado. Veja o log e inicie de novo.' : 'O app não está rodando. Inicie pelo botão de play na lista de sites.');
      continue;
    }
    if (!core.isDir(s.path)) { add(`site-${s.id}`, 'Sites', s.name, 'bad', `Pasta não encontrada: ${s.path}`); continue; }
    const env = parseEnv(path.join(s.path, '.env'));
    if (!env || !env.DB_CONNECTION) continue;
    const drv = env.DB_CONNECTION; const probs = [];
    const ver = sites.resolvePhp(s);
    const ext = DRIVER_EXT[drv];
    if (ver && ext) {
      const mods = await phpModules(ver);
      if (mods && !mods.has(ext)) probs.push(`PHP ${ver} sem a extensão ${ext} (necessária para DB_CONNECTION=${drv}).`);
    }
    const eng = DRIVER_ENGINE[drv];
    if (eng) {
      const host = env.DB_HOST || '127.0.0.1';
      if (['127.0.0.1', 'localhost'].includes(host) && String(env.DB_PORT || '') !== String(cfg.ports[eng])) probs.push(`DB_PORT=${env.DB_PORT || '(vazio)'}, mas o ${eng === 'mariadb' ? 'MariaDB' : 'PostgreSQL'} do RDR Local usa a porta ${cfg.ports[eng]}.`);
    }
    if (env.APP_URL && !env.APP_URL.includes(s.domain)) probs.push(`APP_URL (${env.APP_URL}) não bate com o domínio do site (${sites.baseUrl(s.domain)}).`);
    add(`site-${s.id}`, 'Sites', `${s.name} — .env`, probs.length ? 'warn' : 'ok', probs.length ? probs.join(' ') : `DB_CONNECTION=${drv} compatível.`,
      probs.some((p) => p.startsWith('PHP')) ? { action: 'ini', label: 'Ligar extensões' } : null);
  }
  return { checks: out, summary: { bad: out.filter((c) => c.status === 'bad').length, warn: out.filter((c) => c.status === 'warn').length, ok: out.filter((c) => c.status === 'ok').length }, iniProblem };
}

async function fix(action) {
  if (action === 'ini') {
    comps.ensureAllPhpIni();
    if (services.isRunning('web')) await services.restart('web');
    return 'php.ini corrigido' + (services.isRunning('web') ? ' e Servidor Web reiniciado.' : '. Inicie o Servidor Web para aplicar.');
  }
  if (action === 'trust') { await services.trustCa(); return 'CA instalada.'; }
  throw new Error('Correção desconhecida');
}

module.exports = { check, fix };
