// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 RDR Digital - https://github.com/RDRdigitalFloripa/rdrlocalserver
'use strict';
/**
 * Apps (Node.js, Python e comandos próprios como Go/Java): o RDR Local sobe o processo com a variável PORT,
 * o Caddy põe HTTPS na frente (https://app.test -> 127.0.0.1:PORT), o log fica em logs/app-<id>.log
 * e, se o app cair sozinho, ele é religado (com limite para não ficar em laço).
 */
const fs = require('fs');
const path = require('path');
const core = require('./core');
const rts = require('./runtimes');
const sites = require('./sites');
const { P, IS_WIN, cfg, log, exists, isDir, spawnLogged, killTree, tail, portFree, runStreamed, sleep } = core;

const state = new Map(); // siteId -> { child, desired, restarts: [t], gaveUp, startedAt }
const RANGE = [9300, 9999];

const site = (id) => { const s = cfg.sites.find((x) => x.id === id && x.type === 'app'); if (!s) throw new Error('App não encontrado'); return s; };
const logName = (id) => `app-${id}`;
const alive = (c) => !!c && c.exitCode === null && c.signalCode === null;

/** Próxima porta livre da faixa 9300-9999 (não usada por outro app). */
function allocPort() {
  const used = new Set(cfg.sites.filter((s) => s.type === 'app' && s.appPort).map((s) => s.appPort));
  for (let p = RANGE[0]; p <= RANGE[1]; p++) if (!used.has(p)) return p;
  throw new Error('Sem porta livre para apps (9300-9999).');
}

