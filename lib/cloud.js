// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 RDR Digital - https://github.com/RDRdigitalFloripa/rdrlocalserver
'use strict';
/**
 * Backup na nuvem com rclone (Google Drive, Dropbox, S3/R2/B2…, ou uma pasta/disco).
 *  - credenciais ficam em config/cloud/rclone.conf (restrito ao usuário), nunca no config.json nem na exportação;
 *  - criptografia opcional (rclone "crypt"): o destino só enxerga arquivos cifrados;
 *  - envia: dumps dos bancos, configuração sem segredos e (opcional) .env + storage/app dos projetos;
 *  - "Testar restauração" baixa o backup mais recente e importa num banco temporário.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const core = require('./core');
const comps = require('./components');
const secrets = require('./secrets');
const notify = require('./notify');
const { P, cfg, save, log, exists, isDir, run, decode, killTree } = core;

const NAME_RE = /^[A-Za-z][A-Za-z0-9_-]{0,30}$/;
const KINDS = { drive: 'Google Drive', dropbox: 'Dropbox', s3: 'S3 / Cloudflare R2 / Backblaze B2 / Wasabi', local: 'Pasta ou disco (inclusive a pasta do OneDrive/Dropbox já sincronizada)' };
const dir = () => path.join(P.root, 'config', 'cloud');
const conf = () => path.join(dir(), 'rclone.conf');
const exe = () => comps.bins.rclone();
const installed = () => exists(exe());
const backup = () => require('./backup');

function need() {
  if (!installed()) throw new Error('O rclone não está instalado: instale em Componentes e PHP (ou no botão desta página).');
  fs.mkdirSync(dir(), { recursive: true });
}
const base = () => ['--config', conf()];
async function rc(args, opts = {}) { need(); return run(exe(), [...base(), ...args], { timeout: 120000, maxBuffer: 64 * 1024 * 1024, ...opts }); }

let active = null; let cancelled = false; // rclone em andamento (para cancelar uma autorização que ficou pendente)
/** Roda o rclone mostrando a saída no log da tarefa (com limite de tempo). */
function stream(args, jl, timeoutMs = 6 * 3600 * 1000) {
  need();
  return new Promise((resolve, reject) => {
    const c = spawn(exe(), [...base(), ...args], { windowsHide: true });
    active = c;
    const pipe = (d) => decode(d).split(/\r?\n/).filter(Boolean).forEach((l) => jl(l));
    c.stdout.on('data', pipe); c.stderr.on('data', pipe);
    const timer = setTimeout(() => { killTree(c); reject(new Error('Tempo esgotado.')); }, timeoutMs);
    const end = () => { clearTimeout(timer); if (active === c) active = null; };
    c.on('error', (e) => { end(); reject(e); });
    c.on('exit', (code) => { end(); if (cancelled) { cancelled = false; return reject(new Error('Cancelado por você.')); } code === 0 ? resolve() : reject(new Error(`rclone terminou com código ${code}`)); });
  });
}
/** Cancela o rclone que está rodando (ex.: autorização do Google aberta e esquecida). */
function cancel() { if (!active) return false; cancelled = true; killTree(active); return true; }

// ---------- destinos ----------
/** Lista só nome/tipo (nunca devolve chaves ou senhas). */
async function remotes() {
  if (!installed() || !exists(conf())) return [];
  const r = await rc(['config', 'dump']);
  if (!r.ok) return [];
  let d = {}; try { d = JSON.parse(r.out); } catch (_) { return []; }
  const names = Object.keys(d);
  return names.filter((n) => d[n].type !== 'crypt').map((n) => ({ name: n, type: d[n].type, label: KINDS[d[n].type] || d[n].type, encrypted: names.includes(`${n}-crypt`) }));
}
const safeVal = (v, label) => {
  const s = String(v == null ? '' : v).trim();
  if (/^-/.test(s)) throw new Error(`${label} não pode começar com "-".`);
  if (/[\r\n\0]/.test(s)) throw new Error(`${label} inválido.`);
  return s;
};

