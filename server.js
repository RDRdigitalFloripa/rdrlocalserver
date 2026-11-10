// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 RDR Digital - https://github.com/RDRdigitalFloripa/rdrlocalserver
'use strict';
/**
 * RDR Local — ambiente local de hospedagem com HTTPS (Caddy, PHP, MariaDB, PostgreSQL, Redis, Mailpit).
 * Zero dependências npm. Node 18.15+.   Painel: http://127.0.0.1:7070
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const core = require('./lib/core');
const comps = require('./lib/components');
const rts = require('./lib/runtimes');
const apps = require('./lib/apps');
const sites = require('./lib/sites');
const services = require('./lib/services');
const db = require('./lib/db');
const projects = require('./lib/projects');
const sysinfo = require('./lib/sysinfo');
const backup = require('./lib/backup');
const cloud = require('./lib/cloud');
const notify = require('./lib/notify');
const github = require('./lib/github');
const importer = require('./lib/importer');
const dbimport = require('./lib/dbimport');
const deploy = require('./lib/deploy');
const ftp = require('./lib/ftp');
const secrets = require('./lib/secrets');
const phpini = require('./lib/phpini');
const autostart = require('./lib/autostart');
const updates = require('./lib/updates');
const appupdate = require('./lib/appupdate');
const aifiles = require('./lib/aifiles');
const rdrfile = require('./lib/rdrfile');
const scripts = require('./lib/scripts');
const envfile = require('./lib/envfile');
const devtools = require('./lib/devtools');
const plan = require('./lib/plan');
const procs = require('./lib/procs');
const doctor = require('./lib/doctor');
const term = require('./lib/term');
const { P, IS_WIN, cfg, save, log, panelLog, jobs, startJob, exists, isDir, tail, run } = core;

const PANEL_PORT = Number(process.env.RDR_PORT || 7070);
const PUBLIC = path.join(P.app, 'public');
const DOCS = path.join(P.app, 'docs');
const docList = () => (exists(DOCS) ? fs.readdirSync(DOCS).filter((f) => /^[\w.-]+\.md$/.test(f)).sort() : []);
const docTitle = (f) => { const m = /^#\s+(.+)$/m.exec(fs.readFileSync(path.join(DOCS, f), 'utf8')); return m ? m[1].trim() : f; };
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const VERSION = (() => { try { return require('./package.json').version; } catch (_) { return '0.0.0'; } })();
const LOG_NAMES = ['web', 'mariadb', 'postgres', 'redis', 'mailpit', 'meilisearch'];

function state() {
  const svc = services.status();
  const web = services.isRunning('web');
  const caRoot = services.rootCrt();
  return {
    platform: process.platform,
    version: VERSION,
    services: svc,
    sites: sites.list(web).map((s) => ({ ...s, app: s.type === 'app' ? { ...apps.status(s.id), runtimeVersion: s.runtime === 'custom' ? '' : rts.resolve(s.runtime, s.rtVersion) } : undefined, procs: procs.status(s.id), tunnelUrl: procs.tunnelUrl(s.id), procCaps: procs.capabilities(s), caps: s.path ? { artisan: exists(path.join(s.path, 'artisan')), composer: exists(path.join(s.path, 'composer.json')), npm: exists(path.join(s.path, 'package.json')), git: isDir(path.join(s.path, '.git')), rdr: exists(path.join(s.path, 'rdr.json')) } : {} })),
    components: comps.listComponents(),
    runtimes: rts.summary(),
    updates: updates.summary(),
    php: { installed: comps.phpInstalled(), default: comps.phpDefault(), versions: comps.phpInstalled().map((v) => ({ v, full: comps.version(`php-${v}`) })) },
    settings: { panelUrl: sites.baseUrl(sites.panelDomain()), autoStartServices: !!cfg.autoStartServices, projectDocs: cfg.projectDocs !== false, autoCheckUpdates: cfg.autoCheckUpdates !== false, dnsMode: !!cfg.dnsMode, tld: cfg.tld, tlds: sites.TLDS, projectsRoot: cfg.projectsRoot, ports: cfg.ports },
    connection: db.connectionInfo(),
    pma: { installed: comps.isInstalled.phpmyadmin(), domain: sites.pmaDomain(), base: sites.pmaUrl(), db: sites.pmaUrl('__DB__') },
    adminer: { installed: comps.isInstalled.adminer(), domain: sites.dbDomain(), mariadb: sites.adminerUrl('mariadb'), postgres: sites.adminerUrl('postgres') },
    mailDomain: sites.mailDomain(), mailUrl: sites.baseUrl(sites.mailDomain()),
    ca: { generated: exists(caRoot), trusted: !!cfg.caTrusted, path: caRoot },
    hostsError: sites.getHostsError(), isAdmin: sites.isAdmin(),
    jobs: jobs.map((j) => ({ id: j.id, title: j.title, status: j.status, log: j.log.slice(-60) })),
    log: panelLog.slice(-60),
  };
}

const ok = () => ({ ok: true });
/** Pasta do projeto de uma requisição do rdr.json: por id de site ou por caminho (rdr up). */
const rdrDir = (b) => {
  if (b.id) { const s = cfg.sites.find((x) => x.id === String(b.id)); if (!s || !s.path) throw new Error('Site não encontrado ou sem pasta.'); return s.path; }
  const p = String(b.path || '').trim(); if (!p || !isDir(p)) throw new Error('Pasta não encontrada: ' + p);
  return path.resolve(p);
};
/** Site com pasta (PHP ou app) pelo id, para as ferramentas do projeto. */
const devSite = (id) => {
  const s = cfg.sites.find((x) => x.id === String(id || ''));
  if (!s || !s.path || !['php', 'app', undefined].includes(s.type)) throw new Error('Site não encontrado ou sem pasta de projeto.');
  if (!isDir(s.path)) throw new Error('A pasta do projeto não existe: ' + s.path);
  return s;
};
const routes = {
  'GET /api/state': async () => state(),
  'GET /api/host-status': async () => sysinfo.metrics(),
  'GET /api/metrics': async () => sysinfo.metrics(), // nome antigo (bloqueadores de anúncio costumam barrar "metrics")
  'GET /api/hosts-text': async () => ({ text: sites.hostsText() }),
  'GET /api/php/available': async () => comps.phpAvailable(),
  'GET /api/log': async (_, q) => {
    const name = q.get('name') || 'web';
    if (LOG_NAMES.includes(name) || /^php-\d+\.\d+$/.test(name)) return { text: tail(path.join(P.logs, name + '.log')) };
    if (/^app:[a-z0-9]+$/.test(name)) return { text: apps.logTail(name.slice(4)) };
    const sp = procs.readSpecial(name);
    if (sp !== null) return { text: sp };
    if (name.startsWith('site:')) {
      const d = name.slice(5);
      if (!/^[a-z0-9.-]+$/.test(d)) throw new Error('Nome inválido');
      return { text: tail(path.join(P.logs, 'sites', d + '.log')) };
    }
    throw new Error('Log desconhecido');
  },
  'GET /api/term/info': async (_, q) => term.info(q.get('id')),
  'GET /api/term/out': async (_, q) => term.out(q.get('run'), q.get('from')),
  // Usado pelo ícone da bandeja e pelo instalador: encerra o painel desligando os serviços com segurança.
  'POST /api/quit': async () => { setTimeout(() => shutdown(), 200); return ok(); },
  'GET /api/doctor': async () => doctor.check(),
  'GET /api/docs': async () => ({ docs: docList().map((f) => ({ name: f, title: docTitle(f) })) }),
  'GET /api/docs/read': async (_b, q) => {
    const n = q.get('name') || '';
    if (!docList().includes(n)) throw new Error('Documento não encontrado');
    return { name: n, text: fs.readFileSync(path.join(DOCS, n), 'utf8') };
  },
  'GET /api/php/ini': async (_, q) => phpini.info(q.get('v')),
  'POST /api/php/ext': async (b) => { await phpini.setExtension(b.v, b.name, !!b.on); return ok(); },
  'POST /api/php/settings': async (b) => { await phpini.setSettings(b.v, b.values); return ok(); },
  'POST /api/php/ini-raw': async (b) => { await phpini.setRaw(b.v, b.text); return ok(); },
  'POST /api/php/ini-restore': async (b) => { await phpini.restoreBackup(b.v); return ok(); },
  'GET /api/mcp-config': async () => {
    const script = path.join(P.app, 'mcp.js');
    const j = (env) => JSON.stringify({ mcpServers: { 'rdr-local': { command: process.execPath, args: [script], ...(env ? { env: { RDR_MCP_ALLOW_SHELL: '1' } } : {}) } } }, null, 2);
    return { script, cli: `claude mcp add rdr-local -- "${process.execPath}" "${script}"`, json: j(false), jsonShell: j(true) };
  },
  'GET /api/updates': async (_, q) => updates.cached(q.get('fresh') === '1'),
  'POST /api/updates/apply': async (b) => {
    const t = String(b.id || '');
    startJob(`Atualizar ${t}`, async (jl) => { await updates.apply(t, jl); updates.invalidate(); }, 'update'); return ok();
  },
  // Atualiza o próprio RDR Local: baixa o instalador da última release, confere o SHA-256 e abre o assistente.
  'POST /api/updates/app': async () => { startJob('Atualizar o RDR Local', async (jl) => { await appupdate.install(jl); updates.invalidate(); }, 'appupdate'); return ok(); },
  'GET /api/autostart': async () => autostart.status(),
  'POST /api/autostart': async (b) => { if (b.enabled) await autostart.enable(); else await autostart.disable(); return autostart.status(); },
  'GET /api/db/backups': async () => ({ backups: backup.list(), schedule: cfg.backup }),
  'GET /api/db/list': async (_, q) => ({ databases: await db.list(q.get('engine')) }),

  'POST /api/install': async (b) => {
    startJob(`Instalar ${b.id}${b.version ? ' ' + b.version : ''}`, (jl) => comps.install(b.id, jl, b.version), 'install');
    return ok();
  },
  'POST /api/install-all': async (b) => {
    startJob('Instalação inicial', async (jl) => {
      const av = await comps.phpAvailable();
      const branch = (av.find((x) => x.branch === '8.4') || av[0] || {}).branch;
      const steps = [['caddy'], ['php', branch], ['composer'], ['mariadb'], ['redis'], ['mailpit'], ['adminer'], ['phpmyadmin']];
      if (b.postgres) steps.push(['postgres']);
      for (const [id, arg] of steps) {
        if (id === 'php' ? comps.phpInstalled().includes(arg) : comps.isInstalled[id]()) { jl(`${id} já instalado.`); continue; }
        jl(`=== ${id}${arg ? ' ' + arg : ''} ===`);
        await comps.install(id, jl, arg);
      }
    }, 'install');
    return ok();
  },
  'POST /api/svc': async (b) => {
    if (b.id === 'all') await services.all(b.action);
    else if (b.action === 'start') await services.start(b.id);
    else if (b.action === 'stop') await services.stop(b.id);
    else if (b.action === 'restart') await services.restart(b.id);
    else throw new Error('Ação inválida');
    return ok();
  },
  'POST /api/sites': async (b) => { const site = await sites.add(b); if (site.type === 'app' && services.isRunning('web') && site.autoStart !== false) apps.start(site.id).catch((e) => log('App ' + site.name + ': ' + e.message)); return { site }; },
  'POST /api/sites/update': async (b) => {
    const before = cfg.sites.find((x) => x.id === b.id); const wasUp = !!before && before.type === 'app' && apps.status(b.id).running;
    if (wasUp) await apps.stop(b.id);
    const site = await sites.update(b.id, b);
    if (wasUp) apps.start(b.id).catch((e) => log('App ' + site.name + ': ' + e.message));
    return { site };
  },
  'POST /api/sites/remove': async (b) => { procs.stopSite(b.id); await apps.stop(b.id); await sites.remove(b.id); return ok(); },
  'POST /api/sites/toggle': async (b) => {
    const s = await sites.toggle(b.id);
    if (s.enabled === false) { procs.stopSite(b.id); await apps.stop(b.id); }
    else if (s.type === 'app' && services.isRunning('web') && s.autoStart !== false) apps.start(b.id).catch((e) => log('App ' + s.name + ': ' + e.message));
    return ok();
  },
  // ----- apps (Node.js, Python, Go, Java...) -----
  'POST /api/apps/ctl': async (b) => {
    const action = String(b.action);
    if (action === 'start') await apps.start(b.id); else if (action === 'stop') await apps.stop(b.id); else if (action === 'restart') await apps.restart(b.id); else throw new Error('Ação inválida');
    return ok();
  },
  'POST /api/apps/deps': async (b) => {
    const s = cfg.sites.find((x) => x.id === b.id && x.type === 'app'); if (!s) throw new Error('App não encontrado');
    startJob(`Instalar dependências de ${s.name}`, (jl) => apps.installDeps(s, jl), 'deps:' + s.id);
    return ok();
  },
  'GET /api/apps/detect': async (_, q) => ({ detected: apps.detect(q.get('path')) }),
  'GET /api/apps/templates': async () => ({ templates: apps.templates() }),
  'POST /api/apps/new': async (b) => {
    const tpl = apps.T[b.template] || null;
    const name = String(b.name || '').trim();
    if (!name) throw new Error('Informe o nome do app.');
    const root = String(b.dir || '').trim();
    if (!root) throw new Error('Informe a pasta.');
    const useExisting = b.template === 'existing';
    const dir = useExisting ? root : path.join(root, core.slug(name) || 'app');
    if (useExisting && !core.isDir(dir)) throw new Error('A pasta não existe: ' + dir);
    if (!useExisting && tpl && (tpl.files || tpl.remote) && exists(dir) && fs.readdirSync(dir).length) throw new Error('A pasta já existe e não está vazia: ' + dir);
    const runtime = tpl ? tpl.runtime : String(b.runtime || 'custom');
    const input = { type: 'app', name, path: dir, domain: b.domain, aliases: b.aliases, runtime, rtVersion: b.rtVersion || 'default', cmd: String(b.cmd || (tpl && tpl.cmd) || ''), appPort: b.appPort, cors: !!b.cors, env: b.env || '' };
    if (!useExisting && !(tpl && (tpl.files || tpl.remote))) fs.mkdirSync(dir, { recursive: true });
    // valida tudo antes de criar arquivos
    // Runtime ausente: instala sozinho (Windows) dentro da própria tarefa, em vez de mandar o usuário ir a outra tela.
    let autoVer = ''; let wantVer = '';
    if (runtime !== 'custom' && !rts.resolve(runtime, input.rtVersion)) {
      if (!IS_WIN || b.autoInstall === false) throw new Error(`${rts.KINDS[runtime].label} não está instalado: instale em Componentes e PHP > Linguagens antes de criar o app.`);
      if (input.rtVersion && input.rtVersion !== 'default') { autoVer = String(input.rtVersion); input.rtVersion = 'default'; wantVer = autoVer; }
      else {
        const list = await rts.available(runtime).catch(() => []);
        if (!list.length) throw new Error(`${rts.KINDS[runtime].label} não está instalado e não consegui consultar as versões disponíveis (sem internet?). Instale em Componentes e PHP > Linguagens.`);
        autoVer = (list.find((x) => x.lts) || list[0]).v;
      }
    }
    if (!useExisting && tpl && (tpl.files || tpl.remote)) fs.mkdirSync(dir, { recursive: true });
    let site = await sites.add({ ...input });
    startJob(`Criar app ${name}`, async (jl) => {
      if (autoVer) { jl(`${rts.KINDS[runtime].label} ainda não está instalado: baixando a versão ${autoVer} (pode levar alguns minutos)...`); await rts.install(runtime, jl, autoVer); if (wantVer) site = await sites.update(site.id, { rtVersion: wantVer }) || site; }
      if (!useExisting && tpl && tpl.files) { jl(`Criando arquivos (${tpl.label})...`); apps.scaffold(b.template, dir, name).forEach((f) => jl('  + ' + f)); }
      if (!useExisting && tpl && tpl.remote) await apps.scaffoldRemote(b.template, dir, name, jl);
      if (!useExisting) { // projeto novo: CLAUDE.md, AGENTS.md e docs/ (depois do modelo, que pode recriar a pasta)
        const made = aifiles.scaffold({ dir, name, kind: 'app', domain: site.domain, runtime, template: tpl ? tpl.label : '', cmd: site.cmd, appPort: site.appPort });
        if (made.length) jl(`Arquivos para agentes de IA e documentação: ${made.join(', ')}`);
      }
      if (b.installDeps !== false && runtime !== 'custom') {
        await apps.installDeps(site, jl);
        if (tpl && tpl.django) await apps.finishDjango(site, jl);
      }
      if (services.isRunning('web') && site.autoStart !== false) { jl('Iniciando o app...'); await apps.start(site.id).catch((e) => jl('Não consegui iniciar: ' + e.message.split('\n')[0])); }
      jl(`Pronto: ${sites.baseUrl(site.domain)}`);
    }, 'app:' + site.id);
    return { site };
  },
  // ----- runtimes (Node.js e Python) -----
  'GET /api/runtimes/available': async (_, q) => ({ list: await rts.available(q.get('rt')) }),
  'POST /api/runtimes/install': async (b) => { startJob(`Instalar ${rts.KINDS[b.rt] ? rts.KINDS[b.rt].label : b.rt} ${b.version}`, (jl) => rts.install(b.rt, jl, b.version), 'install'); return ok(); },
  'POST /api/runtimes/install-latest': async (b) => { const rt = String(b.rt || ''); if (!rts.KINDS[rt]) throw new Error('Linguagem desconhecida.'); const v = await rts.pickVersion(rt); startJob(`Instalar ${rts.KINDS[rt].label} ${v}`, (jl) => rts.install(rt, jl, v), 'install'); return ok(); },
  'POST /api/runtimes/default': async (b) => { rts.setDefault(b.rt, b.version); return ok(); },
  'POST /api/runtimes/remove': async (b) => { rts.remove(b.rt, b.version); return ok(); },
  'POST /api/sites/artisan': async (b) => {
    const s = cfg.sites.find((x) => x.id === b.id); if (!s) throw new Error('Site não encontrado');
    const c = procs.COMMANDS[b.cmd]; if (!c) throw new Error('Comando desconhecido');
    startJob(`${c.label} — ${s.name}`, (jl) => procs.runCommand(b.id, b.cmd, jl), 'artisan'); return ok();
  },
  'POST /api/term/run': async (b) => { const r = term.start(b.id, b.cmd); return { run: r.id, cwd: r.cwd }; },
  'POST /api/term/kill': async (b) => { term.kill(b.run); return ok(); },
  'POST /api/sites/proc': async (b) => { if (b.action === 'start') procs.start(b.id, b.kind); else if (b.action === 'stop') procs.stop(b.id, b.kind); else throw new Error('Ação inválida'); return ok(); },
  'POST /api/sites/terminal': async (b) => { sites.openTerminal(b.id); return ok(); },
  'POST /api/sites/folder': async (b) => { sites.openFolder(b.id); return ok(); },
  // ----- rdr.json: configuração do projeto dentro do repositório -----
  'POST /api/rdrfile/plan': async (b) => rdrfile.plan(rdrDir(b)),
  'POST /api/rdrfile/apply': async (b) => {
    const dir = rdrDir(b); const p = rdrfile.plan(dir);
    if (p.errors.length) throw new Error(p.errors.join(' '));
    if (p.needsConfirm && !b.confirmCmd) throw new Error(`Este projeto roda o comando "${p.needsConfirm}" na sua máquina. Confirme para aplicar.`);
    startJob(`Aplicar rdr.json: ${p.name}`, (jl) => rdrfile.apply(dir, { confirmCmd: !!b.confirmCmd }, jl), 'rdrfile'); return ok();
  },
  'POST /api/rdrfile/export': async (b) => { const r = rdrfile.exportSite(String(b.id || ''), { overwrite: !!b.overwrite }); return { ok: true, file: r.file, spec: r.spec }; },
  // ----- ferramentas do projeto: atalhos, scripts, auditoria e .env -----
  'GET /api/dev/info': async (_, q) => { const s = devSite(q.get('id')); return { ...devtools.info(s), scripts: scripts.list(s), env: envfile.summary(s) }; },
  'POST /api/dev/open': async (b) => { devtools.open(devSite(b.id), String(b.what || ''), String(b.editor || '')); return ok(); },
  'POST /api/scripts/run': async (b) => {
    const s = devSite(b.id); const kind = String(b.kind || ''); const name = String(b.name || '');
    scripts.resolve(s, kind, name); // recusa na hora (400) script que não existe ou que não termina
    startJob(`Script ${kind} ${name} — ${s.name}`, (jl) => scripts.run(s, kind, name, jl), 'scripts:' + s.id); return ok();
  },
  'POST /api/scripts/audit': async (b) => { const s = devSite(b.id); startJob(`Auditoria de segurança — ${s.name}`, (jl) => scripts.audit(s, jl), 'scripts:' + s.id); return ok(); },
  'GET /api/env': async (_, q) => envfile.compare(devSite(q.get('id'))),
  'POST /api/env/set': async (b) => { envfile.set(devSite(b.id), String(b.key || ''), b.value === undefined || b.value === null ? '' : String(b.value)); return ok(); },
  'POST /api/env/add-missing': async (b) => ({ ok: true, added: envfile.addMissing(devSite(b.id), Array.isArray(b.keys) ? b.keys.map(String).slice(0, 200) : null) }),
  'POST /api/env/init': async (b) => { envfile.init(devSite(b.id)); return ok(); },
  // ----- plano do projeto: especificação, tarefas e diário (arquivos de docs/) -----
  'GET /api/plan': async (_, q) => plan.get(devSite(q.get('id'))),
  'GET /api/plan/overview': async () => ({ projects: plan.overview(cfg.sites) }),
  'GET /api/plan/file': async (_, q) => plan.file(devSite(q.get('id')), String(q.get('kind') || '')),
  'POST /api/plan/init': async (b) => ({ ok: true, created: plan.init(devSite(b.id)) }),
  'POST /api/plan/task': async (b) => { plan.setState(devSite(b.id), b.line, b.expect, String(b.state)); return ok(); },
  'POST /api/plan/add-task': async (b) => { plan.addTask(devSite(b.id), b.phase, b.text); return ok(); },
  'POST /api/plan/diary': async (b) => { plan.addDiary(devSite(b.id), b.text); return ok(); },
  'GET /api/import/sources': async () => ({ sources: importer.sources() }),
  'POST /api/import/scan': async (b) => ({ list: importer.scan({ kind: String(b.kind || ''), path: String(b.path || '') }) }),
  'GET /api/dbimport/ports': async () => ({ ports: await dbimport.detectPorts() }),
  'POST /api/dbimport/probe': async (b) => dbimport.probe(b),
  'POST /api/dbimport/run': async (b) => {
    const conn = dbimport.cleanConn(b); if (!services.isRunning('mariadb')) throw new Error('Inicie o MariaDB do RDR Local antes de importar.');
    const items = (Array.isArray(b.items) ? b.items : []).slice(0, 50).map((i) => ({ name: String(i.name || ''), target: String(i.target || i.name || ''), overwrite: !!i.overwrite }));
    if (!items.length) throw new Error('Marque ao menos um banco.');
    startJob(`Importar ${items.length} banco(s) da origem (porta ${conn.port})`, (jl) => dbimport.importDbs(conn, items, jl), 'db'); return ok();
  },
  'GET /api/ftp': async () => ftp.lists(),
  'POST /api/ftp/save': async (b) => ftp.save(b),
  'POST /api/ftp/remove': async (b) => { ftp.remove(String(b.id)); return ok(); },
  'POST /api/ftp/test': async (b) => ftp.test(String(b.id)),
  'POST /api/ftp/plan': async (b) => ftp.plan(String(b.id)),
  'POST /api/ftp/baseline': async (b) => ftp.baseline(String(b.id)),
  'POST /api/ftp/publish': async (b) => {
    const id = String(b.id); const t = (ftp.lists().targets || []).find((x) => x.id === id); if (!t) throw new Error('Destino não encontrado.');
    startJob(`Publicar ${t.name}`, (jl) => ftp.publish(id, jl, { confirmFirst: !!b.confirmFirst, deleteRemoved: !!b.deleteRemoved }), 'deploy'); return ok();
  },
  'GET /api/deploy': async () => deploy.lists(),
  'POST /api/deploy/key/generate': async (b) => deploy.generateKey(b.label),
  'POST /api/deploy/key/import': async (b) => deploy.addKey(b.label, b.privateKey),
  'POST /api/deploy/key/remove': async (b) => { deploy.removeKey(String(b.id)); return ok(); },
  'POST /api/deploy/server/save': async (b) => deploy.saveServer(b),
  'POST /api/deploy/server/remove': async (b) => { deploy.removeServer(String(b.id)); return ok(); },
  'POST /api/deploy/server/probe': async (b) => deploy.probeHost(String(b.id)),
  'POST /api/deploy/server/trust': async (b) => deploy.trustHost(String(b.id), b.fingerprint),
  'POST /api/deploy/server/test': async (b) => deploy.testServer(String(b.id)),
  'POST /api/deploy/recipe/save': async (b) => { deploy.saveRecipe(b); return ok(); },
  'POST /api/deploy/recipe/remove': async (b) => { deploy.removeRecipe(String(b.id)); return ok(); },
  'POST /api/deploy/recipe/precheck': async (b) => deploy.precheck(String(b.id)),
  'POST /api/deploy/recipe/publish': async (b) => {
    const id = String(b.id); const pre = await deploy.precheck(id);
    if (!pre.canPublish && !b.force) throw new Error('Há verificações reprovadas. Corrija ou confirme "publicar mesmo assim".');
    const r = cfg.recipes.find((x) => x.id === id);
    startJob(`Publicar ${r.name}`, (jl) => deploy.publish(id, jl, { force: !!b.force }), 'deploy'); return ok();
  },
  'POST /api/deploy/recipe/rollback': async (b) => {
    const id = String(b.id); const r = cfg.recipes.find((x) => x.id === id); if (!r) throw new Error('Receita não encontrada.');
    if (!(r.rollback || []).length) throw new Error('Esta receita não tem comandos de reversão.');
    startJob(`Reverter ${r.name}`, (jl) => deploy.rollback(id, jl), 'deploy'); return ok();
  },
  'POST /api/import/run': async (b) => importer.importSites({ kind: String(b.kind || ''), path: String(b.path || '') }, Array.isArray(b.keys) ? b.keys.map(String).slice(0, 200) : []),
  'POST /api/scan': async (b) => ({ added: await sites.scan(String(b.root || '').trim()) }),
  'POST /api/project': async (b) => { projects.create(b); return ok(); },
  'POST /api/db/create': async (b) => { await db.create(b.engine, b.name); return ok(); },
  'POST /api/db/drop': async (b) => {
    if (b.confirm !== b.name) throw new Error('Confirmação não confere com o nome do banco.');
    const saved = await db.drop(b.engine, b.name); return { ok: true, backup: saved };
  },
  'POST /api/doctor/fix': async (b) => ({ ok: true, message: await doctor.fix(b.action) }),
  'POST /api/db/backup': async (b) => {
    db.assertName(b.name);
    startJob(`Backup do banco ${b.name}`, (jl) => backup.dump(b.engine, b.name, jl), 'db'); return ok();
  },
  // ----- backup na nuvem (rclone) e avisos -----
  'GET /api/cloud': async () => ({ ...(await cloud.summary()), notify: { onFail: cfg.notify.onFail, onOk: cfg.notify.onOk, telegramChatId: cfg.notify.telegramChatId, telegram: !!secrets.get('telegramToken'), webhook: !!secrets.get('webhookUrl') } }),
  'POST /api/cloud/connect': async (b) => { startJob(`Conectar destino ${String(b.name || '').slice(0, 31)}`, (jl) => cloud.connect(b, jl), 'cloud'); return ok(); },
  'POST /api/cloud/remove': async (b) => { await cloud.removeRemote(b.name); return ok(); },
  'POST /api/cloud/settings': async (b) => { await cloud.setSettings(b); return ok(); },
  'POST /api/cloud/encryption': async (b) => { if (b.disable) await cloud.disableEncryption(); else await cloud.enableEncryption(b.passphrase); return ok(); },
  'POST /api/cloud/test': async () => { startJob('Testar destino na nuvem', (jl) => cloud.test(jl), 'cloud'); return ok(); },
  'POST /api/cloud/upload': async () => { startJob('Enviar backups para a nuvem', (jl) => cloud.sync(jl), 'cloud'); return ok(); },
  'POST /api/cloud/verify': async () => { startJob('Testar restauração do backup na nuvem', (jl) => cloud.verify(jl), 'cloud'); return ok(); },
  'GET /api/github': async () => github.summary(),
  'POST /api/github/config': async (b) => { github.setConfig(b); return ok(); },
  'POST /api/github/device-start': async () => github.deviceStart(),
  'POST /api/github/device-poll': async () => github.deviceCheck(),
  'POST /api/github/token': async (b) => { await github.setToken(b.token); return ok(); },
  'POST /api/github/disconnect': async () => { github.disconnect(); return ok(); },
  'GET /api/github/repos': async (b, q) => ({ repos: await github.repos(q.get('q')) }),
  'POST /api/github/clone': async (b) => { startJob(`Clonar ${String(b.full || '').slice(0, 80)}`, (jl) => github.cloneToSite(b, jl), 'github'); return ok(); },
  'GET /api/git/status': async () => github.allStatus(),
  'POST /api/git/fetch': async (b) => { startJob('Git fetch', (jl) => github.fetchSite(b.id, jl), 'github'); return ok(); },
  'POST /api/git/pull': async (b) => { startJob('Git pull', (jl) => github.pullSite(b.id, jl), 'github'); return ok(); },
  'POST /api/notify/settings': async (b) => {
    if (b.telegramToken) { if (!notify.validToken(b.telegramToken)) throw new Error('Token do Telegram inválido (formato 123456:ABC...).'); secrets.set('telegramToken', String(b.telegramToken).trim()); }
    if (b.webhookUrl) { if (!notify.validUrl(b.webhookUrl)) throw new Error('URL do webhook inválida.'); secrets.set('webhookUrl', String(b.webhookUrl).trim()); }
    if (b.clearTelegram) { secrets.set('telegramToken', ''); cfg.notify.telegramChatId = ''; }
    if (b.clearWebhook) secrets.set('webhookUrl', '');
    if (b.telegramChatId !== undefined && !b.clearTelegram) { const id = String(b.telegramChatId).trim(); if (id && !/^-?\d{4,20}$/.test(id)) throw new Error('Chat ID do Telegram: só números.'); cfg.notify.telegramChatId = id; }
    if (b.onFail !== undefined) cfg.notify.onFail = !!b.onFail;
    if (b.onOk !== undefined) cfg.notify.onOk = !!b.onOk;
    core.save(); return ok();
  },
  'POST /api/notify/test': async () => { const r = await notify.send('RDR Local', 'Teste de aviso: está funcionando.'); if (!r.length) throw new Error('Nenhum canal configurado.'); const bad = r.filter((x) => !x.ok); if (bad.length) throw new Error(bad.map((x) => `${x.channel}: ${x.error}`).join('; ')); return ok(); },
  'POST /api/backup/schedule': async (b) => { backup.setSchedule(b); return ok(); },
  'POST /api/backup/run-all': async () => { startJob('Backup de todos os bancos', (jl) => backup.runAll(jl), 'db'); return ok(); },
  'GET /api/config/export': async () => ({
    rdrLocal: 1, exportedAt: new Date().toISOString(), tld: cfg.tld, projectsRoot: cfg.projectsRoot, phpDefault: cfg.phpDefault,
    dnsMode: !!cfg.dnsMode, projectDocs: cfg.projectDocs !== false, ports: cfg.ports, backup: { ...cfg.backup, last: 0, lastMsg: '' },
    sites: cfg.sites.map(({ name, path: p, domain, aliases, php, docroot, enabled, type, target, cors, env }) => ({ name, path: p, domain, aliases, php, docroot, enabled, type, target, cors, env })),
  }),
  'POST /api/config/import': async (b) => {
    const d = b.data; if (!d || d.rdrLocal !== 1 || !Array.isArray(d.sites)) throw new Error('Arquivo inválido: não é uma exportação do RDR Local.');
    if (d.tld && sites.TLDS.includes(d.tld)) cfg.tld = d.tld;
    if (typeof d.projectsRoot === 'string') cfg.projectsRoot = d.projectsRoot;
    if (typeof d.phpDefault === 'string') cfg.phpDefault = d.phpDefault;
    if (typeof d.projectDocs === 'boolean') cfg.projectDocs = d.projectDocs;
    if (d.ports && typeof d.ports === 'object') for (const [k, v] of Object.entries(d.ports)) { const n = Number(v); if (k in cfg.ports && Number.isInteger(n) && n > 0 && n < 65536) cfg.ports[k] = n; }
    if (d.backup) { try { backup.setSchedule(d.backup); } catch (_) { /* mantém */ } }
    if (typeof d.dnsMode === 'boolean' && d.dnsMode !== !!cfg.dnsMode) { cfg.dnsMode = d.dnsMode; save(); if (d.dnsMode) await services.start('dns').catch(() => {}); else await services.stop('dns').catch(() => {}); }
    save();
    let added = 0; const skipped = [];
    for (const s of d.sites) {
      try {
        if (cfg.sites.some((x) => x.domain === s.domain || (s.path && x.path === s.path))) { skipped.push(`${s.name || s.domain} (já existe)`); continue; }
        const created = await sites.add({ name: s.name, path: s.path, domain: s.domain, aliases: (s.aliases || []).join(','), php: s.php, docroot: s.docroot, type: s.type, target: s.target, cors: s.cors, env: s.env });
        if (s.enabled === false) await sites.toggle(created.id);
        added++;
      } catch (e) { skipped.push(`${s.name || s.domain}: ${e.message}`); }
    }
    save(); comps.ensureAllPhpIni(); await services.reloadWeb().catch(() => {});
    return { ok: true, added, skipped };
  },
  'POST /api/db/backup-delete': async (b) => { backup.remove(b.engine, b.file); return ok(); },
  'POST /api/db/restore': async (b) => {
    await backup.prepareRestore(b.engine, b.source, b.target, b.confirm);
    startJob(`Restaurar banco ${b.target}`, (jl) => backup.restore(b.engine, b.source, b.target, b.confirm, jl), 'db'); return ok();
  },
  'POST /api/trust': async () => { await services.trustCa(); return ok(); },
  'POST /api/settings': async (b) => {
    if (b.tld !== undefined) { if (!sites.TLDS.includes(b.tld)) throw new Error('Terminação inválida'); cfg.tld = b.tld; }
    if (b.dnsMode !== undefined) {
      const on = !!b.dnsMode;
      if (on !== !!cfg.dnsMode) {
        cfg.dnsMode = on; save();
        if (on) await services.start('dns'); else await services.stop('dns');
      }
    }
    if (b.autoStartServices !== undefined) cfg.autoStartServices = !!b.autoStartServices;
    if (b.projectDocs !== undefined) cfg.projectDocs = !!b.projectDocs;
    if (b.autoCheckUpdates !== undefined) cfg.autoCheckUpdates = !!b.autoCheckUpdates;
    if (b.projectsRoot !== undefined) cfg.projectsRoot = String(b.projectsRoot).trim();
    if (b.phpDefault !== undefined) { cfg.phpDefault = b.phpDefault; comps.writeShims(); }
    if (b.ports) {
      for (const [k, v] of Object.entries(b.ports)) {
        const n = Number(v);
        if (!(k in cfg.ports) || !Number.isInteger(n) || n < 1 || n > 65535) throw new Error('Porta inválida: ' + k);
        cfg.ports[k] = n;
      }
    }
    save(); comps.ensureAllPhpIni(); comps.ensureTools(); await services.reloadWeb().catch(() => {});
    return ok();
  },
};

