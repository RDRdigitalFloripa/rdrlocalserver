// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 RDR Digital - https://github.com/RDRdigitalFloripa/rdrlocalserver
'use strict';
/**
 * Projetos novos já nascem com CLAUDE.md, AGENTS.md e a pasta docs/ (documentos no padrão NN-DD-MM-AAAA-nome.md),
 * mais o plano do projeto (especificação, tarefas e diário) que o painel lê e mostra no Painel.
 * Nunca sobrescreve arquivo existente e nunca derruba a criação do projeto: qualquer erro só vai para o log.
 * Desligue em Configurações (cfg.projectDocs = false).
 */
const fs = require('fs');
const path = require('path');
const { cfg, log, exists } = require('./core');

const pad = (n) => String(n).padStart(2, '0');
/** DD-MM-AAAA (usado no nome dos documentos). */
const dateBR = (d = new Date()) => `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`;
const enabled = () => cfg.projectDocs !== false;
const FLOW_MARK = '<!-- rdr:fluxo -->'; // evita acrescentar a seção de fluxo duas vezes

const RT_LABEL = { node: 'Node.js', python: 'Python', go: 'Go', java: 'Java (JDK)', custom: 'comando próprio' };

function dbLine(i) {
  const eng = i.dbEngine;
  if (eng === 'postgres' || eng === 'mariadb') {
    const pg = eng === 'postgres';
    const base = `${pg ? 'PostgreSQL' : 'MariaDB'}, banco \`${i.dbName}\`, host 127.0.0.1, porta ${pg ? cfg.ports.postgres : cfg.ports.mariadb}, usuário ${pg ? 'postgres' : 'root'}, sem senha`;
    return i.dbCreated ? base : `${base} (o banco não foi criado automaticamente: crie em *Bancos de dados* do RDR Local)`;
  }
  return i.kind === 'laravel' ? 'SQLite (padrão do Laravel, arquivo `database/database.sqlite`)' : 'nenhum banco configurado';
}

const TAILWIND_V4 = 'Tailwind CSS v4: não crie `tailwind.config.js` nem use `@tailwind base/components/utilities` (isso é do v3). A entrada do CSS é `@import "tailwindcss";` e o tema fica no próprio CSS, com `@theme`.';
/** Linhas sobre o Tailwind, conforme o projeto foi criado: 'laravel' (Vite), 'cli' (compilador independente) ou 'vite' (pasta PHP com Vite). */
function tailwindLines(i) {
  if (i.tailwind === 'laravel') return ['- Estilo: Tailwind CSS 4 com Vite (`resources/css/app.css`). Em desenvolvimento: `npm run dev` (ou Processos > Vite no RDR Local); para publicar: `npm run build`.', `- ${TAILWIND_V4}`];
  if (i.tailwind === 'cli') return ['- Raiz pública do site: `public/` (o `index.php` fica lá).', '- Estilo: Tailwind CSS 4 pelo compilador independente (sem Node.js). Entrada `src/input.css`, saída `public/dist/output.css` (não edite a saída). Para recompilar ao salvar: Processos > Tailwind no RDR Local ou, no Terminal, `tailwindcss -i src/input.css -o public/dist/output.css --watch=always`.', `- ${TAILWIND_V4}`];
  if (i.tailwind === 'vite') return ['- Raiz pública do site: `public/` (o `index.php` fica lá).', '- Estilo: Tailwind CSS 4 com Vite. Entrada `src/main.js` (importa `src/input.css`); a saída vai para `public/dist/assets/` (`main.css`, `main.js`; não edite). `npm run dev` recompila ao salvar (Processos > Vite no RDR Local) e `npm run build` compila uma vez.', `- ${TAILWIND_V4}`];
  return [];
}

function stackLines(i) {
  if (i.kind === 'laravel') return [`- Tipo: Laravel${i.kit ? ` (${i.kit})` : ''}, PHP ${i.php}`, '- Comandos: use o *Terminal* do RDR Local (PHP e Composer já estão no PATH): `php artisan ...`, `composer ...`', ...tailwindLines(i)];
  if (i.kind === 'wordpress') return [`- Tipo: WordPress (pt-BR), PHP ${i.php}`];
  if (i.kind === 'app') {
    return [`- Tipo: app ${RT_LABEL[i.runtime] || i.runtime}${i.template ? ` (${i.template})` : ''}`, `- Comando de execução: \`${i.cmd}\` (o RDR Local define a variável \`PORT\`${i.appPort ? `; porta ${i.appPort}` : ''})`];
  }
  return [`- Tipo: pasta PHP ${i.php}`, ...tailwindLines(i)];
}

const LANGUAGE = `## Importante - Obrigatório
- Sempre forneça as respostas em português do Brasil
`;

