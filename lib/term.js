'use strict';
/** Mini terminal: roda um comando por vez na pasta do site (PHP/Composer no PATH) e guarda a saída para o painel buscar. */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const core = require('./core');
const sites = require('./sites');
const { cfg, isDir, decode, killTree, log } = core;

const runs = new Map();       // id -> { id, siteId, cmd, cwd, chunks, size, done, code, child }
const cwds = new Map();       // siteId -> pasta atual (comando cd)
let seq = 0;
const MAX_CHARS = 1500000;
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;

function site(id) { const s = cfg.sites.find((x) => x.id === id); if (!s) throw new Error('Site não encontrado'); return s; }
function cwdOf(s) { const c = cwds.get(s.id); return c && isDir(c) ? c : s.path; }
const info = (id) => ({ cwd: cwdOf(site(id)), running: [...runs.values()].some((r) => r.siteId === id && !r.done) });

function finishNow(run, text, code = 0) { run.chunks.push(text); run.done = true; run.code = code; }

function start(siteId, rawCmd) {
  const s = site(siteId);
  if (!s.path) throw new Error('Este site não tem pasta de projeto.');
  const cmd = String(rawCmd || '').trim();
  if (!cmd) throw new Error('Digite um comando.');
  if (cmd.length > 2000 || /[\r\n\0]/.test(cmd)) throw new Error('Comando inválido (uma linha, até 2000 caracteres).');
  if ([...runs.values()].some((r) => r.siteId === siteId && !r.done)) throw new Error('Já há um comando em execução neste site. Aguarde ou clique em Parar.');
  const run = { id: ++seq, siteId, cmd, cwd: cwdOf(s), chunks: [], size: 0, done: false, code: null, child: null };
  runs.set(run.id, run);
  if (runs.size > 30) { for (const [k, r] of runs) { if (r.done) { runs.delete(k); break; } } }

  // cd é interno: cada comando roda em um processo novo, então guardamos a pasta atual aqui
  const m = cmd.match(/^cd(?:\s+\/d)?(?:\s+(.*))?$/i);
  if (m) {
    const arg = (m[1] || '').trim().replace(/^["']|["']$/g, '');
    if (!arg) { finishNow(run, run.cwd + '\n'); return run; }
    const target = path.resolve(run.cwd, arg === '~' ? s.path : arg);
    if (!isDir(target)) { finishNow(run, `A pasta não existe: ${target}\n`, 1); return run; }
    cwds.set(s.id, target); run.cwd = target; finishNow(run, target + '\n'); return run;
  }

  const env = { ...sites.terminalEnv(s), NO_COLOR: '1', TERM: 'dumb', FORCE_COLOR: '0', COMPOSER_NO_INTERACTION: '1', COMPOSER_NO_ANSI: '1' };
  let child;
  try { child = spawn(cmd, [], { cwd: run.cwd, env, shell: true, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { finishNow(run, 'Falha ao iniciar: ' + e.message + '\n', 1); return run; }
  run.child = child;
  const push = (d) => {
    if (run.size > MAX_CHARS) return;
    const t = decode(d).replace(ANSI, '');
    run.size += t.length; run.chunks.push(run.size > MAX_CHARS ? t + '\n[saída truncada]\n' : t);
  };
  child.stdout.on('data', push); child.stderr.on('data', push);
  child.on('error', (e) => { run.chunks.push(`Erro: ${e.message}\n`); });
  child.on('exit', (code, sig) => { run.done = true; run.code = code === null ? (sig ? 130 : 1) : code; });
  log(`Terminal (${s.name}): ${cmd}`);
  return run;
}

function out(id, from) {
  const run = runs.get(Number(id)); if (!run) throw new Error('Execução não encontrada');
  const f = Math.max(0, Number(from) || 0);
  return { chunks: run.chunks.slice(f), next: run.chunks.length, done: run.done, code: run.code, cwd: cwdOf(site(run.siteId)) };
}
function kill(id) { const run = runs.get(Number(id)); if (run && !run.done && run.child) killTree(run.child); }
function killAll() { for (const r of runs.values()) if (!r.done && r.child) killTree(r.child); }

module.exports = { start, out, kill, killAll, info };
