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
const rts = require('./runtimes');
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

// ---------- Tailwind CSS ----------
// O que cada tipo de projeto aceita. Sem o campo (API, scripts) nada muda: Laravel puro fica como sempre e a pasta PHP nasce sem Tailwind.
const TAILWIND = { laravel: ['install', 'none'], empty: ['none', 'cli', 'vite'] };
function tailwindChoice(type, kit, value) {
  const v = String(value || '').trim();
  if (!v || v === 'none') return 'none';
  const ok = TAILWIND[type];
  if (!ok) throw new Error('A opção de Tailwind CSS vale só para Laravel e para a pasta PHP vazia.');
  if (!ok.includes(v)) throw new Error(`Opção de Tailwind CSS inválida: "${v}" (use ${ok.join(', ')}).`);
  return type === 'laravel' && kit ? 'none' : v; // o starter kit já traz o Tailwind e roda o npm sozinho
}

/** O Vite 7 pede Node.js 20.19+ ou 22.12+. */
function nodeServes(full) {
  const maj = Number(String(full).split('.')[0]);
  return maj > 22 || (maj === 22 && rts.cmpVer(full, '22.12.0') >= 0) || (maj === 20 && rts.cmpVer(full, '20.19.0') >= 0);
}
/**
 * Garante um Node.js que sirva (o padrão do RDR Local, outro já instalado ou o do sistema) ou baixa o LTS mais novo.
 * Devolve o ambiente (com o PATH ajustado, se preciso) para rodar o npm.
 */
async function ensureNode(jl, env) {
  const sep = IS_WIN ? ';' : ':';
  const withNode = (v) => ({ ...env, PATH: rts.pathParts('node', v).join(sep) + sep + (env.PATH || '') });
  const usable = (v) => nodeServes(rts.fullVersion('node', v) || `${v}.0.0`);
  const def = rts.defaultVersion('node');
  if (def && usable(def)) return env; // o padrão já vai no PATH (sites.terminalEnv)
  const other = rts.installed('node').find(usable);
  if (other) { jl(`Usando o Node.js ${other} do RDR Local.`); return withNode(other); }
  if (!def) {
    const r = await run('node', ['--version'], { env });
    if (r.ok && nodeServes(r.out.trim().replace(/^v/, ''))) return env; // o Node.js do sistema serve
  }
  const want = await rts.pickVersion('node');
  jl(`Não há Node.js 20.19+ (ou 22.12+): baixando o Node.js ${want} (LTS)...`);
  await rts.install('node', jl, want);
  return withNode(want);
}

const phpStr = (s) => "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
/**
 * Arquivos de uma pasta PHP com Tailwind v4 ('cli' = compilador independente, 'vite' = Vite com Node.js).
 * Tudo que o navegador abre fica em public/ (src/, package.json e node_modules não ficam expostos).
 */
function tailwindFiles(mode, name, pkgName) {
  const vite = mode === 'vite';
  const how = vite ? '<code class="rounded bg-slate-200 px-1.5 py-0.5 text-sm">npm run dev</code>' : 'Processos &gt; Tailwind, no RDR Local';
  const files = {
    'src/input.css': '@import "tailwindcss";\n',
    'public/index.php': `<?php
$nome = ${phpStr(name)};
?>
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title><?= htmlspecialchars($nome, ENT_QUOTES, 'UTF-8') ?></title>
  <link rel="stylesheet" href="/dist/${vite ? 'assets/main.css' : 'output.css'}">
</head>
<body class="grid min-h-screen place-items-center bg-slate-50 text-slate-900">
  <main class="max-w-xl p-8 text-center">
    <h1 class="text-4xl font-bold tracking-tight"><?= htmlspecialchars($nome, ENT_QUOTES, 'UTF-8') ?></h1>
    <p class="mt-3 text-slate-600">Tailwind CSS funcionando. Edite <code class="rounded bg-slate-200 px-1.5 py-0.5 text-sm">public/index.php</code> e recompile o CSS (${how}).</p>
    <p class="mt-6 text-sm text-slate-500">PHP <?= PHP_VERSION ?></p>
  </main>${vite ? '\n  <script type="module" src="/dist/assets/main.js"></script>' : ''}
</body>
</html>
`,
  };
  if (vite) {
    files['package.json'] = JSON.stringify({
      name: pkgName, private: true, type: 'module',
      scripts: { dev: 'vite build --watch', build: 'vite build' },
      devDependencies: { '@tailwindcss/vite': '^4.0.0', tailwindcss: '^4.0.0', vite: '^7.0.0' },
    }, null, 2) + '\n';
    files['vite.config.js'] = `import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

// Compila src/main.js (que importa o CSS do Tailwind) para public/dist/assets/main.js e main.css, com nomes fixos para o PHP.
export default defineConfig({
  plugins: [tailwindcss()],
  publicDir: false, // a pasta public/ é a raiz do site (index.php), não arquivos estáticos para o Vite copiar
  build: {
    outDir: 'public/dist',
    emptyOutDir: true,
    rollupOptions: {
      input: 'src/main.js',
      output: { entryFileNames: 'assets/[name].js', chunkFileNames: 'assets/[name].js', assetFileNames: 'assets/[name][extname]' },
    },
  },
});
`;
    files['src/main.js'] = "import './input.css';\n";
    files['.gitignore'] = 'node_modules/\n';
  }
  return files;
}
function writeTailwindFiles(target, mode, name, pkgName) {
  for (const [rel, text] of Object.entries(tailwindFiles(mode, name, pkgName))) {
    const full = path.join(target, ...rel.split('/'));
    fs.mkdirSync(path.dirname(full), { recursive: true });
    if (!exists(full)) fs.writeFileSync(full, text);
  }
}

