'use strict';
/**
 * Runtimes de linguagens gerenciados pelo RDR Local (Node.js e Python), várias versões lado a lado.
 *  - Node.js: zip oficial win-x64 de nodejs.org  -> bin/node/<major>/
 *  - Python:  build "install_only" (python-build-standalone, já com pip e venv) -> bin/python/<major.minor>/
 * Go: zip oficial de go.dev (sha256 verificado) -> bin/go/<1.x>/;  Java: Eclipse Temurin JDK (sha256 verificado) -> bin/java/<major>/.
 * Outras linguagens usam o tipo "custom" (comando próprio, usando o que estiver no PATH do Windows).
 */
const fs = require('fs');
const path = require('path');
const core = require('./core');
const { P, IS_WIN, cfg, save, exists, isDir, getJson, download, unzip, X, log } = core;

const KINDS = {
  node: { label: 'Node.js', dir: () => path.join(P.bin, 'node') },
  python: { label: 'Python', dir: () => path.join(P.bin, 'python') },
  go: { label: 'Go', dir: () => path.join(P.bin, 'go') },
  java: { label: 'Java (JDK)', dir: () => path.join(P.bin, 'java') },
};
const kindOk = (rt) => { if (!KINDS[rt]) throw new Error('Linguagem desconhecida: ' + rt); };
const rtDir = (rt, v) => path.join(KINDS[rt].dir(), String(v));
const verFile = (rt, v) => path.join(rtDir(rt, v), '.version');
const fullVersion = (rt, v) => { try { return fs.readFileSync(verFile(rt, v), 'utf8').trim(); } catch (_) { return ''; } };
const VER_RE = { node: /^\d{1,3}$/, python: /^3\.\d{1,2}$/, go: /^1\.\d{1,2}$/, java: /^\d{1,2}$/ };
const cmpVer = (a, b) => { const x = String(a).split('.').map(Number); const y = String(b).split('.').map(Number); for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d; } return 0; };

/** Executável principal de uma versão instalada. */
function exe(rt, v) {
  const d = rtDir(rt, v);
  if (rt === 'node') return X(path.join(d, 'node'));
  if (rt === 'go' || rt === 'java') return X(path.join(d, 'bin', rt === 'go' ? 'go' : 'java'));
  return IS_WIN ? path.join(d, 'python.exe') : path.join(d, 'bin', 'python3');
}
const isInstalledVer = (rt, v) => exists(exe(rt, v));
function installed(rt) {
  kindOk(rt);
  const d = KINDS[rt].dir();
  if (!isDir(d)) return [];
  return fs.readdirSync(d).filter((n) => VER_RE[rt].test(n) && isInstalledVer(rt, n)).sort((a, b) => cmpVer(b, a));
}
function defaultVersion(rt) {
  const list = installed(rt);
  const want = (cfg.runtimeDefault || {})[rt];
  return want && list.includes(want) ? want : list[0] || '';
}
function setDefault(rt, v) {
  kindOk(rt);
  if (!installed(rt).includes(String(v))) throw new Error(`${KINDS[rt].label} ${v} não está instalado.`);
  cfg.runtimeDefault = { ...(cfg.runtimeDefault || {}), [rt]: String(v) }; save();
}
/** Versão de um site ('default' ou específica) -> versão instalada ou ''. */
function resolve(rt, wanted) {
  kindOk(rt);
  if (wanted && wanted !== 'default' && installed(rt).includes(String(wanted))) return String(wanted);
  return defaultVersion(rt);
}
/** Pastas que entram no PATH (na ordem) para um projeto. */
function pathParts(rt, v, projectDir) {
  const parts = [];
  if (rt === 'python') {
    const venv = projectDir ? path.join(projectDir, '.venv', IS_WIN ? 'Scripts' : 'bin') : '';
    if (venv && isDir(venv)) parts.push(venv);
    if (v) { const d = rtDir('python', v); parts.push(IS_WIN ? d : path.join(d, 'bin')); if (IS_WIN) parts.push(path.join(d, 'Scripts')); }
  } else if (rt === 'node' && v) {
    parts.push(IS_WIN ? rtDir('node', v) : path.join(rtDir('node', v), 'bin'));
  } else if ((rt === 'go' || rt === 'java') && v) {
    parts.push(path.join(rtDir(rt, v), 'bin'));
  }
  return parts.filter(Boolean);
}

// ---------- o que está disponível para baixar ----------
let cache = {};
const fresh = (k) => cache[k] && Date.now() - cache[k].t < 600000;

