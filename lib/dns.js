// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 RDR Digital - https://github.com/RDRdigitalFloripa/rdrlocalserver
'use strict';
/** DNS local: responde 127.0.0.1 para qualquer nome da terminação configurada (ex.: *.test), permitindo subdomínios wildcard sem editar o hosts. */
const dgram = require('dgram');
const core = require('./core');
const { IS_WIN, cfg, log, run } = core;

const PORT = () => Number(process.env.RDR_DNS_PORT || 53);
let sock = null;

/** Lê o nome da pergunta (sem compressão, como todo resolvedor envia). */
function readQuestion(buf) {
  let i = 12; const labels = [];
  while (i < buf.length) {
    const len = buf[i];
    if (len === 0) { i += 1; break; }
    if (len & 0xc0) return null;
    labels.push(buf.toString('ascii', i + 1, i + 1 + len)); i += len + 1;
  }
  if (i + 4 > buf.length) return null;
  return { name: labels.join('.').toLowerCase(), qtype: buf.readUInt16BE(i), end: i + 4 };
}

function answer(msg) {
  if (msg.length < 17) return null;
  const q = readQuestion(msg); if (!q) return null;
  const tld = cfg.tld;
  const mine = q.name === tld || q.name.endsWith('.' + tld);
  const head = Buffer.alloc(12);
  msg.copy(head, 0, 0, 2);                                                   // id
  const rd = msg.readUInt16BE(2) & 0x0100;
  const question = msg.subarray(12, q.end);
  if (!mine) { head.writeUInt16BE(0x8000 | rd | 0x0080 | 5, 2); head.writeUInt16BE(1, 4); return Buffer.concat([head, question]); }   // REFUSED
  const wantA = q.qtype === 1 || q.qtype === 255;
  head.writeUInt16BE(0x8400 | rd | 0x0080, 2);                               // resposta autoritativa, NOERROR
  head.writeUInt16BE(1, 4); head.writeUInt16BE(wantA ? 1 : 0, 6);
  if (!wantA) return Buffer.concat([head, question]);                        // AAAA/HTTPS etc.: sem resposta (cliente usa IPv4)
  const rr = Buffer.from([0xc0, 0x0c, 0, 1, 0, 1, 0, 0, 0, 60, 0, 4, 127, 0, 0, 1]);
  return Buffer.concat([head, question, rr]);
}

function start() {
  if (sock) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = dgram.createSocket('udp4');
    s.on('message', (msg, rinfo) => { try { const a = answer(msg); if (a) s.send(a, rinfo.port, rinfo.address); } catch (_) { /* pacote inválido */ } });
    s.once('error', (e) => { try { s.close(); } catch (_) { /* ok */ } reject(new Error(e.code === 'EADDRINUSE' || e.code === 'EACCES'
      ? `Não consegui abrir a porta ${PORT()}/UDP do DNS local (${e.code}). Outro programa usa a porta 53 (ICS/Docker/WSL?) ou falta executar como Administrador.` : e.message)); });
    s.bind(PORT(), '127.0.0.1', () => { sock = s; s.on('error', (e) => log('DNS local: ' + e.message)); resolve(); });
  });
}
function stop() { if (sock) { try { sock.close(); } catch (_) { /* ok */ } sock = null; } }
const isRunning = () => !!sock;

// ---------- Windows: manda só a terminação do RDR (.test) para o DNS local (NRPT) ----------
const ps = (cmd) => run('powershell', ['-NoProfile', '-NonInteractive', '-Command', cmd], { timeout: 30000 });
async function removeNrpt() {
  if (!IS_WIN) return;
  await ps("Get-DnsClientNrptRule | Where-Object { $_.Comment -eq 'RDR Local' } | Remove-DnsClientNrptRule -Force");
}
async function ensureNrpt() {
  if (!IS_WIN) return;
  await removeNrpt();
  const r = await ps(`Add-DnsClientNrptRule -Namespace '.${cfg.tld}' -NameServers '127.0.0.1' -Comment 'RDR Local'; ipconfig /flushdns | Out-Null`);
  if (!r.ok) throw new Error('Não consegui criar a regra de DNS do Windows (precisa de Administrador): ' + r.out.slice(-200));
}
async function nrptStatus() {
  if (!IS_WIN) return null;
  const r = await ps("(Get-DnsClientNrptRule | Where-Object { $_.Comment -eq 'RDR Local' } | Measure-Object).Count");
  return r.ok && Number(r.out.trim()) > 0;
}

module.exports = { start, stop, isRunning, ensureNrpt, removeNrpt, nrptStatus, answer, PORT };
