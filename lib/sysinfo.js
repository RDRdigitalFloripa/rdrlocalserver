// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 RDR Digital - https://github.com/RDRdigitalFloripa/rdrlocalserver
'use strict';
/** Métricas do sistema: CPU, memória, disco. */
const os = require('os');
const fs = require('fs');
const { P } = require('./core');

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

function metrics() {
  const total = os.totalmem(); const free = os.freemem();
  return { cpu, cpuHistory: history, mem: { total, used: total - free }, disk: disk(), uptime: os.uptime() };
}

module.exports = { metrics };
