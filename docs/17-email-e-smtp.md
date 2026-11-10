# E-mail: Mailpit e SMTP real

A página **E-mail** tem duas partes:

1. **Mailpit** (caixa de testes local): tudo que os seus projetos enviam fica retido aqui e **nada sai para a internet**. É o padrão para desenvolver.
2. **Servidor SMTP real**: para validar o envio **de verdade**, com o servidor do seu provedor (Gmail, Microsoft 365, SendGrid, Brevo, Mailgun, Amazon SES, Zoho, Hostinger ou o seu próprio).

## Configurar o SMTP real

1. Escolha uma **sugestão de provedor** (ela preenche servidor, porta e segurança) ou preencha à mão:
   - **Servidor (host)** e **Porta**.
   - **Segurança:** *STARTTLS* (porta 587, o mais comum), *SSL/TLS* (porta 465) ou *Nenhuma* (porta 25).
   - **Usuário** e **Senha**.
   - **E-mail do remetente (From)** e, se quiser, o **nome do remetente**.
2. Clique em **Salvar**.

> As sugestões de provedor ajudam, mas os dados mudam. Confirme na documentação do seu provedor. Em Gmail e Outlook a **senha normal não funciona** por SMTP: use uma **senha de app** (Gmail) ou libere o *SMTP AUTH* (Microsoft 365). No SendGrid o usuário é `apikey` e a senha é a sua API key.

### Segurança dos dados

- A **senha** é guardada em `config\secrets.json`, protegida pelo Windows (DPAPI: só o seu usuário, neste PC, consegue ler). Ela **nunca** vai para o `config.json`, para a exportação de configuração nem volta para a tela: o campo mostra só se existe uma senha salva.
- O RDR Local **não envia usuário e senha sem criptografia** para um servidor remoto. Com a segurança em *Nenhuma*, só a própria máquina (`localhost`, `127.0.0.1`) aceita login.
- O certificado do servidor é conferido. Para um servidor **seu**, com certificado próprio, marque *Aceitar certificado inválido (só para teste)*.

## Testar

- **Testar conexão:** conecta, negocia a criptografia e faz o login, **sem enviar nada**.
- **Enviar e-mail de teste:** envia **de verdade** uma mensagem de teste (assunto e texto fixos) do remetente para o destino que você digitar, depois de você confirmar.

O resultado mostra **cada etapa com o tempo**: servidor encontrado, conexão, saudação, STARTTLS ou SSL/TLS, login, remetente, destinatário e a resposta final do servidor. Se algo falhar, o RDR Local explica em português **o que aconteceu e o que conferir**:

| Sintoma | O que costuma ser |
|---|---|
| "Não consegui encontrar o servidor" | Nome digitado errado ou sem DNS/internet |
| "O servidor recusou a conexão nessa porta" | Porta errada (587 STARTTLS, 465 SSL/TLS, 25 sem criptografia) ou serviço fora do ar |
| "O servidor não respondeu a tempo" | Firewall, antivírus ou operadora bloqueando a porta (a 25 de saída costuma ser bloqueada); tente 587 ou 465 |
| "O servidor não entendeu a conexão segura" | Segurança incompatível com a porta (ex.: SSL/TLS na 587) |
| "O certificado do servidor não é confiável / não é do nome digitado / está vencido" | Servidor próprio com certificado autoassinado, nome do host errado ou certificado vencido |
| "Usuário ou senha recusados" (535) | Senha normal em vez de senha de app, usuário sem o domínio, ou API key errada |
| "O servidor recusou o remetente ou o destinatário" (550/553) | O From precisa ser da conta autenticada ou de um domínio verificado no provedor |
| "O servidor está indisponível ou limitando envios" (421/450) | Limite de envio ou greylisting: tente de novo mais tarde |

**Limites contra abuso:** no máximo **10 e-mails de teste por hora** e um intervalo mínimo de alguns segundos entre eles. O painel não tem login, então esse limite evita que outro programa do PC use o seu SMTP em massa por esta tela.

## Usar nos projetos

Em **Usar nos projetos**, escolha um site e clique em:

- **Usar o SMTP real:** grava no `.env` do projeto `MAIL_MAILER`, `MAIL_HOST`, `MAIL_PORT`, `MAIL_USERNAME`, `MAIL_PASSWORD`, `MAIL_ENCRYPTION` e, se preenchidos, `MAIL_FROM_ADDRESS` e `MAIL_FROM_NAME`. **A senha vai para o `.env`** (que não deve ir para o Git); por isso o painel pede confirmação.
- **Voltar para o Mailpit:** grava o Mailpit local e remove a senha real do `.env`.

Antes de gravar, o `.env` é copiado para `.env.backup` (um backup só, com o estado de antes de todas as mudanças). No Laravel, depois rode `php artisan config:clear`. Se o projeto não tem `.env`, o painel avisa; crie-o em *Ferramentas do projeto → .env*. Uma senha com aspa simples (`'`) e cifrão (`$`) juntos não pode ser gravada no `.env` sem ambiguidade: o painel recusa em vez de gravar errado.

## Limites desta versão

- Só autenticação por usuário e senha (PLAIN/LOGIN). Servidores que exigem OAuth (XOAUTH2) não são suportados: o painel avisa e sugere senha de app.
- O e-mail de teste é sempre texto simples, com assunto e corpo fixos.
