'use strict';
/**
 * Servidores SSH e publicação por "receitas".
 *  - Chaves SSH ficam cifradas (DPAPI no Windows) e só viram arquivo temporário (permissão restrita) durante um comando.
 *  - A identidade do servidor é confirmada por você (impressão digital) e gravada num known_hosts PRÓPRIO do RDR Local;
 *    depois disso a conexão é estrita: se a impressão digital mudar, a conexão é recusada.
 *  - O painel só executa comandos que estão em receitas cadastradas por você (e o teste "echo"): não há terminal livre.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const core = require('./core');
const secrets = require('./secrets');
const { P, IS_WIN, cfg, save, log, exists } = core;

const github = () => require('./github');
const notify = () => require('./notify');

const WINSSH = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'OpenSSH');
const bin = (n) => (IS_WIN ? path.join(WINSSH, n + '.exe') : n);
const KNOWN = path.join(P.conf, 'ssh', 'known_hosts');
const HOST_RE = /^(?!-)[A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/;
const USER_RE = /^[A-Za-z_][A-Za-z0-9_.-]{0,31}$/;
const uid = () => crypto.randomBytes(5).toString('hex');

function haveSsh() { return IS_WIN ? exists(bin('ssh')) : spawnSync('ssh', ['-V']).status === 0; }
function assertSsh() { if (IS_WIN && !exists(bin('ssh'))) throw new Error('O Cliente OpenSSH não está instalado: Configurações do Windows → Aplicativos → Recursos opcionais → Adicionar → "Cliente OpenSSH".'); }

// ---------- chaves ----------
const pubKeys = () => cfg.sshKeys.map((k) => ({ id: k.id, label: k.label, pub: k.pub, fingerprint: k.fingerprint, usedBy: cfg.servers.filter((s) => s.keyId === k.id).map((s) => s.name) }));
function tmpKeyFile(id) {
  const priv = secrets.getProtected('sshkey:' + id); if (!priv) throw new Error('Chave não encontrada (foi removida?).');
  const dir = path.join(P.data, 'tmp'); fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, 'k-' + uid());
  fs.writeFileSync(f, priv.replace(/\r\n/g, '\n').replace(/\n*$/, '\n'), { mode: 0o600 });
  if (IS_WIN) { const u = process.env.USERNAME; if (u) spawnSync('icacls', [f, '/inheritance:r', '/grant:r', `${u}:(R)`], { windowsHide: true }); }
  return f;
}
const wipe = (f) => { try { fs.writeFileSync(f, crypto.randomBytes(64)); } catch (_) { /* ok */ } try { fs.rmSync(f, { force: true }); } catch (_) { /* ok */ } };

function describeKey(file) {
  const pub = spawnSync(bin('ssh-keygen'), ['-y', '-P', '', '-f', file], { encoding: 'utf8', windowsHide: true, timeout: 15000 });
  if (pub.status !== 0) throw new Error(/passphrase|incorrect/i.test(pub.stderr) ? 'Esta chave tem senha (passphrase): ainda não é suportada. Gere uma chave nova aqui ou remova a senha.' : 'Chave privada inválida.');
  const fp = spawnSync(bin('ssh-keygen'), ['-l', '-f', '-'], { input: pub.stdout, encoding: 'utf8', windowsHide: true, timeout: 15000 });
  return { pub: pub.stdout.trim(), fingerprint: (fp.stdout.match(/SHA256:\S+/) || [''])[0] };
}
function addKey(label, privateText) {
  assertSsh();
  const lb = String(label || '').trim().slice(0, 40); if (!lb) throw new Error('Dê um nome para a chave.');
  const text = String(privateText || '').replace(/\r\n/g, '\n').trim() + '\n';
  if (!/^-----BEGIN [A-Z ]*PRIVATE KEY-----\n[\s\S]+-----END [A-Z ]*PRIVATE KEY-----\n$/.test(text) || text.length > 20000) throw new Error('Isso não parece uma chave privada (cole o arquivo inteiro, começando por -----BEGIN).');
  const tmp = path.join(P.data, 'tmp'); fs.mkdirSync(tmp, { recursive: true });
  const f = path.join(tmp, 'k-' + uid()); fs.writeFileSync(f, text, { mode: 0o600 });
  try {
    if (IS_WIN) { const u = process.env.USERNAME; if (u) spawnSync('icacls', [f, '/inheritance:r', '/grant:r', `${u}:(R)`], { windowsHide: true }); }
    const d = describeKey(f); const id = uid();
    secrets.setProtected('sshkey:' + id, text); cfg.sshKeys.push({ id, label: lb, ...d }); save(); log(`Chave SSH "${lb}" guardada.`);
    return pubKeys().find((k) => k.id === id);
  } finally { wipe(f); }
}
function generateKey(label) {
  assertSsh();
  const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'rdrk-')); const f = path.join(dir, 'id');
  try {
    const r = spawnSync(bin('ssh-keygen'), ['-t', 'ed25519', '-N', '', '-C', `rdr-local@${require('os').hostname()}`, '-f', f], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
    if (r.status !== 0) throw new Error('Não consegui gerar a chave: ' + (r.stderr || r.stdout).slice(0, 200));
    return addKey(label, fs.readFileSync(f, 'utf8'));
  } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* ok */ } }
}
function removeKey(id) {
  const used = cfg.servers.filter((s) => s.keyId === id).map((s) => s.name);
  if (used.length) throw new Error('A chave está em uso por: ' + used.join(', '));
  cfg.sshKeys = cfg.sshKeys.filter((k) => k.id !== id); secrets.setProtected('sshkey:' + id, ''); save();
}