async function availableNode() {
  const idx = await getJson('https://nodejs.org/dist/index.json');
  const byMajor = new Map();
  for (const r of idx) {
    if (!Array.isArray(r.files) || !r.files.includes('win-x64-zip')) continue;
    const major = String(r.version).replace(/^v/, '').split('.')[0];
    if (Number(major) < 18) continue;
    const cur = byMajor.get(major);
    if (!cur || cmpVer(r.version.replace(/^v/, ''), cur.version) > 0) byMajor.set(major, { version: r.version.replace(/^v/, ''), lts: !!r.lts, name: r.lts || '' });
  }
  const list = [...byMajor.entries()].map(([v, x]) => ({ v, full: x.version, lts: x.lts, name: x.name }));
  // LTS (ativas/manutenção) + a versão mais nova, sem as ímpares antigas
  const newest = Math.max(...list.map((x) => Number(x.v)));
  return list.filter((x) => x.lts || Number(x.v) === newest).sort((a, b) => Number(b.v) - Number(a.v));
}

const PY_RE = /^cpython-(\d+\.\d+\.\d+)\+(\d+)-x86_64-pc-windows-msvc-install_only(?:_stripped)?\.tar\.gz$/;
async function pythonRelease() {
  const rel = await getJson('https://api.github.com/repos/astral-sh/python-build-standalone/releases/latest');
  const byMinor = new Map();
  for (const a of rel.assets || []) {
    const m = PY_RE.exec(a.name); if (!m) continue;
    const minor = m[1].split('.').slice(0, 2).join('.');
    const cur = byMinor.get(minor);
    const full = !/_stripped/.test(a.name); // prefere a versão completa (com testes/símbolos) só em empate
    if (!cur || cmpVer(m[1], cur.full) > 0 || (m[1] === cur.full && full && !cur.complete)) byMinor.set(minor, { v: minor, full: m[1], url: a.browser_download_url, tag: rel.tag_name, complete: full });
  }
  return [...byMinor.values()].filter((x) => cmpVer(x.v, '3.9') >= 0).sort((a, b) => cmpVer(b.v, a.v));
}
/** Go: https://go.dev/dl/?mode=json — último patch estável de cada 1.x (zip windows/amd64 com sha256). */
function parseGo(json) {
  const by = new Map();
  for (const r of json) {
    if (!r.stable) continue;
    const full = String(r.version).replace(/^go/, '');
    const m = /^(1\.\d+)(?:\.(\d+))?$/.exec(full); if (!m) continue;
    const f = (r.files || []).find((x) => x.os === 'windows' && x.arch === 'amd64' && x.kind === 'archive' && /\.zip$/.test(x.filename)); if (!f) continue;
    const cur = by.get(m[1]);
    if (!cur || cmpVer(full, cur.full) > 0) by.set(m[1], { v: m[1], full, url: 'https://go.dev/dl/' + f.filename, sha256: f.sha256 });
  }
  return [...by.values()].filter((x) => cmpVer(x.v, '1.21') >= 0).sort((a, b) => cmpVer(b.v, a.v)).slice(0, 4);
}
async function goReleases() { return parseGo(await getJson('https://go.dev/dl/?mode=json')); }

/** Java: Eclipse Temurin (Adoptium) — LTS + a versão mais nova. */
function parseTemurin(a) {
  const b = (a || [])[0]; if (!b || !b.binary || !b.binary.package) return null;
  const pk = b.binary.package;
  return { full: String((b.version && b.version.openjdk_version) || b.release_name || '').replace(/^jdk-?/, '').split('+')[0], url: pk.link, sha256: pk.checksum };
}
async function javaReleases() {
  const info = await getJson('https://api.adoptium.net/v3/info/available_releases');
  const majors = [...new Set([...(info.available_lts_releases || []), info.most_recent_feature_release].filter(Boolean))].filter((n) => n >= 17).sort((a, b) => b - a);
  const out = [];
  for (const n of majors) {
    try {
      const rel = parseTemurin(await getJson(`https://api.adoptium.net/v3/assets/latest/${n}/hotspot?architecture=x64&image_type=jdk&os=windows`));
      if (rel && rel.url) out.push({ v: String(n), lts: (info.available_lts_releases || []).includes(n), ...rel });
    } catch (_) { /* versão sem build para Windows */ }
  }
  return out;
}
async function available(rt) {
  kindOk(rt);
  if (!fresh(rt)) {
    const list = rt === 'node' ? await availableNode()
      : rt === 'go' ? (await goReleases()).map(({ v, full }) => ({ v, full }))
      : rt === 'java' ? (await javaReleases()).map(({ v, full, lts }) => ({ v, full, lts, name: lts ? 'LTS' : '' }))
      : (await pythonRelease()).map(({ v, full }) => ({ v, full }));
    cache[rt] = { t: Date.now(), list };
  }
  return cache[rt].list;
}
const refresh = () => { cache = {}; };

