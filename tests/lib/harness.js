// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 RDR Digital - https://github.com/RDRdigitalFloripa/rdrlocalserver
'use strict';
/**
 * Base dos testes: contagem, servidor do RDR Local isolado (pasta temporária, porta livre, hosts falso) e utilidades.
 * Nenhum teste toca nos dados do RDR Local real. Cada arquivo *.test.js é um programa: imprime OK/FALHA/PULOU e um
 * "RESULTADO ok=N falha=N pulou=N"; o executor (tests/run.js) soma tudo.
 */
const http = require('http');
const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const IS_WIN = process.platform === 'win32';
const FULL = process.env.RDR_TEST_FULL === '1'; // testes que usam a internet ou baixam ferramentas
const R = { ok: 0, fail: 0, skip: 0 };
const servers = []; const dirs = [];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const title = (t) => console.log(`--- ${t}`);
function ok(cond, msg, extra) {
  if (cond) { R.ok++; console.log('OK    ' + msg); } else { R.fail++; console.log('FALHA ' + msg + (extra ? '\n        -> ' + String(extra).slice(0, 700) : '')); }
  return !!cond;
}
function skip(msg) { R.skip++; console.log('PULOU ' + msg); }
const tmp = (name = 'x') => { const d = fs.mkdtempSync(path.join(os.tmpdir(), `rdr-test-${name}-`)); dirs.push(d); return d; };
/** Para os módulos usados em processo: aponta o RDR_HOME para uma pasta temporária ANTES de dar require em qualquer lib. */
function isolateHome() { const d = tmp('home'); process.env.RDR_HOME = d; process.env.RDR_HOSTS = path.join(d, 'hosts'); return d; }
const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.on('error', rej); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });

function request(port, method, p, body) {
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({ host: '127.0.0.1', port, path: p, method, headers: { 'X-RDR': '1', 'Content-Type': 'application/json', ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) } }, (res) => {
      let t = ''; res.on('data', (d) => { t += d; });
      res.on('end', () => { let j = {}; try { j = JSON.parse(t); } catch (_) { /* resposta sem JSON */ } resolve({ status: res.statusCode, j, raw: t }); });
    });
    req.on('error', (e) => resolve({ status: 0, j: { error: e.message }, raw: '' }));
    if (data) req.write(data); req.end();
  });
}

/** Sobe o server.js com RDR_HOME temporário e porta livre. Devolve { port, home, call, state, waitJob, stop }. */
async function startServer({ env = {}, setup } = {}) {
  const home = tmp('srv'); const port = await freePort();
  if (setup) await setup(home); // prepara a pasta antes de o servidor subir (ex.: copiar o PHP para bin/)
  const child = spawn(process.execPath, [path.join(ROOT, 'server.js'), '--no-open'], {
    cwd: ROOT, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, RDR_HOME: home, RDR_PORT: String(port), RDR_HOSTS: path.join(home, 'hosts'), ...env },
  });
  let err = ''; child.stderr.on('data', (d) => { err += d; }); child.stdout.on('data', () => {});
  const srv = {
    port, home, child, call: (m, p, b) => request(port, m, p, b), stderr: () => err,
    state: async () => (await request(port, 'GET', '/api/state')).j,
    async lastJob(prefix) { return ((await srv.state()).jobs || []).filter((x) => x.title.startsWith(prefix)).pop() || null; },
    async waitJob(prefix, pred = (j) => j.status !== 'running', ms = 60000) {
      const t0 = Date.now(); let j = null;
      while (Date.now() - t0 < ms) { j = await srv.lastJob(prefix); if (j && pred(j)) return j; await sleep(300); }
      return j;
    },
    stop() { try { child.kill(); } catch (_) { /* já saiu */ } },
  };
  servers.push(srv);
  let up = false;
  for (let i = 0; i < 80; i++) {
    if (child.exitCode !== null) throw new Error('O servidor saiu ao iniciar: ' + err);
    if ((await request(port, 'GET', '/api/state')).status === 200) { up = true; break; }
    await sleep(250);
  }
  if (!up) throw new Error('O servidor não respondeu a tempo: ' + err);
  await srv.call('POST', '/api/settings', { autoCheckUpdates: false }); // sem consultas de atualização em segundo plano durante o teste
  return srv;
}

/** Espera uma condição (função que devolve verdadeiro) por até `ms` milissegundos. */
async function waitFor(pred, ms = 15000, step = 250) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { if (await pred()) return true; } catch (_) { /* tenta de novo */ } await sleep(step); }
  return false;
}

const mkdir = (...p) => { const d = path.join(...p); fs.mkdirSync(d, { recursive: true }); return d; };
const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); return file; };
const read = (file) => fs.readFileSync(file, 'utf8');
const json = (file, o) => write(file, JSON.stringify(o, null, 2));
/** Cria um site de teste (pasta + cadastro) e devolve o site. */
async function addSite(srv, name, dir, domain, extra = {}) {
  await srv.call('POST', '/api/sites', { name, path: dir, domain, php: 'default', ...extra });
  return ((await srv.state()).sites || []).find((s) => s.domain === domain);
}

/** Executa o teste, garante o encerramento dos servidores e imprime o resultado. */
async function run(fn) {
  try { await fn(); } catch (e) { R.fail++; console.log('FALHA erro inesperado: ' + ((e && e.stack) || e)); }
  for (const s of servers) s.stop();
  await sleep(300);
  for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); } catch (_) { /* arquivo em uso: o SO limpa depois */ } }
  console.log(`RESULTADO ok=${R.ok} falha=${R.fail} pulou=${R.skip}`);
  process.exit(R.fail ? 1 : 0);
}
process.on('exit', () => { for (const s of servers) { try { s.child.kill(); } catch (_) { /* ok */ } } });

module.exports = { ROOT, IS_WIN, FULL, sleep, waitFor, title, ok, skip, tmp, isolateHome, freePort, request, startServer, mkdir, write, read, json, addSite, run };
