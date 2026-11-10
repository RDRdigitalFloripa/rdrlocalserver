# PRD — Product Requirements Document

**Produto:** RDR Local Server · **Versão:** 1.11.0 · **Responsável:** RDR Digital

## 1. Contexto e problema

A RDR Digital mantém vários sistemas (Laravel, WordPress, SaaS multi-tenant, integrações) e precisa de um ambiente local com HTTPS, domínios `.test`, múltiplas versões de PHP e bancos, sem depender de ferramentas pagas ou de configuração manual repetitiva. Alternativas existentes (ServBay, Laragon, XAMPP) não cobrem todo o fluxo da equipe ou exigem ajustes manuais.

## 2. Objetivos

1. Criar um site local com HTTPS válido em poucos cliques.
2. Reproduzir o ambiente de produção (PHP por site, MariaDB/PostgreSQL, Redis, e-mail, busca).
3. Dispensar instalação de dependências: só o Node.js.
4. Ser seguro por padrão (somente máquina local) e fácil de diagnosticar.
5. Ser operável por humanos (painel, CLI) e por agentes de IA (MCP).

### Fora de escopo (v1.8)
Hospedagem real (o RDR Local não serve produção; apenas **publica** para ela via SSH/Swarm e FTP/SFTP), terminal livre no servidor remoto, Ruby e .NET gerenciados, Linux/macOS (a lógica de rede e serviço é Windows), MinIO, Memcached, Typesense, Xdebug, múltiplas versões de banco.

## 3. Personas

- **Dev/coordenador de TI (Rud)**: vários projetos Laravel, quer previsibilidade e atalhos.
- **Dev da equipe**: precisa de ambiente igual ao dos colegas (exportar/importar configuração).
- **Agente de IA**: precisa inspecionar o ambiente com segurança.

## 4. Requisitos funcionais

| ID | Requisito | Prioridade |
|---|---|---|
| RF-01 | Instalar, iniciar, parar e atualizar componentes (Caddy, PHP, Composer, MariaDB, PostgreSQL, Redis, Mailpit, Adminer, phpMyAdmin, Cloudflared, Meilisearch) | Alta |
| RF-02 | Criar/editar/remover/desativar sites (PHP, proxy reverso, redirecionamento) com HTTPS via CA local | Alta |
| RF-03 | Criar projetos Laravel (starter kits), WordPress e pasta PHP, com banco e `.env` prontos | Alta |
| RF-04 | PHP por site, várias versões simultâneas (workers FastCGI) | Alta |
| RF-05 | Editor do php.ini com validação, backup e restauração | Média |
| RF-06 | Gerenciar bancos: listar, criar, excluir, backup, restauração, Adminer/phpMyAdmin | Alta |
| RF-07 | Backup agendado com retenção | Média |
| RF-08 | Terminal por site com PHP/Composer no PATH e guia de comandos | Alta |
| RF-09 | Processos por site: queue, schedule, Vite, túnel público | Média |
| RF-10 | Diagnóstico com correções automáticas (hosts, CA, extensões, portas, `.env`) | Alta |
| RF-11 | DNS local com curinga para multi-tenant | Média |
| RF-12 | Variáveis de ambiente e CORS por site | Média |
| RF-13 | Iniciar com o Windows e ligar serviços automaticamente | Média |
| RF-14 | CLI `rdr` e servidor MCP para agentes de IA | Média |
| RF-15 | Verificar/aplicar atualizações de componentes | Média |
| RF-16 | Exportar/importar configuração | Baixa |
| RF-17 | Central de Ajuda com manuais e documentação técnica no painel | Média |
| RF-18 | Gerenciar runtimes Node.js e Python em várias versões (instalar, padrão, atualizar, remover) | Alta |
| RF-19 | Site do tipo App: iniciar/parar/reiniciar o processo, `PORT` automática, HTTPS, log e religamento automático | Alta |
| RF-20 | Modelos de app (Express, Fastify, FastAPI, Flask, Django) e detecção de projeto existente | Média |
| RF-21 | Apps com comando próprio (Go, Java e outras linguagens) usando o PATH do Windows, com guia de instalação | Média |
| RF-22 | Runtimes gerenciados de Go e Java (Temurin) com SHA-256, e modelos TypeScript, Vite, Next.js, Go e Spring Boot | Média |
| RF-23 | Backup na nuvem (rclone): Google Drive, Dropbox, S3/R2/B2 e pasta; envio automático após o backup agendado | Alta |
| RF-24 | Criptografia opcional do backup na nuvem; credenciais restritas ao usuário e fora da exportação | Alta |
| RF-25 | Teste de restauração do backup na nuvem (integridade + restauração em banco temporário) | Alta |
| RF-26 | Avisos de falha por Telegram e webhook, com segredos fora do config.json | Média |
| RF-27 | Conectar ao GitHub (Device Flow ou token fine-grained) com token cifrado por usuário do Windows | Alta |
| RF-28 | Clonar repositório para um site já configurado (PHP/Laravel ou app) | Alta |
| RF-29 | Mostrar estado do Git por site e atualizar apenas com fast-forward e árvore limpa | Média |
| RF-30 | Importar sites de ServBay/Laragon/XAMPP lendo a configuração (somente leitura), com prévia e criação apontando para as mesmas pastas | Alta |
| RF-31 | Importar bancos MySQL/MariaDB de outro servidor local, com cópia de segurança do dump e conferência de tabelas e linhas | Alta |
| RF-32 | Publicar via SSH com receitas (Swarm/GHCR), chaves cifradas, impressão digital do servidor confirmada e verificação do build no GitHub Actions | Alta |
| RF-33 | Publicar sites antigos por FTP/FTPS/SFTP com prévia, envio incremental, `.env` nunca enviado e exclusão remota só com confirmação | Alta |
| RF-34 | Projetos novos (Laravel, WordPress, pasta PHP e apps) nascem com `CLAUDE.md`, `AGENTS.md` (respostas em português do Brasil) e pasta `docs/` com documentos no padrão `NN-DD-MM-AAAA-nome.md`; nunca sobrescreve; desligável; o Caddy não serve esses arquivos | Média |
| RF-35 | Atualizar o próprio RDR Local pelo painel: última release do GitHub, download do instalador, conferência do SHA-256 e abertura do assistente | Média |
| RF-36 | Verificação automática de atualizações (a cada 6 h, desligável) com selo no menu; inclui Composer e phpMyAdmin | Média |
| RF-37 | `rdr.json`: configuração do projeto no repositório (domínio, PHP, banco, serviços), gerada a partir de um site ou aplicada com prévia; comando `rdr up` | Alta |
| RF-38 | Ferramentas do projeto: scripts do Composer e do npm, auditoria de segurança (`composer audit` e `npm audit`), comparação e edição do `.env` com o `.env.example` e atalhos (editor, GitHub, Claude Code) | Média |
| RF-39 | Plano do projeto: especificação, tarefas e diário em `docs/` (padrão `NN-DD-MM-AAAA-nome.md`), editáveis pelo painel e por agentes de IA, com cartão de andamento no Painel e regra de fluxo no `CLAUDE.md`/`AGENTS.md` | Alta |
| RF-40 | SMTP real editável (servidor, porta, segurança, usuário, senha, remetente) com teste de conexão, e-mail de teste com etapas e diagnóstico em português, senha protegida (DPAPI) e "usar no projeto" (`MAIL_*` no `.env`) | Alta |