const DOCS_RULES = `## Documentação (pasta \`docs/\`)
- A pasta \`docs/\` guarda **todos** os documentos do projeto (visão geral, requisitos, decisões, guias, anotações). Não espalhe arquivos \`.md\` pela raiz.
- Nome dos arquivos: \`NN-DD-MM-AAAA-nome-do-arquivo.md\`
  - \`NN\`: número de ordem com dois dígitos (\`01\`, \`02\`, ...). Olhe os arquivos de \`docs/\` e use sempre o próximo número livre.
  - \`DD-MM-AAAA\`: data de criação do documento.
  - \`nome-do-arquivo\`: minúsculas, sem acentos, palavras separadas por hífen.
  - Exemplo: \`01-10-10-2026-arquivo.md\` (documento 01, criado em 10/10/2026).
- Documento que já existe: edite o próprio arquivo, sem renomear. Assunto novo: arquivo novo, com o próximo número.
`;

/** Seção de fluxo de trabalho (spec-driven) que os agentes seguem. O RDR Local lê esses arquivos e mostra o andamento no Painel. */
const FLOW_RULES = `## Fluxo de trabalho (spec-driven) ${FLOW_MARK}
Em \`docs/\` há três arquivos que dizem o que fazer e onde o projeto está (os nomes terminam em \`-especificacao.md\`, \`-tarefas.md\` e \`-diario.md\`). O RDR Local mostra o andamento no Painel a partir deles.

Antes de codificar:
1. Leia a **especificação** e as **tarefas**. Se a tarefa pedir algo que a especificação não cobre, pergunte e proponha mudar a especificação **antes** de mudar o comportamento.
2. Trabalhe em **uma tarefa por vez** e marque \`[~]\` (em andamento) ao começar.

Durante e depois:
3. Marque \`[x]\` (feito) só quando a tarefa estiver pronta **e verificada** (teste passando ou conferido na tela). Se ela não será feita, marque \`[-]\` e escreva o motivo na própria linha.
4. Uma tarefa nova que aparecer no caminho entra na fase **Descobertas**. Nunca apague nem reescreva tarefas existentes; só mude o estado.
5. Ao terminar o trabalho (ou a sessão), acrescente **no fim do diário** uma linha \`- HH:MM texto\` (sob o \`## DD/MM/AAAA\` de hoje) com o que foi feito, onde parou e o próximo passo.
6. Se o comportamento mudou, atualize a especificação no mesmo commit.

Estados das tarefas: \`[ ]\` a fazer · \`[~]\` em andamento · \`[x]\` feito · \`[-]\` não será feito. Uma tarefa por linha, as fases são os títulos \`##\`.
`;

/** Texto comum do CLAUDE.md e do AGENTS.md de um projeto novo. */
function instructions(i, base) {
  return `# ${i.name}

${LANGUAGE}
${DOCS_RULES}
${FLOW_RULES}
## Ambiente local (RDR Local)
${stackLines(i).join('\n')}
- Pasta: \`${i.dir}\`
- Endereço: ${base(i.domain)} (HTTPS com certificado da CA local)
- Banco de dados: ${dbLine(i)}
- E-mail de teste: Mailpit, SMTP 127.0.0.1:${cfg.ports.mailpitSmtp}
- Nunca grave senhas, tokens ou chaves neste arquivo nem em \`docs/\`; use o \`.env\` (que não vai para o Git).
`;
}

/** CLAUDE.md/AGENTS.md mínimos para um projeto que já existia e ainda não tem os arquivos. */
const basicInstructions = (name) => `# ${name}

${LANGUAGE}
${DOCS_RULES}
${FLOW_RULES}
- Nunca grave senhas, tokens ou chaves neste arquivo nem em \`docs/\`; use o \`.env\` (que não vai para o Git).
`;

function overview(i, base) {
  const d = dateBR().replace(/-/g, '/');
  return `# Visão geral — ${i.name}

- **Criado em:** ${d}, pelo RDR Local
- **Endereço local:** ${base(i.domain)}
- **Pasta:** \`${i.dir}\`
- **Banco de dados:** ${dbLine(i)}

## Objetivo

(Descreva em poucas linhas o que este projeto faz e para quem.)

## Decisões e histórico

(Registre aqui as decisões importantes e as mudanças relevantes, sempre com a data.)
`;
}

// ---------- plano do projeto: especificação, tarefas e diário ----------
const specTemplate = (name) => `# Especificação — ${name}

> Fonte da verdade do que o projeto deve fazer. Mude a especificação **antes** de mudar o comportamento, e mantenha-a em dia no mesmo commit do código.

## Objetivo

(Em poucas linhas: o problema, para quem e o resultado esperado.)

## Requisitos

- RF-01 (descreva o que o sistema deve fazer)

## Critérios de aceitação

(Como saber que está pronto. Ex.: "Dado um usuário sem cadastro, quando ele envia o formulário, então recebe o e-mail de confirmação".)

## Fora do escopo

- (o que NÃO será feito agora)

## Decisões

- ${dateBR().replace(/-/g, '/')}: (decisão e o motivo)
`;

