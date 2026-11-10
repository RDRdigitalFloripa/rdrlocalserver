// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 RDR Digital - https://github.com/RDRdigitalFloripa/rdrlocalserver
'use strict';
/**
 * Cliente SMTP mínimo, sem dependências (net + tls): testa uma conexão real (DNS, TCP, TLS, STARTTLS, AUTH) e envia
 * UM e-mail de teste, devolvendo cada etapa com o tempo e, se falhar, o motivo em português com a dica do que conferir.
 * A senha nunca entra no log nem nas etapas. Não envia usuário/senha sem criptografia (exceto para a própria máquina).
 */
const net = require('net');
const tls = require('tls');
const dns = require('dns');
const crypto = require('crypto');

const timeoutMs = () => Number(process.env.RDR_SMTP_TIMEOUT_MS) || 15000; // a variável existe só para testes
const EMAIL_RE = /^[^\s<>@",;:()[\]\\]+@[^\s<>@",;:()[\]\\]+\.[^\s<>@",;:()[\]\\]+$/;
const isLocal = (h) => /^(localhost|127\.\d+\.\d+\.\d+|::1|\[::1\])$/i.test(h);
const b64 = (s) => Buffer.from(String(s), 'utf8').toString('base64');

/** Sugestões de provedores (confirme sempre na documentação do seu provedor: esses dados mudam). */
const PRESETS = [
  { id: 'gmail', label: 'Gmail / Google Workspace', host: 'smtp.gmail.com', port: 587, secure: 'starttls', note: 'Use uma "senha de app" (com a verificação em duas etapas ligada). A senha normal da conta não funciona por SMTP.' },
  { id: 'microsoft365', label: 'Microsoft 365 / Outlook', host: 'smtp.office365.com', port: 587, secure: 'starttls', note: 'O administrador precisa permitir "SMTP AUTH" na caixa. Contas novas podem exigir OAuth e recusar senha.' },
  { id: 'sendgrid', label: 'SendGrid', host: 'smtp.sendgrid.net', port: 587, secure: 'starttls', user: 'apikey', note: 'Usuário: apikey. Senha: sua API key. O remetente precisa estar verificado no SendGrid.' },
  { id: 'brevo', label: 'Brevo (Sendinblue)', host: 'smtp-relay.brevo.com', port: 587, secure: 'starttls', note: 'Usuário: o e-mail da conta. Senha: a chave SMTP (não a senha do login).' },
  { id: 'mailgun', label: 'Mailgun', host: 'smtp.mailgun.org', port: 587, secure: 'starttls', note: 'Usuário: postmaster@seu-domínio. Senha: a senha SMTP do domínio.' },
  { id: 'ses', label: 'Amazon SES', host: 'email-smtp.us-east-1.amazonaws.com', port: 587, secure: 'starttls', note: 'Troque a região no servidor. Usuário e senha SMTP são gerados no SES (não são a chave de acesso da AWS). O remetente precisa estar verificado.' },
  { id: 'zoho', label: 'Zoho Mail', host: 'smtp.zoho.com', port: 465, secure: 'ssl', note: 'Use a senha da conta ou uma senha de aplicativo.' },
  { id: 'hostinger', label: 'Hostinger', host: 'smtp.hostinger.com', port: 465, secure: 'ssl', note: 'Usuário: o endereço de e-mail completo.' },
];

/** Resposta do servidor: várias linhas "250-..." e a última "250 ...". */
function channel(sock) {
  let buf = ''; let cur = []; const replies = []; let err = null; let waiter = null;
  const wake = () => { if (waiter) waiter(); };
  sock.on('data', (d) => {
    buf += d.toString('utf8'); let m;
    while ((m = /\r?\n/.exec(buf))) {
      const line = buf.slice(0, m.index); buf = buf.slice(m.index + m[0].length); cur.push(line);
      if (/^\d{3}(?: |$)/.test(line)) { replies.push({ code: Number(line.slice(0, 3)), lines: cur }); cur = []; }
    }
    wake();
  });
  sock.on('error', (e) => { err = err || e; wake(); });
  sock.on('close', () => { err = err || Object.assign(new Error('O servidor encerrou a conexão.'), { code: 'ECONNRESET' }); wake(); });
  return {
    sock,
    write: (s) => sock.write(s),
    read: (ms = timeoutMs()) => new Promise((res, rej) => {
      let timer = null;
      const done = () => { clearTimeout(timer); waiter = null; };
      waiter = () => { if (replies.length) { done(); res(replies.shift()); } else if (err) { done(); rej(err); } };
      timer = setTimeout(() => { done(); rej(Object.assign(new Error('Sem resposta do servidor a tempo.'), { code: 'ETIMEDOUT' })); }, ms);
      waiter();
    }),
  };
}

const smtpErr = (stage, r) => Object.assign(new Error(`${stage}: ${r.lines.join(' ')}`), { smtpCode: r.code, stage });
const once = (sock, ev, ms) => new Promise((res, rej) => {
  const timer = setTimeout(() => { sock.destroy(); rej(Object.assign(new Error('Tempo esgotado ao conectar.'), { code: 'ETIMEDOUT' })); }, ms);
  sock.once(ev, () => { clearTimeout(timer); res(); });
  sock.once('error', (e) => { clearTimeout(timer); rej(e); });
});

/** Nome do remetente seguro para o cabeçalho (sem CR/LF/aspas/<>), codificado se tiver acentos. */
function nameHeader(name) {
  const n = String(name || '').replace(/[\r\n\0"<>\\]/g, '').trim().slice(0, 100);
  if (!n) return '';
  if (/^[\x20-\x7E]*$/.test(n)) return /[(),.:;@[\]]/.test(n) ? `"${n}"` : n;
  return `=?UTF-8?B?${b64(n)}?=`;
}
const subjectHeader = (s) => (/^[\x20-\x7E]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`);

/** Mensagem de texto simples (UTF-8 em base64): nada no corpo pode "fechar" o DATA nem quebrar cabeçalhos. */
function buildMessage({ from, fromName, to, subject, text }) {
  const dom = (from.split('@')[1] || 'localhost');
  const id = `<${crypto.randomUUID()}@${dom}>`;
  const nm = nameHeader(fromName);
  const head = [
    `From: ${nm ? `${nm} ` : ''}<${from}>`, `To: <${to}>`, `Subject: ${subjectHeader(subject)}`,
    `Date: ${new Date().toUTCString().replace('GMT', '+0000')}`, `Message-ID: ${id}`, 'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64', 'X-Mailer: RDR Local',
  ].join('\r\n');
  const body = b64(text).replace(/(.{76})/g, '$1\r\n');
  return { id, data: `${head}\r\n\r\n${body}`.replace(/^\./gm, '..') };
}

/** Traduz o erro (de rede, TLS ou do servidor) para uma mensagem em português e o que conferir. */
function explain(e, cfgv) {
  const code = e && e.code; const msg = String((e && e.message) || e); const sc = e && e.smtpCode;
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return ['Não consegui encontrar o servidor pelo nome.', 'Confira a digitação do servidor (host) e a conexão com a internet/DNS.'];
  if (code === 'ECONNREFUSED') return ['O servidor recusou a conexão nessa porta.', 'Confira a porta (587 costuma ser STARTTLS, 465 SSL/TLS, 25 sem criptografia) e se o serviço está no ar.'];
  if (code === 'ETIMEDOUT' || /Tempo esgotado|Sem resposta/.test(msg)) return ['O servidor não respondeu a tempo.', 'Firewall, antivírus ou a operadora podem estar bloqueando a porta (a 25 de saída costuma ser bloqueada). Tente 587 ou 465, ou outra rede.'];
  if (code === 'ECONNRESET' || /encerrou a conexão/.test(msg)) return ['O servidor encerrou a conexão no meio do caminho.', 'Pode ser o modo de segurança errado para a porta (465 exige SSL/TLS direto; 587, STARTTLS), ou bloqueio por IP.'];
  if (/wrong version number|packet length too long|SSL routines|ssl3_get_record|unknown protocol/i.test(msg) || code === 'EPROTO') return ['O servidor não entendeu a conexão segura.', 'O modo de segurança não combina com a porta: 465 usa SSL/TLS direto; 587 usa STARTTLS; 25 costuma ser sem criptografia.'];
  if (/ERR_TLS_CERT_ALTNAME_INVALID|altnames|Hostname\/IP does not match/.test(msg) || code === 'ERR_TLS_CERT_ALTNAME_INVALID') return ['O certificado do servidor não é do nome que você digitou.', 'Confira o servidor (host). Em um servidor seu com certificado próprio, marque "Aceitar certificado inválido (só para teste)".'];
  if (/CERT_HAS_EXPIRED/.test(code || msg)) return ['O certificado do servidor está vencido.', 'Avise o provedor, ou marque "Aceitar certificado inválido (só para teste)" se o servidor é seu.'];
  if (/SELF_SIGNED|UNABLE_TO_VERIFY|UNABLE_TO_GET_ISSUER|certificate/i.test((code || '') + msg)) return ['O certificado do servidor não é confiável.', 'Em servidor de provedor isso indica interceptação ou antivírus com inspeção de HTTPS. Em servidor seu, marque "Aceitar certificado inválido (só para teste)".'];
  if (e && e.stage === 'AUTH-INSEGURO') return ['Não envio usuário e senha sem criptografia.', 'Escolha STARTTLS ou SSL/TLS (só a própria máquina pode usar "Nenhuma" com senha).'];
  if (e && e.stage === 'STARTTLS-AUSENTE') return ['O servidor não oferece STARTTLS nessa porta.', 'Troque a segurança para "SSL/TLS" (porta 465) ou confira a porta.'];
  if (e && e.stage === 'AUTH-SEM-METODO') return [msg, 'O servidor só oferece métodos como OAuth. Use uma senha de app (Gmail), SMTP AUTH liberado (Microsoft 365) ou outro provedor.'];
  if (sc === 535 || sc === 534 || sc === 530 || /Autentica/.test(e && e.stage)) return ['Usuário ou senha recusados.', 'Gmail e Outlook exigem "senha de app" (a senha normal não funciona por SMTP). SendGrid: usuário "apikey". Confira também se o usuário é o e-mail completo.'];
  if (sc === 553 || sc === 550 || sc === 554 || sc === 551 || sc === 501) return ['O servidor recusou o remetente ou o destinatário.', 'O e-mail do remetente (From) costuma precisar ser da conta autenticada ou do domínio verificado no provedor; confira também o destinatário.'];
  if (sc === 421 || sc === 450 || sc === 451 || sc === 452) return ['O servidor está indisponível ou limitando envios agora.', 'Tente de novo em alguns minutos; pode ser limite de envio ou greylisting.'];
  if (sc === 552 || sc === 554) return ['O servidor rejeitou a mensagem.', 'Veja a resposta do servidor nas etapas acima.'];
  return [msg, 'Veja a resposta do servidor nas etapas acima.'];
}

/**
 * mode: 'connect' (até a autenticação, sem enviar nada) ou 'send' (envia o e-mail de teste).
 * cfgv = { host, port, secure: 'starttls'|'ssl'|'none', user, from, fromName, insecureTls }; pass = senha (não entra no log).
 */
async function test(cfgv, pass, mode, to) {
  const steps = []; const t0 = Date.now();
  const step = (text, ok = true) => steps.push({ ok, text, ms: Date.now() - t0 });
  const host = cfgv.host; const port = Number(cfgv.port); const ssl = cfgv.secure === 'ssl'; const reject = !cfgv.insecureTls;
  let ch = null;
  try {
    if (cfgv.user && cfgv.secure === 'none' && !isLocal(host)) throw Object.assign(new Error('Usuário e senha sem criptografia.'), { stage: 'AUTH-INSEGURO' });
    const addr = await dns.promises.lookup(host); step(`Servidor ${host} encontrado (${addr.address}).`);
    const sock = ssl
      ? tls.connect({ host, port, servername: net.isIP(host) ? undefined : host, rejectUnauthorized: reject })
      : net.connect({ host, port });
    await once(sock, ssl ? 'secureConnect' : 'connect', timeoutMs());
    step(ssl ? `Conectado a ${host}:${port} com SSL/TLS (${sock.getProtocol()}${reject ? '' : ', certificado não verificado'}).` : `Conectado a ${host}:${port}.`);
    ch = channel(sock);
    const g = await ch.read(); if (g.code !== 220) throw smtpErr('Saudação', g);
    step(`Servidor: ${g.lines[0]}`);
    const ehlo = async () => { ch.write('EHLO localhost\r\n'); const r = await ch.read(); if (r.code !== 250) throw smtpErr('EHLO', r); return r.lines.map((l) => l.slice(4).toUpperCase()); };
    let caps = await ehlo(); step('Apresentação (EHLO) aceita.');
    if (cfgv.secure === 'starttls') {
      if (!caps.includes('STARTTLS')) throw Object.assign(new Error('Sem STARTTLS.'), { stage: 'STARTTLS-AUSENTE' });
      ch.write('STARTTLS\r\n'); const r = await ch.read(); if (r.code !== 220) throw smtpErr('STARTTLS', r);
      const raw = ch.sock; raw.removeAllListeners('data');
      const t = tls.connect({ socket: raw, host, servername: net.isIP(host) ? undefined : host, rejectUnauthorized: reject });
      await once(t, 'secureConnect', timeoutMs()); ch = channel(t);
      step(`Conexão protegida com STARTTLS (${t.getProtocol()}${reject ? '' : ', certificado não verificado'}).`);
      caps = await ehlo();
    }
    if (cfgv.user) {
      const mech = (caps.find((c) => c.startsWith('AUTH ')) || '').slice(5).split(/\s+/).filter(Boolean);
      if (!mech.length) step('O servidor não anuncia autenticação: seguindo sem login.');
      else {
        let r;
        if (mech.includes('PLAIN')) { ch.write(`AUTH PLAIN ${b64(`\0${cfgv.user}\0${pass}`)}\r\n`); r = await ch.read(); }
        else if (mech.includes('LOGIN')) {
          ch.write('AUTH LOGIN\r\n'); r = await ch.read();
          if (r.code === 334) { ch.write(`${b64(cfgv.user)}\r\n`); r = await ch.read(); }
          if (r.code === 334) { ch.write(`${b64(pass)}\r\n`); r = await ch.read(); }
        } else throw Object.assign(new Error(`O servidor só oferece autenticação por: ${mech.join(', ')}.`), { stage: 'AUTH-SEM-METODO' });
        if (r.code !== 235) throw smtpErr('Autenticação', r);
        step(`Autenticado como ${cfgv.user} (AUTH ${mech.includes('PLAIN') ? 'PLAIN' : 'LOGIN'}).`);
      }
    } else step('Sem usuário: seguindo sem autenticação.');

    if (mode === 'connect') { ch.write('QUIT\r\n'); step('Conexão testada: o servidor aceitou a conexão e o login. Nenhum e-mail foi enviado.'); return { ok: true, steps }; }

    const stamp = new Date().toLocaleString('pt-BR');
    const msg = buildMessage({ from: cfgv.from, fromName: cfgv.fromName, to, subject: `Teste do RDR Local (${stamp})`, text: `Este é um e-mail de teste enviado pelo RDR Local em ${stamp}.\r\n\r\nSe você o recebeu, o servidor SMTP ${host}:${port} está configurado corretamente.\r\nAcentuação: ação, coração, você. Linha que começa com ponto:\r\n.fim` });
    ch.write(`MAIL FROM:<${cfgv.from}>\r\n`); let r = await ch.read(); if (r.code !== 250) throw smtpErr('Remetente', r); step(`Remetente <${cfgv.from}> aceito.`);
    ch.write(`RCPT TO:<${to}>\r\n`); r = await ch.read(); if (r.code !== 250 && r.code !== 251) throw smtpErr('Destinatário', r); step(`Destinatário <${to}> aceito.`);
    ch.write('DATA\r\n'); r = await ch.read(); if (r.code !== 354) throw smtpErr('DATA', r);
    ch.write(`${msg.data}\r\n.\r\n`); r = await ch.read(timeoutMs() * 2); if (r.code !== 250) throw smtpErr('Envio', r);
    step(`Mensagem aceita pelo servidor: ${r.lines[0]}`);
    ch.write('QUIT\r\n');
    return { ok: true, steps, response: r.lines.join(' '), messageId: msg.id };
  } catch (e) {
    const [message, hint] = explain(e, cfgv);
    step(`${message}${e && e.smtpCode ? ` (servidor: ${e.smtpCode})` : ''}`, false);
    return { ok: false, steps, error: message, detail: String((e && e.message) || e), hint };
  } finally { try { if (ch) ch.sock.destroy(); } catch (_) { /* ok */ } }
}

module.exports = { test, explain, buildMessage, nameHeader, PRESETS, EMAIL_RE, isLocal };
