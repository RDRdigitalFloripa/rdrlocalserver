// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 RDR Digital - https://github.com/RDRdigitalFloripa/rdrlocalserver
'use strict';
/**
 * Scripts do projeto: lê "scripts" do composer.json e do package.json, roda um por clique (com o PHP/Node do site)
 * e faz a auditoria de segurança (composer audit + npm audit). Só roda scripts que existem no arquivo do projeto;
 * o nome é validado e nunca vai para um shell sem passar pela lista.
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const core = require('./core');
const comps = require('./components');
const sites = require('./sites');
const { IS_WIN, exists } = core;

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9:_.-]{0,63}$/;
// Eventos do Composer: rodam sozinhos em install/update; não são "botões".
const COMPOSER_EVENTS = new Set(['pre-install-cmd', 'post-install-cmd', 'pre-update-cmd', 'post-update-cmd', 'pre-status-cmd', 'post-status-cmd', 'pre-package-install', 'post-package-install', 'pre-package-update', 'post-package-update', 'pre-package-uninstall', 'post-package-uninstall', 'pre-autoload-dump', 'post-autoload-dump', 'post-root-package-install', 'post-create-project-cmd', 'pre-archive-cmd', 'post-archive-cmd', 'pre-file-download', 'post-file-download', 'pre-command-run', 'command', 'init']);
const NPM_LIFECYCLE = new Set(['preinstall', 'install', 'postinstall', 'prepublish', 'prepare', 'prepublishOnly', 'prepack', 'postpack', 'publish', 'postpublish', 'preversion', 'version', 'postversion', 'dependencies']);
// Scripts que ficam rodando para sempre (servidor, watch): não cabem em "executar e mostrar o resultado".
const LONG_RE = /^(dev|start|serve|watch|hot|storybook|preview)(:|$)|--watch|\bnodemon\b|\bvite\b(?!\s+build)|\bserve\b|artisan\s+(serve|queue:listen|queue:work|schedule:work|pail|horizon)|concurrently/i;
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;
const timeoutMs = () => Number(process.env.RDR_SCRIPT_TIMEOUT_MS) || 10 * 60 * 1000; // a variável existe só para testes

function readJson(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); } catch (_) { return null; } }
const show = (v) => (Array.isArray(v) ? v.join(' && ') : String(v)).slice(0, 200);

/** Scripts de um site com pasta. */
function list(site) {
  const out = { composer: [], npm: [], hasComposer: false, hasNpm: false, hasComposerLock: false, hasNpmLock: false, manager: 'npm' };
  if (!site || !site.path) return out;
  out.hasComposer = exists(path.join(site.path, 'composer.json'));
  out.hasNpm = exists(path.join(site.path, 'package.json'));
  const c = readJson(path.join(site.path, 'composer.json'));
  if (c && c.scripts && typeof c.scripts === 'object') {
    for (const [name, v] of Object.entries(c.scripts)) {
      if (COMPOSER_EVENTS.has(name) || !NAME_RE.test(name)) continue;
      const cmd = show(v); out.composer.push({ name, cmd, long: LONG_RE.test(`${name} ${cmd}`) });
    }
  }
  const p = readJson(path.join(site.path, 'package.json'));
  if (p && p.scripts && typeof p.scripts === 'object') {
    for (const [name, v] of Object.entries(p.scripts)) {
      if (NPM_LIFECYCLE.has(name) || !NAME_RE.test(name)) continue;
      if (/^(pre|post)/.test(name) && p.scripts[name.replace(/^(pre|post)/, '')] !== undefined) continue; // roda sozinho junto do script principal
      const cmd = show(v); out.npm.push({ name, cmd, long: LONG_RE.test(`${name} ${cmd}`) });
    }
  }
  out.hasComposerLock = exists(path.join(site.path, 'composer.lock'));
  out.hasNpmLock = exists(path.join(site.path, 'package-lock.json'));
  out.manager = exists(path.join(site.path, 'pnpm-lock.yaml')) ? 'pnpm' : exists(path.join(site.path, 'yarn.lock')) ? 'yarn' : 'npm';
  return out;
}

/** Confere que o script existe e pode rodar aqui; devolve o item. */
function resolve(site, kind, name) {
  const l = list(site);
  const items = kind === 'composer' ? l.composer : kind === 'npm' ? l.npm : null;
  if (!items) throw new Error('Tipo de script desconhecido (use composer ou npm).');
  const it = NAME_RE.test(String(name)) ? items.find((x) => x.name === name) : null;
  if (!it) throw new Error(`O script "${name}" não existe neste projeto.`);
  if (it.long) throw new Error(`"${name}" fica rodando sem terminar: use Processos (Vite, fila) ou o Terminal do site.`);
  return it;
}

