// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 RDR Digital - https://github.com/RDRdigitalFloripa/rdrlocalserver
'use strict';
/**
 * Plano do projeto: especificação, tarefas e diário, em arquivos de docs/ (versionados no Git).
 * O painel e os agentes de IA editam os MESMOS arquivos. Por isso o painel faz edições mínimas (troca um caractere,
 * acrescenta uma linha) e confere o texto da linha antes de mudar: se o agente editou no meio do caminho, recusa em vez de
 * sobrescrever. Os nomes seguem NN-DD-MM-AAAA-nome.md e são achados pelo final (-tarefas.md, -diario.md, -especificacao.md).
 */
const fs = require('fs');
const path = require('path');
const { exists, isDir } = require('./core');
const aifiles = require('./aifiles');

const TASK_RE = /^(\s*[-*]\s+\[)([ xX~-])(\]\s+)(.*\S)\s*$/;
const STATES = [' ', 'x', '~', '-'];
const MAX_BYTES = 400000;
const pad = (n) => String(n).padStart(2, '0');
const oneLine = (s, max) => String(s == null ? '' : s).replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

function readKind(site, kind) {
  const name = aifiles.planFound(site.path)[kind]; if (!name) return null;
  const full = path.join(site.path, 'docs', name);
  if (fs.statSync(full).size > MAX_BYTES) throw new Error(`${name} é grande demais (máximo ${MAX_BYTES / 1000} KB).`);
  return { name, full, text: fs.readFileSync(full, 'utf8') };
}

