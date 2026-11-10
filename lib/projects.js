// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 RDR Digital - https://github.com/RDRdigitalFloripa/rdrlocalserver
'use strict';
/** Criação de projetos prontos: Laravel, WordPress ou pasta PHP vazia. */
const fs = require('fs');
const path = require('path');
const core = require('./core');
const comps = require('./components');
const services = require('./services');
const sites = require('./sites');
const db = require('./db');
const aifiles = require('./aifiles');
const { P, IS_WIN, cfg, exists, isDir, slug, runStreamed, startJob, download, unzip, get, run } = core;

// Starter kits: 'breeze' instala o pacote laravel/breeze com a stack; 'repo' usa o kit oficial como base do projeto.
const KITS = {
  'breeze-blade': { breeze: 'blade' }, 'breeze-livewire': { breeze: 'livewire' },
  'breeze-react': { breeze: 'react' }, 'breeze-vue': { breeze: 'vue' },
  'kit-livewire': { repo: 'laravel/livewire-starter-kit' },
  'kit-react': { repo: 'laravel/react-starter-kit' },
  'kit-vue': { repo: 'laravel/vue-starter-kit' },
};
const npm = (args, cwd, env, jl) => runStreamed('npm', args, jl, { cwd, env, shell: IS_WIN });

function patchEnv(file, vars) {
  let txt = fs.readFileSync(file, 'utf8');
  for (const [k, v] of Object.entries(vars)) {
    const re = new RegExp(`^#?\\s*${k}=.*$`, 'm');
    txt = re.test(txt) ? txt.replace(re, `${k}=${v}`) : txt.replace(/\s*$/, `\n${k}=${v}\n`);
  }
  fs.writeFileSync(file, txt);
}

async function maybeCreateDb(kind, dbName, jl) {
  if (!dbName || !kind) return false;
  const engine = kind === 'postgres' ? 'postgres' : 'mariadb';
  if (!services.isRunning(engine)) {
    jl(`Iniciando ${engine}...`);
    try { await services.start(engine); } catch (e) { jl(`⚠ Não consegui iniciar o ${engine}: ${e.message}`); return false; }
  }
  try { await db.create(engine, dbName); jl(`Banco "${dbName}" criado no ${engine}.`); return true; } catch (e) { jl(`⚠ Banco não criado: ${e.message}`); return false; }
}