function stream(cmd, args, jl, opts) {
  return new Promise((resolveP, reject) => {
    const child = spawn(cmd, args, { windowsHide: true, ...opts });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; core.killTree(child); }, timeoutMs());
    const pipe = (d) => core.decode(d).replace(ANSI, '').split(/\r?\n/).filter(Boolean).forEach((l) => jl(l));
    child.stdout.on('data', pipe); child.stderr.on('data', pipe);
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) reject(new Error(`tempo esgotado (${Math.max(1, Math.round(timeoutMs() / 60000))} min): o script foi interrompido.`));
      else if (code === 0) resolveP();
      else reject(new Error(`terminou com código ${code}`));
    });
  });
}

function env(site) { return { ...sites.terminalEnv(site), NO_COLOR: '1', FORCE_COLOR: '0', COMPOSER_NO_INTERACTION: '1', COMPOSER_NO_ANSI: '1' }; }

/** Roda um script do projeto e manda a saída para o log da tarefa. */
async function run(site, kind, name, jl = () => {}) {
  resolve(site, kind, name);
  if (kind === 'composer') {
    const ver = sites.resolvePhp(site); if (!ver) throw new Error('Este site está sem PHP.');
    if (!comps.isInstalled.composer()) throw new Error('Instale o Composer na aba Componentes.');
    jl(`> composer run-script ${name}   (em ${site.path})`);
    return stream(comps.bins.phpCli(ver), [comps.bins.composerPhar(), 'run-script', name, '--timeout=0', '--no-interaction', '--no-ansi'], jl, { cwd: site.path, env: env(site) });
  }
  jl(`> npm run ${name}   (em ${site.path})`);
  // O nome já foi validado (letras, números, : _ . -); uma linha só evita o aviso de "shell + argumentos" do Node.
  return stream(IS_WIN ? `npm run ${name}` : 'npm', IS_WIN ? [] : ['run', name], jl, { cwd: site.path, env: env(site), shell: IS_WIN });
}

// ---------- auditoria de segurança ----------
function capture(cmd, args, opts, ms = 180000) {
  return new Promise((resolveP) => {
    const child = spawn(cmd, args, { windowsHide: true, ...opts });
    const o = []; const e = []; let t = false;
    const timer = setTimeout(() => { t = true; core.killTree(child); }, ms);
    child.stdout.on('data', (d) => o.push(d)); child.stderr.on('data', (d) => e.push(d));
    child.on('error', (er) => { clearTimeout(timer); resolveP({ code: -1, out: '', err: er.message, timedOut: false }); });
    child.on('close', (code) => { clearTimeout(timer); resolveP({ code, out: core.decode(Buffer.concat(o)).replace(ANSI, ''), err: core.decode(Buffer.concat(e)).replace(ANSI, ''), timedOut: t }); });
  });
}
const parseJson = (s) => { try { return JSON.parse(s); } catch (_) { const i = s.indexOf('{'); if (i > 0) { try { return JSON.parse(s.slice(i)); } catch (_2) { /* abaixo */ } } return null; } };
const SEV = { critical: 4, high: 3, moderate: 2, medium: 2, low: 1, info: 0 };

// Cada auditoria devolve { found, state }: ok (rodou), skipped (faltou lock/ferramenta) ou failed (não consegui concluir).
async function auditComposer(site, jl) {
  if (!exists(path.join(site.path, 'composer.lock'))) { jl('Sem composer.lock: rode "Composer install" antes (a auditoria olha as versões travadas).'); return { found: 0, state: 'skipped' }; }
  const ver = sites.resolvePhp(site); if (!ver || !comps.isInstalled.composer()) { jl('PHP ou Composer não instalado: auditoria do Composer ignorada.'); return { found: 0, state: 'skipped' }; }
  // --locked: audita o composer.lock mesmo sem a pasta vendor (sem ele o composer exige "composer install" antes)
  const r = await capture(comps.bins.phpCli(ver), [comps.bins.composerPhar(), 'audit', '--locked', '--format=json', '--no-interaction', '--no-ansi'], { cwd: site.path, env: env(site) });
  const j = parseJson(r.out);
  if (!j || typeof j !== 'object') { jl(`Não consegui ler o resultado do composer audit (código ${r.code}).`); jl(((r.err || r.out) || '').trim().slice(0, 800)); return { found: 0, state: 'failed' }; }
  const adv = Array.isArray(j.advisories) ? {} : (j.advisories || {});
  const pkgs = Object.keys(adv); let total = 0;
  for (const p of pkgs) total += (Array.isArray(adv[p]) ? adv[p] : []).length;
  if (!total) jl('Nenhuma vulnerabilidade conhecida nos pacotes do composer.lock.');
  else {
    jl(`${total} vulnerabilidade(s) em ${pkgs.length} pacote(s):`);
    for (const p of pkgs.slice(0, 20)) for (const a of adv[p].slice(0, 3)) jl(`  - ${p}: ${a.title || a.advisoryId}${a.cve ? ` (${a.cve})` : ''}; afeta ${a.affectedVersions || '?'}${a.link ? ` - ${a.link}` : ''}`);
    jl('  Atualize com "composer update <pacote>" e rode os testes.');
  }
  const ab = Object.keys(j.abandoned || {});
  if (ab.length) jl(`Pacotes abandonados: ${ab.join(', ')}.`);
  return { found: total, state: 'ok' };
}