/** Fases (títulos ##) e tarefas ([ ] [~] [x] [-]) do arquivo de tarefas. Ignora blocos de código. */
function parseTasks(text) {
  const phases = []; let cur = null; let fence = false;
  String(text).split('\n').forEach((raw, i) => {
    const l = raw.replace(/\r$/, '');
    if (/^\s*(```|~~~)/.test(l)) { fence = !fence; return; }
    if (fence) return;
    const h = /^##\s+(.+?)\s*$/.exec(l);
    if (h) { cur = { name: h[1], line: i, tasks: [] }; phases.push(cur); return; }
    const m = TASK_RE.exec(l); if (!m) return;
    if (!cur) { cur = { name: 'Geral', line: -1, tasks: [] }; phases.push(cur); }
    cur.tasks.push({ line: i, state: m[2] === 'X' ? 'x' : m[2], text: m[4].trim() });
  });
  for (const p of phases) {
    p.dropped = p.tasks.filter((t) => t.state === '-').length;
    p.total = p.tasks.length - p.dropped;
    p.done = p.tasks.filter((t) => t.state === 'x').length;
    p.doing = p.tasks.filter((t) => t.state === '~').length;
  }
  return phases;
}

/** Entradas do diário: "## DD/MM/AAAA" com linhas "- HH:MM texto" (linhas recuadas continuam a anotação). */
function parseDiary(text) {
  const entries = []; let cur = null; let last = null;
  String(text).split('\n').forEach((raw) => {
    const l = raw.replace(/\r$/, '');
    const h = /^##\s+(\d{2}\/\d{2}\/\d{4})\s*$/.exec(l);
    if (h) { cur = { date: h[1], items: [] }; entries.push(cur); last = null; return; }
    if (/^#{1,2}\s/.test(l)) { cur = null; last = null; return; } // outro título (ex.: "## Notas") encerra o dia: não herda as linhas dele
    if (!cur) return;
    const it = /^[-*]\s+(?:(\d{2}:\d{2})\s+)?(.*\S)\s*$/.exec(l);
    if (it) { last = { time: it[1] || '', text: it[2] }; cur.items.push(last); return; }
    if (last && /^\s{2,}\S/.test(l)) last.text += ' ' + l.trim();
  });
  return entries;
}

function lastDiary(entries) {
  for (let i = entries.length - 1; i >= 0; i--) { const it = entries[i].items; if (it.length) return { date: entries[i].date, time: it[it.length - 1].time, text: it[it.length - 1].text }; }
  return null;
}

/** Plano completo de um projeto (para a aba Plano). */
function get(site) {
  const f = aifiles.planFound(site.path);
  const out = { enabled: !!f.tasks, files: f, phases: [], progress: { total: 0, done: 0, doing: 0, pct: 0 }, current: '', complete: false, doing: [], diary: [] };
  if (!f.tasks) return out;
  const phases = parseTasks(readKind(site, 'tasks').text);
  out.phases = phases;
  const total = phases.reduce((a, p) => a + p.total, 0); const done = phases.reduce((a, p) => a + p.done, 0);
  out.progress = { total, done, doing: phases.reduce((a, p) => a + p.doing, 0), pct: total ? Math.round((done * 100) / total) : 0 };
  const open = phases.find((p) => p.total - p.done > 0);
  out.current = open ? open.name : '';
  out.complete = total > 0 && !open;
  out.doing = phases.flatMap((p) => p.tasks.filter((t) => t.state === '~').map((t) => ({ phase: p.name, text: t.text })));
  const d = f.diary ? readKind(site, 'diary') : null;
  if (d) out.diary = parseDiary(d.text).slice(-30);
  return out;
}

/** Um item por projeto que tem plano (para o cartão do Painel). */
function overview(sites) {
  const out = [];
  for (const s of sites) {
    if (!s.path || !['php', 'app', undefined].includes(s.type) || !isDir(s.path)) continue;
    let p; try { if (!aifiles.planFound(s.path).tasks) continue; p = get(s); } catch (_) { continue; }
    out.push({ id: s.id, name: s.name, domain: s.domain, progress: p.progress, phase: p.current, complete: p.complete, doing: p.doing.slice(0, 3), diary: lastDiary(p.diary) });
  }
  return out;
}

/** Texto de um arquivo do plano (somente leitura). */
function file(site, kind) {
  if (!['spec', 'tasks', 'diary'].includes(kind)) throw new Error('Arquivo desconhecido.');
  const r = readKind(site, kind); if (!r) throw new Error('Este projeto ainda não tem esse arquivo. Ative o plano primeiro.');
  return { name: r.name, text: r.text };
}

/** Muda o estado de UMA tarefa (troca só o caractere do colchete). Recusa se a linha não é mais a mesma. */
function setState(site, line, expect, state) {
  if (!STATES.includes(state)) throw new Error('Estado inválido (use "a fazer", "em andamento", "feito" ou "não será feito").');
  const t = readKind(site, 'tasks'); if (!t) throw new Error('Este projeto não tem o arquivo de tarefas.');
  const idx = Number(line);
  const task = parseTasks(t.text).flatMap((p) => p.tasks).find((x) => x.line === idx);
  if (!Number.isInteger(idx) || !task || task.text !== String(expect == null ? '' : expect).trim()) {
    throw new Error('O arquivo de tarefas mudou desde que a tela foi carregada (talvez o agente tenha editado). Recarregue o plano e tente de novo.');
  }
  const lines = t.text.split('\n');
  lines[idx] = lines[idx].replace(/^(\s*[-*]\s+\[)[ xX~-](\])/, `$1${state}$2`);
  fs.writeFileSync(t.full, lines.join('\n'));
}

/** Acrescenta uma tarefa ao fim da fase (cria a fase, antes de "Descobertas", se ela não existir). */
function addTask(site, phaseName, text) {
  const txt = oneLine(text, 300); const ph = oneLine(String(phaseName || '').replace(/^#+\s*/, ''), 80);
  if (!txt) throw new Error('Escreva o texto da tarefa.'); if (!ph) throw new Error('Escolha a fase.');
  const t = readKind(site, 'tasks'); if (!t) throw new Error('Este projeto não tem o arquivo de tarefas.');
  const eol = t.text.includes('\r\n') ? '\r' : '';
  const lines = t.text.split('\n'); const phases = parseTasks(t.text);
  const target = phases.find((p) => p.name.toLowerCase() === ph.toLowerCase());
  if (target) {
    const at = (target.tasks.length ? target.tasks[target.tasks.length - 1].line : target.line) + 1;
    lines.splice(at, 0, `- [ ] ${txt}${eol}`);
  } else {
    const block = [`## ${ph}${eol}`, `- [ ] ${txt}${eol}`, `${eol}`];
    const desc = phases.find((p) => /^descobertas$/i.test(p.name));
    if (desc) lines.splice(desc.line, 0, ...block);
    else { if (lines[lines.length - 1] === '') lines.pop(); lines.push(`${eol}`, ...block.slice(0, 2), ''); }
  }
  fs.writeFileSync(t.full, lines.join('\n'));
}

/** Acrescenta uma anotação ao fim do diário, sob a seção de hoje (cria a seção se preciso). */
function addDiary(site, text) {
  const d = readKind(site, 'diary'); if (!d) throw new Error('Este projeto não tem o arquivo de diário.');
  const body = String(text == null ? '' : text).replace(/\r/g, '').trim();
  if (!body) throw new Error('Escreva a anotação.'); if (body.length > 2000) throw new Error('Anotação muito longa (máximo 2000 caracteres).');
  const now = new Date(); const date = `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}`; const time = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const nl = d.text.includes('\r\n') ? '\r\n' : '\n';
  const parts = body.split('\n').map((p) => p.trim()).filter(Boolean);
  const entry = [`- ${time} ${parts[0]}`, ...parts.slice(1).map((p) => `  ${p}`)].join(nl);
  const base = d.text.replace(/\s*$/, '');
  const heads = [...base.matchAll(/^##\s+(\d{2}\/\d{2}\/\d{4})\s*$/gm)];
  const today = heads.length && heads[heads.length - 1][1] === date;
  fs.writeFileSync(d.full, base + (today ? nl : nl + nl + `## ${date}` + nl) + entry + nl);
}

/** Ativa o plano num projeto: cria o que falta em docs/ e a seção de fluxo no CLAUDE.md/AGENTS.md. */
function init(site) { return [...aifiles.planFiles(site.path, site.name), ...aifiles.addFlow(site.path, site.name)]; }

module.exports = { get, overview, file, setState, addTask, addDiary, init, parseTasks, parseDiary, lastDiary };
