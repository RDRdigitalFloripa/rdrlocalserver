'use strict';
/**
 * Integração com o GitHub:
 *  - login por "device flow" (sem senha, sem copiar token) ou token pessoal fine-grained;
 *  - o token fica cifrado com DPAPI (Windows) em config/secrets.json e NUNCA vai para .git/config, URL de remote ou argumentos de comando:
 *    para clonar/atualizar ele segue só por variável de ambiente (GIT_CONFIG_*), limitado a https://github.com/;
 *  - lista repositórios, clona para um site já configurado, mostra branch/alterações e faz pull só quando é seguro (fast-forward, árvore limpa).
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const core = require('./core');
const comps = require('./components');
const secrets = require('./secrets');
const sites = require('./sites');
const { P, IS_WIN, cfg, save, log, exists, isDir, slug, run, runStreamed } = core;

// Endereços sobrescrevíveis só para testes automatizados.
const API = () => process.env.RDR_GITHUB_API || 'https://api.github.com';
const WEB = () => process.env.RDR_GITHUB_WEB || 'https://github.com';
const CLONE_BASE = () => process.env.RDR_GITHUB_CLONE_BASE || 'https://github.com';
const FULL_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;
const TOKEN_RE = /^(gh[pousr]_[A-Za-z0-9_]{20,255}|github_pat_[A-Za-z0-9_]{20,255})$/;

const gitExe = () => comps.bins.git();
const token = () => secrets.getProtected('githubToken');
const connected = () => !!token();

function request(method, url, { headers = {}, form, json } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url); const lib = u.protocol === 'https:' ? https : http;
    let body = null; const h = { 'User-Agent': 'rdr-local', Accept: 'application/json', ...headers };
    if (form) { body = new URLSearchParams(form).toString(); h['Content-Type'] = 'application/x-www-form-urlencoded'; }
    if (json) { body = JSON.stringify(json); h['Content-Type'] = 'application/json'; }
    if (body) h['Content-Length'] = Buffer.byteLength(body);
    const req = lib.request(u, { method, headers: h, timeout: 20000 }, (r) => {
      const chunks = []; r.on('data', (c) => chunks.push(c));
      r.on('end', () => { const txt = Buffer.concat(chunks).toString('utf8'); let j = null; try { j = JSON.parse(txt); } catch (_) { /* não é JSON */ } resolve({ status: r.statusCode, json: j, text: txt, headers: r.headers }); });
    });
    req.on('timeout', () => req.destroy(new Error('tempo esgotado falando com o GitHub')));
    req.on('error', reject); if (body) req.write(body); req.end();
  });
}
const apiGet = (p) => request('GET', API() + p, { headers: { Authorization: `Bearer ${token()}`, 'X-GitHub-Api-Version': '2022-11-28', Accept: 'application/vnd.github+json' } });

/** Variáveis de ambiente que entregam o token ao git só para github.com, sem gravar nada em disco. */
function gitEnv(extra = {}) {
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', ...extra };
  const t = token();
  if (t) {
    const n = Math.max(0, parseInt(env.GIT_CONFIG_COUNT, 10) || 0); // acrescenta, sem apagar config de ambiente que já exista
    env.GIT_CONFIG_COUNT = String(n + 1);
    env[`GIT_CONFIG_KEY_${n}`] = `http.${CLONE_BASE().replace(/\/+$/, '')}/.extraheader`;
    env[`GIT_CONFIG_VALUE_${n}`] = 'AUTHORIZATION: basic ' + Buffer.from(`x-access-token:${t}`).toString('base64');
  }
  return env;
}
const git = (args, opts = {}) => run(gitExe(), args, { timeout: 60000, env: gitEnv(), ...opts });
async function gitVersion() { const r = await run(gitExe(), ['--version'], { timeout: 15000 }); return r.ok ? r.out.replace(/^git version\s*/, '').split('\n')[0] : ''; }

