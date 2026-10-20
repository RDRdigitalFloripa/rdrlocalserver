# Segurança, limites e versão

## Modelo de segurança em uma página

O RDR Local é uma ferramenta de **desenvolvimento**. Ele assume que a máquina e o usuário do Windows são confiáveis.

**Protegido**
- Painel escuta só em `127.0.0.1`; `Host` diferente é recusado (anti DNS-rebinding).
- Ações (`POST`) exigem o cabeçalho `X-RDR: 1` (anti-CSRF).
- Adminer e phpMyAdmin só atendem a própria máquina.
- Caddy bloqueia `/.env`, `/.git` e `/storage/logs` em todos os sites.
- MCP não tem ferramentas destrutivas; terminal só com liberação explícita.
- Restaurar e excluir banco sempre salvam backup antes.

**Não protegido (de propósito)**
- Painel sem login: qualquer programa rodando como você pode usá-lo.
- Bancos sem senha, acessíveis em `127.0.0.1`.
- Variáveis de ambiente por site ficam em `config\config.json`, texto puro.
- O túnel público expõe o site a quem tiver o link.

## Regras práticas

1. Nunca use dados reais de clientes em bancos locais nem em sites com túnel ativo.
2. Não guarde chaves de produção nas variáveis do site.
3. Não exponha as portas 80/443/7070/3307/5433/6380 no roteador ou firewall.
4. Mantenha o Windows e o navegador atualizados; use a verificação de atualizações dos componentes.
5. Compartilhe a exportação de configuração apenas com a equipe (contém caminhos e variáveis).

## Versão

**RDR Local Server v1.8.2** — desenvolvido por RDR Digital.

Novidades da 1.3: **Backup na nuvem** (Google Drive, Dropbox, S3/R2/B2, pasta ou disco) com rclone, criptografia opcional, teste de restauração, retenção protegida e avisos de falha por Telegram/webhook. Veja o guia *Backup na nuvem*.

Novidades da 1.4: **GitHub** — login pelo navegador (Device Flow) ou token pessoal, lista de repositórios, clonagem direta para um site (composer install, .env e APP_KEY automáticos), estado do Git (branch, alterações, commits para baixar) na lista de sites e atualização segura (`pull --ff-only`). O token é cifrado com DPAPI e só vai para github.com. Não há commit, push nem deploy. Veja o guia *GitHub*.

Novidades da 1.5: **Importar de outro ambiente** (ServBay, Laragon, XAMPP ou qualquer pasta/arquivo de configuração nginx/Apache), só leitura, com prévia e confirmação. Veja o guia *Importar sites*.

Novidades da 1.6: **Importar bancos de outro servidor** (MySQL/MariaDB ligado neste PC): dump, ajuste de collations do MySQL 8, restauração e conferência de tabelas e linhas. Veja o guia *Importar sites* (seção Bancos).

Novidades da 1.2: runtimes gerenciados de **Go** e **Java (JDK Temurin)** com SHA-256, modelos TypeScript (Express), Vite+React+TS, Next.js, Go e Spring Boot, versão dinâmica no painel, medidores de CPU/memória/disco desenhados na hora e diagnóstico de *quem atende as portas 80/443/53* (detecta ServBay/XAMPP ou outra cópia do RDR Local).

Novidades da 1.1: apps Node.js e Python (e Go/Java por comando próprio) com HTTPS, gerenciador de versões de Node.js e Python, modelos de projeto (Express, Fastify, FastAPI, Flask, Django) e o *Guia de linguagens*.

Inclui: apps de outras linguagens, servidor web com HTTPS, PHP multi-versão, MariaDB/PostgreSQL/Redis/Mailpit/Meilisearch, sites PHP/proxy/redirecionamento, DNS local, túnel público, editor do php.ini, backup agendado, terminal e processos por site, Diagnóstico, atualizações de componentes, iniciar com o Windows, CLI, MCP, exportar/importar configuração e esta Central de Ajuda.

## Licenças dos componentes

Os componentes baixados mantêm suas próprias licenças (Caddy, PHP, Composer, MariaDB, PostgreSQL, Redis/compatíveis, Mailpit, Adminer, phpMyAdmin, Cloudflared, Meilisearch). Consulte as páginas oficiais de cada projeto antes de redistribuir.
