// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 RDR Digital - https://github.com/RDRdigitalFloripa/rdrlocalserver
'use strict';
/**
 * Importador de sites de outros ambientes locais (ServBay, Laragon, XAMPP ou uma pasta/arquivo de configuração qualquer).
 * SOMENTE LEITURA: lê os arquivos de configuração do servidor web de origem (nginx/Apache), mostra uma prévia e,
 * depois da sua confirmação, cria sites no RDR Local apontando para as MESMAS pastas. Nada é copiado, movido ou alterado na origem.
 */
const fs = require('fs');
const path = require('path');
const core = require('./core');
const comps = require('./components');
const sites = require('./sites');
const { IS_WIN, cfg, log, exists, isDir } = core;

const MAX_FILE = 512 * 1024; const MAX_FILES = 300;
const SYSTEM_HOSTS = /^(localhost|.*\.localhost|servbay\.host|.*\.servbay\.host|.*\.servbay\.demo|_|default|example\.com)$/i;
const norm = (p) => String(p || '').replace(/^['"]|['"]$/g, '').trim();
const fsPath = (p) => (IS_WIN ? norm(p).replace(/\//g, '\\') : norm(p));
const fwd = (p) => String(p).replace(/\\/g, '/').replace(/\/+$/, '');

// ---------- onde procurar ----------
function drives() { if (!IS_WIN) return ['']; const out = []; for (let c = 67; c <= 90; c++) { const d = String.fromCharCode(c) + ':'; if (isDir(d + '\\')) out.push(d); } return out; }
function sources() {
  const found = [];
  const add = (kind, label, p, kindFile) => { if (exists(p)) found.push({ kind, label, path: p, file: !!kindFile }); };
  for (const d of drives()) {
    const j = (...a) => (IS_WIN ? path.win32.join(d + '\\', ...a) : path.join('/', ...a));
    add('servbay', `ServBay (${d || '/'})`, j('ServBay', 'etc', 'nginx', 'vhosts'));
    add('laragon', `Laragon nginx (${d || '/'})`, j('laragon', 'etc', 'nginx', 'sites-enabled'));
    add('laragon', `Laragon Apache (${d || '/'})`, j('laragon', 'etc', 'apache2', 'sites-enabled'));
    add('laragon-www', `Laragon pasta www (${d || '/'})`, j('laragon', 'www'));
    add('xampp', `XAMPP vhosts (${d || '/'})`, j('xampp', 'apache', 'conf', 'extra', 'httpd-vhosts.conf'), true);
    add('xampp-htdocs', `XAMPP pasta htdocs (${d || '/'})`, j('xampp', 'htdocs'));
  }
  return found;
}

// ---------- parsers ----------
/** Quebra um texto em blocos "diretiva { ... }" de primeiro nível, respeitando chaves aninhadas. */
function blocks(text, head) {
  const out = []; const re = new RegExp(`(^|[\\s;}])${head}\\s*\\{`, 'g'); let m;
  while ((m = re.exec(text))) {
    let depth = 1; let i = re.lastIndex;
    while (i < text.length && depth) { const c = text[i++]; if (c === '{') depth++; else if (c === '}') depth--; }
    out.push(text.slice(re.lastIndex, i - 1)); re.lastIndex = i;
  }
  return out;
}
const clean = (t) => t.replace(/^\s*#.*$/gm, '');
function parseNginx(text) {
  const res = [];
  for (const b of blocks(clean(text), 'server')) {
    const names = ((/(?:^|[\s;{}])server_name\s+([^;]+);/.exec(b) || [])[1] || '').split(/\s+/).filter(Boolean);
    const root = norm((/(?:^|[\s;{}])root\s+([^;]+);/.exec(b) || [])[1]);
    const proxy = norm((/(?:^|[\s;{}])proxy_pass\s+([^;]+);/.exec(b) || [])[1]);
    const redirOnly = /^\s*return\s+30[12]\s/m.test(b) && !root && !proxy;
    const php = (/set\s+\$php_port\s+'?(\d{4,5})'?/.exec(b) || [])[1];
    if (redirOnly || !names.length || (!root && !proxy)) continue;
    res.push({ names, root, proxy, phpPort: php ? Number(php) : 0 });
  }
  return res;
}
function parseApache(text) {
  const res = [];
  for (const b of blocks(clean(text).replace(/<VirtualHost[^>]*>/gi, 'VirtualHost {').replace(/<\/VirtualHost>/gi, '}'), 'VirtualHost')) {
    const name = (/^\s*ServerName\s+(\S+)/mi.exec(b) || [])[1];
    const alias = ((/^\s*ServerAlias\s+(.+)$/mi.exec(b) || [])[1] || '').split(/\s+/).filter(Boolean);
    const root = norm((/^\s*DocumentRoot\s+(.+)$/mi.exec(b) || [])[1]);
    const proxy = norm((/^\s*ProxyPass\s+\S+\s+(\S+)/mi.exec(b) || [])[1]);
    if (!name || (!root && !proxy)) continue;
    res.push({ names: [name, ...alias], root, proxy, phpPort: 0 });
  }
  return res;
}
function readConf(file) { try { if (fs.statSync(file).size > MAX_FILE) return ''; return fs.readFileSync(file, 'utf8'); } catch (_) { return ''; } }

function collect(src) {
  const p = fsPath(src.path); const raw = [];
  if (!exists(p)) throw new Error('Não encontrei: ' + p);
  if (src.kind === 'laragon-www' || src.kind === 'xampp-htdocs') {
    const suffix = src.kind === 'laragon-www' ? 'test' : cfg.tld;
    for (const d of fs.readdirSync(p, { withFileTypes: true })) {
      if (!d.isDirectory() || d.name.startsWith('.') || ['node_modules', 'vendor'].includes(d.name)) continue;
      raw.push({ names: [`${core.slug(d.name)}.${suffix}`], root: path.join(p, d.name), proxy: '', phpPort: 0, auto: true });
    }
    return raw;
  }
  const files = isDir(p) ? fs.readdirSync(p).filter((f) => /\.(conf|vhost)$/i.test(f) || !f.includes('.')).slice(0, MAX_FILES).map((f) => path.join(p, f)) : [p];
  for (const f of files) {
    try { if (!fs.statSync(f).isFile()) continue; } catch (_) { continue; }
    const t = readConf(f); if (!t) continue;
    raw.push(...(/<VirtualHost/i.test(t) ? parseApache(t) : parseNginx(t)));
  }
  return raw;
}

// ---------- prévia ----------
const phpFromPort = (port) => (port >= 9070 && port <= 9099 ? `${Math.floor(port / 10) - 900}.${port % 10}` : '');
function projectOf(root) {
  const r = fsPath(root); const base = path.basename(r).toLowerCase();
  const up = path.dirname(r);
  // raiz do servidor costuma ser a subpasta pública: o RDR Local detecta isso sozinho a partir da raiz do projeto
  if (['public', 'public_html', 'web', 'dist', 'build'].includes(base) && (exists(path.join(up, 'artisan')) || exists(path.join(up, 'composer.json')) || exists(path.join(up, 'package.json')) || exists(path.join(up, 'wp-config.php')))) return { project: up, docroot: 'auto' };
  return { project: r, docroot: 'auto' };
}
function framework(dir) {
  const h = (f) => exists(path.join(dir, f));
  if (h('artisan')) return 'Laravel'; if (h('wp-config.php')) return 'WordPress'; if (h('composer.json')) return 'PHP (Composer)';
  if (h('package.json')) return 'Node.js (use "Novo app")'; if (h('index.php')) return 'PHP'; if (h('index.html')) return 'Estático'; return '';
}
function scan(src) {
  const raw = collect(src); const byKey = new Map();
  for (const s of raw) {
    const names = [...new Set(s.names.map((n) => n.toLowerCase()).filter((n) => !SYSTEM_HOSTS.test(n) && !n.includes('*') && !n.includes('$')))];
    if (!names.length) continue;
    if (s.proxy) {
      const m = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?\/?$/i.exec(s.proxy);
      if (!m) continue; // proxy para fora da máquina: não importa
      const key = 'proxy:' + s.proxy; const c = byKey.get(key) || { key, type: 'proxy', name: names[0], target: s.proxy.replace(/\/$/, ''), domains: [] };
      c.domains.push(...names); byKey.set(key, c); continue;
    }
    const { project } = projectOf(s.root); const key = 'php:' + fwd(project).toLowerCase();
    const c = byKey.get(key) || { key, type: 'php', name: path.basename(project), path: project, root: s.root, domains: [], phpHint: phpFromPort(s.phpPort), auto: !!s.auto };
    c.domains.push(...names); byKey.set(key, c);
  }
  const used = new Set(); for (const o of cfg.sites) { used.add(o.domain); (o.aliases || []).forEach((a) => used.add(a)); }
  const usedPaths = new Set(cfg.sites.filter((o) => o.path).map((o) => fwd(o.path).toLowerCase()));
  const list = [...byKey.values()].map((c) => {
    c.domains = [...new Set(c.domains)];
    // domínio principal: o mais curto sem "www" (ex.: aion.local antes de aionmvp.local só pela ordem do arquivo)
    c.domain = c.domains[0]; c.aliases = c.domains.slice(1);
    c.warnings = [];
    if (c.type === 'php') {
      c.exists = isDir(fsPath(c.path)); c.framework = c.exists ? framework(fsPath(c.path)) : '';
      if (!c.exists) c.warnings.push('Pasta não encontrada neste PC.');
      if (usedPaths.has(fwd(c.path).toLowerCase())) c.status = 'path-in-use';
      if (c.phpHint && !comps.phpInstalled().includes(c.phpHint)) c.warnings.push(`Na origem usava PHP ${c.phpHint}; será usado o PHP padrão do RDR Local.`);
    }
    const clash = c.domains.filter((d) => used.has(d));
    if (!c.status && clash.length === c.domains.length) c.status = 'domain-in-use';
    else if (clash.length) { c.domains = c.domains.filter((d) => !used.has(d)); c.domain = c.domains[0]; c.aliases = c.domains.slice(1); c.warnings.push('Domínio(s) já usados por outro site foram descartados: ' + clash.join(', ')); }
    if (!c.status) c.status = c.type === 'php' && !c.exists ? 'missing-folder' : 'new';
    return c;
  }).sort((a, b) => a.name.localeCompare(b.name));
  return list;
}

const REASON = { 'path-in-use': 'já existe um site com esta pasta', 'domain-in-use': 'domínio já usado', 'missing-folder': 'pasta não encontrada' };
async function importSites(src, keys) {
  const list = scan(src); const out = { added: [], skipped: [] };
  for (const key of keys) {
    const c = list.find((x) => x.key === key);
    if (!c) { out.skipped.push({ name: key, reason: 'não encontrado na origem' }); continue; }
    if (c.status !== 'new') { out.skipped.push({ name: c.name, reason: REASON[c.status] || c.status }); continue; }
    try {
      const base = { name: c.name, domain: c.domain, aliases: c.aliases.join(',') };
      const s = c.type === 'proxy' ? await sites.add({ ...base, type: 'proxy', target: c.target })
        : await sites.add({ ...base, path: fsPath(c.path), php: c.phpHint && comps.phpInstalled().includes(c.phpHint) ? c.phpHint : 'default' });
      out.added.push({ name: s.name, domain: s.domain });
    } catch (e) { out.skipped.push({ name: c.name, reason: e.message }); }
  }
  log(`Importação: ${out.added.length} site(s) criado(s), ${out.skipped.length} ignorado(s).`);
  return out;
}

module.exports = { sources, scan, importSites, parseNginx, parseApache, phpFromPort, projectOf };
