# GitHub no RDR Local (v1.4)

Conecte sua conta, veja seus repositórios, clone direto para um site e acompanhe o estado do Git. **Não** faz commit, push nem deploy: isso continua no seu Git/IDE.

## 1. Git

Se o Windows já tem o Git, o RDR Local usa o seu. Senão, na página **GitHub**, clique em *Instalar Git (MinGit)* (download conferido por SHA-256, fica em `C:\ProgramData\RDRLocal\bin\git`).

## 2. Conectar a conta

**Opção A: login pelo navegador (recomendada, Device Flow)**

1. Em github.com/settings/developers → *OAuth Apps* → *New OAuth App*. Nome livre; *Homepage URL* e *Callback URL* podem ser `http://127.0.0.1:7070`.
2. Depois de criar, marque **Enable Device Flow** e copie o **Client ID** (o Client Secret não é usado).
3. No RDR Local: cole o Client ID, marque *Acessar repositórios privados* se precisar (escopo `repo`; senão `public_repo`) e clique em **Conectar com o GitHub**.
4. Abra o endereço mostrado, digite o código e autorize.

> Atenção: o escopo `repo` do OAuth dá acesso de leitura **e escrita** a todos os seus repositórios privados. Se isso incomoda, use a opção B.

**Opção B: token pessoal fine-grained (menor privilégio)**

1. github.com/settings/personal-access-tokens → *Generate new token*.
2. Escolha só os repositórios que quer usar e as permissões **Contents: Read** e **Metadata: Read**.
3. Cole em *Usar token* (formato `github_pat_…` ou `ghp_…`). O token é testado antes de ser salvo.

## Como o token é guardado

- Cifrado com **DPAPI** do Windows em `config\secrets.json`: só o seu usuário, neste PC, decifra.
- Enviado **somente a github.com**, por variável de ambiente do processo `git`. Não fica em `.git/config`, nem na URL do remote, nem na linha de comando.
- Nunca entra na exportação de configuração nem nos backups na nuvem.
- *Desconectar* apaga o token daqui. Para revogar de vez, apague-o em github.com/settings.

## Clonar

Lista de repositórios → **Clonar** → escolha nome, domínio e (opcional) pasta. Em seguida:

- Com `composer.json`: `composer install`, cria `.env` a partir do `.env.example`, ajusta `APP_URL`, gera a `APP_KEY` e cria o site PHP. Opcionalmente cria um banco MariaDB e ajusta o `.env`.
- Com `package.json`, `go.mod`, `manage.py`, `pom.xml`…: cria um *app* com o comando detectado; instale as dependências no botão "pacote".
- **As migrations não são executadas.** Revise o `.env` e rode `php artisan migrate` no terminal do site.

## Estado e atualização

Na lista de sites aparece `⎇ branch` (com ● se houver alterações e ↓N se houver commits para baixar). Na página GitHub, *Buscar* faz `git fetch` e *Atualizar* faz `git pull --ff-only`. O RDR Local **recusa** atualizar se houver arquivos alterados/novos sem commit, HEAD desanexado ou branch sem upstream: ele nunca mexe em trabalho não salvo.

## Repositório apagado no GitHub

Apagar um repositório lá **não** remove o site daqui. A cada 10 minutos o RDR Local confere, em segundo plano, se o remoto ainda existe; se o GitHub responder "não encontrado" (apagado, renomeado ou sem acesso do seu token), o site ganha o aviso *removido no GitHub?* e, na página GitHub, o botão **Remover site**. Remover o site não apaga a pasta. Erros de rede nunca disparam o aviso.

## Problemas comuns

| Sintoma | Causa | Solução |
|---|---|---|
| "O GitHub recusou… Device Flow" | *Enable Device Flow* desligado | Ligue no OAuth App |
| Repositório privado não aparece | Token sem acesso a ele | Escopo `repo` (A) ou inclua o repo no token (B) |
| Org com SSO | Token precisa de autorização da organização | Em github.com/settings/tokens → *Configure SSO* |
| Clone falha com 403/404 | Sem permissão ou nome errado | Confira dono/nome e as permissões |
| "pasta já existe" | Destino ocupado | Escolha outro nome ou pasta |

## Build do GitHub Actions (usado em Publicar)
Para a página *Publicar* conferir o último build, o token fine-grained precisa também de **Actions: Read** (além de Contents: Read e Metadata: Read). No Device Flow com `repo`/`public_repo` já vale. Veja o guia *Publicar*.