function create({ type, name, dir, php, dbEngine, kit, domain: wantedDomain }) {
  const nm = String(name || '').trim();
  if (!nm) throw new Error('Informe o nome do projeto.');
  const folder = slug(nm);
  if (!folder) throw new Error('Nome inválido.');
  const root = String(dir || cfg.projectsRoot || '').trim();
  if (!root || !isDir(root)) throw new Error('Defina uma pasta raiz de projetos válida (Configurações ou campo "Pasta").');
  const target = path.join(root, folder);
  if (exists(target) && fs.readdirSync(target).length) throw new Error('A pasta já existe e não está vazia: ' + target);
  const ver = php && php !== 'default' ? php : comps.phpDefault();
  if (type !== 'empty' && !ver) throw new Error('Instale um PHP antes (aba Componentes).');
  const dbName = folder.replace(/-/g, '_');
  const domain = String(wantedDomain || '').trim().toLowerCase() || `${folder}.${cfg.tld}`;

  return startJob(`Novo projeto ${type}: ${nm}`, async (jl) => {
    const cli = comps.bins.phpCli(ver);
    const env = { ...sites.terminalEnv({ php: ver, path: target }) };
    let docDb = { engine: '', created: false }; // para o CLAUDE.md/AGENTS.md saberem qual banco o projeto usa
    if (type === 'laravel') {
      if (!comps.isInstalled.composer()) { jl('Instalando Composer...'); await comps.install('composer', jl); }
      const kitDef = KITS[kit || ''];
      const repo = (kitDef && kitDef.repo) || 'laravel/laravel';
      jl(`composer create-project ${repo} (pode levar alguns minutos)...`);
      await runStreamed(cli, [comps.bins.composerPhar(), 'create-project', repo, target, '--prefer-dist', '--no-interaction'], jl, { env });
      const created = await maybeCreateDb(dbEngine, dbName, jl);
      docDb = { engine: dbEngine || '', created };
      if (!dbEngine) jl('Sem banco selecionado: o .env mantém o padrão do Laravel (SQLite).');
      const envFile = path.join(target, '.env');
      if (exists(envFile)) {
        const vars = { APP_URL: sites.baseUrl(domain), APP_NAME: `"${nm.replace(/"/g, '')}"` };
        if (created) {
          const pgsql = dbEngine === 'postgres';
          Object.assign(vars, {
            DB_CONNECTION: pgsql ? 'pgsql' : 'mariadb', DB_HOST: '127.0.0.1', DB_PORT: String(pgsql ? cfg.ports.postgres : cfg.ports.mariadb),
            DB_DATABASE: dbName, DB_USERNAME: pgsql ? 'postgres' : 'root', DB_PASSWORD: '',
            MAIL_MAILER: 'smtp', MAIL_HOST: '127.0.0.1', MAIL_PORT: String(cfg.ports.mailpitSmtp),
          });
          if (comps.isInstalled.redis()) Object.assign(vars, { REDIS_HOST: '127.0.0.1', REDIS_PORT: String(cfg.ports.redis) });
        }
        patchEnv(envFile, vars);
        jl('.env ajustado (APP_URL, banco, e-mail).');
      }
      if (kitDef && kitDef.breeze) {
        jl(`Instalando Laravel Breeze (${kitDef.breeze})...`);
        await runStreamed(cli, [comps.bins.composerPhar(), 'require', 'laravel/breeze', '--dev', '--no-interaction'], jl, { cwd: target, env });
        await runStreamed(cli, ['artisan', 'breeze:install', kitDef.breeze, '--no-interaction'], jl, { cwd: target, env });
      } else if (kitDef && kitDef.repo) {
        jl('npm install (dependências do front-end)...');
        await npm(['install'], target, env, jl);
        jl('npm run build...');
        await npm(['run', 'build'], target, env, jl);
      }
      const v = await run(cli, ['artisan', '--version'], { cwd: target, env });
      if (v.ok) jl(`Instalado: ${v.out.split('\n')[0]} · PHP ${ver}`);
      if (created) {
        jl('Rodando php artisan migrate...');
        try { await runStreamed(cli, ['artisan', 'migrate', '--force', '--no-interaction'], jl, { cwd: target, env }); } catch (e) { jl('⚠ migrate falhou: ' + e.message); }
      }
    } else if (type === 'wordpress') {
      jl('Baixando WordPress (pt-BR)...');
      fs.mkdirSync(target, { recursive: true });
      const zip = path.join(P.data, 'wordpress.zip');
      await download('https://br.wordpress.org/latest-pt_BR.zip', zip, jl);
      const stage = path.join(P.data, 'wp-stage');
      await unzip(zip, stage); fs.unlinkSync(zip);
      for (const n of fs.readdirSync(stage)) fs.renameSync(path.join(stage, n), path.join(target, n));
      fs.rmSync(stage, { recursive: true, force: true });
      const wpEngine = dbEngine === '' ? '' : 'mariadb';
      docDb = { engine: wpEngine, created: await maybeCreateDb(wpEngine, dbName, jl) };
      jl(`Na instalação do WordPress use: banco "${dbName}", usuário "root", senha vazia, host 127.0.0.1:${cfg.ports.mariadb}.`);
    } else {
      fs.mkdirSync(target, { recursive: true });
      fs.writeFileSync(path.join(target, 'index.php'), `<?php\nphpinfo();\n`);
      jl('Pasta criada com index.php de teste.');
    }
    const made = aifiles.scaffold({ dir: target, name: nm, kind: type === 'laravel' || type === 'wordpress' ? type : 'php', domain, php: ver || 'sem PHP', kit, dbEngine: docDb.engine, dbName, dbCreated: docDb.created });
    if (made.length) jl(`Arquivos para agentes de IA e documentação: ${made.join(', ')}`);
    await sites.add({ name: nm, path: target, domain, php: ver || 'none' });
    jl(`Site pronto: ${sites.baseUrl(domain)}  (inicie o Servidor Web se ainda não estiver rodando)`);
  }, 'project');
}

module.exports = { create, maybeCreateDb, patchEnv };