// ---------- instalar / remover ----------
const sha256File = (f) => new Promise((res, rej) => { const h = require('crypto').createHash('sha256'); fs.createReadStream(f).on('data', (d) => h.update(d)).on('end', () => res(h.digest('hex'))).on('error', rej); });
function needWindows() {
  if (!IS_WIN) throw new Error('A instalação automática funciona só no Windows. Em outros sistemas, coloque o runtime em bin/<linguagem>/<versão>.');
}
async function install(rt, jl, v) {
  kindOk(rt); needWindows();
  const ver = String(v || '');
  if (!VER_RE[rt].test(ver)) throw new Error('Versão inválida.');
  const list = await available(rt);
  const item = list.find((x) => x.v === ver);
  if (!item) throw new Error(`${KINDS[rt].label} ${ver} não está disponível para Windows.`);
  fs.mkdirSync(KINDS[rt].dir(), { recursive: true });
  const dest = rtDir(rt, ver);
  if (rt === 'node') {
    const url = `https://nodejs.org/dist/v${item.full}/node-v${item.full}-win-x64.zip`;
    const zip = path.join(P.bin, `node-${ver}.zip`);
    jl(`Baixando Node.js ${item.full}...`);
    await download(url, zip, jl);
    try { await unzip(zip, dest); } finally { fs.rmSync(zip, { force: true }); }
  } else if (rt === 'go' || rt === 'java') {
    const rel = (rt === 'go' ? await goReleases() : await javaReleases()).find((x) => x.v === ver);
    if (!rel) throw new Error(`${KINDS[rt].label} ${ver} não está disponível.`);
    const zip = path.join(P.bin, `${rt}-${ver}.zip`);
    jl(`Baixando ${KINDS[rt].label} ${rel.full}...`);
    await download(rel.url, zip, jl);
    try {
      jl('Verificando a integridade (SHA-256)...');
      const got = await sha256File(zip);
      if (!rel.sha256 || got.toLowerCase() !== String(rel.sha256).toLowerCase()) throw new Error('SHA-256 não confere com o publicado pelo fabricante: download descartado.');
      await unzip(zip, dest);
    } finally { fs.rmSync(zip, { force: true }); }
  } else {
    const pr = (await pythonRelease()).find((x) => x.v === ver);
    if (!pr) throw new Error(`Python ${ver} não está disponível.`);
    const tgz = path.join(P.bin, `python-${ver}.tar.gz`);
    jl(`Baixando Python ${pr.full} (build independente, com pip e venv)...`);
    await download(pr.url, tgz, jl);
    try { await unzip(tgz, dest); } finally { fs.rmSync(tgz, { force: true }); }
  }
  if (!exists(exe(rt, ver))) throw new Error('A instalação terminou, mas não achei o executável. Tente de novo.');
  fs.writeFileSync(verFile(rt, ver), item.full);
  if (!(cfg.runtimeDefault || {})[rt]) setDefault(rt, ver);
  log(`${KINDS[rt].label} ${item.full} instalado.`);
  jl(`${KINDS[rt].label} ${item.full} pronto.`);
}

/** Sites (apps) que usam essa versão — para impedir remover o que está em uso. */
function usedBy(rt, v) {
  return cfg.sites.filter((s) => s.type === 'app' && s.runtime === rt && resolve(rt, s.rtVersion) === String(v));
}
function remove(rt, v) {
  kindOk(rt);
  if (!installed(rt).includes(String(v))) throw new Error('Versão não instalada.');
  const users = usedBy(rt, v);
  if (users.length) throw new Error(`Em uso por: ${users.map((s) => s.name).join(', ')}. Troque a versão desses apps antes de remover.`);
  fs.rmSync(rtDir(rt, v), { recursive: true, force: true });
  if ((cfg.runtimeDefault || {})[rt] === String(v)) { delete cfg.runtimeDefault[rt]; save(); }
  log(`${KINDS[rt].label} ${v} removido.`);
}

function summary() {
  return Object.fromEntries(Object.keys(KINDS).map((rt) => [rt, {
    label: KINDS[rt].label, default: defaultVersion(rt),
    installed: installed(rt).map((v) => ({ v, full: fullVersion(rt, v), uses: usedBy(rt, v).length })),
  }]));
}

module.exports = { KINDS, installed, defaultVersion, setDefault, resolve, pathParts, exe, available, refresh, install, remove, usedBy, summary, fullVersion, rtDir, cmpVer, pythonRelease, parseGo, parseTemurin };
