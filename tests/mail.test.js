// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 RDR Digital - https://github.com/RDRdigitalFloripa/rdrlocalserver
'use strict';
/** Página E-mail (API): salvar o perfil SMTP, senha protegida, testar, limite de envios e aplicar no .env do projeto. Usa servidores SMTP falsos. */
const fs = require('fs');
const path = require('path');
const h = require('./lib/harness');
const tools = require('./lib/tools');
const { startFakeSmtp } = require('./lib/fakesmtp');

const PW = 's3nh@-t3ste'; const USER = 'rdruser';

h.run(async () => {
  const pki = tools.makeCert();
  if (!pki) { h.skip('openssl não encontrado para gerar o certificado de teste (defina RDR_TEST_OPENSSL): teste da página E-mail pulado'); return; }
  const fb = await startFakeSmtp({ tls: 'starttls', key: pki.key, cert: pki.cert, auth: { user: USER, pass: PW } }); // servidor "de verdade": STARTTLS + login
  const fl = await startFakeSmtp({ tls: 'none' }); // servidor local simples, para o limite por hora
  const srv = await h.startServer({ env: { RDR_SMTP_TIMEOUT_MS: '3000' } }); const call = srv.call; const home = srv.home;
  const prof = { host: '127.0.0.1', port: fb.port, secure: 'starttls', user: USER, insecureTls: true };
  const secrets = () => fs.readFileSync(path.join(home, 'config', 'secrets.json'), 'utf8');

  h.title('padrões e validações');
  let g = await call('GET', '/api/mail');
  h.ok(g.status === 200 && g.j.host === '' && g.j.port === 587 && g.j.secure === 'starttls' && g.j.hasPassword === false && !('password' in g.j), 'padrões: 587 STARTTLS, sem senha salva, sem campo de senha na resposta');
  h.ok(g.j.presets[0].id === 'mailpit' && g.j.presets[0].port === 1026 && g.j.presets.some((p) => p.id === 'gmail' && p.host === 'smtp.gmail.com' && p.port === 587), 'sugestões de provedor: Mailpit local (porta do RDR Local) primeiro, depois Gmail etc.');
  for (const [body, why] of [[{ host: 'http://x.com', port: 587, secure: 'starttls' }, 'host com http://'], [{ host: 'a b', port: 587, secure: 'starttls' }, 'host com espaço'], [{ host: 'x.com', port: 0, secure: 'starttls' }, 'porta 0'], [{ host: 'x.com', port: 70000, secure: 'starttls' }, 'porta 70000'], [{ host: 'x.com', port: 587, secure: 'tls' }, 'segurança inventada'], [{ host: 'x.com', port: 587, secure: 'starttls', from: 'sem-arroba' }, 'remetente inválido'], [{ host: 'x.com', port: 587, secure: 'starttls', password: 'a\nb' }, 'senha com quebra de linha']]) {
    const r = await call('POST', '/api/mail/save', body); h.ok(r.status === 400, `salvar recusa: ${why} (HTTP ${r.status})`);
  }

  h.title('salvar e proteger a senha');
  let s = await call('POST', '/api/mail/save', { ...prof, from: 'rdr@exemplo.com.br', fromName: 'Meu "Nome" <x>', password: PW }); h.ok(s.status === 200, 'salvar o perfil com senha');
  g = await call('GET', '/api/mail'); h.ok(g.j.hasPassword === true && g.j.host === '127.0.0.1' && g.j.fromName === 'Meu Nome x' && !g.raw.includes(PW), 'lido de volta: senha marcada como salva, nome saneado e a senha NÃO vem na resposta');
  const cfgTxt = fs.readFileSync(path.join(home, 'config', 'config.json'), 'utf8');
  h.ok(!cfgTxt.includes(PW) && /"smtp"/.test(cfgTxt), 'config.json tem o perfil mas NÃO a senha');
  h.ok(!secrets().includes(PW) && (h.IS_WIN ? /dpapi:/ : /plain:/).test(secrets()), h.IS_WIN ? 'secrets.json guarda a senha protegida pelo Windows (dpapi), nunca em texto puro' : 'secrets.json não tem a senha em texto puro (fora do Windows fica só ofuscada, modo desenvolvimento)', secrets().slice(0, 120));

  h.title('testar conexão e enviar');
  g = await call('POST', '/api/mail/test', { mode: 'connect', settings: prof });
  h.ok(g.status === 200 && g.j.ok === true && !g.raw.includes(PW), 'testar a conexão SEM digitar a senha usa a salva', g.raw.slice(0, 300));
  g = await call('POST', '/api/mail/test', { mode: 'connect', settings: prof, password: 'digitada-errada' }); h.ok(g.status === 200 && g.j.ok === false && /recusados/.test(g.j.error), 'a senha digitada no formulário vale para o teste (sem salvar) e é recusada');
  g = await call('GET', '/api/mail'); h.ok(g.j.hasPassword === true, 'o teste com outra senha não trocou a senha salva');
  g = await call('POST', '/api/mail/test', { mode: 'send', settings: { ...prof, from: 'rdr@exemplo.com.br' }, to: 'invalido' }); h.ok(g.status === 400, 'enviar com destino inválido -> 400');
  g = await call('POST', '/api/mail/test', { mode: 'send', settings: prof, to: 'x@y.com' }); h.ok(g.status === 400 && /remetente/.test(g.j.error), 'enviar sem remetente (From) -> 400');
  g = await call('POST', '/api/mail/test', { mode: 'connect', settings: { host: '', port: 587, secure: 'starttls' } }); h.ok(g.status === 400, 'testar sem servidor -> 400');
  g = await call('POST', '/api/mail/test', { mode: 'send', settings: { ...prof, from: 'rdr@exemplo.com.br' }, to: 'api@exemplo.com' });
  h.ok(g.status === 200 && g.j.ok === true && fb.messages.length === 1 && fb.messages[0].envelopeTo.includes('api@exemplo.com'), 'enviar o e-mail de teste pela API: entregue ao servidor', g.raw.slice(0, 300));
  g = await call('POST', '/api/mail/test', { mode: 'send', settings: { ...prof, from: 'rdr@exemplo.com.br' }, to: 'api2@exemplo.com' }); h.ok(g.status === 400 && /Aguarde/.test(g.j.error), 'o segundo envio imediato é barrado (intervalo mínimo entre testes)');
  g = await call('GET', '/api/mail'); h.ok(g.j.lastTo === 'api@exemplo.com', 'o último destino fica lembrado');

  h.title('limite de 10 testes por hora');
  const srv2 = await h.startServer({ env: { RDR_MAIL_MIN_GAP_MS: '0' } }); let blocked = 0; let sent = 0;
  for (let i = 0; i < 12; i++) {
    const rr = await srv2.call('POST', '/api/mail/test', { mode: 'send', settings: { host: '127.0.0.1', port: fl.port, secure: 'none', from: 'rdr@exemplo.com.br' }, to: `l${i}@exemplo.com` });
    if (rr.status === 400 && /Limite de 10/.test(rr.j.error)) { blocked = i + 1; break; } if (rr.j.ok) sent++;
  }
  h.ok(sent === 10 && blocked === 11 && fl.messages.length === 10, 'passou de 10 e-mails de teste na hora: bloqueado ("Limite de 10")', JSON.stringify({ sent, blocked, chegaram: fl.messages.length }));
  srv2.stop();

  h.title('aplicar no .env do projeto');
  const P = h.mkdir(h.tmp('mailproj'), 'loja');
  const orig = 'APP_NAME=Loja\nMAIL_MAILER=log\nMAIL_HOST=smtp.antigo.com\nDB_PASSWORD=segredo-do-banco\n'; fs.writeFileSync(path.join(P, '.env'), orig);
  const site = await h.addSite(srv, 'Loja Mail', P, 'lojamail-rdr.test');
  g = await call('POST', '/api/mail/apply', { id: site.id, mode: 'real' }); const env1 = fs.readFileSync(path.join(P, '.env'), 'utf8');
  h.ok(g.status === 200 && /^MAIL_HOST=127\.0\.0\.1$/m.test(env1) && new RegExp(`^MAIL_PORT=${fb.port}$`, 'm').test(env1) && /^MAIL_USERNAME=rdruser$/m.test(env1) && /^MAIL_PASSWORD=('?)s3nh@-t3ste\1$/m.test(env1) && /^MAIL_ENCRYPTION=tls$/m.test(env1) && /^MAIL_FROM_ADDRESS=rdr@exemplo\.com\.br$/m.test(env1) && /^MAIL_FROM_NAME="Meu Nome x"$/m.test(env1), 'SMTP real aplicado: MAIL_* gravados no .env (host, porta, usuário, senha, tls, remetente)', env1);
  h.ok(env1.includes('APP_NAME=Loja') && env1.includes('DB_PASSWORD=segredo-do-banco') && !/smtp\.antigo\.com/.test(env1), 'o resto do .env fica; o MAIL_HOST antigo foi trocado');
  h.ok(fs.readFileSync(path.join(P, '.env.backup'), 'utf8') === orig, '.env.backup guarda o .env de ANTES (um backup só, mesmo gravando várias chaves)');
  g = await call('GET', '/api/env?id=' + site.id); h.ok(!g.raw.includes(PW) && g.j.entries.find((e) => e.key === 'MAIL_PASSWORD').secret === true, 'a tela do .env continua mascarando o MAIL_PASSWORD');
  g = await call('POST', '/api/mail/apply', { id: site.id, mode: 'mailpit' }); const env2 = fs.readFileSync(path.join(P, '.env'), 'utf8');
  h.ok(g.status === 200 && /^MAIL_HOST=127\.0\.0\.1$/m.test(env2) && /^MAIL_PORT=1026$/m.test(env2) && /^MAIL_PASSWORD=null$/m.test(env2) && /^MAIL_USERNAME=null$/m.test(env2) && /^MAIL_ENCRYPTION=null$/m.test(env2) && !env2.includes(PW), 'voltar ao Mailpit: MAIL_* locais e a senha real some do .env');
  g = await call('POST', '/api/mail/apply', { id: site.id, mode: 'foo' }); h.ok(g.status === 400, 'modo inválido -> 400');
  const sn = await h.addSite(srv, 'Sem Env', h.mkdir(h.tmp('mailnoenv'), 'x'), 'semenvmail-rdr.test');
  g = await call('POST', '/api/mail/apply', { id: sn.id, mode: 'mailpit' }); h.ok(g.status === 400 && /não tem .env/.test(g.j.error), 'projeto sem .env -> 400 claro');
  await call('POST', '/api/mail/save', { ...prof, from: 'rdr@exemplo.com.br', password: "a'b$c" });
  g = await call('POST', '/api/mail/apply', { id: site.id, mode: 'real' }); h.ok(g.status === 400 && /aspas simples/.test(g.j.error), 'senha com aspa simples e $ juntos: recusa gravar no .env em vez de gravar errado');
  await call('POST', '/api/mail/save', { ...prof, from: 'rdr@exemplo.com.br', clearPassword: true });
  g = await call('GET', '/api/mail'); h.ok(g.j.hasPassword === false && !/"smtpPassword"\s*:\s*"(dpapi|plain):/.test(secrets()), 'apagar a senha salva: remove de secrets.json');
  g = await call('POST', '/api/mail/apply', { id: site.id, mode: 'real' }); h.ok(g.status === 400 && /senha/.test(g.j.error), 'usar o SMTP real sem senha salva (e com usuário): recusa');

  fb.close(); fl.close();
});