async function connect(o, jl = () => {}) {
  need();
  const name = String(o.name || '').trim();
  if (!NAME_RE.test(name)) throw new Error('Nome do destino: comece com letra; use letras, números, _ ou - (até 31).');
  if (!KINDS[o.kind]) throw new Error('Tipo de destino inválido.');
  if ((await remotes()).some((x) => x.name === name) || name.endsWith('-crypt')) throw new Error('Já existe um destino com esse nome.');
  const args = ['config', 'create', name, o.kind];
  if (o.kind === 'drive') {
    args.push('scope', 'drive.file'); // o app só enxerga o que ele mesmo cria, não o seu Drive inteiro
    if (o.clientId) args.push('client_id', safeVal(o.clientId, 'Client ID'));
    if (o.clientSecret) args.push('client_secret', safeVal(o.clientSecret, 'Client Secret'));
  }
  if (o.kind === 's3') {
    const need3 = ['accessKeyId', 'secretAccessKey'].filter((k) => !String(o[k] || '').trim());
    if (need3.length) throw new Error('Informe a Access Key e a Secret Key.');
    args.push('provider', safeVal(o.provider || 'Other', 'Provedor'), 'env_auth', 'false', 'access_key_id', safeVal(o.accessKeyId, 'Access Key'), 'secret_access_key', safeVal(o.secretAccessKey, 'Secret Key'));
    if (o.endpoint) args.push('endpoint', safeVal(o.endpoint, 'Endpoint'));
    if (o.region) args.push('region', safeVal(o.region, 'Região'));
  }
  if (o.kind === 'drive' || o.kind === 'dropbox') jl('O navegador vai abrir para você autorizar o acesso. Se não abrir, copie o endereço http://127.0.0.1:53682/auth... que aparecer abaixo. Você tem 5 minutos.');
  try { await stream(args, jl, 5 * 60 * 1000); } catch (e) {
    // autorização cancelada, expirada ou recusada: não deixa um destino pela metade (sem token) no rclone.conf
    await rc(['config', 'delete', name]).catch(() => {});
    throw e;
  }
  secrets.harden(conf());
  if (!(await remotes()).some((x) => x.name === name)) throw new Error('O destino não foi criado (autorização cancelada?).');
  jl(`Destino "${name}" criado.`);
  log(`Destino de backup "${name}" (${o.kind}) criado.`);
}
/** Valida o "Google Drive em um clique" (antes de instalar qualquer coisa ou abrir o navegador). */
function driveOpts(o) {
  const name = String(o.name || '').trim() || 'google-drive';
  if (!NAME_RE.test(name) || name.endsWith('-crypt')) throw new Error('Nome do destino: comece com letra; use letras, números, _ ou - (até 31).');
  const folder = validPath('drive', o.path || 'RDR-Local-Backup');
  const pass = String(o.passphrase || '');
  if (pass && pass.length < 12) throw new Error('A senha de criptografia precisa ter pelo menos 12 caracteres.');
  const c = cfg.cloud;
  if (c.encrypt && (c.remote !== name || c.path !== folder)) throw new Error('A criptografia já está ligada em outro destino ou pasta. Desligue-a antes de trocar (os arquivos já enviados continuam cifrados lá).');
  return { name, folder, pass, enable: o.enable !== false, clientId: String(o.clientId || '').trim(), clientSecret: String(o.clientSecret || '') };
}

/**
 * Um clique: instala o rclone (se faltar), conecta o Google Drive (o navegador abre para autorizar), usa-o como destino com envio
 * automático e, se houver senha, liga a criptografia; no fim testa a escrita. Se o destino já existe, reaproveita a autorização.
 */
async function quickDrive(o, jl = () => {}) {
  const d = driveOpts(o);
  if (!installed()) { jl('Instalando o rclone (o download é conferido por SHA-256)...'); await comps.install('rclone', jl); jl('rclone instalado.'); }
  need();
  const existing = (await remotes()).find((x) => x.name === d.name);
  if (existing && existing.type !== 'drive') throw new Error(`Já existe um destino "${d.name}" que não é Google Drive: escolha outro nome.`);
  if (existing) jl(`O destino "${d.name}" já existe: reaproveitando a autorização dele.`);
  else await connect({ kind: 'drive', name: d.name, clientId: d.clientId, clientSecret: d.clientSecret }, jl);
  await setSettings({ remote: d.name, path: d.folder, enabled: d.enable });
  jl(`Destino em uso: Google Drive, pasta "${d.folder}"; envio automático ${d.enable ? 'ligado' : 'desligado'}.`);
  if (d.pass && !cfg.cloud.encrypt) { jl('Ligando a criptografia...'); await enableEncryption(d.pass); jl('Criptografia ligada. Guarde a senha: sem ela o backup é irrecuperável.'); }
  jl('Testando a conexão e a permissão de escrita no Drive...');
  await test(jl);
  jl('Pronto! Próximo passo: "Enviar agora" e, depois, "Testar restauração".');
  log(`Google Drive conectado como destino de backup ("${d.name}", pasta "${d.folder}").`);
}
async function removeRemote(name) {
  if (!NAME_RE.test(String(name || ''))) throw new Error('Nome inválido.');
  await rc(['config', 'delete', `${name}-crypt`]); await rc(['config', 'delete', name]);
  if (cfg.cloud.remote === name) Object.assign(cfg.cloud, { remote: '', enabled: false, encrypt: false });
  save(); log(`Destino de backup "${name}" removido da configuração (os arquivos na nuvem não foram apagados).`);
}