// ---------- servidores ----------
const pubServer = (s) => ({ id: s.id, name: s.name, group: s.group || '', host: s.host, port: s.port, user: s.user, keyId: s.keyId, trusted: !!s.fingerprint, fingerprint: s.fingerprint || '' });
function cleanServer(i, cur) {
  const name = String(i.name || '').trim().slice(0, 60); if (!name) throw new Error('Dê um nome ao servidor.');
  const host = String(i.host || '').trim().toLowerCase(); if (!HOST_RE.test(host)) throw new Error('Host inválido (use o IP ou o domínio do servidor).');
  const port = Number(i.port || 22); if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Porta inválida.');
  const user = String(i.user || 'root').trim(); if (!USER_RE.test(user)) throw new Error('Usuário inválido.');
  const keyId = String(i.keyId || ''); if (!cfg.sshKeys.some((k) => k.id === keyId)) throw new Error('Escolha uma chave SSH (crie ou importe uma antes).');
  if (cfg.servers.some((s) => s.name === name && (!cur || s.id !== cur.id))) throw new Error('Já existe um servidor com esse nome.');
  const changedHost = cur && (cur.host !== host || cur.port !== port);
  return { name, group: String(i.group || '').trim().slice(0, 40), host, port, user, keyId, fingerprint: changedHost ? '' : (cur && cur.fingerprint) || '' };
}
function saveServer(i) {
  const cur = i.id ? cfg.servers.find((s) => s.id === i.id) : null; if (i.id && !cur) throw new Error('Servidor não encontrado.');
  const v = cleanServer(i, cur);
  if (cur) { Object.assign(cur, v); } else { cfg.servers.push({ id: uid(), ...v }); }
  save(); return pubServer(cur || cfg.servers[cfg.servers.length - 1]);
}
function removeServer(id) {
  const used = cfg.recipes.filter((r) => r.serverId === id).map((r) => r.name);
  if (used.length) throw new Error('Há receitas usando este servidor: ' + used.join(', '));
  cfg.servers = cfg.servers.filter((s) => s.id !== id); save();
}
const getServer = (id) => { const s = cfg.servers.find((x) => x.id === id); if (!s) throw new Error('Servidor não encontrado.'); return s; };

