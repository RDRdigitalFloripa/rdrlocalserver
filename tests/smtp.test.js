// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 RDR Digital - https://github.com/RDRdigitalFloripa/rdrlocalserver
'use strict';
/** Cliente SMTP próprio (lib/smtp.js) contra servidores SMTP falsos: sem criptografia, STARTTLS, SSL/TLS direto, login e as falhas que o usuário encontra. */
const h = require('./lib/harness');
const tools = require('./lib/tools');
const { startFakeSmtp } = require('./lib/fakesmtp');

const PW = 's3nh@-t3ste'; const USER = 'rdruser';
const noLeak = (r) => !JSON.stringify(r).includes(PW);

h.run(async () => {
  h.isolateHome(); process.env.RDR_SMTP_TIMEOUT_MS = '3000';
  const smtp = require('../lib/smtp');
  const pki = tools.makeCert();
  const A0 = { host: '127.0.0.1', secure: 'none', user: '', from: 'rdr@exemplo.com.br', fromName: 'Equipe RDR Ação', insecureTls: false };
  const servers = [];
  const up = async (o) => { const s = await startFakeSmtp(o); servers.push(s); return s; };

  h.title('1) mensagem e cabeçalhos (sem rede)');
  const bm = smtp.buildMessage({ from: 'a@b.com', fromName: 'Evil\r\nBcc: x@y.z "x"<y>', to: 'c@d.com', subject: 'Olá', text: '.ponto no começo\r\n..dois\r\nfim' });
  h.ok(!/\r\nBcc:/i.test(bm.data), 'nome do remetente com CR/LF, aspas e <> não injeta cabeçalho (Bcc)', bm.data.split('\r\n').slice(0, 3).join(' | '));
  h.ok(/^Subject: =\?UTF-8\?B\?/m.test(bm.data) && smtp.nameHeader('Equipe Ação').startsWith('=?UTF-8?B?'), 'assunto e nome com acento vão codificados (RFC 2047)');
  h.ok(/Content-Transfer-Encoding: base64/.test(bm.data) && !/^\./m.test(bm.data.split('\r\n\r\n')[1] || ''), 'corpo em base64 (nenhuma linha começa com ponto)');
  h.ok(/^Message-ID: <[0-9a-f-]{36}@b\.com>\r\n/m.test(bm.data) && /^Date: .* \+0000\r\n/m.test(bm.data), 'Message-ID e Date no formato certo');

  h.title('2) servidor A: sem criptografia e sem login');
  const A = await up({ tls: 'none' }); const a = { ...A0, port: A.port };
  let r = await smtp.test(a, '', 'connect', '');
  h.ok(r.ok && A.messages.length === 0, 'testar conexão: ok e NENHUM e-mail enviado', JSON.stringify(r.steps));
  r = await smtp.test(a, '', 'send', 'destino@exemplo.com');
  h.ok(r.ok && r.messageId && /Mensagem aceita/.test(r.steps[r.steps.length - 1].text), 'enviar teste: aceito pelo servidor (com Message-ID)', JSON.stringify(r));
  const m = A.messages[0];
  h.ok(m && /^Teste do RDR Local \(/.test(m.subject) && m.envelopeTo.includes('destino@exemplo.com') && m.envelopeFrom === 'rdr@exemplo.com.br', 'o servidor recebeu: assunto, destinatário e remetente', JSON.stringify(m && { s: m.subject, f: m.envelopeFrom, t: m.envelopeTo }));
  h.ok(m && /Equipe RDR Ação/.test(m.from), 'nome do remetente com acento chegou decodificado ("Equipe RDR Ação")', m && m.from);
  h.ok(m && /ação, coração, você/.test(m.text) && /^\.fim$/m.test(m.text), 'corpo UTF-8 intacto, inclusive a linha que começa com ponto (".fim")', m && m.text);
  h.ok(noLeak(r), 'a resposta não contém senha');
  r = await smtp.test({ ...a, secure: 'starttls' }, '', 'connect', ''); h.ok(!r.ok && /não oferece STARTTLS/.test(r.error) && /SSL\/TLS/.test(r.hint), 'STARTTLS pedido a um servidor sem STARTTLS: explica e sugere SSL/TLS', JSON.stringify(r));
  r = await smtp.test({ ...a, secure: 'ssl' }, '', 'connect', ''); h.ok(!r.ok && /conexão segura|SSL|TLS/.test(r.error + r.hint) && /465|STARTTLS/.test(r.hint), 'SSL/TLS numa porta sem TLS: explica o modo errado', JSON.stringify(r));

  if (!pki) h.skip('servidores com STARTTLS e SSL/TLS: openssl não encontrado para gerar o certificado de teste (RDR_TEST_OPENSSL)');
  else {
    h.title('3) servidor B: STARTTLS + login');
    const B = await up({ tls: 'starttls', key: pki.key, cert: pki.cert, auth: { user: USER, pass: PW } }); const b = { ...A0, port: B.port, secure: 'starttls', user: USER, fromName: 'RDR', insecureTls: true };
    r = await smtp.test({ ...b, insecureTls: false }, PW, 'connect', ''); h.ok(!r.ok && /certificado/.test(r.error) && /Aceitar certificado inválido/.test(r.hint), 'certificado autoassinado: recusado por padrão, com a dica do botão', JSON.stringify(r));
    r = await smtp.test(b, PW, 'connect', ''); h.ok(r.ok && r.steps.some((s) => /STARTTLS/.test(s.text)) && r.steps.some((s) => /Autenticado como rdruser/.test(s.text)), 'com o certificado aceito: STARTTLS e login ok', JSON.stringify(r.steps));
    r = await smtp.test(b, 'senha-errada', 'connect', ''); h.ok(!r.ok && /Usuário ou senha recusados/.test(r.error) && /senha de app/.test(r.hint) && /535/.test(JSON.stringify(r.steps)), 'senha errada: "usuário ou senha recusados" + dica de senha de app (servidor: 535)', JSON.stringify(r));
    h.ok(noLeak(r) && !JSON.stringify(r).includes('senha-errada'), 'nem a senha errada aparece nas etapas');
    r = await smtp.test(b, PW, 'send', 'x@y.com'); h.ok(r.ok && B.messages.length === 1, 'envio com STARTTLS + login chega ao servidor', JSON.stringify(r));
    r = await smtp.test({ ...b, secure: 'none' }, PW, 'connect', ''); h.ok(!r.ok && /só libera o login depois do STARTTLS/.test(r.error) && /STARTTLS/.test(r.hint), 'sem criptografia num servidor que só libera o login após STARTTLS: erro claro, nunca "ok" sem login', JSON.stringify(r));
    r = await smtp.test({ ...b, secure: 'none', user: '' }, '', 'connect', ''); h.ok(r.ok && !/e o login/.test(r.steps[r.steps.length - 1].text), 'sem usuário: a conexão passa e a mensagem final não diz que houve login', JSON.stringify(r.steps));
    r = await smtp.test({ ...b, host: 'smtp.exemplo.invalid', secure: 'none' }, PW, 'connect', ''); h.ok(!r.ok && r.steps.length === 1 && /sem criptografia/.test(r.error), 'usuário e senha sem criptografia em servidor remoto: recusado ANTES de abrir a conexão', JSON.stringify(r));

    h.title('4) servidor C: SSL/TLS direto (465)');
    const C = await up({ tls: 'ssl', key: pki.key, cert: pki.cert, auth: { user: USER, pass: PW } }); const c = { ...b, port: C.port, secure: 'ssl' };
    r = await smtp.test(c, PW, 'send', 'z@y.com'); h.ok(r.ok && r.steps.some((s) => /SSL\/TLS/.test(s.text)) && C.messages.length === 1, 'SSL/TLS direto + login: envio ok', JSON.stringify(r.steps));
    r = await smtp.test({ ...c, secure: 'starttls' }, PW, 'connect', ''); h.ok(!r.ok && /não respondeu|conexão segura|encerrou/.test(r.error), 'STARTTLS numa porta SSL/TLS: falha explicada', JSON.stringify(r));
  }

  h.title('5) falhas de rede');
  const closed = await h.freePort();
  r = await smtp.test({ ...a, port: closed }, '', 'connect', ''); h.ok(!r.ok && /recusou a conexão/.test(r.error) && /porta/.test(r.hint), 'porta fechada: "recusou a conexão" + dica de portas', JSON.stringify(r));
  r = await smtp.test({ ...a, host: 'host-que-nao-existe.invalid' }, '', 'connect', ''); h.ok(!r.ok && /encontrar o servidor/.test(r.error) && /DNS/.test(r.hint), 'nome inexistente: "não consegui encontrar o servidor" + dica de DNS', JSON.stringify(r));
  let f = await up({ behavior: 'silent' }); const t0 = Date.now(); r = await smtp.test({ ...a, port: f.port }, '', 'connect', '');
  h.ok(!r.ok && /não respondeu/.test(r.error) && /porta|Firewall/.test(r.hint) && Date.now() - t0 < 8000, 'servidor mudo: expira no tempo e explica firewall/porta bloqueada', `${Date.now() - t0} ms ${JSON.stringify(r)}`);
  f = await up({ behavior: 'hangup' }); r = await smtp.test({ ...a, port: f.port }, '', 'connect', ''); h.ok(!r.ok && /encerrou a conexão/.test(r.error), 'servidor que desliga: "encerrou a conexão"', JSON.stringify(r));
  f = await up({ behavior: 'busy' }); r = await smtp.test({ ...a, port: f.port }, '', 'connect', ''); h.ok(!r.ok && /indisponível|limitando/.test(r.error), 'resposta 421: "indisponível ou limitando envios"', JSON.stringify(r));

  h.title('6) respostas do servidor');
  f = await up({ behavior: 'rcpt550' }); r = await smtp.test({ ...a, port: f.port }, '', 'send', 'x@y.com'); h.ok(!r.ok && /recusou o remetente ou o destinatário/.test(r.error) && /550/.test(JSON.stringify(r.steps)) && /From/.test(r.hint), 'RCPT 550: "recusou o remetente ou o destinatário" + dica do domínio verificado', JSON.stringify(r));
  f = await up({ behavior: 'xoauth' }); r = await smtp.test({ ...a, port: f.port, user: 'u' }, 'p', 'connect', ''); h.ok(!r.ok && /XOAUTH2/.test(r.error) && /OAuth|senha de app/.test(r.hint), 'servidor que só aceita OAuth: explica (XOAUTH2)', JSON.stringify(r));
  f = await up({ auth: { user: USER, pass: PW }, authMechs: ['LOGIN'] }); r = await smtp.test({ ...a, port: f.port, user: USER }, PW, 'send', 'x@y.com');
  h.ok(r.ok && f.store.authAttempts[0] && f.store.authAttempts[0].user === USER && f.store.authAttempts[0].pass === PW && r.steps.some((s) => /AUTH LOGIN/.test(s.text)), 'servidor só com AUTH LOGIN: usuário e senha entregues corretamente em duas etapas', JSON.stringify(r));
  r = await smtp.test({ ...a, port: f.port, user: USER }, 'errada', 'connect', ''); h.ok(!r.ok && /recusados/.test(r.error), 'AUTH LOGIN com senha errada: recusado', JSON.stringify(r));

  for (const s of servers) s.close();
});