// ---------- configurações ----------
function validPath(kind, p) {
  const s = String(p || '').trim();
  if (kind === 'local') { if (!path.isAbsolute(s)) throw new Error('Para pasta/disco, informe o caminho completo (ex.: D:\\Backups\\RDR).'); return s; }
  const clean = s.replace(/^[\\/]+|[\\/]+$/g, '');
  if (!clean || /(^|[\\/])\.\.([\\/]|$)|[\0\r\n:]/.test(clean) || /^-/.test(clean)) throw new Error('Nome da pasta no destino inválido (sem "..", ":" ou "-" no início).');
  return clean;
}
async function setSettings(o) {
  const c = cfg.cloud; const list = await remotes();
  const remote = o.remote !== undefined ? String(o.remote) : c.remote;
  const kind = (list.find((x) => x.name === remote) || {}).type;
  if (remote && !kind) throw new Error('Destino não encontrado.');
  const pth = o.path !== undefined ? o.path : c.path;
  const changedDest = remote !== c.remote || (remote && validPath(kind, pth) !== c.path);
  if (c.encrypt && changedDest) throw new Error('Desative a criptografia antes de trocar de destino ou de pasta (os arquivos já enviados continuam cifrados no destino antigo).');
  const projects = o.projects !== undefined ? o.projects : c.projects;
  if (!['none', 'essentials'].includes(projects)) throw new Error('Opção de projetos inválida.');
  const retainDays = o.retainDays !== undefined ? Number(o.retainDays) : c.retainDays;
  if (!Number.isInteger(retainDays) || retainDays < 0 || retainDays > 3650 || (retainDays > 0 && retainDays < 7)) throw new Error('Retenção na nuvem: 0 (nunca apagar) ou de 7 a 3650 dias.');
  const enabled = o.enabled !== undefined ? !!o.enabled : c.enabled;
  if (enabled && !remote) throw new Error('Escolha um destino antes de ativar o envio.');
  Object.assign(c, { remote, path: remote ? validPath(kind, pth) : c.path, projects, retainDays, enabled, includeConfig: o.includeConfig !== undefined ? !!o.includeConfig : c.includeConfig });
  save();
}

const obscure = (text) => {
  const r = spawnSync(exe(), ['obscure', '-'], { input: text, encoding: 'utf8', windowsHide: true });
  if (r.status !== 0 || !r.stdout.trim()) throw new Error('Não consegui preparar a senha de criptografia.');
  return r.stdout.trim();
};
/** Liga a criptografia (rclone crypt por cima do destino). A senha NÃO é guardada em texto: só ofuscada no rclone.conf.
 *  O "sal" é derivado da própria senha (scrypt): em outro PC, a mesma senha reconstrói a mesma chave e abre os backups. */
async function enableEncryption(passphrase) {
  need();
  const c = cfg.cloud; if (!c.remote) throw new Error('Escolha o destino antes.');
  const pw = String(passphrase || '');
  if (pw.length < 12) throw new Error('A senha de criptografia precisa ter pelo menos 12 caracteres.');
  const cn = `${c.remote}-crypt`;
  await rc(['config', 'delete', cn]);
  const r = await rc(['config', 'create', cn, 'crypt', 'remote', `${c.remote}:${cryptRoot()}`, 'password', obscure(pw), 'password2', obscure(crypto.scryptSync(pw, 'rdr-local-crypt-v1', 24).toString('base64url'))]);
  if (!r.ok) throw new Error('Falha ao configurar a criptografia: ' + r.out.slice(-200));
  secrets.harden(conf());
  c.encrypt = true; save(); log('Criptografia do backup na nuvem ligada.');
}
async function disableEncryption() { await rc(['config', 'delete', `${cfg.cloud.remote}-crypt`]); cfg.cloud.encrypt = false; save(); }