/** PATH/variáveis do app: runtime escolhido + variáveis do site + PORT. */
function envFor(s) {
  const base = sites.terminalEnv(s);
  const extra = {};
  if (s.runtime === 'python') {
    Object.assign(extra, { PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8' });
    const venv = path.join(s.path, '.venv'); if (isDir(venv)) extra.VIRTUAL_ENV = venv;
  }
  if (s.runtime === 'go') {
    const v = rts.resolve('go', s.rtVersion);
    if (v) Object.assign(extra, { GOROOT: rts.rtDir('go', v), GOPATH: path.join(P.root, 'data', 'gopath'), GOTELEMETRY: 'off' });
  }
  if (s.runtime === 'java') {
    const v = rts.resolve('java', s.rtVersion);
    if (v) extra.JAVA_HOME = rts.rtDir('java', v);
    // Spring Boot, Quarkus e Micronaut leem estas variáveis sozinhos
    Object.assign(extra, { SERVER_PORT: String(s.appPort), SERVER_ADDRESS: '127.0.0.1', QUARKUS_HTTP_PORT: String(s.appPort), QUARKUS_HTTP_HOST: '127.0.0.1', MICRONAUT_SERVER_PORT: String(s.appPort) });
  }
  if (s.runtime === 'node') Object.assign(extra, { FORCE_COLOR: '0', NODE_ENV: (s.env && s.env.NODE_ENV) || 'development' });
  return { ...base, ...extra, HOST: '127.0.0.1', PORT: String(s.appPort), RDR_APP_URL: sites.baseUrl(s.domain) };
}
const expand = (s) => String(s.cmd || '').replace(/\{PORT\}/g, String(s.appPort)).replace(/\{HOST\}/g, '127.0.0.1');

function runtimeProblem(s) {
  if (s.runtime === 'custom') return '';
  if (!rts.resolve(s.runtime, s.rtVersion)) return `${rts.KINDS[s.runtime].label} não está instalado (aba Componentes e PHP > Linguagens).`;
  return '';
}

async function start(id, { manual = true } = {}) {
  const s = site(id);
  const st = state.get(id) || { restarts: [] }; state.set(id, st);
  if (alive(st.child)) return;
  if (s.enabled === false) throw new Error('O site está desativado.');
  if (!isDir(s.path)) throw new Error('A pasta do app não existe: ' + s.path);
  if (!String(s.cmd || '').trim()) throw new Error('Defina o comando de início do app (Editar).');
  const prob = runtimeProblem(s); if (prob) throw new Error(prob);
  if (!(await portFree(s.appPort))) throw new Error(`A porta ${s.appPort} já está em uso. Feche o programa que a usa ou edite o app para outra porta.`);
  if (manual) { st.restarts = []; st.gaveUp = false; }
  st.desired = true;
  const child = spawnLogged(logName(id), expand(s), [], { cwd: s.path, env: envFor(s), shell: true, detached: true });
  st.child = child; st.startedAt = Date.now();
  log(`App ${s.name} iniciado na porta ${s.appPort}.`);
  child.on('exit', (code) => {
    if (state.get(id) && state.get(id).child !== child) return;
    log(`App ${s.name} encerrou (código ${code}).`);
    const cur = cfg.sites.find((x) => x.id === id);
    if (!st.desired || !cur || cur.enabled === false) return;
    const now = Date.now();
    st.restarts = st.restarts.filter((t) => now - t < 60000).concat(now);
    if (st.restarts.length > 4) { st.gaveUp = true; log(`App ${s.name}: caiu 5 vezes em 1 minuto, parei de religar. Veja o log.`); return; }
    setTimeout(() => { if (st.desired) start(id, { manual: false }).catch((e) => log(`App ${s.name}: ${e.message}`)); }, 1500);
  });
}

async function stop(id) {
  const st = state.get(id); if (!st) return;
  st.desired = false;
  const c = st.child; if (!alive(c)) return;
  killTree(c);
  for (let i = 0; i < 20 && alive(c); i++) await sleep(150);
}
async function restart(id) { await stop(id); await sleep(300); await start(id); }

const status = (id) => {
  const st = state.get(id); const s = cfg.sites.find((x) => x.id === id);
  return { running: alive(st && st.child), port: s && s.appPort, gaveUp: !!(st && st.gaveUp), restarts: st ? st.restarts.length : 0, startedAt: st && st.startedAt || 0 };
};
const anyRunning = () => [...state.values()].some((st) => alive(st.child));

/** Liga todos os apps ativos (chamado quando o Servidor Web sobe). */
async function startAll() {
  for (const s of cfg.sites.filter((x) => x.type === 'app' && x.enabled !== false && x.autoStart !== false)) {
    try { await start(s.id, { manual: true }); } catch (e) { log(`App ${s.name}: ${e.message}`); }
  }
}
async function stopAll() { await Promise.all([...state.keys()].map((id) => stop(id))); }
/** Para os apps que usam uma versão de runtime (antes de atualizar/remover). Devolve os ids parados. */
async function stopUsing(rt, ver) {
  const ids = rts.usedBy(rt, ver).filter((s) => status(s.id).running).map((s) => s.id);
  for (const id of ids) await stop(id);
  return ids;
}
const logTail = (id) => { site(id); return tail(path.join(P.logs, logName(id) + '.log'), 40000) || '(o app ainda não escreveu nada no log)'; };

// ---------- detecção, dependências e modelos ----------
function readJson(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (_) { return null; } }
/** Sugere linguagem e comando de início olhando a pasta. */
function detect(dir) {
  if (!dir || !isDir(dir)) return null;
  const pkg = readJson(path.join(dir, 'package.json'));
  if (pkg) {
    const sc = pkg.scripts || {};
    const cmd = sc.dev ? 'npm run dev' : sc.start ? 'npm start' : exists(path.join(dir, 'server.js')) ? 'node server.js' : exists(path.join(dir, 'index.js')) ? 'node index.js' : 'npm start';
    const dep = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    if (dep.next) return { runtime: 'node', cmd: 'npx next dev -H 127.0.0.1 -p {PORT}', note: 'Next.js' };
    if (dep.vite && !dep.next) return { runtime: 'node', cmd: 'npm run dev', note: 'Vite (confira se o vite.config permite o domínio: server.allowedHosts)' };
    if (dep.tsx || dep['ts-node'] || dep.typescript) return { runtime: 'node', cmd, note: 'TypeScript (package.json encontrado)' };
    return { runtime: 'node', cmd, note: 'package.json encontrado' };
  }
  const has = (f) => exists(path.join(dir, f));
  if (has('manage.py')) return { runtime: 'python', cmd: 'python manage.py runserver 127.0.0.1:{PORT}', note: 'Django' };
  const read = (f) => { try { return fs.readFileSync(path.join(dir, f), 'utf8').toLowerCase(); } catch (_) { return ''; } };
  const deps = read('requirements.txt') + read('pyproject.toml');
  if (/fastapi|uvicorn/.test(deps)) { const mod = has('main.py') ? 'main' : has('app.py') ? 'app' : 'main'; return { runtime: 'python', cmd: `python -m uvicorn ${mod}:app --reload --host 127.0.0.1 --port {PORT}`, note: 'FastAPI' }; }
  if (/flask/.test(deps)) return { runtime: 'python', cmd: 'python -m flask --app app run --debug --host 127.0.0.1 --port {PORT}', note: 'Flask' };
  if (has('main.py') || has('app.py')) return { runtime: 'python', cmd: `python ${has('main.py') ? 'main.py' : 'app.py'}`, note: 'script Python (use a variável PORT)' };
  if (has('go.mod')) return { runtime: 'go', cmd: 'go run .', note: 'Go' };
  if (has('mvnw.cmd') || has('mvnw')) return { runtime: 'java', cmd: IS_WIN ? 'mvnw.cmd spring-boot:run' : './mvnw spring-boot:run', note: 'Java (Maven wrapper)' };
  if (has('pom.xml')) return { runtime: 'java', cmd: 'mvn spring-boot:run', note: 'Java (Maven: instale o Maven ou adicione o mvnw)' };
  if (has('gradlew.bat') || has('gradlew')) return { runtime: 'java', cmd: IS_WIN ? 'gradlew.bat bootRun' : './gradlew bootRun', note: 'Java (Gradle wrapper)' };
  return null;
}

/** Instala dependências: npm install ou venv + pip install. */
async function installDeps(s, jl) {
  const env = envFor(s); const opts = { cwd: s.path, env, shell: true };
  if (s.runtime === 'node') {
    if (!exists(path.join(s.path, 'package.json'))) throw new Error('Sem package.json nesta pasta.');
    if (!rts.resolve('node', s.rtVersion)) throw new Error('Node.js não está instalado (Componentes e PHP > Linguagens).');
    jl('> npm install'); await runStreamed('npm install --no-fund --no-audit', [], jl, opts); return;
  }
  if (s.runtime === 'python') {
    const v = rts.resolve('python', s.rtVersion); if (!v) throw new Error('Python não está instalado (Componentes e PHP > Linguagens).');
    if (!isDir(path.join(s.path, '.venv'))) { jl('> python -m venv .venv'); await runStreamed(rts.exe('python', v), ['-m', 'venv', '.venv'], jl, { cwd: s.path, env: process.env }); }
    const env2 = envFor(s); // agora com o venv no PATH
    if (exists(path.join(s.path, 'requirements.txt'))) { jl('> pip install -r requirements.txt'); await runStreamed('python -m pip install -r requirements.txt', [], jl, { cwd: s.path, env: env2, shell: true }); }
    else if (exists(path.join(s.path, 'pyproject.toml'))) { jl('> pip install -e .'); await runStreamed('python -m pip install -e .', [], jl, { cwd: s.path, env: env2, shell: true }); }
    else jl('Sem requirements.txt: nada para instalar.');
    return;
  }
  if (s.runtime === 'go') {
    if (!rts.resolve('go', s.rtVersion)) throw new Error('Go não está instalado (Componentes e PHP > Linguagens).');
    if (!exists(path.join(s.path, 'go.mod'))) { jl('Sem go.mod: nada para baixar.'); return; }
    jl('> go mod download'); await runStreamed('go mod download', [], jl, opts); return;
  }
  if (s.runtime === 'java') {
    if (!rts.resolve('java', s.rtVersion)) throw new Error('JDK não está instalado (Componentes e PHP > Linguagens).');
    jl('Java/Maven/Gradle baixam as dependências na primeira execução (pode demorar no primeiro start).'); return;
  }
  jl('Apps com comando próprio gerenciam suas próprias dependências.');
}

const pkgName = (n) => path.basename(String(n)).toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '') || 'app';
const T = {
  'node-express': {
    label: 'Node.js — Express', runtime: 'node', cmd: 'npm run dev',
    files: (n) => ({
      'package.json': JSON.stringify({ name: path.basename(n).toLowerCase().replace(/[^a-z0-9-]/g, '-'), version: '1.0.0', private: true, scripts: { start: 'node server.js', dev: 'node --watch server.js' }, dependencies: { express: '^4.21.0' } }, null, 2) + '\n',
      'server.js': `const express = require('express');\nconst app = express();\nconst port = process.env.PORT || 3000;\n\napp.use(express.json());\n\napp.get('/', (req, res) => {\n  res.send('<h1>Olá do RDR Local!</h1><p>Node.js ' + process.version + ' rodando com HTTPS.</p>');\n});\n\napp.get('/api/health', (req, res) => res.json({ ok: true, node: process.version }));\n\napp.listen(port, '127.0.0.1', () => console.log('Servidor na porta ' + port));\n`,
      '.gitignore': 'node_modules\n.env\n',
    }),
  },
  'node-fastify': {
    label: 'Node.js — Fastify', runtime: 'node', cmd: 'npm run dev',
    files: (n) => ({
      'package.json': JSON.stringify({ name: path.basename(n).toLowerCase().replace(/[^a-z0-9-]/g, '-'), version: '1.0.0', private: true, scripts: { start: 'node server.js', dev: 'node --watch server.js' }, dependencies: { fastify: '^5.0.0' } }, null, 2) + '\n',
      'server.js': `const fastify = require('fastify')({ logger: true });\n\nfastify.get('/', async () => ({ ola: 'RDR Local', node: process.version }));\nfastify.get('/api/health', async () => ({ ok: true }));\n\nfastify.listen({ port: Number(process.env.PORT || 3000), host: '127.0.0.1' }).catch((e) => { fastify.log.error(e); process.exit(1); });\n`,
      '.gitignore': 'node_modules\n.env\n',
    }),
  },
  'python-fastapi': {
    label: 'Python — FastAPI', runtime: 'python', cmd: 'python -m uvicorn main:app --reload --host 127.0.0.1 --port {PORT}',
    files: () => ({
      'requirements.txt': 'fastapi>=0.110\nuvicorn[standard]>=0.29\n',
      'main.py': `from fastapi import FastAPI\nfrom fastapi.responses import HTMLResponse\nimport sys\n\napp = FastAPI(title="RDR Local")\n\n\n@app.get("/", response_class=HTMLResponse)\ndef home():\n    return f"<h1>Olá do RDR Local!</h1><p>Python {sys.version.split()[0]} + FastAPI com HTTPS. Docs em <a href='/docs'>/docs</a>.</p>"\n\n\n@app.get("/api/health")\ndef health():\n    return {"ok": True}\n`,
      '.gitignore': '.venv/\n__pycache__/\n.env\n',
    }),
  },
  'python-flask': {
    label: 'Python — Flask', runtime: 'python', cmd: 'python -m flask --app app run --debug --host 127.0.0.1 --port {PORT}',
    files: () => ({
      'requirements.txt': 'flask>=3.0\n',
      'app.py': `from flask import Flask, jsonify\nimport sys\n\napp = Flask(__name__)\n\n\n@app.route("/")\ndef home():\n    return f"<h1>Olá do RDR Local!</h1><p>Python {sys.version.split()[0]} + Flask com HTTPS.</p>"\n\n\n@app.route("/api/health")\ndef health():\n    return jsonify(ok=True)\n`,
      '.gitignore': '.venv/\n__pycache__/\n.env\n',
    }),
  },
  'python-django': {
    label: 'Python — Django', runtime: 'python', cmd: 'python manage.py runserver 127.0.0.1:{PORT}', django: true,
    files: () => ({ 'requirements.txt': 'django>=5.0\n', '.gitignore': '.venv/\n__pycache__/\ndb.sqlite3\n.env\n' }),
  },
  'node-express-ts': {
    label: 'TypeScript — Express (tsx)', runtime: 'node', cmd: 'npm run dev',
    files: (n) => ({
      'package.json': JSON.stringify({ name: pkgName(n), version: '1.0.0', private: true, type: 'module', scripts: { dev: 'tsx watch src/server.ts', build: 'tsc', start: 'node dist/server.js' }, dependencies: { express: '^4.21.0' }, devDependencies: { '@types/express': '^4.17.21', '@types/node': '^22.0.0', tsx: '^4.19.0', typescript: '^5.6.0' } }, null, 2) + '\n',
      'tsconfig.json': JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', outDir: 'dist', rootDir: 'src', strict: true, esModuleInterop: true, skipLibCheck: true } }, null, 2) + '\n',
      'src/server.ts': `import express from 'express';\n\nconst app = express();\nconst port = Number(process.env.PORT ?? 3000);\n\napp.use(express.json());\n\napp.get('/', (_req, res) => {\n  res.send(\`<h1>Olá do RDR Local!</h1><p>TypeScript + Express em Node.js \${process.version}, com HTTPS.</p>\`);\n});\n\napp.get('/api/health', (_req, res) => res.json({ ok: true }));\n\napp.listen(port, '127.0.0.1', () => console.log(\`Servidor na porta \${port}\`));\n`,
      '.gitignore': 'node_modules\ndist\n.env\n',
    }),
  },
  'vite-react-ts': {
    label: 'Vite — React + TypeScript', runtime: 'node', cmd: 'npm run dev',
    files: (n) => ({
      'package.json': JSON.stringify({ name: pkgName(n), version: '1.0.0', private: true, type: 'module', scripts: { dev: 'vite', build: 'tsc -b && vite build', preview: 'vite preview' }, dependencies: { react: '^18.3.1', 'react-dom': '^18.3.1' }, devDependencies: { '@types/node': '^22.0.0', '@types/react': '^18.3.0', '@types/react-dom': '^18.3.0', '@vitejs/plugin-react': '^4.3.0', typescript: '^5.6.0', vite: '^5.4.0' } }, null, 2) + '\n',
      'vite.config.ts': `import { defineConfig } from 'vite';\nimport react from '@vitejs/plugin-react';\n\n// O RDR Local define PORT e põe HTTPS na frente (Caddy). allowedHosts libera o domínio local.\nexport default defineConfig({\n  plugins: [react()],\n  server: {\n    host: '127.0.0.1',\n    port: Number(process.env.PORT ?? 5173),\n    strictPort: true,\n    allowedHosts: true,\n    hmr: { protocol: 'wss', clientPort: 443 },\n  },\n});\n`,
      'tsconfig.json': JSON.stringify({ compilerOptions: { target: 'ES2020', lib: ['ES2020', 'DOM', 'DOM.Iterable'], module: 'ESNext', moduleResolution: 'bundler', jsx: 'react-jsx', strict: true, skipLibCheck: true, noEmit: true }, include: ['src', 'vite.config.ts'] }, null, 2) + '\n',
      'index.html': '<!doctype html>\n<html lang="pt-BR">\n  <head>\n    <meta charset="UTF-8" />\n    <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n    <title>RDR Local — Vite</title>\n  </head>\n  <body>\n    <div id="root"></div>\n    <script type="module" src="/src/main.tsx"></script>\n  </body>\n</html>\n',
      'src/main.tsx': `import React from 'react';\nimport ReactDOM from 'react-dom/client';\nimport App from './App';\n\nReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);\n`,
      'src/App.tsx': `import { useState } from 'react';\n\nexport default function App() {\n  const [n, setN] = useState(0);\n  return (\n    <main style={{ fontFamily: 'system-ui', padding: 32 }}>\n      <h1>Olá do RDR Local!</h1>\n      <p>React + TypeScript + Vite com HTTPS.</p>\n      <button onClick={() => setN(n + 1)}>Cliques: {n}</button>\n    </main>\n  );\n}\n`,
      '.gitignore': 'node_modules\ndist\n.env\n',
    }),
  },
  'nextjs': {
    label: 'Next.js (TypeScript)', runtime: 'node', cmd: 'npx next dev -H 127.0.0.1 -p {PORT}',
    files: (n, name) => ({
      'package.json': JSON.stringify({ name: pkgName(n), version: '1.0.0', private: true, scripts: { dev: 'next dev -H 127.0.0.1', build: 'next build', start: 'next start -H 127.0.0.1' }, dependencies: { next: '^15.0.0', react: '^19.0.0', 'react-dom': '^19.0.0' }, devDependencies: { '@types/node': '^22.0.0', '@types/react': '^19.0.0', '@types/react-dom': '^19.0.0', typescript: '^5.6.0' } }, null, 2) + '\n',
      'tsconfig.json': JSON.stringify({ compilerOptions: { target: 'ES2017', lib: ['dom', 'dom.iterable', 'esnext'], allowJs: true, skipLibCheck: true, strict: true, noEmit: true, esModuleInterop: true, module: 'esnext', moduleResolution: 'bundler', resolveJsonModule: true, isolatedModules: true, jsx: 'preserve', incremental: true, plugins: [{ name: 'next' }] }, include: ['next-env.d.ts', '**/*.ts', '**/*.tsx'], exclude: ['node_modules'] }, null, 2) + '\n',
      'next.config.mjs': `/** @type {import('next').NextConfig} */\n// allowedDevOrigins: libera o domínio local do RDR Local durante o desenvolvimento.\nconst nextConfig = { allowedDevOrigins: ['*.local', '*.test', '*.localhost'] };\nexport default nextConfig;\n`,
      'app/layout.tsx': `export const metadata = { title: 'RDR Local — Next.js' };\n\nexport default function RootLayout({ children }: { children: React.ReactNode }) {\n  return (<html lang="pt-BR"><body style={{ fontFamily: 'system-ui', padding: 32 }}>{children}</body></html>);\n}\n`,
      'app/page.tsx': `export default function Home() {\n  return (<main><h1>Olá do RDR Local!</h1><p>Next.js com HTTPS.</p></main>);\n}\n`,
      'app/api/health/route.ts': `export function GET() {\n  return Response.json({ ok: true });\n}\n`,
      '.gitignore': 'node_modules\n.next\n.env\nnext-env.d.ts\n',
    }),
  },
  'go-http': {
    label: 'Go — servidor HTTP (net/http)', runtime: 'go', cmd: 'go run .',
    files: (n) => ({
      'go.mod': `module ${pkgName(n)}\n\ngo 1.22\n`,
      'main.go': `package main\n\nimport (\n\t"encoding/json"\n\t"fmt"\n\t"log"\n\t"net/http"\n\t"os"\n\t"runtime"\n)\n\nfunc main() {\n\tport := os.Getenv("PORT")\n\tif port == "" {\n\t\tport = "3000"\n\t}\n\n\tmux := http.NewServeMux()\n\tmux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {\n\t\tif r.URL.Path != "/" {\n\t\t\thttp.NotFound(w, r)\n\t\t\treturn\n\t\t}\n\t\tw.Header().Set("Content-Type", "text/html; charset=utf-8")\n\t\tfmt.Fprintf(w, "<h1>Olá do RDR Local!</h1><p>%s com HTTPS.</p>", runtime.Version())\n\t})\n\tmux.HandleFunc("/api/health", func(w http.ResponseWriter, r *http.Request) {\n\t\tw.Header().Set("Content-Type", "application/json")\n\t\tjson.NewEncoder(w).Encode(map[string]bool{"ok": true})\n\t})\n\n\taddr := "127.0.0.1:" + port\n\tlog.Println("Servidor em", addr)\n\tlog.Fatal(http.ListenAndServe(addr, mux))\n}\n`,
      '.gitignore': '*.exe\n.env\n',
    }),
  },
  'java-spring': {
    label: 'Java — Spring Boot (gerado pelo start.spring.io)', runtime: 'java', cmd: IS_WIN ? 'mvnw.cmd spring-boot:run' : './mvnw spring-boot:run', remote: true,
    hint: 'Baixa o projeto pronto de start.spring.io (Maven, Java 21, Spring Web). A primeira execução baixa as dependências e demora.',
  },
};
const templates = () => Object.entries(T).map(([id, t]) => ({ id, label: t.label, runtime: t.runtime, cmd: t.cmd, hint: t.hint || '', scaffold: !!(t.files || t.remote) }));

/** Cria os arquivos do modelo na pasta (sem sobrescrever o que já existe). */
function scaffold(tpl, dir, name) {
  const t = T[tpl]; if (!t || !t.files) return [];
  fs.mkdirSync(dir, { recursive: true });
  const made = [];
  for (const [f, content] of Object.entries(t.files(dir, name))) {
    const full = path.join(dir, f);
    if (exists(full)) continue;
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content); made.push(f);
  }
  return made;
}
/** Modelos baixados de um gerador oficial (Spring Initializr). */
async function scaffoldRemote(tpl, dir, name, jl) {
  const t = T[tpl]; if (!t || !t.remote) return;
  fs.mkdirSync(dir, { recursive: true });
  const art = pkgName(dir);
  // Alvo do projeto = JDK instalado (o start.spring.io aceita 17, 21 e 25); sem JDK conhecido, 21.
  const jmaj = String(rts.resolve('java', 'default') || '21').split('.')[0];
  const javaVersion = ['17', '21', '25'].includes(jmaj) ? jmaj : (Number(jmaj) > 21 && Number(jmaj) < 25 ? '21' : (Number(jmaj) >= 25 ? '25' : '21'));
  const q = new URLSearchParams({ type: 'maven-project', language: 'java', packaging: 'jar', javaVersion, groupId: 'br.com.rdr', artifactId: art, name: art, dependencies: 'web,actuator', baseDir: '' });
  const zip = path.join(P.bin, `spring-${Date.now()}.zip`);
  jl('Baixando o projeto de start.spring.io...');
  try { await core.download('https://start.spring.io/starter.zip?' + q.toString(), zip, jl); await core.unzip(zip, dir); }
  finally { fs.rmSync(zip, { force: true }); }
  if (!exists(path.join(dir, 'pom.xml'))) throw new Error('O start.spring.io não devolveu um projeto válido.');
  jl('  + projeto Spring Boot (pom.xml, mvnw, src/)');
}
/** Django: depois do pip install, cria o projeto e libera o domínio local. */
async function finishDjango(s, jl) {
  if (!exists(path.join(s.path, 'manage.py'))) { jl('> django-admin startproject config .'); await runStreamed('django-admin startproject config .', [], jl, { cwd: s.path, env: envFor(s), shell: true }); }
  const f = path.join(s.path, 'config', 'settings.py');
  if (exists(f)) {
    let t = fs.readFileSync(f, 'utf8');
    t = t.replace(/^ALLOWED_HOSTS\s*=\s*\[\s*\]/m, "ALLOWED_HOSTS = ['*']  # ambiente local do RDR Local");
    if (!/CSRF_TRUSTED_ORIGINS/.test(t)) t += `\nCSRF_TRUSTED_ORIGINS = ['${sites.baseUrl(s.domain)}']\nUSE_X_FORWARDED_HOST = True\nSECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')\n`;
    fs.writeFileSync(f, t);
  }
}

module.exports = { start, stop, restart, status, anyRunning, startAll, stopAll, stopUsing, logTail, detect, installDeps, templates, T, scaffold, scaffoldRemote, finishDjango, allocPort, envFor, expand, runtimeProblem };