## 5. Requisitos não funcionais

- **Segurança**: painel só em 127.0.0.1; validação do cabeçalho Host (anti DNS-rebinding); POST exige `X-RDR: 1` (anti-CSRF); MCP sem ferramentas destrutivas.
- **Dependências**: Node.js sem pacotes npm (zero-dependency).
- **Resiliência**: alterações no php.ini revertidas se inválidas; restauração e exclusão de banco geram backup antes.
- **Usabilidade**: interface em pt-BR, tarefas longas com log ao vivo, modal padrão para avisos.
- **Manutenibilidade**: módulos pequenos em `lib/`, documentação em `docs/`.

## 6. Critérios de aceitação (resumo)

- Instalar tudo e iniciar sem edição manual de arquivos.
- Site novo abre em `https://<nome>.test` com cadeado verde após confiar na CA.
- Laravel novo chega com banco criado e migrações aplicadas.
- Diagnóstico aponta e corrige hosts, extensão faltante e `.env` divergente.
- Backup agendado gera arquivo `-auto` e apaga só os automáticos antigos.
- php.ini inválido nunca fica ativo.
- Painel recusa Host diferente de 127.0.0.1/localhost e POST sem `X-RDR`.

## 7. Riscos e premissas

| Risco | Mitigação |
|---|---|
| Portas 80/443 ocupadas | Portas configuráveis; Diagnóstico avisa |
| Antivírus/SmartScreen bloqueando binários | Downloads de fontes oficiais; documentar exceções |
| Recursos só testáveis no Windows (DNS/NRPT, tarefa agendada, downloads) | Validar em máquina real a cada versão |
| Perda de dados em atualização de banco | MariaDB/PostgreSQL não são atualizados automaticamente |
| Segredos em `config.json` | Aviso na interface e no manual |

## 8. Roadmap sugerido

Túnel SSH para o banco de produção, receita "Webhook do Portainer", chave SSH com senha (passphrase), Runtimes gerenciados para Go e Java (JDK), Docker Compose por projeto, perfis de projeto, múltiplas versões de banco, Xdebug, MinIO/Memcached sob demanda, assinatura digital do instalador.
