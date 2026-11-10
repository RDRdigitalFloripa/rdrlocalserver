// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 RDR Digital - https://github.com/RDRdigitalFloripa/rdrlocalserver
'use strict';
/**
 * Servidor SMTP falso para os testes (127.0.0.1, porta livre): fala SMTP de verdade (EHLO, STARTTLS, SSL/TLS direto,
 * AUTH PLAIN/LOGIN, MAIL/RCPT/DATA) e guarda o que recebeu, para conferir o que o cliente enviou.
 * opts: { tls: 'none'|'starttls'|'ssl', key, cert, auth: {user, pass}|null, authMechs, behavior }
 * behavior: normal | silent | hangup | busy | rcpt550 | xoauth
 */
const net = require('net');
const tls = require('tls');

const decodeWords = (s) => String(s).replace(/=\?UTF-8\?B\?([^?]*)\?=/gi, (m, b) => Buffer.from(b, 'base64').toString('utf8'));

function parseMessage(st) {
  const raw = st.data.join('\r\n'); const [head, ...rest] = raw.split('\r\n\r\n'); const body = rest.join('\r\n\r\n'); const headers = {};
  head.replace(/\r\n[ \t]+/g, ' ').split('\r\n').forEach((h) => { const i = h.indexOf(':'); if (i > 0) headers[h.slice(0, i).toLowerCase()] = h.slice(i + 1).trim(); });
  const text = /base64/i.test(headers['content-transfer-encoding'] || '') ? Buffer.from(body.replace(/\s+/g, ''), 'base64').toString('utf8') : body;
  return { envelopeFrom: st.from, envelopeTo: st.rcpt, headers, subject: decodeWords(headers.subject || ''), from: decodeWords(headers.from || ''), to: headers.to || '', text, raw };
}

function startFakeSmtp(opts = {}) {
  const o = { tls: 'none', auth: null, authMechs: ['PLAIN', 'LOGIN'], behavior: 'normal', key: null, cert: null, ...opts };
  const store = { messages: [], authAttempts: [], connections: 0 };

  const session = (sock, secure) => {
    let buf = ''; let step = ''; let tmpUser = ''; const st = { authed: !o.auth, from: '', rcpt: [], data: [] };
    const w = (s) => sock.write(s + '\r\n');
    const finishAuth = (user, pass) => {
      store.authAttempts.push({ user, pass });
      if (o.auth && user === o.auth.user && pass === o.auth.pass) { st.authed = true; return w('235 2.7.0 Authentication successful'); }
      return w('535 5.7.8 Authentication credentials invalid');
    };
    const line = (l) => {
      if (step === 'data') {
        if (l === '.') { step = ''; store.messages.push(parseMessage(st)); return w(`250 2.0.0 Ok: queued as FAKE${store.messages.length}`); }
        st.data.push(l.startsWith('..') ? l.slice(1) : l); return undefined;
      }
      if (step === 'login-user') { tmpUser = Buffer.from(l, 'base64').toString(); step = 'login-pass'; return w('334 UGFzc3dvcmQ6'); }
      if (step === 'login-pass') { step = ''; return finishAuth(tmpUser, Buffer.from(l, 'base64').toString()); }
      const cmd = l.split(' ')[0].toUpperCase();
      if (cmd === 'EHLO' || cmd === 'HELO') {
        const caps = ['fake'];
        if (o.tls === 'starttls' && !secure) caps.push('STARTTLS');
        if (o.behavior === 'xoauth') caps.push('AUTH XOAUTH2');
        else if (o.auth && (secure || o.tls === 'none')) caps.push('AUTH ' + o.authMechs.join(' '));
        caps.forEach((c, i) => w((i < caps.length - 1 ? '250-' : '250 ') + c)); return undefined;
      }
      if (cmd === 'STARTTLS') {
        if (o.tls !== 'starttls' || secure) return w('503 5.5.1 Error');
        w('220 2.0.0 Ready to start TLS'); sock.removeAllListeners('data');
        const t = new tls.TLSSocket(sock, { isServer: true, key: o.key, cert: o.cert }); t.on('error', () => {}); session(t, true); return undefined;
      }
      if (cmd === 'AUTH') {
        if (o.tls === 'starttls' && !secure) return w('530 5.7.0 Must issue a STARTTLS command first');
        if (o.behavior === 'xoauth') return w('504 5.5.4 Unrecognized authentication type');
        const [, mech, arg] = l.split(' '); const m = String(mech).toUpperCase();
        if (!o.authMechs.includes(m)) return w('504 5.5.4 Unrecognized authentication type');
        if (m === 'PLAIN') { const p = Buffer.from(arg || '', 'base64').toString().split('\0'); return finishAuth(p[1], p[2]); }
        step = 'login-user'; return w('334 VXNlcm5hbWU6');
      }
      if (cmd === 'MAIL') { if (!st.authed) return w('530 5.7.0 Authentication required'); st.from = (/<([^>]*)>/.exec(l) || [])[1] || ''; return w('250 2.1.0 Ok'); }
      if (cmd === 'RCPT') {
        if (!st.authed) return w('530 5.7.0 Authentication required');
        if (o.behavior === 'rcpt550') return w('550 5.7.1 Relay access denied');
        st.rcpt.push((/<([^>]*)>/.exec(l) || [])[1] || ''); return w('250 2.1.5 Ok');
      }
      if (cmd === 'DATA') { step = 'data'; return w('354 End data with <CR><LF>.<CR><LF>'); }
      if (cmd === 'QUIT') { w('221 2.0.0 Bye'); sock.end(); return undefined; }
      return w('502 5.5.2 Error: command not recognized');
    };
    sock.on('data', (d) => { buf += d.toString('utf8'); let i; while ((i = buf.indexOf('\r\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 2); line(l); } });
    sock.on('error', () => {});
  };

  const onSocket = (raw) => {
    store.connections++; raw.on('error', () => {});
    if (o.behavior === 'silent') return;
    if (o.behavior === 'hangup') { raw.write('220 oi\r\n'); setTimeout(() => raw.destroy(), 60); return; }
    if (o.behavior === 'busy') { raw.write('421 4.3.2 Servico indisponivel\r\n'); return; }
    session(raw, o.tls === 'ssl'); raw.write('220 fake ESMTP ready\r\n');
  };
  const srv = o.tls === 'ssl' ? tls.createServer({ key: o.key, cert: o.cert }, onSocket) : net.createServer(onSocket);
  srv.on('tlsClientError', () => {});
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve({ port: srv.address().port, host: '127.0.0.1', store, messages: store.messages, close: () => srv.close() })));
}

module.exports = { startFakeSmtp, decodeWords };
