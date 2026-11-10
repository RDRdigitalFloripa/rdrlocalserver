# Testes do RDR Local

A suíte fica em `tests/` e não usa nenhuma dependência: só o Node.js. Cada arquivo `*.test.js` é um programa que sobe o que precisa **isolado** (pasta temporária no lugar de `RDR_HOME`, porta livre, arquivo `hosts` falso), confere o resultado e termina com `RESULTADO ok=N falha=N pulou=N`. **Nenhum teste toca nos dados do seu RDR Local de verdade**, e o `.github/workflows/ci.yml` roda a mesma suíte no GitHub (Windows) a cada push na `main` e a cada pull request.

## Rodar

```bash
npm test                          # suíte rápida: sem internet e sem baixar ferramentas (cerca de 40 s)
npm run test:full                 # inclui os testes que usam a internet
node tests/run.js --only plan,smtp   # só os arquivos cujo nome contém "plan" ou "smtp"
node tests/run.js -v              # mostra todas as linhas (por padrão só aparecem as falhas)
```

Código de saída `0` = tudo certo; `1` = alguma falha. Linhas `PULOU` não são falha: o teste precisa de algo que esta máquina não tem (veja abaixo) e diz qual.

## O que cada arquivo cobre

| Arquivo | Cobre |
|---|---|
| `aifiles.test.js` | `CLAUDE.md`, `AGENTS.md` e `docs/` dos projetos novos (texto exato da regra do português, nomes `NN-DD-MM-AAAA`, nunca sobrescreve) |
| `plan.test.js` | Plano do projeto: parser das tarefas e do diário, marcar, adicionar, edição simultânea pelo agente, CRLF, projeto novo |
| `rdrfile.test.js` | `rdr.json`: plano, aplicação, erros claros, confirmação do comando do app, exportação sem segredos e `rdr up` |
| `panel.test.js` | Estado e versão, configurações, atualização do próprio app (release simulada), segurança da API (Host, CSRF, caminhos), tema claro/automático/escuro e métricas de CPU, memória, disco e **rede** |
| `envfile.test.js` | Comparar e editar o `.env` sem devolver valores sensíveis pela API |
| `scripts.test.js` | Scripts do `composer.json`/`package.json`, recusas, limite de tempo e auditoria de segurança |
| `devtools.test.js` | Link do repositório (sem token), abrir editor/terminal com caminhos difíceis e o botão Pasta (erros claros e script que traz a janela para a frente; não abre janelas de verdade) |
| `smtp.test.js` | Cliente SMTP próprio contra servidores falsos (sem criptografia, STARTTLS, SSL/TLS, login, falhas) |
| `mail.test.js` | Página E-mail: perfil, senha protegida, testar, limite de 10 por hora, aplicar no `.env` |
| `drive.test.js` | Google Drive em um clique: validações e, no modo completo, destino existente com criptografia |
| `meili.test.js` | Meilisearch: quando migrar o banco (comparação numérica de versão), cópia de segurança antes do `--upgrade-db`, banco mais novo que o programa e primeira partida |
| `pgvector.test.js` | pgvector: endereço de download, SHA-256 fixado no código, só os arquivos esperados, pacote incompleto, versão principal do PostgreSQL, aviso ao restaurar backup que usa a extensão e a rota de ativar por banco (pacote simulado; a compilação de verdade é testada no workflow `pgvector.yml`, com um PostgreSQL real) |
| `caddy.test.js` | Caddyfile gerado (bloqueio de `docs/`, `CLAUDE.md`, `AGENTS.md`, `rdr.json`) e validação com o Caddy |
| `release.test.js` | Mesma versão em `package.json`, rodapé e `CHANGELOG`; notas da release; ações do workflow fixadas por SHA |

## O que vale só com ferramentas extras

| Teste | Precisa de | Como informar |
|---|---|---|
| Scripts e auditoria do Composer | PHP e Composer | `RDR_TEST_PHP` (pasta `php-8.x`) e `RDR_TEST_COMPOSER` (pasta com `composer.phar`), ou a pasta `bin/` do repositório |
| STARTTLS, SSL/TLS e página E-mail | `openssl` (gera o certificado de teste) | `RDR_TEST_OPENSSL`; o do Git for Windows é achado sozinho |
| `release-notes.sh` | `bash` | `RDR_TEST_BASH` |
| Validar o Caddyfile | `caddy` | `RDR_TEST_CADDY`, ou `bin/caddy/` |
| `npm audit`, `composer audit`, download do rclone (`--full`) | internet | só rodam com `--full` |

O modo `--full` **nunca** abre a autorização do Google: o teste do Drive usa um destino já existente com token falso. O caminho "novo destino" (que abre o navegador) é manual.

## Servidores de teste

- `tests/lib/harness.js`: `startServer()` sobe o `server.js` com `RDR_HOME`, `RDR_PORT` e `RDR_HOSTS` temporários (use `setup(home)` para preparar a pasta antes, ex.: copiar o PHP), `ok()`, `skip()`, `addSite()`, `waitJob()`.
- `tests/lib/fakesmtp.js`: servidor SMTP falso que fala SMTP de verdade (STARTTLS, SSL/TLS, AUTH PLAIN/LOGIN, DATA) e guarda o que recebeu; sabe ficar mudo, desligar, responder 421, recusar destinatário (550) ou só oferecer OAuth.
- `tests/lib/tools.js`: acha `openssl`, PHP, Composer e npm.

Variáveis que existem **só para teste** (o produto as ignora quando ausentes): `RDR_FAKE_APP_RELEASE`, `RDR_FAKE_LATEST`, `RDR_SCRIPT_TIMEOUT_MS`, `RDR_SMTP_TIMEOUT_MS` e `RDR_MAIL_MIN_GAP_MS`.

## Escrever um teste novo

1. Crie `tests/<assunto>.test.js` e use `h.run(async () => { ... })`, com `h.ok(condição, 'o que deveria acontecer', detalhe)`.
2. Prefira conferir o **efeito** (arquivo gravado, resposta da API, o que chegou ao servidor falso) a conferir o texto de um log.
3. Se precisar do servidor, `const srv = await h.startServer()`; ele é encerrado no fim e a pasta temporária é apagada.
4. Em processo (sem servidor), chame `h.isolateHome()` **antes** do primeiro `require` de `lib/`.
5. Se o teste depender de algo opcional, `h.skip('o que falta')` em vez de falhar.

## Cuidados conhecidos

- **Windows:** o `node` do `PATH` pode ser um atalho de outro programa (ex.: ServBay). Os testes iniciam o servidor com `process.execPath`, que é o Node de verdade. Se um servidor de teste ficar de pé por engano, confira o dono da porta antes de encerrar; não encerre por parte da linha de comando.
- O Mailpit real e o Caddy real foram usados na validação manual do desenvolvimento; a suíte usa servidores falsos para ser repetível em qualquer máquina e no CI.
