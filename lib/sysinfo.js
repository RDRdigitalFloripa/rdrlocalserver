// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 RDR Digital - https://github.com/RDRdigitalFloripa/rdrlocalserver
'use strict';
/** Métricas do sistema: CPU, memória, disco e rede. */
const os = require('os');
const fs = require('fs');
const { execFile } = require('child_process');
const { P, IS_WIN } = require('./core');

let prev = os.cpus();
let cpu = 0;
setInterval(() => {
  const cur = os.cpus(); let idle = 0; let total = 0;
  cur.forEach((c, i) => {
    for (const k of Object.keys(c.times)) total += c.times[k] - prev[i].times[k];
    idle += c.times.idle - prev[i].times.idle;
  });
  prev = cur;
  cpu = total ? Math.round((1 - idle / total) * 1000) / 10 : 0;
}, 2000).unref();

function disk() {
  try {
    const s = fs.statfsSync(P.root);
    return { total: s.blocks * s.bsize, free: s.bavail * s.bsize };
  } catch (_) { return { total: 0, free: 0 }; }
}

const history = [];
setInterval(() => { history.push(cpu); if (history.length > 60) history.shift(); }, 2000).unref();

// ---------- rede ----------
// Windows: "netstat -e" (totais recebidos/enviados das interfaces; a linha "Bytes" é igual em qualquer idioma, ~80 ms).
// Linux: /proc/net/dev (sem a interface lo). Só amostra enquanto o painel pede (metrics() foi chamada há pouco).
const NET_PEAK = 0x100000000; // contadores de 32 bits dão a volta em 4 GB
const net = { ok: false, rx: 0, tx: 0, totalRx: 0, totalTx: 0, rxHistory: [], txHistory: [], prev: null, lastAsk: 0, busy: false };

function readNet() {
  return new Promise((resolve) => {
    if (IS_WIN) {
      execFile('netstat', ['-e'], { windowsHide: true, timeout: 4000 }, (err, out) => {
        if (err) return resolve(null);
        const m = /^\s*Bytes\s+(\d+)\s+(\d+)/im.exec(String(out));
        resolve(m ? { rx: Number(m[1]), tx: Number(m[2]) } : null);
      });
    } else {
      fs.readFile('/proc/net/dev', 'utf8', (err, t) => {
        if (err) return resolve(null);
        let rx = 0; let tx = 0;
        for (const l of String(t).split('\n').slice(2)) { const m = /^\s*([^:\s]+):\s*(\d+)(?:\s+\d+){7}\s+(\d+)/.exec(l); if (m && m[1] !== 'lo') { rx += Number(m[2]); tx += Number(m[3]); } }
        resolve({ rx, tx });
      });
    }
  });
}
/** Diferença entre duas leituras: trata a volta do contador de 32 bits e o reinício (adaptador reconectado) sem inventar picos. */
function delta(cur, old) {
  let d = cur - old;
  if (d < 0) d = old <= NET_PEAK ? d + NET_PEAK : 0;
  return d > NET_PEAK / 2 ? 0 : d; // mais de 2 GB em uma amostra não é tráfego: é reinício do contador
}
async function sampleNet() {
  if (net.busy) return; net.busy = true;
  try {
    const cur = await readNet(); const now = Date.now();
    if (!cur) { net.ok = false; return; }
    net.ok = true; net.totalRx = cur.rx; net.totalTx = cur.tx;
    if (net.prev && now - net.prev.t < 10000) {
      const dt = Math.max(0.5, (now - net.prev.t) / 1000);
      net.rx = delta(cur.rx, net.prev.rx) / dt; net.tx = delta(cur.tx, net.prev.tx) / dt;
    } else { net.rx = 0; net.tx = 0; } // primeira leitura, ou o painel ficou fechado: não dá para saber a taxa
    net.prev = { t: now, rx: cur.rx, tx: cur.tx };
    net.rxHistory.push(net.rx); net.txHistory.push(net.tx);
    if (net.rxHistory.length > 60) { net.rxHistory.shift(); net.txHistory.shift(); }
  } finally { net.busy = false; }
}
setInterval(() => { if (Date.now() - net.lastAsk < 15000) sampleNet().catch(() => {}); }, 2000).unref();

function metrics() {
  const total = os.totalmem(); const free = os.freemem();
  if (!net.lastAsk || Date.now() - net.lastAsk > 15000) sampleNet().catch(() => {}); // acorda a amostragem (a primeira leitura só marca o ponto de partida)
  net.lastAsk = Date.now();
  return {
    cpu, cpuHistory: history, mem: { total, used: total - free }, disk: disk(), uptime: os.uptime(),
    net: { ok: net.ok, rx: net.rx, tx: net.tx, rxHistory: net.rxHistory, txHistory: net.txHistory, totalRx: net.totalRx, totalTx: net.totalTx },
  };
}

module.exports = { metrics, delta };
