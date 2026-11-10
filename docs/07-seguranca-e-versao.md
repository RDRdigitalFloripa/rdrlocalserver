# Segurança, limites e versão

## Modelo de segurança em uma página

O RDR Local é uma ferramenta de **desenvolvimento**. Ele assume que a máquina e o usuário do Windows são confiáveis.

**Protegido**
- Painel escuta só em `127.0.0.1`; `Host` diferente é recusado (anti DNS-rebinding).
- Ações (`POST`) exigem o cabeçalho `X-RDR: 1` (anti-CSRF).
- Adminer e phpMyAdmin só atendem a própria máquina.
- Caddy bloqueia `/.env`, `/.git` e `/storage/logs` em todos os sites, e também `/docs/*`, `/CLAUDE.md` e `/AGENTS.md` quando esses arquivos existem na pasta pública.
- A atualização do próprio RDR Local só baixa de `github.com/…/releases/download` e só abre o instalador se o SHA-256 conferir.
- O `rdr.json` aplica só campos validados e não executa scripts. O comando de um app (`app.cmd`) exige confirmação (`--yes` no `rdr up`), e *Gerar rdr.json* não exporta variáveis de ambiente.
- *Ferramentas do projeto*: só roda script que existe no `composer.json`/`package.json` (nome validado); a API do `.env` nunca devolve valores sensíveis; o `.env` é copiado para `.env.backup` antes de cada alteração; o link do GitHub nunca leva o usuário/token da URL do remoto. **Um script é código do projeto: rode só em projetos em que você confia.**
- *E-mail (SMTP real)*: a senha fica em `config\secrets.json` protegida pelo Windows (DPAPI) e nunca volta pela API nem entra na exportação; usuário e senha não são enviados sem criptografia a servidores remotos; o certificado do servidor é conferido (a exceção é uma opção explícita, só para teste); o e-mail de teste tem assunto/corpo fixos, um destinatário só e limite de 10 por hora. **Como o painel não tem login, evite deixar uma senha de SMTP de produção salva em um PC compartilhado.** "Usar o SMTP real" grava a senha no `.env` do projeto, que não deve ir para o Git.
- *Plano do projeto*: o painel só lê e grava os arquivos de plano dentro de `docs/` do projeto (achados pelo nome), faz edições mínimas e recusa mudar uma tarefa cujo texto não confere mais; textos são limitados (tarefa 300 caracteres, anotação 2000).
- MCP não tem ferramentas destrutivas; terminal só com liberação explícita.
- Restaurar e excluir banco sempre salvam backup antes.
- Publicar: só roda comandos de receitas que você cadastrou; chaves SSH e senhas FTP ficam cifradas (DPAPI); a impressão digital do servidor é confirmada por você e depois exigida; `.env` nunca é enviado por FTP/SFTP; nada é apagado no servidor sem confirmação.
- O painel só aceita o `Host` exato `rdr-local-server.<terminação>` além de 127.0.0.1/localhost.

**Não protegido (de propósito)**
- Painel sem login: qualquer programa rodando como você pode usá-lo.
- Bancos sem senha, acessíveis em `127.0.0.1`.
- Variáveis de ambiente por site ficam em `config\config.json`, texto puro.
- Quem controla o painel (qualquer programa rodando como você) pode publicar receitas já cadastradas.
- FTP simples não é criptografado.
- O túnel público expõe o site a quem tiver o link.

## Regras práticas

1. Nunca use dados reais de clientes em bancos locais nem em sites com túnel ativo.
2. Não guarde chaves de produção nas variáveis do site.
3. Não exponha as portas 80/443/7070/3307/5433/6380 no roteador ou firewall.
4. Mantenha o Windows e o navegador atualizados; use a verificação de atualizações dos componentes.
5. Compartilhe a exportação de configuração apenas com a equipe (contém caminhos e variáveis).

## Versão

**RDR Local Server v1.12.0** — desenvolvido por RDR Digital.