const tasksTemplate = (name) => `# Tarefas — ${name}

> Estados: \`[ ]\` a fazer · \`[~]\` em andamento · \`[x]\` feito · \`[-]\` não será feito.
> O RDR Local lê este arquivo e mostra o andamento no Painel. As fases são os títulos \`##\`; uma tarefa por linha.

## Fase 1 — Fundação
- [ ] Preencher a especificação (objetivo, requisitos e critérios de aceitação)
- [ ] Preparar o ambiente (banco, \`.env\`, dependências)

## Descobertas
<!-- tarefas que surgirem durante o trabalho entram aqui -->
`;

const diaryTemplate = (name) => {
  const d = new Date(); const date = `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
  return `# Diário — ${name}

> Registro cronológico: o que foi feito, onde parou e o próximo passo. Uma seção por dia (\`## DD/MM/AAAA\`), uma linha por anotação, no fim do arquivo.

## ${date}
- ${pad(d.getHours())}:${pad(d.getMinutes())} Projeto criado pelo RDR Local.
`;
};

const PLAN_KINDS = [['especificacao', specTemplate, 'spec'], ['tarefas', tasksTemplate, 'tasks'], ['diario', diaryTemplate, 'diary']];
const PLAN_RE = { spec: /(^|-)especificacao\.md$/i, tasks: /(^|-)tarefas\.md$/i, diary: /(^|-)diario\.md$/i };

/** Arquivos do plano que já existem em docs/ (nome do arquivo por tipo). */
function planFound(dir) {
  const out = {}; let names = [];
  try { names = fs.readdirSync(path.join(dir, 'docs')).filter((n) => /\.md$/i.test(n)).sort(); } catch (_) { return out; }
  for (const [kind, re] of Object.entries(PLAN_RE)) { const n = names.find((x) => re.test(x)); if (n) out[kind] = n; }
  return out;
}

/** Cria o que falta do plano (especificação, tarefas, diário) em docs/, com o próximo número livre. Devolve os caminhos criados. */
function planFiles(dir, name) {
  const docs = path.join(dir, 'docs'); fs.mkdirSync(docs, { recursive: true });
  const have = planFound(dir); const made = [];
  const nums = fs.readdirSync(docs).map((n) => /^(\d+)-/.exec(n)).filter(Boolean).map((m) => Number(m[1]));
  let next = (nums.length ? Math.max(...nums) : 0) + 1;
  for (const [label, tpl, kind] of PLAN_KINDS) {
    if (have[kind]) continue;
    const file = `${pad(next++)}-${dateBR()}-${label}.md`;
    fs.writeFileSync(path.join(docs, file), tpl(name), 'utf8'); made.push(`docs/${file}`);
  }
  return made;
}

/** Garante a seção de fluxo no CLAUDE.md e no AGENTS.md: acrescenta ao que existe (uma vez só) e cria o que falta. */
function addFlow(dir, name) {
  const changed = [];
  for (const f of ['CLAUDE.md', 'AGENTS.md']) {
    const full = path.join(dir, f);
    if (!exists(full)) { fs.writeFileSync(full, basicInstructions(name), 'utf8'); changed.push(`${f} (criado)`); continue; }
    const t = fs.readFileSync(full, 'utf8');
    if (t.includes(FLOW_MARK)) continue;
    const nl = t.includes('\r\n') ? '\r\n' : '\n';
    const section = FLOW_RULES.replace(/\n/g, nl);
    fs.writeFileSync(full, t.replace(/\s*$/, '') + nl + nl + section, 'utf8'); changed.push(`${f} (seção Fluxo de trabalho)`);
  }
  return changed;
}

function put(full, text, label, made) {
  if (exists(full)) return;
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, text, 'utf8');
  made.push(label);
}

/**
 * i = { dir, name, kind: 'laravel'|'wordpress'|'php'|'app', domain, php, kit, dbEngine, dbName, dbCreated, runtime, template, cmd, appPort, tailwind: ''|'laravel'|'cli'|'vite' }
 * Devolve a lista de arquivos criados (para o log da tarefa).
 */
function scaffold(i) {
  if (!enabled()) return [];
  const made = [];
  try {
    const base = (d) => require('./sites').baseUrl(d);
    const text = instructions(i, base);
    put(path.join(i.dir, 'CLAUDE.md'), text, 'CLAUDE.md', made);
    put(path.join(i.dir, 'AGENTS.md'), text, 'AGENTS.md', made);
    const docs = path.join(i.dir, 'docs');
    fs.mkdirSync(docs, { recursive: true });
    if (!fs.readdirSync(docs).length) { const f = `01-${dateBR()}-visao-geral.md`; put(path.join(docs, f), overview(i, base), `docs/${f}`, made); }
    planFiles(i.dir, i.name).forEach((f) => made.push(f));
  } catch (e) { log(`CLAUDE.md/AGENTS.md/docs não criados em ${i.dir}: ${e.message}`); }
  return made;
}

module.exports = { scaffold, dateBR, enabled, instructions, planFiles, planFound, addFlow, FLOW_MARK, PLAN_RE };
