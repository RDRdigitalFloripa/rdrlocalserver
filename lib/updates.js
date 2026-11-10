// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 RDR Digital - https://github.com/RDRdigitalFloripa/rdrlocalserver
'use strict';
/** Verificação e aplicação de atualizações dos componentes (Caddy, PHP, Node.js, Python, Mailpit, Meilisearch, Cloudflared, Adminer). */
const fs = require('fs');
const path = require('path');
const core = require('./core');
const comps = require('./components');
const rts = require('./runtimes');
const appupdate = require('./appupdate');
const { cfg, log } = core;
const VERSION = (() => { try { return require('../package.json').version; } catch (_) { return '0.0.0'; } })();

const TARGETS = [
  { id: 'caddy', repo: 'caddyserver/caddy', svc: 'web' },
  { id: 'mailpit', repo: 'axllent/mailpit', svc: 'mailpit' },
  { id: 'meilisearch', repo: 'meilisearch/meilisearch', svc: 'meilisearch' },
  { id: 'cloudflared', repo: 'cloudflare/cloudflared', tunnel: true },
  { id: 'adminer', repo: 'vrana/adminer' },
];
const services = () => require('./services');
const nums = (v) => String(v || '').replace(/^v/i, '').split(/[^0-9]+/).filter(Boolean).map(Number);
/** > 0 se a for mais nova que b. */
function cmp(a, b) {
  const x = nums(a); const y = nums(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d; }
  return 0;
}

async function latestTag(repo) {
  const fake = process.env.RDR_FAKE_LATEST ? JSON.parse(process.env.RDR_FAKE_LATEST) : null; // só para testes
  if (fake && fake[repo]) return fake[repo];
  return comps.githubLatestTag(repo);
}

async function check() {
  const items = []; const errors = [];
  for (const t of TARGETS) {
    if (!comps.isInstalled[t.id]()) continue;
    const current = comps.version(t.id).replace(/^v/, '');
    try {
      const latest = (await latestTag(t.repo)).replace(/^v/, '');
      items.push({ id: t.id, name: comps.LABELS[t.id].split(' — ')[0], current, latest, updatable: !!current && cmp(latest, current) > 0 });
    } catch (e) { errors.push(`${t.id}: ${e.message.slice(0, 80)}`); }
  }
  try {
    const rels = await comps.latestPhpReleases();
    for (const b of comps.phpInstalled()) {
      const current = comps.version(`php-${b}`);
      const latest = rels[b] && rels[b].version;
      if (latest) items.push({ id: `php-${b}`, name: `PHP ${b}`, current, latest, updatable: !!current && cmp(latest, current) > 0 });
    }
  } catch (e) { errors.push(`php: ${e.message.slice(0, 80)}`); }
  for (const rt of Object.keys(rts.KINDS)) {
    const have = rts.installed(rt); if (!have.length) continue;
    try {
      rts.refresh();
      const av = await rts.available(rt);
      for (const v of have) {
        const latest = (av.find((x) => x.v === v) || {}).full; const current = rts.fullVersion(rt, v);
        if (latest) items.push({ id: `rt-${rt}-${v}`, name: `${rts.KINDS[rt].label} ${v}`, current, latest, updatable: !!current && cmp(latest, current) > 0 });
      }
    } catch (e) { errors.push(`${rt}: ${e.message.slice(0, 80)}`); }
  }
  if (comps.isInstalled.composer() && comps.phpDefault()) {
    try {
      const r = await core.run(comps.bins.phpCli(comps.phpDefault()), [comps.bins.composerPhar(), '--version', '--no-ansi'], { timeout: 30000 });
      const m = /Composer version (\d+\.\d+\.\d+)/.exec(r.out || '');
      const latest = ((await core.getJson('https://getcomposer.org/versions')).stable || [])[0];
      if (m && latest && latest.version) items.push({ id: 'composer', name: 'Composer', current: m[1], latest: latest.version, updatable: cmp(latest.version, m[1]) > 0 });
    } catch (e) { errors.push(`composer: ${e.message.slice(0, 80)}`); }
  }
  if (comps.isInstalled.phpmyadmin()) {
    try {
      const current = comps.version('phpmyadmin');
      const latest = (await core.getJson('https://www.phpmyadmin.net/home_page/version.json')).version;
      if (latest && /^\d/.test(current)) items.push({ id: 'phpmyadmin', name: 'phpMyAdmin', current, latest, updatable: cmp(latest, current) > 0 });
    } catch (e) { errors.push(`phpmyadmin: ${e.message.slice(0, 80)}`); }
  }
  // O próprio RDR Local (release no GitHub). Sem release publicada (ou repositório privado): fica "em dia", sem erro.
  let app = { current: VERSION, latest: '', updatable: false, url: '', notes: '', ready: false };
  try {
    const rel = await appupdate.latest();
    if (rel) app = { current: VERSION, latest: rel.version, updatable: cmp(rel.version, VERSION) > 0, url: rel.url, notes: rel.notes, ready: rel.ready };
  } catch (e) { errors.push(`RDR Local: ${e.message.slice(0, 80)}`); }
  return { items, errors, app, checkedAt: Date.now() };
}

