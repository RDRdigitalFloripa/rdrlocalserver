'use strict';
/** Catálogo e instalação dos componentes (Caddy, PHP, MariaDB, PostgreSQL, Redis, Mailpit, Composer). */
const fs = require('fs');
const path = require('path');
const core = require('./core');
const { P, IS_WIN, cfg, save, log, exists, isDir, fwd, X, download, unzip, getJson, get, findFile } = core;

const dir = (id) => path.join(P.bin, id);
const verFile = (id) => path.join(dir(id), '.version');
const version = (id) => { try { return fs.readFileSync(verFile(id), 'utf8').trim(); } catch (_) { return ''; } };
const setVersion = (id, v) => fs.writeFileSync(verFile(id), v);

function first(...candidates) { return candidates.find((c) => exists(c)) || candidates[0]; }

// ---------- executáveis ----------
const bins = {
  caddy: () => path.join(dir('caddy'), X('caddy')),
  mariadbd: () => first(path.join(dir('mariadb'), 'bin', X('mariadbd')), path.join(dir('mariadb'), 'bin', X('mysqld'))),
  mariadbCli: () => first(path.join(dir('mariadb'), 'bin', X('mariadb')), path.join(dir('mariadb'), 'bin', X('mysql'))),
  mariadbAdmin: () => first(path.join(dir('mariadb'), 'bin', X('mariadb-admin')), path.join(dir('mariadb'), 'bin', X('mysqladmin'))),
  mariadbInstallDb: () => first(path.join(dir('mariadb'), 'bin', X('mariadb-install-db')), path.join(dir('mariadb'), 'bin', X('mysql_install_db'))),
  pg: (n) => path.join(dir('postgres'), 'bin', X(n)),
  redisServer: () => findFile(dir('redis'), X('redis-server')) || path.join(dir('redis'), X('redis-server')),
  redisCli: () => findFile(dir('redis'), X('redis-cli')) || path.join(dir('redis'), X('redis-cli')),
  mailpit: () => path.join(dir('mailpit'), X('mailpit')),
  cloudflared: () => path.join(dir('cloudflared'), X('cloudflared')),
  meilisearch: () => path.join(dir('meilisearch'), X('meilisearch')),
  rclone: () => path.join(dir('rclone'), X('rclone')),
  git: () => { const m = path.join(dir('git'), 'cmd', X('git')); return exists(m) ? m : 'git'; },
  phpDir: (v) => path.join(P.bin, `php-${v}`),
  phpCgi: (v) => path.join(P.bin, `php-${v}`, X('php-cgi')),
  phpCli: (v) => path.join(P.bin, `php-${v}`, X('php')),
  composerPhar: () => path.join(dir('composer'), 'composer.phar'),
  cacert: () => path.join(P.bin, 'cacert.pem'),
  mariadbDump: () => first(path.join(dir('mariadb'), 'bin', X('mariadb-dump')), path.join(dir('mariadb'), 'bin', X('mysqldump'))),
  adminerFile: () => path.join(dir('adminer'), 'adminer.php'),
  pmaIndex: () => path.join(dir('phpmyadmin'), 'index.php'),
};

function phpInstalled() {
  try {
    return fs.readdirSync(P.bin).map((n) => (n.match(/^php-(\d+\.\d+)$/) || [])[1])
      .filter((v) => v && exists(bins.phpCgi(v)))
      .sort((a, b) => parseFloat(b) - parseFloat(a));
  } catch (_) { return []; }
}
const phpDefault = () => (phpInstalled().includes(cfg.phpDefault) ? cfg.phpDefault : phpInstalled()[0] || '');

