# Manual do usuário

> RDR Local Server v1.8.2 — ambiente local de hospedagem com HTTPS para Windows. Desenvolvido por RDR Digital.

## 1. O que é

O RDR Local roda no seu PC os mesmos blocos que você usa em produção: servidor web com HTTPS (Caddy), várias versões de PHP, bancos (MariaDB, PostgreSQL), Redis, e-mail de teste (Mailpit) e busca (Meilisearch). Tudo é controlado por um painel em **http://127.0.0.1:7070**.

## 2. Primeiro uso (5 passos)

1. Dê duplo clique em `start.bat` (ele pede Administrador).
2. No painel, clique em **Instalar tudo** (Painel ou Componentes e PHP).
3. Clique em **Iniciar tudo**. A CA local é instalada no Windows sozinha.
4. Se o cadeado do navegador não ficar verde: **Certificado SSL → Confiar na CA local** e reabra o navegador.
5. Crie o primeiro site: **Novo site** ou **Escanear pasta**.

## 3. Menu lateral

| Item | Para que serve |
|---|---|
| Painel | Serviços (ligar/desligar), sites, tarefas em andamento |
| Bancos de dados | Listar/criar/excluir bancos, backups, restauração, Adminer e phpMyAdmin |
| Terminal | Rodar comandos na pasta do projeto, com o PHP e o Composer do site |
| Diagnóstico | Verifica extensões, portas, hosts, CA, bancos e `.env` dos projetos |
| E-mail | Caixa do Mailpit (https://mail.test) |
| Certificado SSL | Status da CA local e botão de confiar |
| Componentes e PHP | Instalar/atualizar componentes, versões de PHP, Node.js e Python, editor do php.ini |
| Logs | Logs dos serviços e `laravel.log` do projeto |
| Configurações | Domínios, portas, DNS local, inicialização, backup agendado, MCP, exportar/importar |
| Ajuda | Esta documentação |

## 4. Sites

### Criar
- **Laravel novo**: última versão via `composer create-project`, `.env` ajustado (APP_URL, banco, e-mail, Redis), banco criado e `migrate` executado. Starter kits oficiais (Livewire, React, Vue) ou Breeze.
- **WordPress novo** (pt-BR), **pasta PHP vazia** ou **pasta já existente** (com aliases e pasta pública).
- **Banco**: MariaDB/MySQL ou PostgreSQL (o PostgreSQL é instalado e iniciado se preciso).
- **Escanear pasta**: cada subpasta da raiz de projetos vira um site.

### Tipos de site
- **PHP** (padrão): serve a pasta com a versão de PHP escolhida; detecta Laravel/WordPress e a pasta pública.
- **Proxy reverso**: coloca HTTPS em um app que já roda em outra porta (Node, Vite, Docker, Python). Use `3000` ou `host:porta`. No Docker do Windows: `host.docker.internal:3000`. Suporta WebSocket.
- **Redirecionamento**: manda o domínio para outra URL.

### Apps Node.js, Python, Go e Java
**Painel → Novo app** cria (ou cadastra) um app que escuta em uma porta. O RDR Local liga o processo com a variável `PORT`, põe HTTPS na frente (`https://app.test`), guarda o log e religa se o app cair. Modelos prontos: Node.js (Express, Fastify), Python (FastAPI, Flask, Django), Go e Java (comando próprio). Node.js e Python são baixados em **Componentes e PHP → Linguagens** (várias versões; cada app escolhe a sua). Detalhes e comandos de cada framework: *Guia de linguagens*.

### Opções por site
- **Aliases** (domínios extras). Aliases com curinga (`*.meu-app.test`) exigem o **DNS local** ligado.
- **PHP por site** (várias versões lado a lado).
- **Variáveis de ambiente** (uma por linha, `CHAVE=valor`): valem para o PHP do site, o terminal e os comandos do painel, e vencem o `.env`. Reinicie o Servidor Web para aplicar. Ficam em `config\config.json` em texto puro: **não guarde segredos de produção**.
- **Liberar CORS** (para APIs).
- Bloqueios automáticos: `/.env`, `/.git` e `/storage/logs`.

### Processos do site
Ícone de processos na linha do site: `queue:work`, `schedule:work`, `npm run dev` (Vite) e **Túnel público** (Cloudflared, link `https://*.trycloudflare.com`). Comandos rápidos: Migrate, Limpar caches, Storage link, Composer install, Migrate:fresh --seed.

> **Atenção:** quem tiver o link do túnel acessa o site. Não use dados reais.

## 5. Bancos de dados

- Listar, criar e excluir (a exclusão salva um backup automático antes).
- **Backup** por banco, lista de backups, **Restaurar** e **Restaurar de um arquivo .sql** (restaurar sobre um banco existente faz backup dele, apaga e recria). Arquivos em `data\backups\<motor>\`.
- **Backup agendado**: diário/semanal/mensal, horário e quantos manter. Só roda com o RDR Local aberto e o banco ligado; se perder o horário, roda ao abrir. Backups automáticos têm a marca `auto` e só eles são apagados pela retenção.
- **Conexão**: trecho de `.env` pronto (inclui Meilisearch).
- **Adminer** (https://db.test) e **phpMyAdmin** (https://pma.test, login automático como root): só respondem para 127.0.0.1.

Portas padrão (diferentes das comuns para conviver com ServBay/XAMPP): MariaDB 3307, PostgreSQL 5433, Redis 6380, Mailpit SMTP 1026 / painel 8026, Meilisearch 7710.

## 6. Terminal

Roda **um comando por vez** na pasta do projeto, com PHP e Composer do site no PATH. Tem saída ao vivo, histórico (setas), `cd`, `clear` e botão Parar. Para comandos interativos (tinker, perguntas) use **Abrir no CMD**. O **Guia de primeiros comandos** (Laravel, Composer, PHP, Node, Git) tem Executar / Editar / Copiar; comandos destrutivos pedem confirmação.

## 7. Componentes e PHP

- Instalar/atualizar: Caddy, PHP, Composer, MariaDB, PostgreSQL, Redis, Mailpit, Adminer, phpMyAdmin, Cloudflared, Meilisearch.
- **Linguagens**: Node.js e Python em várias versões lado a lado (veja o *Guia de linguagens*).
- **Verificar atualizações**: o que usa o componente é parado e religado sozinho; o php.ini é mantido. MariaDB e PostgreSQL **não** são atualizados automaticamente (risco para os dados).
- **Editor do PHP** (Configurar, por versão): ajustes comuns (memória, upload, fuso, erros, OPcache), liga/desliga extensões e edita o php.ini inteiro. Toda alteração é testada; se o PHP reclamar, volta como estava. Há backup `php.ini.bak`. Extensões desligadas por você não são religadas.

## 8. Configurações

- **Terminação dos domínios** (`.test`, `.local`, `.host`, `.localhost`), pasta raiz de projetos, PHP padrão.
- **Inicialização**: abrir com o Windows (tarefa agendada, exige Administrador uma vez) e ligar serviços automaticamente.
- **DNS local**: resolve `*.test` para 127.0.0.1 (porta 53/UDP; cria regra NRPT só para o domínio e remove ao parar).
- **Portas** de todos os serviços.
- **Conectar agentes de IA (MCP)**: veja o documento *Referência: CLI, API e MCP*.
- **Exportar/importar configuração**: leva sites, portas e preferências para outro PC (sem bancos e sem arquivos dos projetos).

## 9. Linha de comando

```
rdr status | start [serviço] | stop [serviço] | restart <serviço>
rdr sites | open <domínio> | doctor | backup
```
Funciona em qualquer terminal do RDR Local, ou com `bin\shims` no PATH. Precisa do painel aberto.

## 10. Boas práticas

- Use o RDR Local **só em desenvolvimento**: não há senhas nos bancos e o painel não tem login (acesso restrito a 127.0.0.1).
- Rode o **Diagnóstico** após criar ou clonar um projeto.
- Ative o **backup agendado** e teste uma restauração de vez em quando.
- Reinicie o Servidor Web depois de mexer em variáveis de ambiente ou no php.ini à mão.


## Endereço do painel
Com o servidor Web ligado, o painel também abre em `https://rdr-local-server.local` (a terminação segue a de Configurações). O nome é reservado, não pode ser usado por um site. Se o Web estiver parado, use `http://127.0.0.1:7070`.
