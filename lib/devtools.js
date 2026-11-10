// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 RDR Digital - https://github.com/RDRdigitalFloripa/rdrlocalserver
'use strict';
/** Atalhos do projeto: abrir no editor, link do repositório e terminal com o Claude Code. */
const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const core = require('./core');
const sites = require('./sites');
const { IS_WIN, exists, isDir } = core;

const fromEnv = (v, ...p) => (process.env[v] ? path.join(process.env[v], ...p) : '');
let cache = null;

/** Editores conhecidos que estão instalados (só Windows; procura nos locais padrão). */
function editors() {
  if (!IS_WIN) return [];
  if (cache && Date.now() - cache.at < 60000) return cache.list;
  const list = [];
  const add = (id, label, cands) => { const exe = cands.filter(Boolean).find((p) => exists(p)); if (exe) list.push({ id, label, exe }); };
  add('code', 'VS Code', [fromEnv('LOCALAPPDATA', 'Programs', 'Microsoft VS Code', 'Code.exe'), fromEnv('ProgramFiles', 'Microsoft VS Code', 'Code.exe')]);
  add('cursor', 'Cursor', [fromEnv('LOCALAPPDATA', 'Programs', 'cursor', 'Cursor.exe'), fromEnv('ProgramFiles', 'Cursor', 'Cursor.exe')]);
  try {
    const jb = fromEnv('ProgramFiles', 'JetBrains');
    const dirs = fs.readdirSync(jb).filter((n) => /^PhpStorm/i.test(n)).sort().reverse();
    add('phpstorm', 'PhpStorm', dirs.map((n) => path.join(jb, n, 'bin', 'phpstorm64.exe')));
  } catch (_) { /* sem JetBrains */ }
  cache = { at: Date.now(), list };
  return list;
}

let claudeCache = null;
function claudeInstalled() {
  if (!IS_WIN) return false;
  if (claudeCache && Date.now() - claudeCache.at < 60000) return claudeCache.ok;
  let ok = false; try { execFileSync('where', ['claude'], { stdio: 'ignore', windowsHide: true }); ok = true; } catch (_) { /* não achou */ }
  claudeCache = { at: Date.now(), ok };
  return ok;
}

/**
 * Abre um programa com argumentos sem passar a pasta por nenhum interpretador de linha de comando: o executável e
 * os argumentos vão por variáveis de ambiente para o PowerShell (nome de pasta com & ou espaço não vira comando).
 * hidden só existe para os testes.
 */
function launch(exe, args, { hidden = false } = {}) {
  if (!IS_WIN) throw new Error('Disponível só no Windows.');
  for (const a of args) if (/["\u0001\r\n\0]/.test(a)) throw new Error('Argumento inválido.');
  args = args.map((a) => a.replace(/(\\+)$/, '$1$1')); // barra invertida no fim ("C:\www\") escaparia a aspa de fechamento
  const ps = `$a = @(); if ($env:RDR_ARGS) { $a = @($env:RDR_ARGS -split [char]1 | ForEach-Object { '"' + $_ + '"' }) }; `
    + `if ($a.Count) { Start-Process -FilePath $env:RDR_EXE${hidden ? ' -WindowStyle Hidden' : ''} -ArgumentList $a } else { Start-Process -FilePath $env:RDR_EXE${hidden ? ' -WindowStyle Hidden' : ''} }`;
  spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { env: { ...process.env, RDR_EXE: exe, RDR_ARGS: args.join('\u0001') }, windowsHide: true, stdio: 'ignore' }).unref(); // sem "detached": com ele o PowerShell sai sem abrir o programa
}

/** https://host/dono/repo do remoto "origin" (lido do .git/config, sem usuário/token da URL). '' se não houver. */
function remoteUrl(dir) {
  let t; try { t = fs.readFileSync(path.join(dir, '.git', 'config'), 'utf8'); } catch (_) { return ''; }
  const m = /\[remote "origin"\][^[]*?\burl\s*=\s*([^\r\n]+)/.exec(t); if (!m) return '';
  const u = m[1].trim(); // a linha inteira: URL com espaço não vale
  const x = /^git@([A-Za-z0-9.-]+):([A-Za-z0-9._/-]+?)(?:\.git)?\/?$/.exec(u)
    || /^ssh:\/\/git@([A-Za-z0-9.-]+)(?::\d+)?\/([A-Za-z0-9._/-]+?)(?:\.git)?\/?$/.exec(u)
    || /^https:\/\/(?:[^@/]+@)?([A-Za-z0-9.-]+)\/([A-Za-z0-9._/-]+?)(?:\.git)?\/?$/.exec(u);
  return x ? `https://${x[1]}/${x[2]}` : '';
}

const info = (site) => ({ editors: editors().map((e) => ({ id: e.id, label: e.label })), github: remoteUrl(site.path), claude: claudeInstalled(), canOpen: IS_WIN });

function open(site, what, editorId) {
  if (!IS_WIN) throw new Error('Disponível só no Windows.');
  if (!site.path || !isDir(site.path)) throw new Error('A pasta do projeto não existe.');
  if (what === 'editor') {
    const e = editors().find((x) => x.id === editorId); if (!e) throw new Error('Editor não encontrado neste PC.');
    launch(e.exe, [site.path]); return;
  }
  if (what === 'claude') {
    if (!claudeInstalled()) throw new Error('O Claude Code não está instalado (o comando "claude" não foi encontrado).');
    spawn('cmd', ['/c', 'start', 'RDR - Claude Code', 'cmd', '/k', 'claude'], { cwd: site.path, env: sites.terminalEnv(site), detached: true, stdio: 'ignore' }).unref(); return;
  }
  throw new Error('Ação desconhecida.');
}

module.exports = { info, open, editors, claudeInstalled, remoteUrl, launch };