const isInstalled = {
  caddy: () => exists(bins.caddy()),
  mariadb: () => exists(bins.mariadbd()),
  postgres: () => exists(bins.pg('postgres')),
  redis: () => exists(bins.redisServer()),
  mailpit: () => exists(bins.mailpit()),
  cloudflared: () => exists(bins.cloudflared()),
  meilisearch: () => exists(bins.meilisearch()),
  rclone: () => exists(bins.rclone()),
  git: () => exists(path.join(dir('git'), 'cmd', X('git'))),
  composer: () => exists(bins.composerPhar()),
  adminer: () => exists(bins.adminerFile()),
  phpmyadmin: () => exists(bins.pmaIndex()),
};

// ---------- instaladores ----------
function needWindows() {
  if (!IS_WIN) throw new Error('A instalação automática funciona só no Windows. Em outros sistemas, coloque os binários em bin/<componente>.');
}
const tmp = (name) => path.join(P.bin, name);

async function githubAsset(repo, re, pref) {
  const rel = await getJson(`https://api.github.com/repos/${repo}/releases/latest`);
  const list = rel.assets.filter((a) => re.test(a.name));
  const asset = (pref && list.find((a) => pref.test(a.name))) || list[0];
  if (!asset) throw new Error(`Arquivo para Windows não encontrado em ${repo}`);
  return { url: asset.browser_download_url, tag: rel.tag_name };
}

let phpReleases = null;
async function githubLatestTag(repo) {
  const rel = await getJson(`https://api.github.com/repos/${repo}/releases/latest`);
  if (!rel.tag_name) throw new Error('sem resposta do GitHub');
  return rel.tag_name;
}
async function latestPhpReleases() { phpReleases = null; return phpReleaseList(); }

async function installCaddy(jl) {
  const a = await githubAsset('caddyserver/caddy', /windows_amd64\.zip$/);
  jl(`Baixando Caddy ${a.tag}...`);
  await download(a.url, tmp('caddy.zip'), jl);
  await unzip(tmp('caddy.zip'), dir('caddy')); fs.unlinkSync(tmp('caddy.zip'));
  setVersion('caddy', a.tag.replace(/^v/, ''));
}

async function phpReleaseList() {
  if (!phpReleases) phpReleases = await getJson('https://windows.php.net/downloads/releases/releases.json');
  return phpReleases;
}
async function phpAvailable() {
  const rels = await phpReleaseList();
  return Object.keys(rels).sort((a, b) => parseFloat(b) - parseFloat(a))
    .filter((k) => Object.keys(rels[k]).some((x) => /^nts-vs\d+-x64$/.test(x)))
    .map((k) => ({ branch: k, version: rels[k].version }));
}

async function ensureCacert(jl) {
  if (exists(bins.cacert())) return;
  jl('Baixando certificados raiz (cacert.pem)...');
  fs.writeFileSync(bins.cacert(), await get('https://curl.se/ca/cacert.pem'));
}

const WANTED_EXT = ['curl', 'fileinfo', 'gd', 'intl', 'mbstring', 'exif', 'mysqli', 'openssl', 'pdo_mysql', 'pdo_pgsql', 'pgsql', 'pdo_sqlite', 'sqlite3', 'sodium', 'zip', 'bcmath', 'soap', 'sockets', 'ftp', 'gmp'];

