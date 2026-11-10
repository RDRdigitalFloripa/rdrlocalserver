// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 RDR Digital - https://github.com/RDRdigitalFloripa/rdrlocalserver
'use strict';
/** Avisos (Telegram e/ou webhook genérico: ntfy, Discord, Slack, n8n…) quando um backup falha ou termina. */
const https = require('https');
const http = require('http');
const { cfg, log } = require('./core');
const secrets = require('./secrets');

function post(urlStr, body) {
  return new Promise((resolve, reject) => {
    let u; try { u = new URL(urlStr); } catch (_) { return reject(new Error('URL inválida')); }
    if (!/^https?:$/.test(u.protocol)) return reject(new Error('Use http:// ou https://'));
    const data = Buffer.from(JSON.stringify(body));
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(u, { method: 'POST', timeout: 15000, headers: { 'Content-Type': 'application/json', 'Content-Length': data.length, 'User-Agent': 'rdr-local' } }, (r) => {
      r.resume(); r.on('end', () => (r.statusCode >= 200 && r.statusCode < 300 ? resolve() : reject(new Error('HTTP ' + r.statusCode))));
    });
    req.on('timeout', () => req.destroy(new Error('tempo esgotado')));
    req.on('error', reject); req.end(data);
  });
}

const TOKEN_RE = /^\d{5,}:[\w-]{30,}$/;
const validToken = (t) => TOKEN_RE.test(String(t || ''));
const validUrl = (u) => /^https?:\/\/[^\s]+$/i.test(String(u || ''));

/** Envia para os canais configurados. Devolve [{channel, ok, error?}]. */
async function send(title, text) {
  const s = secrets.read(); const out = [];
  if (s.telegramToken && cfg.notify.telegramChatId) {
    try { await post(`https://api.telegram.org/bot${s.telegramToken}/sendMessage`, { chat_id: cfg.notify.telegramChatId, text: `${title}\n${text}` }); out.push({ channel: 'telegram', ok: true }); }
    catch (e) { out.push({ channel: 'telegram', ok: false, error: e.message }); }
  }
  if (s.webhookUrl) {
    try { await post(s.webhookUrl, { title, text, content: `${title}\n${text}`, source: 'rdr-local' }); out.push({ channel: 'webhook', ok: true }); }
    catch (e) { out.push({ channel: 'webhook', ok: false, error: e.message }); }
  }
  return out;
}
/** kind: 'fail' | 'ok' — respeita as preferências. Nunca lança erro. */
async function event(kind, title, text) {
  try {
    if ((kind === 'fail' && !cfg.notify.onFail) || (kind === 'ok' && !cfg.notify.onOk)) return;
    const r = await send(title, text);
    r.filter((x) => !x.ok).forEach((x) => log(`Aviso (${x.channel}) não enviado: ${x.error}`));
  } catch (e) { log('Aviso não enviado: ' + e.message); }
}

module.exports = { send, event, validToken, validUrl };
