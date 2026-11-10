// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 RDR Digital - https://github.com/RDRdigitalFloripa/rdrlocalserver
'use strict';
/** lib/aifiles.js: CLAUDE.md, AGENTS.md e docs/ iniciais dos projetos (em processo, com RDR_HOME temporário). */
const path = require('path');
const fs = require('fs');
const h = require('./lib/harness');

h.run(async () => {
  h.isolateHome();
  const core = require('../lib/core');
  const aif = require('../lib/aifiles');
  const out = h.tmp('proj');
  const mk = (n) => h.mkdir(out, n);
  const rd = (d, f) => fs.readFileSync(path.join(d, f), 'utf8');

  h.title('laravel com banco');
  const lar = mk('laravel');
  let made = aif.scaffold({ dir: lar, name: 'Loja Teste', kind: 'laravel', domain: 'loja-teste.local', php: '8.4', kit: 'breeze-blade', dbEngine: 'postgres', dbName: 'loja_teste', dbCreated: true });
  h.ok(made.includes('CLAUDE.md') && made.includes('AGENTS.md'), 'laravel: CLAUDE.md e AGENTS.md criados', JSON.stringify(made));
  const docFile = made.find((x) => /visao-geral/.test(x));
  h.ok(/^docs\/01-\d\d-\d\d-\d{4}-visao-geral\.md$/.test(docFile || ''), 'doc inicial no padrão NN-DD-MM-AAAA-nome.md', docFile);
  h.ok(made.filter((x) => x.startsWith('docs/')).length === 4 && made.some((x) => /^docs\/02-.*-especificacao\.md$/.test(x)) && made.some((x) => /^docs\/04-.*-diario\.md$/.test(x)), 'plano acompanha: 02 especificação, 03 tarefas, 04 diário', JSON.stringify(made));
  const claude = rd(lar, 'CLAUDE.md');
  h.ok(claude === rd(lar, 'AGENTS.md'), 'CLAUDE.md idêntico ao AGENTS.md');
  h.ok(claude.includes('## Importante - Obrigatório\n- Sempre forneça as respostas em português do Brasil'), 'regra do português do Brasil (texto exato)');
  h.ok(claude.includes('NN-DD-MM-AAAA-nome-do-arquivo.md') && claude.includes('01-10-10-2026-arquivo.md'), 'orientação de nomenclatura e exemplo');
  h.ok(claude.includes('PostgreSQL, banco `loja_teste`') && claude.includes('porta ' + core.cfg.ports.postgres), 'banco postgres descrito, com a porta do RDR Local');

  h.title('não sobrescreve');
  made = aif.scaffold({ dir: lar, name: 'Loja Teste', kind: 'laravel', domain: 'loja-teste.local', php: '8.4' });
  h.ok(made.length === 0, 'segunda chamada não cria nada', JSON.stringify(made));
  fs.writeFileSync(path.join(lar, 'CLAUDE.md'), 'MEU TEXTO');
  aif.scaffold({ dir: lar, name: 'x', kind: 'laravel', domain: 'x.local', php: '8.4' });
  h.ok(rd(lar, 'CLAUDE.md') === 'MEU TEXTO', 'CLAUDE.md existente preservado');

  h.title('outros tipos');
  const wp = mk('wp');
  aif.scaffold({ dir: wp, name: 'Blog', kind: 'wordpress', domain: 'blog.local', php: '8.4', dbEngine: 'mariadb', dbName: 'blog', dbCreated: false });
  h.ok(rd(wp, 'CLAUDE.md').includes('o banco não foi criado automaticamente'), 'wordpress: aviso de banco não criado');
  const ph = mk('php');
  aif.scaffold({ dir: ph, name: 'Pasta', kind: 'php', domain: 'pasta.local', php: '8.4' });
  h.ok(rd(ph, 'CLAUDE.md').includes('nenhum banco configurado'), 'php: sem banco');
  const ap = mk('app');
  aif.scaffold({ dir: ap, name: 'Api', kind: 'app', domain: 'api.local', runtime: 'node', template: 'TypeScript — Express (tsx)', cmd: 'npm run dev', appPort: 9301 });
  const at = rd(ap, 'CLAUDE.md');
  h.ok(at.includes('app Node.js (TypeScript — Express (tsx))') && at.includes('`npm run dev`') && at.includes('porta 9301'), 'app: runtime, comando e porta');

  h.title('docs/ e configuração');
  const pre = mk('predocs'); fs.mkdirSync(path.join(pre, 'docs')); fs.writeFileSync(path.join(pre, 'docs', 'x.md'), 'x');
  made = aif.scaffold({ dir: pre, name: 'Pre', kind: 'php', domain: 'pre.local', php: '8.4' });
  h.ok(!made.some((x) => /visao-geral/.test(x)) && fs.existsSync(path.join(pre, 'docs', 'x.md')), 'docs/ já com conteúdo: não cria a visão geral e não mexe no que existe', JSON.stringify(made));
  h.ok(made.filter((x) => /-(especificacao|tarefas|diario)\.md$/.test(x)).length === 3, 'mas cria o plano (especificação, tarefas e diário)', JSON.stringify(made));
  const bad = mk('docsfile'); fs.writeFileSync(path.join(bad, 'docs'), 'sou um arquivo');
  let threw = false; try { aif.scaffold({ dir: bad, name: 'Bad', kind: 'php', domain: 'bad.local', php: '8.4' }); } catch (_) { threw = true; }
  h.ok(!threw, 'docs é um arquivo: não lança erro');
  core.cfg.projectDocs = false; const off = mk('off');
  h.ok(aif.scaffold({ dir: off, name: 'Off', kind: 'php', domain: 'off.local', php: '8.4' }).length === 0 && fs.readdirSync(off).length === 0, 'projectDocs=false: não cria nada');
});
