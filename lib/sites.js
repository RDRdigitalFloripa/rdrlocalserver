// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 RDR Digital - https://github.com/RDRdigitalFloripa/rdrlocalserver
'use strict';
/** Sites: cadastro, validação, Caddyfile, arquivo hosts, atalhos (terminal/pasta). */
const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const core = require('./core');
const comps = require('./components');
const rts = require('./runtimes');
const { P, IS_WIN, HOSTS_FILE, cfg, save, log, exists, isDir, fwd, slug } = core;

const WORKERS = 3;
const TLDS = ['test', 'local', 'host', 'localhost'];
const LABEL = '[a-z0-9]([a-z0-9-]*[a-z0-9])?';
const domainRe = () => new RegExp(`^${LABEL}(\\.${LABEL})*\\.(${TLDS.join('|')})$`);
const MARK_BEGIN = '# >>> RDR Local (gerenciado automaticamente)';
const MARK_END = '# <<< RDR Local';
let hostsError = '';

const mailDomain = () => `mail.${cfg.tld}`;
const dbDomain = () => `db.${cfg.tld}`;
const pmaDomain = () => `pma.${cfg.tld}`;
const panelDomain = () => `rdr-local-server.${cfg.tld}`;
const baseUrl = (domain) => `https://${domain}${cfg.ports.https === 443 ? '' : ':' + cfg.ports.https}`;

// ---------- resolução ----------
const isNet = (s) => s && (s.type === 'proxy' || s.type === 'redirect');
const isApp = (s) => !!s && s.type === 'app';
function resolvePhp(s) {
  if (isNet(s) || isApp(s)) return '';
  if (s.php === 'none') return '';
  if (s.php && s.php !== 'default' && comps.phpInstalled().includes(s.php)) return s.php;
  return comps.phpDefault();
}
function docroot(s) {
  if (isNet(s) || isApp(s)) return '';
  if (s.docroot && s.docroot !== 'auto') return path.isAbsolute(s.docroot) ? s.docroot : path.join(s.path, s.docroot);
  for (const c of ['public', 'public_html', 'web', 'dist', 'build']) {
    const d = path.join(s.path, c);
    if (isDir(d) && (exists(path.join(d, 'index.php')) || exists(path.join(d, 'index.html')))) return d;
  }
  return s.path;
}
function kind(s) {
  if (s.type === 'proxy') return 'Proxy reverso';
  if (s.type === 'redirect') return 'Redirecionamento';
  if (s.type === 'app') return ({ node: 'App Node.js', python: 'App Python', go: 'App Go', java: 'App Java' })[s.runtime] || 'App';
  if (exists(path.join(s.path, 'artisan'))) return 'Laravel';
  if (exists(path.join(s.path, 'wp-config.php')) || exists(path.join(s.path, 'wp-content'))) return 'WordPress';
  if (exists(path.join(s.path, 'composer.json'))) return 'PHP';
  if (exists(path.join(s.path, 'package.json'))) return 'Node/estático';
  return exists(path.join(s.path, 'index.php')) ? 'PHP' : 'Estático';
}
function workerPorts(ver) {
  if (!cfg.phpPorts[ver]) { cfg.phpPorts[ver] = 9100 + 10 * Object.keys(cfg.phpPorts).length; save(); }
  return Array.from({ length: WORKERS }, (_, i) => cfg.phpPorts[ver] + i);
}
const usedPhpVersions = () => {
  const v = new Set(cfg.sites.filter((s) => s.enabled !== false).map(resolvePhp).filter(Boolean));
  if (comps.isInstalled.adminer() && comps.phpDefault()) v.add(comps.phpDefault());
  if (comps.isInstalled.phpmyadmin() && comps.pmaPhp()) v.add(comps.pmaPhp());
  return [...v];
};