Novidades da 1.3: **Backup na nuvem** (Google Drive, Dropbox, S3/R2/B2, pasta ou disco) com rclone, criptografia opcional, teste de restauração, retenção protegida e avisos de falha por Telegram/webhook. Veja o guia *Backup na nuvem*.

Novidades da 1.4: **GitHub** — login pelo navegador (Device Flow) ou token pessoal, lista de repositórios, clonagem direta para um site (composer install, .env e APP_KEY automáticos), estado do Git (branch, alterações, commits para baixar) na lista de sites e atualização segura (`pull --ff-only`). O token é cifrado com DPAPI e só vai para github.com. Não há commit, push nem deploy. Veja o guia *GitHub*.

Novidades da 1.5: **Importar de outro ambiente** (ServBay, Laragon, XAMPP ou qualquer pasta/arquivo de configuração nginx/Apache), só leitura, com prévia e confirmação. Veja o guia *Importar sites*.

Novidades da 1.6: **Importar bancos de outro servidor** (MySQL/MariaDB ligado neste PC): dump, ajuste de collations do MySQL 8, restauração e conferência de tabelas e linhas. Veja o guia *Importar sites* (seção Bancos).

Novidades da 1.7: **Publicar** — servidores SSH, chaves, impressão digital, receitas Docker Swarm (imagens do GHCR) e verificação do build no GitHub Actions. Veja o guia *Publicar*.

Novidades da 1.8: publicação de sites antigos por **FTP, FTPS e SFTP** com prévia e envio incremental. 1.8.1: endereço `https://rdr-local-server.local` para o painel. 1.8.2: versão correta na imagem do instalador. 1.8.3: documentação atualizada. 1.9.0: botão **Reverter** nas receitas de Publicar. 1.9.1: criar app instala a linguagem que faltar. 1.9.2: botão "Instalar versão LTS" por linguagem. 1.10.0: projetos novos com `CLAUDE.md`, `AGENTS.md` e `docs/`; atualização do próprio RDR Local pelo painel (instalador conferido por SHA-256); verificação automática de atualizações com selo no menu; Composer e phpMyAdmin na lista de atualizações. 1.11.0: ferramentas do projeto (scripts, auditoria de segurança, `.env` × `.env.example` e atalhos) e plano do projeto (especificação, tarefas e diário). 1.12.0: modo escuro com escolha (claro, automático, escuro), migração do banco do Meilisearch com cópia de segurança e correção do botão Pasta.

Novidades da 1.2: runtimes gerenciados de **Go** e **Java (JDK Temurin)** com SHA-256, modelos TypeScript (Express), Vite+React+TS, Next.js, Go e Spring Boot, versão dinâmica no painel, medidores de CPU/memória/disco desenhados na hora e diagnóstico de *quem atende as portas 80/443/53* (detecta ServBay/XAMPP ou outra cópia do RDR Local).

Novidades da 1.1: apps Node.js e Python (e Go/Java por comando próprio) com HTTPS, gerenciador de versões de Node.js e Python, modelos de projeto (Express, Fastify, FastAPI, Flask, Django) e o *Guia de linguagens*.

Inclui: apps de outras linguagens, servidor web com HTTPS, PHP multi-versão, MariaDB/PostgreSQL/Redis/Mailpit/Meilisearch, sites PHP/proxy/redirecionamento, DNS local, túnel público, editor do php.ini, backup agendado, terminal e processos por site, Diagnóstico, atualizações de componentes, iniciar com o Windows, CLI, MCP, exportar/importar configuração e esta Central de Ajuda.

## Licenças dos componentes

Os componentes baixados mantêm suas próprias licenças (Caddy, PHP, Composer, MariaDB, PostgreSQL, Redis/compatíveis, Mailpit, Adminer, phpMyAdmin, Cloudflared, Meilisearch). Consulte as páginas oficiais de cada projeto antes de redistribuir.