/** Garante extensões comuns ligadas (MySQL, PostgreSQL, etc.) e o sendmail apontando para o Mailpit. Idempotente. */
function ensurePhpIni(v) {
  const dirV = bins.phpDir(v); const f = path.join(dirV, 'php.ini');
  let ini;
  try { ini = fs.readFileSync(f, 'utf8'); } catch (_) {
    const dev = path.join(dirV, 'php.ini-development'); if (!exists(dev)) return false;
    ini = fs.readFileSync(dev, 'utf8');
  }
  const orig = ini;
  ini = ini.replace(/^;\s*extension_dir\s*=\s*"ext"/m, 'extension_dir = "ext"');
  const userOff = (cfg.phpOff && cfg.phpOff[v]) || [];
  for (const e of WANTED_EXT) {
    if (userOff.includes(e)) continue;
    if (!exists(path.join(dirV, 'ext', `php_${e}.dll`))) continue;
    if (new RegExp(`^\\s*extension\\s*=\\s*(php_)?${e}(\\.dll)?\\s*$`, 'm').test(ini)) continue;
    const off = new RegExp(`^;\\s*extension\\s*=\\s*${e}\\s*$`, 'm');
    ini = off.test(ini) ? ini.replace(off, `extension=${e}`) : ini.replace(/\s*$/, `\nextension=${e}\n`);
  }
  if (isInstalled.mailpit()) {
    const line = `sendmail_path = "${fwd(bins.mailpit())} sendmail --smtp-addr 127.0.0.1:${cfg.ports.mailpitSmtp}"`;
    ini = /^;?\s*sendmail_path\s*=.*$/m.test(ini) ? ini.replace(/^;?\s*sendmail_path\s*=.*$/m, line) : ini.replace(/\s*$/, `\n${line}\n`);
  }
  if (ini !== orig) { fs.writeFileSync(f, ini); log(`php.ini do PHP ${v} atualizado (extensões/sendmail).`); }
  return true;
}
const ensureAllPhpIni = () => phpInstalled().forEach((v) => { try { ensurePhpIni(v); } catch (_) { /* ok */ } });

async function installPhp(jl, branch) {
  const rels = await phpReleaseList();
  const entry = rels[branch];
  if (!entry) throw new Error(`PHP ${branch} indisponível para Windows`);
  const key = Object.keys(entry).find((k) => /^nts-vs\d+-x64$/.test(k));
  jl(`Baixando PHP ${entry.version} (NTS x64)...`);
  await download('https://windows.php.net/downloads/releases/' + entry[key].zip.path, tmp(`php-${branch}.zip`), jl);
  await unzip(tmp(`php-${branch}.zip`), bins.phpDir(branch)); fs.unlinkSync(tmp(`php-${branch}.zip`));
  await ensureCacert(jl);

  const ca = fwd(bins.cacert());
  let ini = fs.readFileSync(path.join(bins.phpDir(branch), 'php.ini-development'), 'utf8');
  ini = ini.replace(/^;\s*extension_dir\s*=\s*"ext"/m, 'extension_dir = "ext"');
  for (const e of ['curl', 'fileinfo', 'gd', 'intl', 'mbstring', 'exif', 'mysqli', 'openssl', 'pdo_mysql', 'pdo_pgsql', 'pgsql', 'pdo_sqlite', 'sqlite3', 'sodium', 'zip', 'bcmath', 'soap', 'sockets', 'ftp', 'gmp']) {
    ini = ini.replace(new RegExp(`^;\\s*extension=${e}\\s*$`, 'm'), `extension=${e}`);
  }
  ini = ini.replace(/^;?\s*curl\.cainfo\s*=.*$/m, `curl.cainfo = "${ca}"`)
    .replace(/^;?\s*openssl\.cafile\s*=.*$/m, `openssl.cafile = "${ca}"`)
    .replace(/^memory_limit\s*=.*$/m, 'memory_limit = 512M')
    .replace(/^upload_max_filesize\s*=.*$/m, 'upload_max_filesize = 128M')
    .replace(/^post_max_size\s*=.*$/m, 'post_max_size = 128M')
    .replace(/^max_execution_time\s*=.*$/m, 'max_execution_time = 120')
    .replace(/^;?\s*date\.timezone\s*=.*$/m, 'date.timezone = America/Sao_Paulo');
  ini += `\n; --- RDR Local ---\nmail.add_x_header = Off\nopcache.enable_cli = 0\n`;
  fs.writeFileSync(path.join(bins.phpDir(branch), 'php.ini'), ini);
  ensurePhpIni(branch);
  setVersion(`php-${branch}`, entry.version);
  if (!cfg.phpPorts[branch]) cfg.phpPorts[branch] = 9100 + 10 * Object.keys(cfg.phpPorts).length;
  if (!cfg.phpDefault) cfg.phpDefault = branch;
  save();
  writeShims();
}