/** Laravel: o esqueleto 12+ já traz o Tailwind 4 no package.json; aqui só instala as dependências e compila. Não derruba a criação do site. */
async function laravelTailwind(target, env, jl) {
  jl('Tailwind CSS: o Laravel 12+ já inclui o Tailwind 4; instalando as dependências e compilando...');
  try {
    const e = await ensureNode(jl, env);
    jl('npm install (dependências do front-end)...');
    await npm(['install'], target, e, jl);
    let has = false;
    try { const pkg = JSON.parse(fs.readFileSync(path.join(target, 'package.json'), 'utf8')); has = !!({ ...pkg.dependencies, ...pkg.devDependencies }).tailwindcss; } catch (_) { /* sem package.json legível */ }
    jl('npm run build...');
    await npm(['run', 'build'], target, e, jl);
    if (has) jl('Tailwind CSS pronto. Para estilizar com recarga automática, use Processos > Vite no painel (npm run dev).');
    else jl('⚠ Este Laravel não traz o Tailwind no esqueleto (só o Laravel 12 ou mais novo, que pede PHP 8.2+). Foram instalados só o npm e o Vite.');
    return has ? 'laravel' : '';
  } catch (e) {
    jl(`⚠ O Tailwind CSS não ficou pronto: ${e.message}. O site foi criado; no Terminal do site rode "npm install" e "npm run build".`);
    return '';
  }
}

/** Pasta PHP: instala o que falta (compilador ou Node.js) e compila o CSS uma vez. Não derruba a criação do site. */
async function phpTailwindBuild(mode, target, env, jl) {
  try {
    if (mode === 'cli') {
      if (!comps.isInstalled.tailwindcss()) { jl('Instalando o Tailwind CSS (compilador independente)...'); await comps.install('tailwindcss', jl); }
      jl('Compilando o CSS: tailwindcss -i src/input.css -o public/dist/output.css');
      await runStreamed(comps.bins.tailwind(), ['-i', 'src/input.css', '-o', 'public/dist/output.css'], jl, { cwd: target, env });
    } else {
      const e = await ensureNode(jl, env);
      jl('npm install (Tailwind, Vite)...');
      await npm(['install'], target, e, jl);
      jl('npm run build...');
      await npm(['run', 'build'], target, e, jl);
    }
    jl('Tailwind CSS pronto.');
  } catch (e) {
    jl(`⚠ O CSS do Tailwind ainda não foi compilado: ${e.message}. O site foi criado; depois, ${mode === 'cli' ? 'instale o Tailwind CSS em Componentes e use Processos > Tailwind' : 'no Terminal do site rode "npm install" e "npm run build"'}.`);
  }
}

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

function create({ type, name, dir, php, dbEngine, kit, tailwind, domain: wantedDomain }) {
  const nm = String(name || '').trim();
  if (!nm) throw new Error('Informe o nome do projeto.');
  const folder = slug(nm);
  if (!folder) throw new Error('Nome inválido.');
  const tw = tailwindChoice(type, kit, tailwind); // valida já: um pedido inválido não cria nada
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
    let env = { ...sites.terminalEnv({ php: ver, path: target }) };
    let twDoc = ''; // o que os arquivos para agentes de IA dizem sobre o Tailwind: 'laravel' | 'cli' | 'vite'
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
      if (kitDef) { try { env = await ensureNode(jl, env); } catch (e) { jl(`⚠ Não consegui garantir o Node.js: ${e.message}`); } }
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
      if (tw === 'install') twDoc = await laravelTailwind(target, env, jl);
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
    } else if (tw !== 'none') {
      fs.mkdirSync(target, { recursive: true });
      writeTailwindFiles(target, tw, nm, folder);
      jl('Pasta criada com src/input.css e public/index.php de exemplo (o site abre a pasta public/).');
      twDoc = tw;
      await phpTailwindBuild(tw, target, env, jl);
    } else {
      fs.mkdirSync(target, { recursive: true });
      fs.writeFileSync(path.join(target, 'index.php'), `<?php\nphpinfo();\n`);
      jl('Pasta criada com index.php de teste.');
    }
    const made = aifiles.scaffold({ dir: target, name: nm, kind: type === 'laravel' || type === 'wordpress' ? type : 'php', domain, php: ver || 'sem PHP', kit, dbEngine: docDb.engine, dbName, dbCreated: docDb.created, tailwind: twDoc });
    if (made.length) jl(`Arquivos para agentes de IA e documentação: ${made.join(', ')}`);
    await sites.add({ name: nm, path: target, domain, php: ver || 'none' });
    jl(`Site pronto: ${sites.baseUrl(domain)}  (inicie o Servidor Web se ainda não estiver rodando)`);
  }, 'project');
}

module.exports = { create, maybeCreateDb, patchEnv, TAILWIND, tailwindChoice, tailwindFiles, nodeServes, laravelTailwind };