/** Lê a chave pública do servidor (ssh-keyscan) e devolve a impressão digital para VOCÊ conferir. Não grava nada. */
function scanHost(s) {
  assertSsh();
  const r = spawnSync(bin('ssh-keyscan'), ['-T', '8', '-p', String(s.port), '-t', 'ed25519,ecdsa,rsa', s.host], { encoding: 'utf8', windowsHide: true, timeout: 20000 });
  const lines = (r.stdout || '').split('\n').filter((l) => l && !l.startsWith('#'));
  if (!lines.length) throw new Error('Não consegui falar com o servidor em ' + s.host + ':' + s.port + ' (desligado, porta errada ou firewall).');
  const pick = lines.find((l) => /ssh-ed25519/.test(l)) || lines[0];
  const fp = spawnSync(bin('ssh-keygen'), ['-l', '-f', '-'], { input: pick + '\n', encoding: 'utf8', windowsHide: true, timeout: 15000 });
  const m = (fp.stdout || '').match(/(\d+)\s+(SHA256:\S+)\s.*\((\w+)\)/); if (!m) throw new Error('Não consegui calcular a impressão digital.');
  return { line: pick, fingerprint: m[2], type: m[3] };
}
const probeHost = (id) => { const s = getServer(id); const h = scanHost(s); return { fingerprint: h.fingerprint, type: h.type, current: s.fingerprint || '' }; };
/** Confirma: você mandou a impressão digital que viu; só gravamos se o servidor ainda mostrar exatamente a mesma. */
function trustHost(id, fingerprint) {
  const s = getServer(id); const h = scanHost(s);
  if (h.fingerprint !== String(fingerprint || '')) throw new Error('A impressão digital mudou entre a leitura e a confirmação. Leia de novo e confira.');
  fs.mkdirSync(path.dirname(KNOWN), { recursive: true });
  const old = exists(KNOWN) ? fs.readFileSync(KNOWN, 'utf8').split('\n').filter((l) => l && !l.startsWith(hostTag(s) + ' ')) : [];
  old.push(h.line.replace(/^\S+/, hostTag(s))); fs.writeFileSync(KNOWN, old.join('\n') + '\n');
  s.fingerprint = h.fingerprint; save(); log(`Servidor ${s.name}: impressão digital confirmada (${h.fingerprint}).`);
  return pubServer(s);
}
const hostTag = (s) => (s.port === 22 ? s.host : `[${s.host}]:${s.port}`);