async function auditNpm(site, jl) {
  if (!exists(path.join(site.path, 'package-lock.json'))) { jl('Sem package-lock.json: rode "npm install" antes (a auditoria olha as versões travadas). Projetos com yarn ou pnpm não são auditados aqui.'); return { found: 0, state: 'skipped' }; }
  const r = await capture(IS_WIN ? 'npm audit --json --omit=dev' : 'npm', IS_WIN ? [] : ['audit', '--json', '--omit=dev'], { cwd: site.path, env: env(site), shell: IS_WIN });
  const j = parseJson(r.out);
  if (r.timedOut) { jl('Tempo esgotado ao consultar o npm.'); return { found: 0, state: 'failed' }; }
  if (!j || typeof j !== 'object') { jl(`Não consegui ler o resultado do npm audit (código ${r.code}).`); jl(((r.err || r.out) || '').trim().slice(0, 800)); return { found: 0, state: 'failed' }; }
  if (j.error) { jl(`npm audit não rodou: ${j.error.summary || j.error.code || 'erro'}`); return { found: 0, state: 'failed' }; }
  const m = (j.metadata && j.metadata.vulnerabilities) || {}; const total = Number(m.total) || 0;
  if (!total) { jl('Nenhuma vulnerabilidade conhecida nas dependências de produção.'); return { found: 0, state: 'ok' }; }
  jl(`${total} vulnerabilidade(s): ${['critical', 'high', 'moderate', 'low', 'info'].filter((k) => m[k]).map((k) => `${m[k]} ${k}`).join(', ')}`);
  const vs = Object.entries(j.vulnerabilities || {}).sort((a, b) => (SEV[b[1].severity] || 0) - (SEV[a[1].severity] || 0));
  for (const [pkg, v] of vs.slice(0, 15)) {
    const via = (v.via || []).find((x) => x && typeof x === 'object');
    jl(`  - ${pkg} (${v.severity}): ${via ? via.title : 'depende de pacote vulnerável'}${via && via.url ? ` - ${via.url}` : ''}; correção: ${v.fixAvailable ? 'disponível (npm audit fix)' : 'não automática'}`);
  }
  return { found: total, state: 'ok' };
}

/**
 * composer audit + npm audit (o que existir no projeto). Termina com ERRO se achar vulnerabilidades e também se não
 * conseguir concluir uma verificação: "não consegui auditar" nunca pode parecer "está tudo certo".
 */
async function audit(site, jl = () => {}) {
  const hasC = exists(path.join(site.path, 'composer.json')); const hasN = exists(path.join(site.path, 'package.json'));
  if (!hasC && !hasN) throw new Error('Este projeto não tem composer.json nem package.json.');
  const results = [];
  if (hasC) { jl('=== Composer (composer audit --locked) ==='); results.push(await auditComposer(site, jl)); }
  if (hasN) { jl('=== npm (npm audit --omit=dev) ==='); results.push(await auditNpm(site, jl)); }
  const found = results.reduce((a, r) => a + r.found, 0);
  if (found) throw new Error(`Auditoria concluída com ${found} achado(s): veja o resumo acima.`);
  if (results.some((r) => r.state === 'failed')) throw new Error('Auditoria incompleta: não consegui concluir uma das verificações (veja acima). Isso NÃO significa que está tudo certo.');
  if (results.every((r) => r.state === 'skipped')) { jl('Nada foi auditado: faltam o composer.lock e/ou o package-lock.json (veja acima).'); return; }
  jl(results.some((r) => r.state === 'skipped') ? 'Auditoria concluída sem achados (uma das verificações foi ignorada: veja acima).' : 'Auditoria concluída sem achados.');
}

module.exports = { list, resolve, run, audit, NAME_RE };
