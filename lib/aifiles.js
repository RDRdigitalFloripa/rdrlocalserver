// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 RDR Digital - https://github.com/RDRdigitalFloripa/rdrlocalserver
'use strict';
/**
 * Projetos novos já nascem com CLAUDE.md, AGENTS.md e a pasta docs/ (documentos no padrão NN-DD-MM-AAAA-nome.md).
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

function stackLines(i) {
  if (i.kind === 'laravel') return [`- Tipo: Laravel${i.kit ? ` (${i.kit})` : ''}, PHP ${i.php}`, '- Comandos: use o *Terminal* do RDR Local (PHP e Composer já estão no PATH): `php artisan ...`, `composer ...`'];
  if (i.kind === 'wordpress') return [`- Tipo: WordPress (pt-BR), PHP ${i.php}`];
  if (i.kind === 'app') {
    return [`- Tipo: app ${RT_LABEL[i.runtime] || i.runtime}${i.template ? ` (${i.template})` : ''}`, `- Comando de execução: \`${i.cmd}\` (o RDR Local define a variável \`PORT\`${i.appPort ? `; porta ${i.appPort}` : ''})`];
  }
  return [`- Tipo: pasta PHP ${i.php}`];
}

/** Texto comum do CLAUDE.md e do AGENTS.md. */
function instructions(i, base) {
  return `# ${i.name}

## Importante - Obrigatório
- Sempre forneça as respostas em português do Brasil

## Documentação (pasta \`docs/\`)
- A pasta \`docs/\` guarda **todos** os documentos do projeto (visão geral, requisitos, decisões, guias, anotações). Não espalhe arquivos \`.md\` pela raiz.
- Nome dos arquivos: \`NN-DD-MM-AAAA-nome-do-arquivo.md\`
  - \`NN\`: número de ordem com dois dígitos (\`01\`, \`02\`, ...). Olhe os arquivos de \`docs/\` e use sempre o próximo número livre.
  - \`DD-MM-AAAA\`: data de criação do documento.
  - \`nome-do-arquivo\`: minúsculas, sem acentos, palavras separadas por hífen.
  - Exemplo: \`01-10-10-2026-arquivo.md\` (documento 01, criado em 10/10/2026).
- Documento que já existe: edite o próprio arquivo, sem renomear. Assunto novo: arquivo novo, com o próximo número.

## Ambiente local (RDR Local)
${stackLines(i).join('\n')}
- Pasta: \`${i.dir}\`
- Endereço: ${base(i.domain)} (HTTPS com certificado da CA local)
- Banco de dados: ${dbLine(i)}
- E-mail de teste: Mailpit, SMTP 127.0.0.1:${cfg.ports.mailpitSmtp}
- Nunca grave senhas, tokens ou chaves neste arquivo nem em \`docs/\`; use o \`.env\` (que não vai para o Git).
`;
}

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

function put(full, text, label, made) {
  if (exists(full)) return;
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, text, 'utf8');
  made.push(label);
}

/**
 * i = { dir, name, kind: 'laravel'|'wordpress'|'php'|'app', domain, php, kit, dbEngine, dbName, dbCreated, runtime, template, cmd, appPort }
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
  } catch (e) { log(`CLAUDE.md/AGENTS.md/docs não criados em ${i.dir}: ${e.message}`); }
  return made;
}

module.exports = { scaffold, dateBR, enabled, instructions };