// ---------- executar por SSH ----------
function sshArgs(s, keyFile) {
  return ['-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', `UserKnownHostsFile=${KNOWN}`, '-o', 'IdentitiesOnly=yes', '-o', 'PasswordAuthentication=no',
    '-o', 'ConnectTimeout=10', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=4', '-i', keyFile, '-p', String(s.port), `${s.user}@${s.host}`];
}
function runRemote(s, command, jl = () => {}, timeoutMs = 900000) {
  assertSsh();
  if (!s.fingerprint) return Promise.reject(new Error('Confirme a impressão digital do servidor antes de conectar.'));
  if (typeof command !== 'string' || !command || /[\0\r\n]/.test(command) || command.length > 2000) return Promise.reject(new Error('Comando inválido.'));
  const key = tmpKeyFile(s.keyId);
  return new Promise((resolve) => {
    let out = ''; const c = spawn(bin('ssh'), [...sshArgs(s, key), '--', command], { windowsHide: true });
    const t = setTimeout(() => { try { c.kill(); } catch (_) { /* ok */ } }, timeoutMs);
    const pipe = (d) => { const txt = core.decode(d); out += txt; txt.split(/\r?\n/).filter(Boolean).forEach((l) => jl(l)); };
    c.stdout.on('data', pipe); c.stderr.on('data', pipe);
    c.on('error', (e) => { clearTimeout(t); wipe(key); resolve({ code: -1, out: e.message }); });
    c.on('exit', (code) => { clearTimeout(t); wipe(key); resolve({ code: code == null ? -1 : code, out }); });
  });
}
async function testServer(id) {
  const s = getServer(id); const r = await runRemote(s, 'echo RDR_OK; uname -sr; id -un', () => {}, 30000);
  if (r.code === 0 && r.out.includes('RDR_OK')) return { ok: true, info: r.out.replace('RDR_OK', '').trim().replace(/\s+/g, ' · ') };
  const k = cfg.sshKeys.find((x) => x.id === s.keyId);
  if (/permission denied/i.test(r.out)) return { ok: false, error: 'O servidor recusou a chave. Adicione esta chave pública ao ~/.ssh/authorized_keys do usuário ' + s.user + ' no servidor.', pub: k && k.pub };
  if (/host key verification failed|REMOTE HOST IDENTIFICATION/i.test(r.out)) return { ok: false, error: 'A identidade do servidor não bate com a confirmada (pode ser reinstalação... ou um ataque). Confirme a impressão digital de novo só se você sabe o motivo.' };
  return { ok: false, error: r.out.trim().slice(-300) || 'Falha ao conectar.' };
}

// ---------- receitas ----------
const IMG_RE = /^[a-z0-9][a-z0-9._/-]*(:[A-Za-z0-9._-]{1,128})?(@sha256:[a-f0-9]{64})?$/;
const SVC_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$/;
function swarmSteps(image, services, extra) {
  if (!IMG_RE.test(image)) throw new Error('Imagem inválida (ex.: ghcr.io/rdrdigitalfloripa/listgo:latest).');
  if (!services.length || services.some((x) => !SVC_RE.test(x))) throw new Error('Informe os serviços do Swarm (ex.: listgo_app listgo_worker).');
  const steps = services.map((sv) => ({ label: `Atualizar ${sv}`, cmd: `docker service update --with-registry-auth --image ${image} ${sv}` }));
  for (const e of extra) steps.push(e);
  return steps;
}
function cleanSteps(list) {
  const steps = (Array.isArray(list) ? list : []).map((x) => ({ label: String((x && x.label) || '').trim().slice(0, 80), cmd: String((x && x.cmd) || '').trim() })).filter((x) => x.cmd);
  if (!steps.length) throw new Error('A receita precisa de ao menos um comando.');
  if (steps.length > 20) throw new Error('No máximo 20 passos por receita.');
  for (const x of steps) { if (x.cmd.length > 2000 || /[\0\r\n]/.test(x.cmd)) throw new Error('Comando inválido (uma linha, até 2000 caracteres).'); if (!x.label) x.label = x.cmd.slice(0, 50); }
  return steps;
}
function saveRecipe(i) {
  const cur = i.id ? cfg.recipes.find((r) => r.id === i.id) : null; if (i.id && !cur) throw new Error('Receita não encontrada.');
  const name = String(i.name || '').trim().slice(0, 60); if (!name) throw new Error('Dê um nome à receita.');
  if (cfg.recipes.some((r) => r.name === name && (!cur || r.id !== cur.id))) throw new Error('Já existe uma receita com esse nome.');
  getServer(i.serverId);
  let steps;
  if (i.swarm) steps = swarmSteps(String(i.swarm.image || '').trim(), String(i.swarm.services || '').split(/[\s,;]+/).filter(Boolean), (i.swarm.extra ? cleanSteps(i.swarm.extra) : []));
  else steps = cleanSteps(i.steps);
  const siteId = i.siteId && cfg.sites.some((s) => s.id === i.siteId) ? i.siteId : '';
  const branch = String(i.branch || 'main').trim(); if (!/^[A-Za-z0-9._/-]{1,60}$/.test(branch)) throw new Error('Branch inválida.');
  const v = { name, serverId: i.serverId, siteId, branch, steps, checkBuild: i.checkBuild !== false };
  if (cur) Object.assign(cur, v); else cfg.recipes.push({ id: uid(), last: null, ...v });
  save(); return cur || cfg.recipes[cfg.recipes.length - 1];
}
function removeRecipe(id) { cfg.recipes = cfg.recipes.filter((r) => r.id !== id); save(); }

/** Verificações antes de publicar. level: ok | warn | bad */
async function precheck(id) {
  const r = cfg.recipes.find((x) => x.id === id); if (!r) throw new Error('Receita não encontrada.');
  const s = getServer(r.serverId); const checks = [];
  checks.push(s.fingerprint ? { level: 'ok', text: `Servidor ${s.name}: identidade confirmada.` } : { level: 'bad', text: `Servidor ${s.name}: confirme a impressão digital antes.` });
  if (r.siteId) {
    const gh = github(); const info = await gh.localInfo(r.siteId).catch(() => null);
    if (!info) checks.push({ level: 'warn', text: 'O site ligado não é um repositório Git: não dá para conferir o código.' });
    else {
      const st = info.status || {}; const n = (st.changed || 0) + (st.untracked || 0);
      checks.push(n ? { level: 'warn', text: `${n} alteração(ões) local(is) sem commit: não vão para a produção.` } : { level: 'ok', text: 'Nenhuma alteração local pendente.' });
      checks.push(st.ahead ? { level: 'bad', text: `${st.ahead} commit(s) ainda NÃO enviados ao GitHub (faça push antes: a produção usa a imagem do GitHub).` } : { level: 'ok', text: 'Tudo que foi commitado já está no GitHub.' });
      if (r.checkBuild && info.repo) {
        try {
          const b = await gh.actionsLatest(info.repo, r.branch);
          if (!b) checks.push({ level: 'warn', text: `Nenhum build encontrado para ${info.repo}@${r.branch}.` });
          else if (b.status !== 'completed') checks.push({ level: 'bad', text: `O build ainda está ${b.status === 'in_progress' ? 'rodando' : 'na fila'} (${b.name}). Espere terminar.`, url: b.url });
          else if (b.conclusion !== 'success') checks.push({ level: 'bad', text: `O último build terminou com "${b.conclusion}". A imagem pode estar desatualizada.`, url: b.url });
          else if (info.sha && b.sha !== info.sha) checks.push({ level: 'warn', text: 'O último build é de outro commit que o seu HEAD local (confira se é o que você quer publicar).', url: b.url });
          else checks.push({ level: 'ok', text: `Build do commit ${b.sha.slice(0, 7)} concluído com sucesso.`, url: b.url });
        } catch (e) { checks.push({ level: 'warn', text: 'Não consegui consultar o build: ' + e.message }); }
      }
    }
  } else checks.push({ level: 'warn', text: 'Receita sem site ligado: não há como conferir Git nem build.' });
  return { checks, canPublish: !checks.some((c) => c.level === 'bad'), steps: r.steps };
}

async function publish(id, jl = () => {}, opts = {}) {
  const r = cfg.recipes.find((x) => x.id === id); if (!r) throw new Error('Receita não encontrada.');
  const s = getServer(r.serverId); const pre = await precheck(id);
  for (const c of pre.checks) jl(`${c.level === 'ok' ? '✔' : c.level === 'warn' ? '⚠' : '✖'} ${c.text}`);
  if (!pre.canPublish && !opts.force) throw new Error('Há verificações reprovadas. Corrija ou publique mesmo assim (com confirmação).');
  jl(`\nPublicando "${r.name}" em ${s.name} (${s.user}@${s.host})...`);
  const t0 = Date.now(); let failed = null;
  for (const [i, st] of r.steps.entries()) {
    jl(`\n[${i + 1}/${r.steps.length}] ${st.label}\n$ ${st.cmd}`);
    const res = await runRemote(s, st.cmd, jl);
    if (res.code !== 0) { failed = `passo ${i + 1} ("${st.label}") terminou com código ${res.code}`; break; }
  }
  r.last = { at: Date.now(), ok: !failed, msg: failed || `concluído em ${Math.round((Date.now() - t0) / 1000)}s` }; save();
  notify().event(failed ? 'fail' : 'ok', `Deploy ${failed ? 'FALHOU' : 'concluído'}: ${r.name}`, `${r.name} → ${s.name}: ${r.last.msg}`);
  if (failed) throw new Error(failed);
  jl(`\nPublicado: ${r.last.msg}.`); log(`Deploy "${r.name}" em ${s.name} concluído.`);
}

const lists = () => ({ ssh: haveSsh(), servers: cfg.servers.map(pubServer), keys: pubKeys(), recipes: cfg.recipes.map((r) => ({ id: r.id, name: r.name, serverId: r.serverId, siteId: r.siteId, branch: r.branch, checkBuild: r.checkBuild, steps: r.steps, last: r.last })) });

module.exports = { tmpKeyFile, wipeFile: wipe, lists, addKey, generateKey, removeKey, saveServer, removeServer, probeHost, trustHost, testServer, saveRecipe, removeRecipe, precheck, publish, runRemote, sshArgs, cleanServer, swarmSteps };