// ---------- destino efetivo ----------
/** A pasta cifrada fica numa subpasta própria, sem misturar com arquivos enviados antes (em texto claro). */
const cryptRoot = () => `${String(cfg.cloud.path).replace(/[\\/]+$/, '')}/encrypted`;
function target() {
  const c = cfg.cloud; if (!c.remote) throw new Error('Nenhum destino escolhido.');
  return c.encrypt ? `${c.remote}-crypt:` : `${c.remote}:${c.path}`;
}
const sub = (t, p) => (t.endsWith(':') ? t + p : t.replace(/[\\/]+$/, '') + '/' + p);
const describe = () => `${cfg.cloud.remote}:${cfg.cloud.path}${cfg.cloud.encrypt ? ' (criptografado)' : ''}`;
const COMMON = ['--transfers', '2', '--checkers', '4', '--retries', '3', '--low-level-retries', '5', '--stats', '20s', '--stats-one-line', '-v'];

/** Configuração sem segredos: variáveis de ambiente dos sites ficam só com o nome. */
function safeConfig() {
  return {
    rdrLocal: 1, exportedAt: new Date().toISOString(), tld: cfg.tld, projectsRoot: cfg.projectsRoot, phpDefault: cfg.phpDefault, ports: cfg.ports,
    sites: cfg.sites.map((s) => ({ name: s.name, path: s.path, domain: s.domain, aliases: s.aliases, php: s.php, docroot: s.docroot, enabled: s.enabled, type: s.type, target: s.target, runtime: s.runtime, rtVersion: s.rtVersion, cmd: s.cmd, appPort: s.appPort, cors: s.cors, envKeys: Object.keys(s.env || {}) })),
  };
}
const slugDomain = (d) => String(d || 'site').toLowerCase().replace(/[^a-z0-9.-]/g, '-').slice(0, 80);
const stamp = () => new Date().toISOString().slice(0, 10).replace(/-/g, '');

async function upload(jl = () => {}) {
  need(); const c = cfg.cloud; const t = target();
  jl(`Destino: ${describe()}`);
  const root = backup().ROOT;
  if (isDir(root)) { jl('Enviando os backups dos bancos...'); await stream(['copy', root, sub(t, 'db'), ...COMMON], jl); } else jl('Ainda não há backups de bancos para enviar.');
  if (c.includeConfig) {
    const st = path.join(P.data, 'cloud-stage'); fs.rmSync(st, { recursive: true, force: true }); fs.mkdirSync(st, { recursive: true });
    fs.writeFileSync(path.join(st, `rdr-local-config-${stamp()}.json`), JSON.stringify(safeConfig(), null, 2));
    jl('Enviando a configuração (sem segredos)...'); await stream(['copy', st, sub(t, 'config'), ...COMMON], jl);
    fs.rmSync(st, { recursive: true, force: true });
  }
  if (c.projects === 'essentials') {
    for (const s of cfg.sites.filter((x) => x.path && isDir(x.path) && x.enabled !== false && (x.type === 'php' || x.type === 'app' || !x.type))) {
      jl(`Projeto ${s.domain}: .env e storage/app...`);
      try {
        await stream(['copy', s.path, sub(t, `projects/${slugDomain(s.domain)}`), '--filter', '+ /.env', '--filter', '+ /.env.*', '--filter', '+ /storage/app/**', '--filter', '- *', '--max-size', '500M', ...COMMON], jl);
      } catch (e) { jl(`  falhou em ${s.domain}: ${e.message}`); throw e; }
    }
  }
  if (c.retainDays > 0) await pruneRemote(t, c.retainDays, jl);
}

/** Apaga no destino só o que passou da retenção, e SOMENTE se existir backup recente (protege contra "parou de enviar e apagou tudo"). */
async function pruneRemote(t, days, jl) {
  try {
    const r = await rc(['lsjson', '-R', '--files-only', '--max-age', `${days}d`, sub(t, 'db')]);
    const recent = JSON.parse(r.out || '[]');
    if (!r.ok || !Array.isArray(recent) || !recent.length) { jl(`Retenção ignorada: não há backup com menos de ${days} dias no destino.`); return; }
    jl(`Apagando do destino arquivos com mais de ${days} dias...`);
    await stream(['delete', sub(t, 'db'), '--min-age', `${days}d`, '-v'], jl);
  } catch (e) { jl('Retenção ignorada: ' + e.message); }
}

/** Envia e registra o resultado (última execução, aviso de falha). */
async function sync(jl = () => {}) {
  const c = cfg.cloud;
  try {
    await upload(jl);
    c.last = Date.now(); c.lastOk = true; c.lastMsg = `${new Date().toLocaleString('pt-BR')}: envio concluído para ${describe()}.`; save();
    jl(c.lastMsg); log('Nuvem: ' + c.lastMsg);
    notify.event('ok', 'RDR Local: backup enviado', c.lastMsg);
  } catch (e) {
    c.last = Date.now(); c.lastOk = false; c.lastMsg = `${new Date().toLocaleString('pt-BR')}: FALHA ao enviar — ${e.message.slice(0, 200)}`; save();
    jl(c.lastMsg); log('Nuvem: ' + c.lastMsg);
    notify.event('fail', 'RDR Local: falha no backup na nuvem', c.lastMsg);
    throw e;
  }
}

