// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 RDR Digital - https://github.com/RDRdigitalFloripa/rdrlocalserver
'use strict';
/** Plano do projeto: parser, ativar, tarefas, diário, edição simultânea, CRLF e projeto novo (servidor isolado). */
const fs = require('fs');
const path = require('path');
const h = require('./lib/harness');

const pad = (n) => String(n).padStart(2, '0'); const now = new Date();
const TODAY_FILE = `${pad(now.getDate())}-${pad(now.getMonth() + 1)}-${now.getFullYear()}`;
const TODAY_DIARY = `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}`;
const re = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const diffChars = (a, b) => { if (a.length !== b.length) return -1; let n = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++; return n; };

h.run(async () => {
  h.isolateHome();
  const plan = require('../lib/plan');
  const base = h.tmp('plan');
  const mk = (n) => h.mkdir(base, 'proj', n);
  const rd = h.read;
  const srv = await h.startServer();
  const call = srv.call;

  h.title('1) parser de tarefas');
  const txt = ['- [ ] solta antes de qualquer fase', '', '## Fase A', '- [x] feita', '- [X] feita maiúscula', '  - [~] filha em andamento', '* [-] descartada', '- [ ] a fazer', '### sub-título (não é fase)', '- [ ] ainda na Fase A', '```', '- [ ] dentro de código: ignorar', '## Falsa fase em código', '```', '<!-- - [ ] comentário -->', '- [ ]sem espaço depois do colchete', '- [?] estado inexistente', '## Fase B', '- [ ] b1', '', '## Descobertas'].join('\n');
  const ph = plan.parseTasks(txt);
  h.ok(JSON.stringify(ph.map((p) => p.name)) === JSON.stringify(['Geral', 'Fase A', 'Fase B', 'Descobertas']), 'fases: Geral, Fase A, Fase B, Descobertas; ### e blocos de código não viram fase', JSON.stringify(ph.map((p) => p.name)));
  const a = ph[1];
  h.ok(a.tasks.length === 6 && a.done === 2 && a.doing === 1 && a.dropped === 1 && a.total === 5, 'Fase A: [x] e [X] feitas, [~] aninhada conta, [-] fora do total', JSON.stringify({ n: a.tasks.length, done: a.done, doing: a.doing, dropped: a.dropped, total: a.total }));
  h.ok(!ph.flatMap((p) => p.tasks).some((t) => /código|comentário|sem espaço|inexistente/.test(t.text)), 'ignora tarefa em bloco de código, em comentário HTML, sem espaço e com estado inexistente');
  const dia = plan.parseDiary('# D\n\n## 09/11/2026\n- 10:00 primeira\n  continua aqui\n- sem hora\n\n## 10/11/2026\n- 08:15 outra\n\n## não é data\n- x');
  h.ok(dia.length === 2 && dia[0].items.length === 2 && dia[0].items[0].text === 'primeira continua aqui' && dia[0].items[1].time === '' && dia[1].items[0].time === '08:15', 'diário: continuação recuada, item sem hora, título que não é data encerra a entrada', JSON.stringify(dia));
  h.ok(JSON.stringify(plan.lastDiary(dia)) === JSON.stringify({ date: '10/11/2026', time: '08:15', text: 'outra' }), 'lastDiary devolve a última anotação');

  h.title('2) ativar o plano num projeto existente');
  const P = mk('plano1'); fs.mkdirSync(path.join(P, 'docs')); fs.writeFileSync(path.join(P, 'docs', `01-${TODAY_FILE}-visao-geral.md`), '');
  fs.writeFileSync(path.join(P, 'CLAUDE.md'), '# Meu projeto\n\nMEU TEXTO CLAUDE\n');
  const s1 = await h.addSite(srv, 'Plano1', P, 'plano1-rdr.test');
  let r = await call('GET', '/api/plan?id=' + s1.id); h.ok(r.status === 200 && r.j.enabled === false && r.j.phases.length === 0, 'antes: plano desativado');
  r = await call('GET', '/api/plan/overview'); h.ok(!r.j.projects.some((p) => p.id === s1.id), 'projeto sem plano não aparece na visão geral do Painel');
  r = await call('POST', '/api/plan/init', { id: s1.id }); const created = r.j.created || [];
  h.ok(r.status === 200 && created.includes(`docs/02-${TODAY_FILE}-especificacao.md`) && created.includes(`docs/03-${TODAY_FILE}-tarefas.md`) && created.includes(`docs/04-${TODAY_FILE}-diario.md`), 'init cria especificação, tarefas e diário com o próximo número e a data (02, 03, 04)', JSON.stringify(created));
  const claude = rd(path.join(P, 'CLAUDE.md')); const agents = rd(path.join(P, 'AGENTS.md'));
  h.ok(claude.startsWith('# Meu projeto\n\nMEU TEXTO CLAUDE') && (claude.match(/rdr:fluxo/g) || []).length === 1 && /Fluxo de trabalho \(spec-driven\)/.test(claude), 'CLAUDE.md existente: conteúdo preservado e seção de fluxo acrescentada uma vez');
  h.ok(created.includes('AGENTS.md (criado)') && /português do Brasil/.test(agents) && /rdr:fluxo/.test(agents) && /NN-DD-MM-AAAA/.test(agents), 'AGENTS.md ausente: criado com a regra do português, a nomenclatura e o fluxo');
  h.ok(/\[~\]/.test(claude) && /\[x\]/.test(claude) && /Descobertas/.test(claude) && /diário/.test(claude), 'a seção de fluxo explica os estados, Descobertas e o diário ao agente');
  r = await call('POST', '/api/plan/init', { id: s1.id }); h.ok(r.status === 200 && r.j.created.length === 0, 'init repetido não cria nem duplica nada');
  h.ok((rd(path.join(P, 'CLAUDE.md')).match(/rdr:fluxo/g) || []).length === 1, 'a seção de fluxo continua uma só');

  h.title('3) ler o plano e marcar tarefas');
  r = await call('GET', '/api/plan?id=' + s1.id); let pl = r.j;
  h.ok(pl.enabled && pl.phases.length === 2 && pl.phases[0].name === 'Fase 1 — Fundação' && pl.phases[0].tasks.length === 2 && pl.phases[1].name === 'Descobertas', 'plano lido: Fase 1 com 2 tarefas e Descobertas');
  h.ok(pl.progress.total === 2 && pl.progress.done === 0 && pl.progress.pct === 0 && pl.current === 'Fase 1 — Fundação', 'progresso 0/2, fase atual Fase 1');
  h.ok(pl.diary.length === 1 && pl.diary[0].date === TODAY_DIARY && /Projeto criado pelo RDR Local/.test(pl.diary[0].items[0].text), 'diário inicial com a data de hoje');
  const tf = path.join(P, 'docs', `03-${TODAY_FILE}-tarefas.md`); const t0 = pl.phases[0].tasks[0];
  const before = rd(tf);
  r = await call('POST', '/api/plan/task', { id: s1.id, line: t0.line, expect: t0.text, state: 'x' }); h.ok(r.status === 200, 'marcar tarefa como feita');
  const after = rd(tf); h.ok(diffChars(before, after) === 1 && /- \[x\] Preencher a especificação/.test(after), 'a edição troca exatamente 1 caractere do arquivo', 'diferença: ' + diffChars(before, after));
  await call('POST', '/api/plan/task', { id: s1.id, line: pl.phases[0].tasks[1].line, expect: pl.phases[0].tasks[1].text, state: '~' });
  pl = (await call('GET', '/api/plan?id=' + s1.id)).j;
  h.ok(pl.progress.done === 1 && pl.progress.doing === 1 && pl.progress.pct === 50 && pl.doing.length === 1 && /Preparar o ambiente/.test(pl.doing[0].text), 'progresso 1/2 (50%) e "em andamento" listado');
  await call('POST', '/api/plan/task', { id: s1.id, line: t0.line, expect: t0.text, state: '-' }); pl = (await call('GET', '/api/plan?id=' + s1.id)).j;
  h.ok(pl.progress.total === 1 && pl.progress.done === 0, '"não será feito" sai do total (0/1)');
  await call('POST', '/api/plan/task', { id: s1.id, line: t0.line, expect: t0.text, state: ' ' });
  for (const [body, why] of [[{ line: t0.line, expect: 'outro texto', state: 'x' }, 'texto da linha diferente (arquivo mudou)'], [{ line: t0.line, expect: t0.text, state: 'z' }, 'estado inválido'], [{ line: 0, expect: '# Tarefas', state: 'x' }, 'linha que não é tarefa (título)'], [{ line: 9999, expect: 'x', state: 'x' }, 'linha fora do arquivo'], [{ line: 'abc', expect: 'x', state: 'x' }, 'linha não numérica']]) {
    r = await call('POST', '/api/plan/task', { id: s1.id, ...body }); h.ok(r.status === 400, `recusa: ${why} (HTTP ${r.status})`);
  }

  h.title('4) o agente edita o arquivo no meio do caminho');
  const t1 = pl.phases[0].tasks[0]; // linha que o painel "viu"
  const txt2 = rd(tf).split('\n'); txt2.splice(t1.line, 0, '- [ ] Tarefa nova inserida pelo agente'); fs.writeFileSync(tf, txt2.join('\n'));
  r = await call('POST', '/api/plan/task', { id: s1.id, line: t1.line, expect: t1.text, state: 'x' });
  h.ok(r.status === 400 && /mudou desde que a tela foi carregada/.test(r.j.error || ''), 'tela desatualizada: recusa em vez de marcar a tarefa errada', r.j.error);
  h.ok(!/\[x\] Preencher a especificação/.test(rd(tf)), 'e o arquivo não foi alterado');
  pl = (await call('GET', '/api/plan?id=' + s1.id)).j; h.ok(pl.phases[0].tasks.length === 3 && pl.phases[0].tasks[0].text === 'Tarefa nova inserida pelo agente', 'recarregar mostra a tarefa nova do agente');
  fs.writeFileSync(tf, rd(tf).replace('- [ ] Tarefa nova inserida pelo agente', '- [x] Tarefa nova inserida pelo agente')); // agente marca como feita
  pl = (await call('GET', '/api/plan?id=' + s1.id)).j; h.ok(pl.progress.done === 1 && pl.phases[0].tasks[0].state === 'x', 'o que o agente marca aparece no painel');

  h.title('5) adicionar tarefas e fases');
  r = await call('POST', '/api/plan/add-task', { id: s1.id, phase: 'Fase 1 — Fundação', text: 'Configurar o CI' }); h.ok(r.status === 200, 'adicionar tarefa a uma fase existente');
  let lines = rd(tf).split('\n'); const iCi = lines.findIndex((l) => l.includes('Configurar o CI')); const iDesc = lines.findIndex((l) => /^## Descobertas/.test(l)); const iLast = lines.findIndex((l) => l.includes('Preparar o ambiente'));
  h.ok(iCi === iLast + 1 && iCi < iDesc, 'entra logo depois da última tarefa da própria fase (antes de Descobertas)', lines.join('|'));
  r = await call('POST', '/api/plan/add-task', { id: s1.id, phase: '## Fase 2 — Cadastro', text: 'Tela de login' }); h.ok(r.status === 200, 'adicionar tarefa em fase nova');
  lines = rd(tf).split('\n'); const iF2 = lines.findIndex((l) => l === '## Fase 2 — Cadastro'); const iD2 = lines.findIndex((l) => /^## Descobertas/.test(l));
  h.ok(iF2 > 0 && lines[iF2 + 1] === '- [ ] Tela de login' && iF2 < iD2, 'fase nova é criada antes de Descobertas, sem "##" duplicado no nome', lines.join('|'));
  r = await call('POST', '/api/plan/add-task', { id: s1.id, phase: 'Descobertas', text: 'Linha 1\nlinha 2\t  com   espaços' }); lines = rd(tf).split('\n');
  h.ok(r.status === 200 && lines.some((l) => l === '- [ ] Linha 1 linha 2 com espaços'), 'quebras de linha e espaços do texto viram um espaço só (uma tarefa = uma linha)', lines.slice(-4).join('|'));
  r = await call('POST', '/api/plan/add-task', { id: s1.id, phase: 'Descobertas', text: '   ' }); h.ok(r.status === 400, 'tarefa vazia recusada');
  r = await call('POST', '/api/plan/add-task', { id: s1.id, phase: '', text: 'x' }); h.ok(r.status === 400, 'fase vazia recusada');
  r = await call('POST', '/api/plan/add-task', { id: s1.id, phase: 'Descobertas', text: 'x'.repeat(500) }); h.ok(r.status === 200 && rd(tf).split('\n').some((l) => l === '- [ ] ' + 'x'.repeat(300)), 'texto muito longo é cortado em 300 caracteres');
  pl = (await call('GET', '/api/plan?id=' + s1.id)).j; h.ok(pl.phases.map((p) => p.name).join('|') === 'Fase 1 — Fundação|Fase 2 — Cadastro|Descobertas', 'ordem das fases lida de volta');

  h.title('6) diário');
  const df = path.join(P, 'docs', `04-${TODAY_FILE}-diario.md`);
  r = await call('POST', '/api/plan/diary', { id: s1.id, text: 'Terminei o login.\nFalta o reset de senha.' }); h.ok(r.status === 200, 'registrar anotação');
  let d = rd(df); h.ok((d.match(new RegExp('^## ' + re(TODAY_DIARY) + '$', 'gm')) || []).length === 1 && /- \d\d:\d\d Terminei o login\.\n {2}Falta o reset de senha\./.test(d), 'entra sob a seção de hoje (uma só), com linha de continuação recuada', d);
  pl = (await call('GET', '/api/plan?id=' + s1.id)).j; const lastE = pl.diary[pl.diary.length - 1]; h.ok(lastE.items[lastE.items.length - 1].text === 'Terminei o login. Falta o reset de senha.', 'o painel lê a anotação de várias linhas como uma só');
  fs.writeFileSync(df, d.replace(new RegExp('## ' + re(TODAY_DIARY), 'g'), '## 01/01/2026')); // a última seção vira "antiga"
  r = await call('POST', '/api/plan/diary', { id: s1.id, text: 'Segunda anotação' }); d = rd(df);
  h.ok(r.status === 200 && new RegExp('## 01/01/2026[\\s\\S]*## ' + re(TODAY_DIARY) + '\\n- \\d\\d:\\d\\d Segunda anotação').test(d), 'seção de hoje nova quando a última seção é de outro dia', d);
  r = await call('POST', '/api/plan/diary', { id: s1.id, text: '   ' }); h.ok(r.status === 400, 'anotação vazia recusada');
  r = await call('POST', '/api/plan/diary', { id: s1.id, text: 'a'.repeat(2001) }); h.ok(r.status === 400, 'anotação com mais de 2000 caracteres recusada');
  r = await call('GET', '/api/plan/overview'); const ov = r.j.projects.find((p) => p.id === s1.id);
  h.ok(ov && ov.name === 'Plano1' && ov.progress.total >= 4 && ov.diary && ov.diary.text === 'Segunda anotação' && ov.phase === 'Fase 1 — Fundação', 'visão geral do Painel: nome, progresso, fase atual e última anotação', JSON.stringify(ov));

  h.title('7) especificação e erros');
  r = await call('GET', '/api/plan/file?id=' + s1.id + '&kind=spec'); h.ok(r.status === 200 && r.j.name === `02-${TODAY_FILE}-especificacao.md` && /Fonte da verdade/.test(r.j.text), 'ler a especificação (somente leitura)');
  r = await call('GET', '/api/plan/file?id=' + s1.id + '&kind=../../etc/passwd'); h.ok(r.status === 400, 'tipo de arquivo fora da lista (../..) recusado');
  r = await call('GET', '/api/plan?id=inexistente'); h.ok(r.status === 400, 'site inexistente -> 400');
  const sN = await h.addSite(srv, 'SemDocs', mk('semdocs'), 'semdocs-rdr.test');
  r = await call('POST', '/api/plan/add-task', { id: sN.id, phase: 'x', text: 'y' }); h.ok(r.status === 400 && /não tem o arquivo de tarefas/.test(r.j.error), 'sem plano: adicionar tarefa -> 400 claro');
  r = await call('POST', '/api/plan/diary', { id: sN.id, text: 'y' }); h.ok(r.status === 400, 'sem plano: diário -> 400');

  h.title('8) nomes antigos e CRLF');
  const L = mk('legado'); fs.mkdirSync(path.join(L, 'docs')); fs.writeFileSync(path.join(L, 'docs', 'tarefas.md'), '# T\r\n\r\n## Fase 1\r\n- [ ] a\r\n- [ ] b\r\n');
  const sL = await h.addSite(srv, 'Legado', L, 'legado-rdr.test'); pl = (await call('GET', '/api/plan?id=' + sL.id)).j;
  h.ok(pl.enabled && pl.files.tasks === 'tarefas.md' && pl.progress.total === 2, 'reconhece docs/tarefas.md (nome sem número e data)');
  r = await call('POST', '/api/plan/init', { id: sL.id }); const cl = r.j.created.join('|');
  h.ok(/especificacao/.test(cl) && /diario/.test(cl) && !/tarefas/.test(cl), 'init cria só o que falta (não cria outro arquivo de tarefas)', cl);
  const lt = path.join(L, 'docs', 'tarefas.md'); const ptl = (await call('GET', '/api/plan?id=' + sL.id)).j;
  await call('POST', '/api/plan/task', { id: sL.id, line: ptl.phases[0].tasks[0].line, expect: 'a', state: 'x' });
  await call('POST', '/api/plan/add-task', { id: sL.id, phase: 'Fase 1', text: 'c' }); await call('POST', '/api/plan/add-task', { id: sL.id, phase: 'Fase nova', text: 'd' });
  const crlf = rd(lt); h.ok(crlf.includes('- [x] a') && !/(?<!\r)\n/.test(crlf) && crlf.includes('- [ ] c') && crlf.includes('## Fase nova'), 'CRLF preservado em marcar, adicionar tarefa e criar fase (nenhum LF solto)', JSON.stringify(crlf));
  const dl = path.join(L, 'docs', fs.readdirSync(path.join(L, 'docs')).find((n) => /diario\.md$/.test(n))); fs.writeFileSync(dl, rd(dl).replace(/\r?\n/g, '\r\n'));
  await call('POST', '/api/plan/diary', { id: sL.id, text: 'linha crlf' }); h.ok(!/(?<!\r)\n/.test(rd(dl)), 'CRLF preservado no diário');

  h.title('9) projeto novo já nasce com o plano');
  const www = h.mkdir(base, 'www');
  await call('POST', '/api/project', { type: 'empty', name: 'Projeto Novo', dir: www });
  const jn = await srv.waitJob('Novo projeto empty: Projeto Novo'); const NP = path.join(www, 'projeto-novo');
  h.ok(jn && jn.status === 'done', 'projeto novo criado', jn && jn.log.join(' | '));
  const docs = fs.existsSync(path.join(NP, 'docs')) ? fs.readdirSync(path.join(NP, 'docs')).sort() : [];
  h.ok(docs.length === 4 && /^01-.*-visao-geral\.md$/.test(docs[0]) && /^02-.*-especificacao\.md$/.test(docs[1]) && /^03-.*-tarefas\.md$/.test(docs[2]) && /^04-.*-diario\.md$/.test(docs[3]), 'docs/ nasce com 01 visão geral, 02 especificação, 03 tarefas e 04 diário', docs.join(','));
  h.ok(/rdr:fluxo/.test(rd(path.join(NP, 'CLAUDE.md'))) && rd(path.join(NP, 'CLAUDE.md')) === rd(path.join(NP, 'AGENTS.md')), 'CLAUDE.md e AGENTS.md do projeto novo trazem o fluxo e continuam idênticos');
  h.ok(jn && (/Fluxo de trabalho/.test(jn.log.join('\n')) || /docs\/03-/.test(jn.log.join('\n'))), 'o log da tarefa lista os arquivos do plano');
  const sNP = ((await srv.state()).sites || []).find((s) => s.path && s.path.replace(/\\/g, '/').endsWith('/www/projeto-novo')); h.ok(!!sNP, 'o site do projeto novo foi criado');
  pl = sNP ? (await call('GET', '/api/plan?id=' + sNP.id)).j : {}; h.ok(pl.enabled && pl.progress.total === 2 && pl.diary.length === 1, 'o plano do projeto novo já abre com 2 tarefas e 1 anotação');
  await call('POST', '/api/settings', { projectDocs: false });
  await call('POST', '/api/project', { type: 'empty', name: 'Sem Docs Nenhum', dir: www }); await srv.waitJob('Novo projeto empty: Sem Docs Nenhum');
  h.ok(!fs.existsSync(path.join(www, 'sem-docs-nenhum', 'docs')) && !fs.existsSync(path.join(www, 'sem-docs-nenhum', 'CLAUDE.md')), 'projectDocs desligado: nada do plano é criado');
});