const ALLOWED_HOSTS = new Set([`127.0.0.1:${PANEL_PORT}`, `localhost:${PANEL_PORT}`]);
// Endereço amigável (https://rdr-local-server.local) via Caddy; só vale se o Host for exatamente esse nome.
const hostOk = (h) => ALLOWED_HOSTS.has(h) || h === sites.panelDomain() || h === sites.panelDomain() + ':' + cfg.ports.https;

const server = http.createServer(async (req, res) => {
  // Anti DNS-rebinding e anti-CSRF: o painel mexe em hosts, processos e bancos.
  if (!hostOk(String(req.headers.host || '').toLowerCase())) { res.writeHead(403); return res.end('Forbidden'); }
  const url = new URL(req.url, 'http://x');

  if (req.method === 'GET' && !url.pathname.startsWith('/api/')) {
    const rel = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\/+/, '');
    const file = path.normalize(path.join(PUBLIC, rel));
    if (!file.startsWith(PUBLIC) || !exists(file) || isDir(file)) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    return res.end(fs.readFileSync(file));
  }
  const handler = routes[`${req.method} ${url.pathname}`];
  if (!handler) { res.writeHead(404); return res.end('{}'); }
  if (req.method === 'POST' && req.headers['x-rdr'] !== '1') { res.writeHead(403); return res.end('{}'); }

  let body = '';
  req.on('data', (c) => { body += c; if (body.length > 1e5) req.destroy(); });
  req.on('end', async () => {
    try {
      const out = await handler(body ? JSON.parse(body) : {}, url.searchParams);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(out));
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
  });
});

try { comps.writeShims(); comps.ensureAllPhpIni(); comps.ensureTools(); } catch (_) { /* sem PHP ainda */ }

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.log(`O RDR Local já está rodando (http://127.0.0.1:${PANEL_PORT}). Abrindo o painel...`);
    if (IS_WIN && !process.argv.includes('--no-open')) spawn('cmd', ['/c', 'start', '', `http://127.0.0.1:${PANEL_PORT}`], { windowsHide: true });
    process.exit(0);
  }
  console.error(e.message); process.exit(1);
});
server.listen(PANEL_PORT, '127.0.0.1', () => {
  backup.startScheduler();
  updates.startAuto();
  if (cfg.autoStartServices) setTimeout(() => services.all('start').catch((e) => log('Início automático dos serviços: ' + e.message.split('\n')[0])), 1500);
  log(`RDR Local em http://127.0.0.1:${PANEL_PORT}`);
  if (IS_WIN && !process.argv.includes('--no-open')) spawn('cmd', ['/c', 'start', '', `http://127.0.0.1:${PANEL_PORT}`], { windowsHide: true });
});

let closing = false;
const shutdown = async () => { if (closing) return; closing = true; procs.stopAll(); term.killAll(); await services.shutdownAll(); process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