async function test(jl = () => {}) {
  need(); const t = target(); jl(`Testando ${describe()}...`);
  const f = path.join(P.data, 'cloud-test.txt'); fs.mkdirSync(P.data, { recursive: true }); fs.writeFileSync(f, `rdr-local ${new Date().toISOString()}\n`);
  try {
    await stream(['copyto', f, sub(t, '.rdr-test.txt'), '-v'], jl, 120000);
    await stream(['deletefile', sub(t, '.rdr-test.txt')], jl, 60000);
  } finally { fs.rmSync(f, { force: true }); }
  jl('Conexão e permissão de escrita OK.');
}

/** Baixa o backup mais recente do destino e prova que dá para restaurar (importa num banco temporário e apaga). */
async function verify(jl = () => {}) {
  need(); const t = target();
  jl('Procurando o backup mais recente no destino...');
  const r = await rc(['lsjson', '-R', '--files-only', sub(t, 'db')]);
  let files = []; try { files = JSON.parse(r.out); } catch (_) { throw new Error('Não consegui listar o destino: ' + r.out.slice(-200)); }
  files = files.filter((f) => /\.sql$/i.test(f.Path)).sort((a, b) => String(b.ModTime).localeCompare(String(a.ModTime)));
  if (!files.length) throw new Error('Não há backups .sql no destino ainda. Rode "Enviar agora" primeiro.');
  const f = files[0]; const engine = /^postgres[\\/]/.test(f.Path) ? 'postgres' : 'mariadb';
  jl(`Mais recente: ${f.Path} (${(f.Size / 1048576).toFixed(2)} MB, ${f.ModTime})`);
  const work = path.join(P.data, 'cloud-verify'); fs.rmSync(work, { recursive: true, force: true }); fs.mkdirSync(work, { recursive: true });
  const local = path.join(work, 'teste.sql');
  try {
    await stream(['copyto', sub(t, 'db/' + f.Path.replace(/\\/g, '/')), local, '-v'], jl, 3600000);
    const size = fs.statSync(local).size; if (!size) throw new Error('O arquivo baixado está vazio.');
    const fd = fs.openSync(local, 'r'); const tailBuf = Buffer.alloc(Math.min(4096, size)); fs.readSync(fd, tailBuf, 0, tailBuf.length, size - tailBuf.length); fs.closeSync(fd);
    const tailTxt = tailBuf.toString('utf8');
    const complete = engine === 'postgres' ? /PostgreSQL database dump complete/.test(tailTxt) : /Dump completed/.test(tailTxt);
    if (!complete) throw new Error('O arquivo não termina como um dump completo: pode estar truncado ou corrompido.');
    jl('Integridade: o dump está completo.');
    let msg = 'dump completo e legível';
    if (require('./services').isRunning(engine)) {
      jl(`Restaurando num banco temporário (rdr_restore_test, ${engine})...`);
      await backup().restore(engine, local, 'rdr_restore_test', 'rdr_restore_test', jl);
      await require('./db').dropRaw(engine, 'rdr_restore_test');
      jl('Banco temporário removido.'); msg = 'restauração real OK';
    } else jl(`${engine === 'mariadb' ? 'MariaDB' : 'PostgreSQL'} está desligado: só a verificação de integridade foi feita (ligue o banco para testar a restauração de verdade).`);
    cfg.cloud.lastVerify = `${new Date().toLocaleString('pt-BR')}: ${f.Path} — ${msg}.`; save();
    jl(cfg.cloud.lastVerify);
  } catch (e) {
    cfg.cloud.lastVerify = `${new Date().toLocaleString('pt-BR')}: FALHOU — ${e.message.slice(0, 160)}`; save();
    notify.event('fail', 'RDR Local: teste de restauração falhou', cfg.cloud.lastVerify);
    throw e;
  } finally { fs.rmSync(work, { recursive: true, force: true }); }
}

async function summary() {
  const inst = installed();
  return { installed: inst, version: comps.version('rclone'), kinds: KINDS, remotes: inst ? await remotes() : [], settings: { ...cfg.cloud }, target: cfg.cloud.remote ? describe() : '', confPath: conf() };
}

module.exports = { installed, summary, connect, driveOpts, quickDrive, cancel, removeRemote, setSettings, enableEncryption, disableEncryption, upload, sync, test, verify, safeConfig, KINDS };