async function installMariadb(jl) {
  let v = process.env.RDR_MARIADB;
  if (!v) {
    jl('Descobrindo a versão LTS do MariaDB...');
    const idx = await getJson('https://downloads.mariadb.org/rest-api/mariadb/');
    const majors = (idx.major_releases || []).filter((m) => m.release_status === 'Stable');
    const lts = majors.find((m) => /long term/i.test(m.release_support_type || '')) || majors[0];
    if (!lts) throw new Error('Não foi possível descobrir a versão do MariaDB (defina RDR_MARIADB=11.4.5)');
    const rels = await getJson(`https://downloads.mariadb.org/rest-api/mariadb/${lts.release_id}/`);
    v = Object.keys(rels.releases || {}).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0];
  }
  jl(`Baixando MariaDB ${v}...`);
  await download(`https://archive.mariadb.org/mariadb-${v}/winx64-packages/mariadb-${v}-winx64.zip`, tmp('mariadb.zip'), jl);
  await unzip(tmp('mariadb.zip'), dir('mariadb')); fs.unlinkSync(tmp('mariadb.zip'));
  setVersion('mariadb', v);
}

async function installPostgres(jl) {
  const cands = process.env.RDR_PG ? [process.env.RDR_PG] : ['17.6-1', '17.5-2', '17.5-1', '17.4-1', '17.2-1', '16.10-1', '16.9-1', '16.8-1'];
  let lastErr;
  for (const v of cands) {
    try {
      jl(`Tentando PostgreSQL ${v}...`);
      await download(`https://get.enterprisedb.com/postgresql/postgresql-${v}-windows-x64-binaries.zip`, tmp('pg.zip'), jl);
      await unzip(tmp('pg.zip'), dir('postgres')); fs.unlinkSync(tmp('pg.zip'));
      setVersion('postgres', v.replace(/-\d+$/, ''));
      return;
    } catch (e) { lastErr = e; jl(`  não disponível (${e.message.slice(0, 60)})`); try { fs.unlinkSync(tmp('pg.zip')); } catch (_) { /* ok */ } }
  }
  throw new Error('Nenhuma versão do PostgreSQL baixou. Defina RDR_PG=17.5-1 com uma versão existente. ' + (lastErr ? lastErr.message : ''));
}

async function installRedis(jl) {
  const a = await githubAsset('redis-windows/redis-windows', /x64.*\.zip$/i, /msys2/i);
  jl(`Baixando Redis ${a.tag}...`);
  await download(a.url, tmp('redis.zip'), jl);
  await unzip(tmp('redis.zip'), dir('redis')); fs.unlinkSync(tmp('redis.zip'));
  setVersion('redis', a.tag.replace(/^v/, ''));
}

async function installMailpit(jl) {
  const a = await githubAsset('axllent/mailpit', /mailpit-windows-amd64\.zip$/);
  jl(`Baixando Mailpit ${a.tag}...`);
  await download(a.url, tmp('mailpit.zip'), jl);
  await unzip(tmp('mailpit.zip'), dir('mailpit')); fs.unlinkSync(tmp('mailpit.zip'));
  setVersion('mailpit', a.tag.replace(/^v/, ''));
}

async function installCloudflared(jl) {
  const a = await githubAsset('cloudflare/cloudflared', /^cloudflared-windows-amd64\.exe$/);
  jl(`Baixando Cloudflared ${a.tag}...`);
  fs.mkdirSync(dir('cloudflared'), { recursive: true });
  await download(a.url, bins.cloudflared(), jl);
  setVersion('cloudflared', a.tag.replace(/^v/, ''));
}

async function installMeilisearch(jl) {
  const a = await githubAsset('meilisearch/meilisearch', /^meilisearch-windows-amd64(\.exe)?$/);
  jl(`Baixando Meilisearch ${a.tag}...`);
  fs.mkdirSync(dir('meilisearch'), { recursive: true });
  await download(a.url, bins.meilisearch(), jl);
  setVersion('meilisearch', a.tag.replace(/^v/, ''));
}