// ---------- validação / CRUD ----------
/** "CHAVE=valor" por linha (ou objeto) -> objeto validado. Vão para o PHP (web e terminal) do site. */
function cleanEnv(raw) {
  const out = {};
  const pairs = typeof raw === 'object' && raw ? Object.entries(raw)
    : String(raw || '').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map((l) => { const i = l.indexOf('='); return i < 0 ? [l, ''] : [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^(["'])(.*)\1$/, '$2')]; });
  for (const [k, v0] of pairs) {
    const v = String(v0);
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(k)) throw new Error(`Nome de variável inválido: "${k}" (use letras, números e _).`);
    if (/["\\\r\n{}`]/.test(v)) throw new Error(`O valor de ${k} tem caractere não permitido (aspas, barra invertida, chaves ou crase).`);
    if (v.length > 500) throw new Error(`Valor muito longo em ${k}.`);
    out[k] = v;
  }
  if (Object.keys(out).length > 50) throw new Error('Máximo de 50 variáveis por site.');
  return out;
}

/** Normaliza o destino de um proxy ("3000", "localhost:3000", "http://127.0.0.1:3000") ou redirecionamento (URL completa). */
function cleanTarget(type, raw) {
  let t = String(raw || '').trim();
  if (!t || /["\s{}`\\]/.test(t)) throw new Error(type === 'proxy' ? 'Informe o destino do proxy (ex.: 3000 ou http://127.0.0.1:3000).' : 'Informe a URL de destino (ex.: https://exemplo.com.br).');
  if (type === 'proxy') {
    if (/^\d{1,5}$/.test(t)) t = '127.0.0.1:' + t;
    if (!/^https?:\/\//i.test(t)) t = 'http://' + t;
    const m = t.match(/^(https?):\/\/([A-Za-z0-9._-]+)(?::(\d{1,5}))?\/?$/i);
    if (!m) throw new Error('Destino do proxy inválido. Use porta ou host:porta, sem caminho (ex.: 3000, localhost:8080, http://host.docker.internal:3000).');
    if (m[3] && (Number(m[3]) < 1 || Number(m[3]) > 65535)) throw new Error('Porta do destino inválida.');
    return `${m[1].toLowerCase()}://${m[2]}${m[3] ? ':' + m[3] : ''}`;
  }
  if (!/^https?:\/\/[^/]+/i.test(t)) throw new Error('A URL de destino deve começar com http:// ou https://');
  return t.replace(/\/+$/, '');
}
function clean(input, current) {
  const type = ['proxy', 'redirect', 'app'].includes(input.type) ? input.type : (current && current.type) || 'php';
  const net = type === 'proxy' || type === 'redirect';
  const p = net ? '' : String(input.path || '').trim();
  if (!net) {
    if (!p || /["\r\n{}`]/.test(p)) throw new Error('Caminho inválido.');
    if (!isDir(p)) throw new Error('A pasta não existe: ' + p);
  }
  const name = String(input.name || '').trim() || (net ? 'Site' : path.basename(p));
  const domain = String(input.domain || `${slug(name)}.${cfg.tld}`).trim().toLowerCase();
  if (!domainRe().test(domain)) throw new Error(`Domínio inválido. Use algo como meu-site.${cfg.tld} (terminações: ${TLDS.join(', ')})`);
  const aliases = String(input.aliases || '').split(/[\s,;]+/).map((a) => a.trim().toLowerCase()).filter(Boolean);
  for (const a of aliases) if (!domainRe().test(a.replace(/^\*\./, ''))) throw new Error('Alias inválido: ' + a);
  if (aliases.some((a) => a.startsWith('*.')) && !cfg.dnsMode) throw new Error('Alias com curinga (*.meu-app.' + cfg.tld + ') precisa do DNS local: ative em Configurações > DNS local.');
  for (const o of cfg.sites) {
    if (current && o.id === current.id) continue;
    for (const d of [domain, ...aliases]) if (o.domain === d || (o.aliases || []).includes(d)) throw new Error('Domínio já usado por outro site: ' + d);
  }
  if (domain === mailDomain() || aliases.includes(mailDomain())) throw new Error(`${mailDomain()} é reservado para o Mailpit.`);
  if (domain === panelDomain() || aliases.includes(panelDomain())) throw new Error(`${panelDomain()} é reservado para o painel do RDR Local.`);
  if (domain === dbDomain() || aliases.includes(dbDomain())) throw new Error(`${dbDomain()} é reservado para o Adminer (bancos de dados).`);
  if (domain === pmaDomain() || aliases.includes(pmaDomain())) throw new Error(`${pmaDomain()} é reservado para o phpMyAdmin.`);
  if (net) {
    const target = cleanTarget(type, input.target);
    return { name, path: '', domain, aliases, php: 'none', docroot: 'auto', type, target, cors: type === 'proxy' ? !!input.cors : false };
  }
  if (type === 'app') {
    const runtime = ['node', 'python', 'go', 'java', 'custom'].includes(input.runtime) ? input.runtime : (current && current.runtime) || 'custom';
    const rtVersion = String(input.rtVersion || 'default');
    if (runtime !== 'custom' && rtVersion !== 'default' && !rts.installed(runtime).includes(rtVersion)) throw new Error(`${rts.KINDS[runtime].label} ${rtVersion} não está instalado.`);
    const cmd = String(input.cmd !== undefined ? input.cmd : (current && current.cmd) || '').trim();
    if (!cmd) throw new Error('Informe o comando que inicia o app (ex.: npm run dev). Use {PORT} onde o app precisa da porta.');
    if (cmd.length > 500 || /[\r\n\0]/.test(cmd)) throw new Error('Comando inválido (uma linha, até 500 caracteres).');
    let appPort = Number(input.appPort || (current && current.appPort) || 0);
    if (!appPort) appPort = require('./apps').allocPort();
    if (!Number.isInteger(appPort) || appPort < 1024 || appPort > 65535) throw new Error('Porta do app inválida (use entre 1024 e 65535).');
    if ([cfg.ports.http, cfg.ports.https, cfg.ports.mariadb, cfg.ports.postgres, cfg.ports.redis, cfg.ports.mailpitSmtp, cfg.ports.mailpitUi, cfg.ports.meilisearch, 7070].includes(appPort)) throw new Error('Essa porta é usada por um serviço do RDR Local.');
    if (cfg.sites.some((o) => o.type === 'app' && o.appPort === appPort && !(current && o.id === current.id))) throw new Error(`A porta ${appPort} já é usada por outro app.`);
    return { name, path: p, domain, aliases, php: 'none', docroot: 'auto', type, runtime, rtVersion, cmd, appPort, cors: !!input.cors, autoStart: input.autoStart !== undefined ? !!input.autoStart : (current ? current.autoStart !== false : true), env: input.env !== undefined ? cleanEnv(input.env) : (current && current.env) || {} };
  }
  const php = String(input.php || 'default');
  if (!['default', 'none'].includes(php) && !comps.phpInstalled().includes(php)) throw new Error(`PHP ${php} não está instalado.`);
  let dr = String(input.docroot || 'auto').trim() || 'auto';
  if (/["\r\n{}`]/.test(dr)) throw new Error('Pasta pública inválida.');
  return { name, path: p, domain, aliases, php, docroot: dr, type: 'php', cors: !!input.cors, env: input.env !== undefined ? cleanEnv(input.env) : (current && current.env) || {} };
}

async function afterChange() {
  save();
  await require('./services').reloadWeb();
}
async function add(input) {
  const s = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), enabled: true, ...clean(input) };
  cfg.sites.push(s); await afterChange(); log(`Site criado: ${baseUrl(s.domain)}`); return s;
}
async function update(id, input) {
  const s = cfg.sites.find((x) => x.id === id); if (!s) throw new Error('Site não encontrado');
  Object.assign(s, clean(input, s)); await afterChange(); return s;
}
async function remove(id) { cfg.sites = cfg.sites.filter((x) => x.id !== id); await afterChange(); }
async function toggle(id) {
  const s = cfg.sites.find((x) => x.id === id); if (!s) throw new Error('Site não encontrado');
  s.enabled = s.enabled === false; await afterChange(); return s;
}
async function scan(root) {
  if (!root || !isDir(root)) throw new Error('Pasta raiz inválida.');
  cfg.projectsRoot = root; let added = 0;
  for (const d of fs.readdirSync(root, { withFileTypes: true })) {
    if (!d.isDirectory() || d.name.startsWith('.') || ['node_modules', 'vendor'].includes(d.name)) continue;
    const full = path.join(root, d.name);
    if (cfg.sites.some((s) => s.path === full)) continue;
    try {
      cfg.sites.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), enabled: true, ...clean({ name: d.name, path: full }) });
      added++;
    } catch (_) { /* nome inválido ou domínio repetido */ }
  }
  await afterChange(); log(`Varredura de ${root}: ${added} site(s) novo(s).`); return added;
}

// ---------- Caddyfile ----------
function envBlock(s) {
  const e = Object.entries(s.env || {});
  return e.length ? ` {\n${e.map(([k, v]) => `\t\tenv ${k} "${v}"`).join('\n')}\n\t}` : '';
}
function buildCaddyfile() {
  const { http, https, mailpitUi } = cfg.ports;
  const logsDir = fwd(path.join(P.logs, 'sites'));
  let out = `{\n\tadmin 127.0.0.1:20190\n\tskip_install_trust\n\thttp_port ${http}\n\thttps_port ${https}\n}\n\n`;
  const redir = (d) => `http://${d} {\n\tredir ${baseUrl(d)}{uri} permanent\n}\n\n`;

  for (const s of cfg.sites.filter((x) => x.enabled !== false)) {
    const ver = resolvePhp(s);
    const names = [s.domain, ...(s.aliases || [])];
    const logBlk = `\tlog {\n\t\toutput file "${logsDir}/${s.domain}.log"\n\t\tformat console\n\t}\n`;
    const cors = s.cors ? `\theader {\n\t\tAccess-Control-Allow-Origin *\n\t\tAccess-Control-Allow-Methods "GET, POST, PUT, PATCH, DELETE, OPTIONS"\n\t\tAccess-Control-Allow-Headers *\n\t}\n\t@preflight method OPTIONS\n\trespond @preflight 204\n` : '';
    if (s.type === 'redirect') {
      out += `${names.map((d) => 'https://' + d).join(', ')} {\n\ttls internal\n\tredir ${s.target}{uri}\n${logBlk}}\n\n${names.map(redir).join('')}`;
      continue;
    }
    if (s.type === 'app') {
      out += `${names.map((d) => 'https://' + d).join(', ')} {\n\ttls internal\n\tencode zstd gzip\n${cors}\treverse_proxy 127.0.0.1:${s.appPort}\n${logBlk}}\n\n${names.map(redir).join('')}`;
      continue;
    }
    if (s.type === 'proxy') {
      const tls = /^https:/i.test(s.target) ? ' {\n\t\ttransport http {\n\t\t\ttls_insecure_skip_verify\n\t\t}\n\t}' : '';
      out += `${names.map((d) => 'https://' + d).join(', ')} {\n\ttls internal\n\tencode zstd gzip\n${cors}\treverse_proxy ${s.target}${tls}\n${logBlk}}\n\n${names.map(redir).join('')}`;
      continue;
    }
    out += `${names.map((d) => 'https://' + d).join(', ')} {\n`
      + `\ttls internal\n`
      + `\troot * "${fwd(docroot(s))}"\n`
      + `\tencode zstd gzip\n`
      + cors
      + `\t@blocked path /.git/* /.env /.env.* /.ht* /storage/logs/*\n`
      + `\trespond @blocked 404\n`
      // CLAUDE.md, AGENTS.md e docs/ não podem ser servidos (túnel público, WordPress na raiz); só bloqueia se o arquivo existir na pasta pública.
      + `\t@aidocs {\n\t\tpath /docs/* /CLAUDE.md /AGENTS.md /rdr.json\n\t\tfile\n\t}\n`
      + `\trespond @aidocs 404\n`
      + (ver ? `\tphp_fastcgi ${workerPorts(ver).map((p) => '127.0.0.1:' + p).join(' ')}${envBlock(s)}\n` : '')
      + `\tfile_server\n`
      + `\tlog {\n\t\toutput file "${logsDir}/${s.domain}.log"\n\t\tformat console\n\t}\n`
      + `}\n\n`
      + names.map(redir).join('');
  }
  out += `https://${panelDomain()} {\n\ttls internal\n\t@outside not remote_ip 127.0.0.1 ::1\n\trespond @outside 403\n\treverse_proxy 127.0.0.1:${process.env.RDR_PORT || 7070}\n}\n\n${redir(panelDomain())}`;
  if (comps.isInstalled.mailpit()) {
    out += `https://${mailDomain()} {\n\ttls internal\n\treverse_proxy 127.0.0.1:${mailpitUi}\n}\n\n${redir(mailDomain())}`;
  }
  if (comps.isInstalled.phpmyadmin() && comps.pmaPhp()) {
    out += `https://${pmaDomain()} {\n\ttls internal\n\t@outside not remote_ip 127.0.0.1 ::1\n\trespond @outside 403\n\t@deny path /libraries/* /templates/* /vendor/* /setup/* /sql/* /examples/* /config.inc.php\n\trespond @deny 404\n`
      + `\troot * "${fwd(comps.dir('phpmyadmin'))}"\n\tencode zstd gzip\n\tphp_fastcgi ${workerPorts(comps.pmaPhp()).map((p) => '127.0.0.1:' + p).join(' ')}\n\tfile_server\n}\n\n${redir(pmaDomain())}`;
  }
  if (comps.isInstalled.adminer() && comps.phpDefault()) {
    out += `https://${dbDomain()} {\n\ttls internal\n\t@outside not remote_ip 127.0.0.1 ::1\n\trespond @outside 403\n\t@raw path /adminer.php\n\trespond @raw 404\n`
      + `\troot * "${fwd(comps.dir('adminer'))}"\n\tphp_fastcgi ${workerPorts(comps.phpDefault()).map((p) => '127.0.0.1:' + p).join(' ')}\n\tfile_server\n}\n\n${redir(dbDomain())}`;
  }
  return out;
}
const CADDYFILE = path.join(P.conf, 'Caddyfile');
const writeCaddyfile = () => fs.writeFileSync(CADDYFILE, buildCaddyfile());

// ---------- hosts ----------
function allDomains() {
  const d = [];
  for (const s of cfg.sites.filter((x) => x.enabled !== false)) d.push(s.domain, ...(s.aliases || []));
  d.push(panelDomain());
  if (comps.isInstalled.mailpit()) d.push(mailDomain());
  if (comps.isInstalled.adminer()) d.push(dbDomain());
  if (comps.isInstalled.phpmyadmin()) d.push(pmaDomain());
  return [...new Set(d)].filter((x) => !x.endsWith('.localhost') && !x.startsWith('*.'));
}
let adminCache = null;
function isAdmin() {
  if (!IS_WIN) return typeof process.getuid === 'function' ? process.getuid() === 0 : true;
  if (adminCache === null) {
    try { execFileSync('fltmc', [], { stdio: 'ignore', windowsHide: true }); adminCache = true; } catch (_) { adminCache = false; }
  }
  return adminCache;
}

function hostsBlock(txt, domains) {
  const esc = (v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  txt = txt.replace(new RegExp(`\\r?\\n?${esc(MARK_BEGIN)}[\\s\\S]*?${esc(MARK_END)}\\r?\\n?`, 'm'), '\n');
  if (!domains.length) return txt;
  const nl = txt.includes('\r\n') ? '\r\n' : '\n';
  const block = [MARK_BEGIN, ...domains.map((d) => `127.0.0.1 ${d}`), ...domains.map((d) => `::1 ${d}`), MARK_END].join(nl);
  const base = txt.replace(/\s*$/, '');
  return (base ? base + nl + nl : '') + block + nl;
}

/** Tenta gravar o hosts; em caso de bloqueio tenta destravar (somente leitura, permissões, PowerShell). */
function writeHostsFile(txt) {
  const attempts = [() => fs.writeFileSync(HOSTS_FILE, txt)];
  if (IS_WIN) {
    const sh = (cmd, args) => { try { execFileSync(cmd, args, { stdio: 'ignore', windowsHide: true, timeout: 20000 }); } catch (_) { /* segue */ } };
    attempts.push(
      () => { sh('attrib', ['-R', HOSTS_FILE]); fs.writeFileSync(HOSTS_FILE, txt); },
      () => { sh('icacls', [HOSTS_FILE, '/grant', '*S-1-5-32-544:F']); sh('attrib', ['-R', HOSTS_FILE]); fs.writeFileSync(HOSTS_FILE, txt); },
      () => {
        const tmp = path.join(P.data, 'hosts.new'); fs.writeFileSync(tmp, txt);
        execFileSync('powershell', ['-NoProfile', '-Command', `Copy-Item -LiteralPath '${tmp}' -Destination '${HOSTS_FILE}' -Force`], { stdio: 'pipe', windowsHide: true, timeout: 30000 });
      },
    );
  }
  let last;
  for (const t of attempts) { try { t(); return null; } catch (e) { last = e; } }
  return last;
}

function syncHosts() {
  const domains = allDomains();
  let txt = '';
  try { txt = fs.readFileSync(HOSTS_FILE, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') { hostsError = `Não consegui LER o arquivo hosts (${e.code || e.message}).`; log('AVISO: ' + hostsError); return; } }
  const next = hostsBlock(txt, domains);
  if (next === txt) { hostsError = ''; return; }
  const err = writeHostsFile(next);
  if (!err) { hostsError = ''; return; }
  if (cfg.dnsMode) { hostsError = ''; log('Hosts não gravado, mas o DNS local resolve os domínios.'); return; }
  const code = err.code || String(err.message).slice(0, 80);
  hostsError = `Não consegui gravar o arquivo hosts (${code}). ` + (isAdmin()
    ? 'O RDR Local está como Administrador, então algo bloqueia o arquivo: antivírus (Defender/Kaspersky/Avast) ou outro programa (ServBay/XAMPP). Abra a pasta C:\\Windows\\System32\\drivers\\etc, clique com o botão direito em "hosts" > Propriedades e desmarque "Somente leitura", ou crie uma exceção no antivírus para ela. Enquanto isso, use o botão "Copiar linhas do hosts" ou troque a terminação para .localhost em Configurações (não precisa de hosts).'
    : 'O RDR Local NÃO está como Administrador. Feche e abra o start.bat, e aceite o aviso do Windows (UAC).');
  log('AVISO: ' + hostsError);
}

function hostsText() { return allDomains().flatMap((d) => [`127.0.0.1 ${d}`, `::1 ${d}`]).join('\r\n'); }

// ---------- atalhos ----------
function terminalEnv(s) {
  const ver = resolvePhp(s);
  const parts = [];
  if (isApp(s) && s.runtime !== 'custom') parts.push(...rts.pathParts(s.runtime, rts.resolve(s.runtime, s.rtVersion), s.path));
  else if (s.path) { const nv = rts.resolve('node', 'default'); if (nv && !process.env.RDR_NO_MANAGED_NODE) parts.push(...rts.pathParts('node', nv)); }
  if (ver) parts.push(comps.bins.phpDir(ver));
  if (comps.isInstalled.git()) parts.push(path.join(comps.dir('git'), 'cmd'));
  parts.push(path.join(P.bin, 'shims'));
  const pg = path.join(comps.dir('postgres'), 'bin'); const my = path.join(comps.dir('mariadb'), 'bin');
  if (exists(pg)) parts.push(pg);
  if (exists(my)) parts.push(my);
  const sep = IS_WIN ? ';' : ':';
  return { ...process.env, ...(s.env || {}), PATH: parts.join(sep) + sep + (process.env.PATH || ''), COMPOSER_HOME: path.join(P.data, 'composer') };
}
function openTerminal(id) {
  const s = cfg.sites.find((x) => x.id === id); if (!s) throw new Error('Site não encontrado');
  if (isNet(s)) throw new Error('Este site não tem pasta.');
  if (!IS_WIN) throw new Error('Terminal integrado só no Windows.');
  spawn('cmd', ['/c', 'start', `RDR - ${s.name}`, 'cmd', '/k'], { cwd: s.path, env: terminalEnv(s), detached: true, stdio: 'ignore' }).unref();
}
function openFolder(id) {
  const s = cfg.sites.find((x) => x.id === id); if (!s) throw new Error('Site não encontrado');
  if (isNet(s)) throw new Error('Este site não tem pasta.');
  if (!IS_WIN) throw new Error('Abrir pasta só no Windows.');
  require('./devtools').openFolder(s.path); // abre e traz a janela para a frente (devtools requer sites, por isso o require aqui dentro)
}

/** Link do Adminer já com servidor e usuário preenchidos (senha vazia: um clique em Entrar). */
function adminerUrl(engine, name) {
  const q = engine === 'postgres' ? `pgsql=127.0.0.1%3A${cfg.ports.postgres}&username=postgres` : `server=127.0.0.1%3A${cfg.ports.mariadb}&username=root`;
  return `${baseUrl(dbDomain())}/?${q}${name ? '&db=' + encodeURIComponent(name) : ''}`;
}

/** Link do phpMyAdmin (login automático). Sem nome, abre a tela inicial. */
function pmaUrl(name) {
  return `${baseUrl(pmaDomain())}/index.php${name ? '?route=/database/structure&db=' + encodeURIComponent(name) : ''}`;
}

function list(webRunning) {
  return cfg.sites.map((s) => ({
    ...s, kind: kind(s), docrootResolved: docroot(s), phpResolved: resolvePhp(s), exists: isNet(s) ? true : isDir(s.path),
    url: baseUrl(s.domain), running: webRunning && s.enabled !== false,
  }));
}

module.exports = {
  isNet, isApp, TLDS, clean, add, update, remove, toggle, scan, list, resolvePhp, docroot, workerPorts, usedPhpVersions, WORKERS,
  panelDomain, dbDomain, pmaDomain, pmaUrl, adminerUrl, buildCaddyfile, writeCaddyfile, syncHosts, CADDYFILE, baseUrl, mailDomain, openTerminal, openFolder, terminalEnv,
  getHostsError: () => hostsError, hostsText, isAdmin,
};