// ---------- cache, resumo e verificação automática ----------
let cache = null;
/** Resultado da última verificação (reaproveita por 10 min; fresh=true força nova consulta). */
async function cached(fresh) {
  if (!cache || fresh || Date.now() - cache.checkedAt > 600000) cache = await check();
  return cache;
}
const invalidate = () => { cache = null; };
/** Sem rede: contagem de atualizações pendentes segundo a última verificação (vai no /api/state para o selo do menu). */
function summary() {
  if (!cache) return { pending: 0, app: false, checkedAt: 0 };
  const appNew = !!(cache.app && cache.app.updatable);
  return { pending: cache.items.filter((i) => i.updatable).length + (appNew ? 1 : 0), app: appNew, checkedAt: cache.checkedAt };
}
/** Verifica 30 s depois de abrir e a cada 6 horas (desligável em Configurações). Não instala nada sozinho. */
function startAuto() {
  const run = () => { if (cfg.autoCheckUpdates === false) return; cached(true).catch((e) => log('Verificação de atualizações falhou: ' + e.message.split('\n')[0])); };
  setTimeout(run, 30000);
  setInterval(run, 6 * 3600 * 1000);
}

/** Atualiza um componente: para o que usa o arquivo, reinstala a versão mais nova e religa. */
async function apply(id, jl = () => {}) {
  if (id === 'composer' || id === 'phpmyadmin') { // sem serviço para parar: baixa a versão estável mais nova por cima
    await comps.install(id, jl); jl('Atualizado.'); log(`Componente ${id} atualizado.`); return;
  }
  const rt = String(id).match(/^rt-(node|python|go|java)-(\d+(?:\.\d+)?)$/);
  if (rt) {
    const apps = require('./apps');
    jl('Parando os apps que usam essa versão...');
    const stopped = await apps.stopUsing(rt[1], rt[2]);
    try { await rts.install(rt[1], jl, rt[2]); jl('Atualizado.'); log(`${rts.KINDS[rt[1]].label} ${rt[2]} atualizado.`); }
    finally { for (const sid of stopped) await apps.start(sid).catch((e) => jl('Não consegui religar o app: ' + e.message.split('\n')[0])); }
    return;
  }
  const php = String(id).match(/^php-(\d+\.\d+)$/);
  const t = TARGETS.find((x) => x.id === id);
  if (!php && !t) throw new Error('Componente não atualizável: ' + id);
  const sv = services();
  let restart = null; let ini = null;
  if (php) {
    const ver = php[1];
    try { ini = fs.readFileSync(path.join(comps.bins.phpDir(ver), 'php.ini')); } catch (_) { /* sem ini */ }
    jl(`Parando os workers do PHP ${ver}...`); await sv.stopPhp(ver);
  } else if (t.svc && sv.isRunning(t.svc)) {
    jl(`Parando ${t.svc}...`); await sv.stop(t.svc); restart = t.svc;
  } else if (t.tunnel) {
    const procs = require('./procs');
    for (const s of cfg.sites) procs.stop(s.id, 'tunnel');
  }
  try {
    if (php) {
      await comps.install('php', jl, php[1]);
      if (ini) fs.writeFileSync(path.join(comps.bins.phpDir(php[1]), 'php.ini'), ini); // mantém os ajustes do usuário
      comps.ensurePhpIni(php[1]);
    } else {
      await comps.install(id, jl);
    }
    jl('Atualizado.'); log(`Componente ${id} atualizado.`);
  } finally {
    if (restart) { jl(`Religando ${restart}...`); await sv.start(restart).catch((e) => jl('Não consegui religar: ' + e.message.split('\n')[0])); }
    if (php) await sv.reloadWeb().catch(() => {});
  }
}

module.exports = { check, cached, invalidate, summary, startAuto, apply, cmp };