/** rclone (backup na nuvem): zip oficial de downloads.rclone.org, com SHA-256 conferido contra o SHA256SUMS da mesma versão. */
async function installRclone(jl) {
  const ver = (await get('https://downloads.rclone.org/version.txt')).toString('utf8').trim().replace(/^rclone\s+/, '');
  if (!/^v\d+\.\d+\.\d+$/.test(ver)) throw new Error('Não consegui descobrir a versão atual do rclone.');
  const name = `rclone-${ver}-windows-amd64.zip`;
  const sums = (await get(`https://downloads.rclone.org/${ver}/SHA256SUMS`)).toString('utf8');
  const m = new RegExp(`^([0-9a-f]{64})\\s+${name.replace(/\./g, '\\.')}\\s*$`, 'mi').exec(sums);
  if (!m) throw new Error('SHA-256 do rclone não encontrado na lista oficial.');
  jl(`Baixando rclone ${ver}...`);
  const zip = tmp('rclone.zip');
  await download(`https://downloads.rclone.org/${ver}/${name}`, zip, jl);
  try {
    jl('Verificando a integridade (SHA-256)...');
    const got = await new Promise((res, rej) => { const h = require('crypto').createHash('sha256'); fs.createReadStream(zip).on('data', (d) => h.update(d)).on('end', () => res(h.digest('hex'))).on('error', rej); });
    if (got.toLowerCase() !== m[1].toLowerCase()) throw new Error('SHA-256 do rclone não confere: download descartado.');
    await unzip(zip, dir('rclone'));
  } finally { fs.rmSync(zip, { force: true }); }
  if (!exists(bins.rclone())) throw new Error('Instalei, mas não achei o rclone.exe.');
  setVersion('rclone', ver.replace(/^v/, ''));
}

/** Git (MinGit, a versão enxuta oficial do Git for Windows), com SHA-256 conferido quando o GitHub informa. */
async function installGit(jl) {
  const rel = await getJson('https://api.github.com/repos/git-for-windows/git/releases/latest');
  const a = (rel.assets || []).find((x) => /^MinGit-[\d.]+-64-bit\.zip$/.test(x.name));
  if (!a) throw new Error('MinGit para Windows não encontrado no Git for Windows.');
  jl(`Baixando ${a.name}...`);
  const zip = tmp('mingit.zip');
  await download(a.browser_download_url, zip, jl);
  try {
    const m = /^sha256:([0-9a-f]{64})$/i.exec(a.digest || '');
    if (m) {
      jl('Verificando a integridade (SHA-256)...');
      const got = await new Promise((res, rej) => { const h = require('crypto').createHash('sha256'); fs.createReadStream(zip).on('data', (d) => h.update(d)).on('end', () => res(h.digest('hex'))).on('error', rej); });
      if (got.toLowerCase() !== m[1].toLowerCase()) throw new Error('SHA-256 do Git não confere: download descartado.');
    } else jl('O GitHub não informou o SHA-256 desta versão: pulando a conferência.');
    await unzip(zip, dir('git'));
  } finally { fs.rmSync(zip, { force: true }); }
  if (!exists(path.join(dir('git'), 'cmd', X('git')))) throw new Error('Instalei, mas não achei o git.exe.');
  setVersion('git', String(rel.tag_name || '').replace(/^v/, ''));
}

async function installComposer(jl) {
  jl('Baixando Composer...');
  fs.mkdirSync(dir('composer'), { recursive: true });
  fs.writeFileSync(bins.composerPhar(), await get('https://getcomposer.org/download/latest-stable/composer.phar'));
  setVersion('composer', 'latest');
  writeShims();
}