// ---------- conexão ----------
async function summary() {
  const gv = await gitVersion();
  return { gitInstalled: !!gv, gitVersion: gv, managedGit: comps.isInstalled.git(), connected: connected(), user: cfg.github.user, clientId: cfg.github.clientId, privateRepos: !!cfg.github.privateRepos };
}
function setConfig(o) {
  const id = String(o.clientId == null ? cfg.github.clientId : o.clientId).trim();
  if (id && !/^[A-Za-z0-9._-]{8,40}$/.test(id)) throw new Error('Client ID inválido (copie da página do seu OAuth App no GitHub).');
  cfg.github.clientId = id; if (o.privateRepos !== undefined) cfg.github.privateRepos = !!o.privateRepos; save();
}

let pending = null; // { device_code, interval, expires, last }
async function deviceStart() {
  if (!cfg.github.clientId) throw new Error('Informe o Client ID do seu OAuth App (veja o guia GitHub na Ajuda) ou use um token pessoal.');
  const r = await request('POST', WEB() + '/login/device/code', { form: { client_id: cfg.github.clientId, scope: cfg.github.privateRepos ? 'repo' : 'public_repo' } });
  if (r.status !== 200 || !r.json || !r.json.device_code) throw new Error('O GitHub recusou: ' + ((r.json && (r.json.error_description || r.json.error)) || 'HTTP ' + r.status) + '. Confira se "Enable Device Flow" está ligado no OAuth App.');
  pending = { device_code: r.json.device_code, interval: Math.max(5, Number(r.json.interval) || 5), expires: Date.now() + (Number(r.json.expires_in) || 900) * 1000, last: 0 };
  return { userCode: r.json.user_code, url: r.json.verification_uri, interval: pending.interval, expiresIn: Number(r.json.expires_in) || 900 };
}
async function deviceCheck() {
  if (!pending) throw new Error('Nenhum login em andamento. Clique em "Conectar com o GitHub".');
  if (Date.now() > pending.expires) { pending = null; return { status: 'expired' }; }
  if (Date.now() - pending.last < pending.interval * 1000 - 500) return { status: 'pending' };
  pending.last = Date.now();
  const r = await request('POST', WEB() + '/login/oauth/access_token', { form: { client_id: cfg.github.clientId, device_code: pending.device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' } });
  const j = r.json || {};
  if (j.access_token) { pending = null; await store(j.access_token); return { status: 'ok', user: cfg.github.user }; }
  if (j.error === 'authorization_pending') return { status: 'pending' };
  if (j.error === 'slow_down') { pending.interval += 5; return { status: 'pending' }; }
  if (j.error === 'expired_token') { pending = null; return { status: 'expired' }; }
  if (j.error === 'access_denied') { pending = null; return { status: 'denied' }; }
  throw new Error(j.error_description || j.error || 'Resposta inesperada do GitHub.');
}
/** Guarda o token (cifrado) depois de provar que ele funciona. */
async function store(t) {
  const old = token();
  secrets.setProtected('githubToken', t);
  const r = await apiGet('/user').catch((e) => ({ status: 0, json: null, err: e }));
  if (r.status !== 200 || !r.json || !r.json.login) { secrets.setProtected('githubToken', old || ''); throw new Error('O GitHub não aceitou esse token' + (r.status === 401 ? ' (inválido ou expirado).' : ` (HTTP ${r.status}).`)); }
  cfg.github.user = r.json.login; save(); cache = null; log(`GitHub conectado como ${r.json.login}.`);
}
async function setToken(t) {
  const s = String(t || '').trim();
  if (!TOKEN_RE.test(s)) throw new Error('Formato de token inválido. Use um token pessoal (github_pat_… ou ghp_…).');
  await store(s);
}
function disconnect() { secrets.setProtected('githubToken', ''); cfg.github.user = ''; save(); cache = null; pending = null; log('GitHub desconectado (o token foi apagado daqui; para revogar de vez, apague-o em github.com/settings).'); }

// ---------- repositórios ----------
let cache = null;
async function repos(q) {
  if (!connected()) throw new Error('Conecte sua conta do GitHub primeiro.');
  if (!cache || Date.now() - cache.t > 60000) {
    const out = [];
    for (let page = 1; page <= 3; page++) {
      const r = await apiGet(`/user/repos?per_page=100&page=${page}&sort=pushed&affiliation=owner,collaborator,organization_member`);
      if (r.status === 401) throw new Error('Token recusado pelo GitHub (expirado?). Conecte de novo.');
      if (r.status !== 200 || !Array.isArray(r.json)) throw new Error('Não consegui listar os repositórios (HTTP ' + r.status + ').');
      out.push(...r.json.map((x) => ({ full: x.full_name, private: !!x.private, description: x.description || '', pushed: x.pushed_at, branch: x.default_branch, archived: !!x.archived })));
      if (r.json.length < 100) break;
    }
    cache = { t: Date.now(), list: out };
  }
  const term = String(q || '').trim().toLowerCase();
  return cache.list.filter((x) => !term || x.full.toLowerCase().includes(term) || x.description.toLowerCase().includes(term)).slice(0, 200);
}

// ---------- clonar para um site ----------
const dbName = (s) => s.replace(/-/g, '_');
async function cloneToSite(o, jl = () => {}) {
  const full = String(o.full || '');
  if (!FULL_RE.test(full)) throw new Error('Repositório inválido.');
  if (!(await gitVersion())) throw new Error('O Git não está instalado: instale em Componentes e PHP ou no botão da página GitHub.');
  const root = String(o.dir || cfg.projectsRoot || '').trim();
  if (!root || !isDir(root)) throw new Error('Defina a pasta raiz dos projetos (Configurações) ou informe uma pasta válida.');
  const repo = full.split('/')[1].replace(/\.git$/i, '');
  const folder = slug(String(o.name || repo)) || slug(repo);
  const target = path.join(root, folder);
  if (exists(target) && fs.readdirSync(target).length) throw new Error('A pasta já existe e não está vazia: ' + target);
  const name = String(o.name || repo).trim();
  const domain = String(o.domain || '').trim().toLowerCase() || `${folder}.${cfg.tld}`;
  jl(`git clone ${full} → ${target}`);
  const url = `${CLONE_BASE().replace(/\/+$/, '')}/${full}.git`;
  await runStreamed(gitExe(), ['clone', '--progress', url, target], jl, { env: gitEnv() });
  jl('Clone concluído.');
  const has = (f) => exists(path.join(target, f));
  const ver = comps.phpDefault();
  if (has('composer.json') && ver) {
    const env = sites.terminalEnv({ php: ver, path: target }); const cli = comps.bins.phpCli(ver);
    if (!comps.isInstalled.composer()) { jl('Instalando Composer...'); await comps.install('composer', jl); }
    jl('composer install (pode demorar)...');
    try { await runStreamed(cli, [comps.bins.composerPhar(), 'install', '--no-interaction', '--prefer-dist'], jl, { cwd: target, env }); } catch (e) { jl('⚠ composer install falhou: ' + e.message + ' (confira as extensões do PHP em Diagnóstico).'); }
    const envFile = path.join(target, '.env');
    if (!has('.env') && has('.env.example')) { fs.copyFileSync(path.join(target, '.env.example'), envFile); jl('.env criado a partir do .env.example.'); }
    if (exists(envFile)) {
      const pr = require('./projects'); const vars = { APP_URL: sites.baseUrl(domain) };
      if (o.createDb) { const eng = o.dbEngine === 'postgres' ? 'postgres' : 'mariadb'; const made = await pr.maybeCreateDb(eng, dbName(folder), jl); if (made) { const pg = eng === 'postgres'; Object.assign(vars, { DB_CONNECTION: pg ? 'pgsql' : 'mariadb', DB_HOST: '127.0.0.1', DB_PORT: String(pg ? cfg.ports.postgres : cfg.ports.mariadb), DB_DATABASE: dbName(folder), DB_USERNAME: pg ? 'postgres' : 'root', DB_PASSWORD: '' }); } }
      pr.patchEnv(envFile, vars); jl('.env ajustado (APP_URL' + (o.createDb ? ' e banco' : '') + ').');
      if (has('artisan')) { try { await runStreamed(cli, ['artisan', 'key:generate', '--force', '--no-interaction'], jl, { cwd: target, env }); } catch (e) { jl('⚠ key:generate falhou: ' + e.message); } }
    }
    await sites.add({ name, path: target, domain, php: ver });
    jl('Site PHP criado. As migrations NÃO foram rodadas (confira o .env e rode "php artisan migrate" no terminal do site).');
  } else if (has('package.json') || has('go.mod') || has('manage.py') || has('requirements.txt') || has('pom.xml')) {
    const d = require('./apps').detect(target);
    if (!d) { await sites.add({ name, path: target, domain, php: ver || 'none' }); jl('Não identifiquei o tipo do projeto: criei um site comum (PHP/estático).'); }
    else {
      await sites.add({ type: 'app', name, path: target, domain, runtime: d.runtime, rtVersion: 'default', cmd: d.cmd });
      jl(`App ${d.note} criado. Instale as dependências no botão "pacote" da lista de sites e inicie.`);
    }
  } else { await sites.add({ name, path: target, domain, php: ver || 'none' }); jl('Site comum criado.'); }
  jl(`Pronto: ${sites.baseUrl(domain)}`);
}

// ---------- estado e atualização dos repositórios dos sites ----------
const statusCache = new Map(); // id -> { t, v }
function parseStatus(out) {
  const v = { branch: '', ahead: 0, behind: 0, changed: 0, untracked: 0, detached: false, upstream: false };
  for (const l of String(out).split(/\r?\n/)) {
    if (l.startsWith('# branch.head ')) { v.branch = l.slice(14).trim(); v.detached = v.branch === '(detached)'; }
    else if (l.startsWith('# branch.upstream ')) v.upstream = true;
    else if (l.startsWith('# branch.ab ')) { const m = /\+(\d+) -(\d+)/.exec(l); if (m) { v.ahead = +m[1]; v.behind = +m[2]; } }
    else if (l.startsWith('?')) v.untracked++;
    else if (l && !l.startsWith('#')) v.changed++;
  }
  return v;
}
async function siteStatus(s) {
  const c = statusCache.get(s.id); if (c && Date.now() - c.t < 15000) return c.v;
  let v = { error: 'sem git' };
  if (s.path && isDir(path.join(s.path, '.git'))) {
    const r = await run(gitExe(), ['-C', s.path, '-c', 'core.quotepath=off', 'status', '--porcelain=v2', '--branch'], { timeout: 15000, env: gitEnv() });
    v = r.ok ? parseStatus(r.out) : { error: r.out.slice(0, 120) };
  }
  statusCache.set(s.id, { t: Date.now(), v }); return v;
}
// Repositório removido/renomeado/sem acesso no GitHub: checa em segundo plano (git ls-remote), no máximo a cada 10 min por site.
const goneCache = new Map(); // id -> { t, gone, busy }
function checkGone(s) {
  const c = goneCache.get(s.id);
  if (c && (c.busy || Date.now() - c.t < 600000)) return !!(c && c.gone);
  goneCache.set(s.id, { t: Date.now(), gone: !!(c && c.gone), busy: true });
  (async () => {
    let gone = false;
    try {
      if (connected() && (await isGithub(s))) {
        const r = await run(gitExe(), ['-C', s.path, 'ls-remote', '--exit-code', 'origin', 'HEAD'], { timeout: 15000, env: gitEnv() });
        gone = !r.ok && /repository not found|not found/i.test(r.out);
      }
    } catch (_) { /* rede fora do ar: não marca nada */ }
    goneCache.set(s.id, { t: Date.now(), gone, busy: false });
  })();
  return !!(c && c.gone);
}
async function allStatus() {
  const out = {}; const list = cfg.sites.filter((s) => s.path && isDir(path.join(s.path, '.git')));
  await Promise.all(list.map(async (s) => { out[s.id] = { ...(await siteStatus(s)), remoteGone: checkGone(s) }; }));
  return out;
}
const siteOf = (id) => { const s = cfg.sites.find((x) => x.id === id); if (!s || !s.path || !isDir(path.join(s.path, '.git'))) throw new Error('Este site não é um repositório Git.'); return s; };
const isGithub = async (s) => { const r = await run(gitExe(), ['-C', s.path, 'remote', 'get-url', 'origin'], { timeout: 10000 }); return r.ok && r.out.startsWith(CLONE_BASE().replace(/\/+$/, '') + '/'); };

async function fetchSite(id, jl = () => {}) {
  const s = siteOf(id); jl(`git fetch (${s.name})...`);
  await runStreamed(gitExe(), ['-C', s.path, 'fetch', '--prune'], jl, { env: gitEnv() });
  statusCache.delete(id);
}
async function pullSite(id, jl = () => {}) {
  const s = siteOf(id); statusCache.delete(id);
  const st = await siteStatus(s); statusCache.delete(id);
  if (st.error) throw new Error('Não consegui ler o estado do repositório: ' + st.error);
  if (st.detached) throw new Error('O repositório está em HEAD desanexado (sem branch). Troque de branch no terminal antes.');
  if (!st.upstream) throw new Error('A branch atual não acompanha uma branch remota (sem upstream).');
  if (st.changed || st.untracked) throw new Error(`Há ${st.changed} arquivo(s) alterado(s) e ${st.untracked} novo(s) sem commit. Faça commit ou guarde com "git stash" antes de atualizar: o RDR Local não mexe em trabalho não salvo.`);
  jl(`git pull --ff-only (${s.name}, branch ${st.branch})...`);
  await runStreamed(gitExe(), ['-C', s.path, 'pull', '--ff-only', '--progress'], jl, { env: gitEnv() });
  statusCache.delete(id);
  jl('Atualizado. Se o projeto tem dependências novas, rode "composer install"/"npm install" no terminal do site.');
}

/** Último build (GitHub Actions) de uma branch: { status, conclusion, sha, url, at } ou null. */
async function actionsLatest(full, branch = 'main') {
  if (!FULL_RE.test(full)) throw new Error('Repositório inválido.');
  if (!connected()) throw new Error('Conecte sua conta do GitHub para consultar o build.');
  const r = await apiGet(`/repos/${full}/actions/runs?branch=${encodeURIComponent(branch)}&per_page=5&exclude_pull_requests=true`);
  if (r.status === 404) throw new Error('Repositório não encontrado ou o token não tem acesso ao Actions (precisa de "Actions: Read").');
  if (r.status !== 200 || !r.json) throw new Error('Não consegui consultar o Actions (HTTP ' + r.status + ').');
  const x = (r.json.workflow_runs || [])[0]; if (!x) return null;
  return { status: x.status, conclusion: x.conclusion, sha: x.head_sha, url: x.html_url, at: x.updated_at || x.created_at, name: x.name };
}
async function localInfo(siteId) {
  const s = cfg.sites.find((x) => x.id === siteId); if (!s || !s.path || !isDir(path.join(s.path, '.git'))) return null;
  const head = await run(gitExe(), ['-C', s.path, 'rev-parse', 'HEAD'], { timeout: 10000 });
  const url = await run(gitExe(), ['-C', s.path, 'remote', 'get-url', 'origin'], { timeout: 10000 });
  const m = /github\.com[:/]([A-Za-z0-9-]+\/[A-Za-z0-9._-]+?)(?:\.git)?\/?$/.exec(url.ok ? url.out.trim() : '');
  statusCache.delete(s.id);
  return { sha: head.ok ? head.out.trim() : '', repo: m ? m[1] : '', status: await siteStatus(s) };
}

module.exports = { actionsLatest, localInfo, summary, setConfig, deviceStart, deviceCheck, setToken, disconnect, repos, cloneToSite, allStatus, fetchSite, pullSite, parseStatus, gitEnv, FULL_RE, TOKEN_RE };
