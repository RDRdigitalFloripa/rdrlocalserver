// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 RDR Digital - https://github.com/RDRdigitalFloripa/rdrlocalserver
'use strict';
/**
 * Atualização do próprio RDR Local: consulta a última release no GitHub, baixa o instalador, confere o SHA-256
 * publicado junto e só então abre o instalador (que encerra o programa antigo e mantém os dados).
 * Nada é instalado em silêncio: o assistente do instalador abre e o usuário confirma.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const core = require('./core');
const { P, IS_WIN, getJson, get, download, log } = core;

const REPO = 'RDRdigitalFloripa/rdrlocalserver';
const BASE = `https://github.com/${REPO}/releases/download/`;
const sha256 = (f) => new Promise((res, rej) => { const h = crypto.createHash('sha256'); fs.createReadStream(f).on('data', (d) => h.update(d)).on('end', () => res(h.digest('hex'))).on('error', rej); });

/** Última release publicada ou null (repositório sem release, ou privado). Lança erro só em falha de rede. */
async function latest() {
  if (process.env.RDR_FAKE_APP_RELEASE) return JSON.parse(process.env.RDR_FAKE_APP_RELEASE); // só para testes
  let rel;
  try { rel = await getJson(`https://api.github.com/repos/${REPO}/releases/latest`); } catch (e) { if (/HTTP 404/.test(e.message)) return null; throw e; }
  const version = String(rel.tag_name || '').replace(/^v/i, '');
  if (!/^\d+\.\d+\.\d+$/.test(version)) return null;
  const assets = rel.assets || [];
  const exe = assets.find((a) => a.name === `RDR-Local-Setup-${version}.exe`);
  const sha = assets.find((a) => a.name === `RDR-Local-Setup-${version}.sha256`);
  const page = String(rel.html_url || '');
  return {
    version, notes: String(rel.body || '').slice(0, 800),
    url: page.startsWith(`https://github.com/${REPO}/`) ? page : `https://github.com/${REPO}/releases`,
    exe: exe ? exe.browser_download_url : '', sha: sha ? sha.browser_download_url : '', ready: !!(exe && sha),
  };
}

/** Baixa o instalador da última versão, confere o SHA-256 e abre o assistente. */
async function install(jl = () => {}) {
  const rel = await latest();
  if (!rel) throw new Error('Nenhuma versão publicada no GitHub (Releases).');
  if (!rel.ready) throw new Error(`A versão ${rel.version} não tem o instalador e o arquivo .sha256 publicados. Baixe manualmente em ${rel.url}`);
  for (const u of [rel.exe, rel.sha]) if (!String(u).startsWith(BASE)) throw new Error('Endereço de download inesperado: recusado.');
  const dir = path.join(P.data, 'updates'); fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(dir)) if (/^RDR-Local-Setup-.*\.exe$/.test(f)) fs.rmSync(path.join(dir, f), { force: true }); // instaladores antigos
  const file = path.join(dir, `RDR-Local-Setup-${rel.version}.exe`);
  const m = /\b([0-9a-f]{64})\b/i.exec((await get(rel.sha)).toString('utf8'));
  if (!m) throw new Error('O arquivo .sha256 da versão não é válido: nada foi baixado.');
  jl(`Baixando o instalador do RDR Local ${rel.version}...`);
  await download(rel.exe, file, jl);
  jl('Verificando a integridade (SHA-256)...');
  if ((await sha256(file)).toLowerCase() !== m[1].toLowerCase()) { fs.rmSync(file, { force: true }); throw new Error('SHA-256 não confere: download descartado.'); }
  jl('Integridade confirmada.');
  log(`Instalador do RDR Local ${rel.version} baixado e conferido.`);
  if (!IS_WIN) { jl(`Fora do Windows o instalador não abre sozinho. Arquivo: ${file}`); return; }
  jl('Abrindo o instalador. Ele encerra o RDR Local atual, troca o programa e mantém seus dados; confirme as telas dele.');
  spawn('cmd', ['/c', 'start', '', file], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
}

module.exports = { latest, install, REPO };