/** Adminer: gerenciador de bancos (MariaDB/MySQL e PostgreSQL) servido em db.<tld>, só para a própria máquina. */
function ensureAdminer() {
  if (!isInstalled.adminer()) return;
  let head = '';
  try { head = fs.readFileSync(bins.adminerFile(), 'latin1').slice(0, 20000); } catch (_) { return; }
  const v5 = /namespace\s+Adminer\s*;/.test(head);
  const guard = `$ip = $_SERVER['REMOTE_ADDR'] ?? '';
if (!in_array($ip, ['127.0.0.1', '::1'], true)) { http_response_code(403); exit('Somente acesso local.'); }
error_reporting(E_ALL & ~E_DEPRECATED & ~E_NOTICE & ~E_WARNING);
ini_set('display_errors', '0');
`;
  // adminer_object precisa ser GLOBAL (o Adminer checa function_exists('adminer_object') com string, sem namespace).
  const code = v5
    ? `<?php
// Gerado pelo RDR Local. Banco local sem senha: login liberado só para 127.0.0.1.
${guard}function adminer_object() {
    $plugin = new class { function login($login, $password) { return true; } };
    $cls = class_exists('Adminer\\Pluginer') ? 'Adminer\\Pluginer' : 'Adminer\\Plugins'; // v5 / v6
    return new $cls([$plugin]);
}
include __DIR__ . '/adminer.php';
`
    : `<?php
// Gerado pelo RDR Local. Banco local sem senha: login liberado só para 127.0.0.1.
${guard}function adminer_object() {
    class RdrAdminer extends Adminer { function login($login, $password) { return true; } }
    return new RdrAdminer;
}
include __DIR__ . '/adminer.php';
`;
  fs.writeFileSync(path.join(dir('adminer'), 'index.php'), code);
}

/** PHP usado pelo phpMyAdmin: o maior instalado até 8.3 (a versão 5.2 ainda não declara suporte ao 8.4); senão o padrão. */
const pmaPhp = () => phpInstalled().find((v) => parseFloat(v) <= 8.3) || phpDefault();

/** phpMyAdmin: login automático (auth config, usuário root sem senha) liberado só para 127.0.0.1. */
function ensurePma() {
  if (!isInstalled.phpmyadmin()) return;
  if (!cfg.pmaSecret) { cfg.pmaSecret = require('crypto').randomBytes(16).toString('hex'); save(); }
  const tmpDir = path.join(P.data, 'pma-tmp'); fs.mkdirSync(tmpDir, { recursive: true });
  fs.writeFileSync(path.join(dir('phpmyadmin'), 'config.inc.php'), `<?php
// Gerado pelo RDR Local. Banco local sem senha: acesso liberado só para 127.0.0.1.
if (!in_array($_SERVER['REMOTE_ADDR'] ?? '', ['127.0.0.1', '::1'], true)) { http_response_code(403); exit('Somente acesso local.'); }
error_reporting(E_ALL & ~E_DEPRECATED & ~E_NOTICE & ~E_WARNING);
$cfg['blowfish_secret'] = '${cfg.pmaSecret}';
$i = 1;
$cfg['Servers'][$i]['auth_type'] = 'config';
$cfg['Servers'][$i]['host'] = '127.0.0.1';
$cfg['Servers'][$i]['port'] = ${Number(cfg.ports.mariadb)};
$cfg['Servers'][$i]['user'] = 'root';
$cfg['Servers'][$i]['password'] = '';
$cfg['Servers'][$i]['AllowNoPassword'] = true;
$cfg['Servers'][$i]['verbose'] = 'RDR Local (MariaDB)';
$cfg['TempDir'] = '${fwd(tmpDir)}';
$cfg['UploadDir'] = '';
$cfg['SaveDir'] = '';
$cfg['ExecTimeLimit'] = 300;
$cfg['VersionCheck'] = false;
$cfg['ShowPhpInfo'] = true;
`);
}
const ensureTools = () => { ensureAdminer(); ensurePma(); };

async function installPhpMyAdmin(jl) {
  jl('Baixando phpMyAdmin (última versão estável)...');
  fs.mkdirSync(P.bin, { recursive: true });
  const zip = tmp('pma.zip');
  await download('https://www.phpmyadmin.net/downloads/phpMyAdmin-latest-all-languages.zip', zip, jl);
  await unzip(zip, dir('phpmyadmin')); fs.unlinkSync(zip);
  if (!exists(bins.pmaIndex())) throw new Error('O pacote do phpMyAdmin veio sem index.php (extração falhou).');
  const rel = fs.readdirSync(dir('phpmyadmin')).find((n) => /^RELEASE-DATE-/.test(n));
  setVersion('phpmyadmin', rel ? rel.replace('RELEASE-DATE-', '') : 'latest');
  ensurePma();
}

async function installAdminer(jl) {
  let a;
  try { a = await githubAsset('vrana/adminer', /^adminer-\d[\d.]*\.php$/); } catch (_) { a = await githubAsset('vrana/adminer', /^adminer-\d[\d.]*-en\.php$/); }
  jl(`Baixando Adminer ${a.tag}...`);
  fs.mkdirSync(dir('adminer'), { recursive: true });
  await download(a.url, bins.adminerFile(), jl);
  ensureAdminer();
  setVersion('adminer', a.tag.replace(/^v/, ''));
}

/** Atalhos php.bat e composer.bat (PHP padrão) para usar em qualquer terminal. */
function writeShims() {
  const shims = path.join(P.bin, 'shims'); fs.mkdirSync(shims, { recursive: true });
  fs.writeFileSync(path.join(shims, 'rdr.bat'), `@echo off\r\n"${process.execPath}" "${path.join(P.app, 'rdr.js')}" %*\r\n`);
  const v = phpDefault(); if (!v) return;
  const cli = bins.phpCli(v);
  fs.writeFileSync(path.join(shims, 'php.bat'), `@echo off\r\n"${cli}" %*\r\n`);
  fs.writeFileSync(path.join(shims, 'composer.bat'), `@echo off\r\n"${cli}" "${bins.composerPhar()}" %*\r\n`);
}

const INSTALLERS = {
  caddy: installCaddy, mariadb: installMariadb, postgres: installPostgres,
  redis: installRedis, mailpit: installMailpit, composer: installComposer, adminer: installAdminer, phpmyadmin: installPhpMyAdmin, cloudflared: installCloudflared, meilisearch: installMeilisearch, rclone: installRclone, git: installGit,
};
const LABELS = {
  caddy: 'Caddy — servidor web + HTTPS', mariadb: 'MariaDB (compatível com MySQL)', postgres: 'PostgreSQL',
  redis: 'Redis', mailpit: 'Mailpit — caixa de e-mail de testes', composer: 'Composer',
  adminer: 'Adminer — visualizador de bancos (MariaDB e PostgreSQL)',
  phpmyadmin: 'phpMyAdmin — gerenciador completo do MariaDB/MySQL',
  meilisearch: 'Meilisearch — busca rápida (Laravel Scout), opcional',
  git: 'Git (MinGit) — clonar e atualizar repositórios do GitHub (opcional; use o seu, se já tiver)',
  rclone: 'rclone — envia os backups para Google Drive, Dropbox, S3… (opcional)',
  cloudflared: 'Cloudflared — túnel público temporário para mostrar um site (opcional)',
};

function install(id, jl, arg) {
  needWindows();
  if (id === 'php') return installPhp(jl, arg);
  if (!INSTALLERS[id]) throw new Error('Componente desconhecido: ' + id);
  return INSTALLERS[id](jl);
}

function listComponents() {
  return Object.keys(LABELS).map((id) => ({ id, name: LABELS[id], installed: isInstalled[id](), version: version(id) }));
}

module.exports = {
  githubLatestTag, latestPhpReleases, ensureAdminer, ensurePma, ensureTools, pmaPhp, ensurePhpIni, ensureAllPhpIni, bins, dir, version, phpInstalled, phpDefault, isInstalled, install, listComponents, phpAvailable, writeShims, LABELS,
};
