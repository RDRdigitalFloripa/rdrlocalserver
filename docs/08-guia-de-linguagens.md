# Guia de linguagens: Node.js, Python, Go, Java e outras

O RDR Local não serve só PHP. Qualquer app que escute em uma porta ganha **HTTPS, domínio `.test`, log e reinício automático**, no mesmo painel e com o mesmo certificado. Isso vale para Node.js, Python, Go, Java, Ruby, .NET, Deno, Bun ou um binário seu.

## 1. Como funciona

Um site do tipo **App** tem: a pasta do projeto, a linguagem (e versão), o **comando de início** e uma **porta** (o RDR Local escolhe uma livre entre 9300 e 9999).

1. O RDR Local executa o comando na pasta do projeto, com a variável `PORT` e o runtime certo no PATH.
2. O Caddy responde em `https://seu-app.test` e repassa para `127.0.0.1:PORTA` (WebSocket incluído).
3. Se o app cair sozinho, é religado em 1,5 s. Se cair 5 vezes em 1 minuto, o RDR Local desiste e avisa (veja o log).
4. Os apps ligam junto com o **Servidor Web** e desligam com ele (opção *Ligar junto com o Servidor Web* por app).

**Regra de ouro:** o app precisa escutar em `127.0.0.1` na porta indicada. Use a variável `PORT` no código ou `{PORT}` no comando.

## 2. Instalar as linguagens (Node.js, Python, Go e Java)

**Componentes e PHP → Linguagens**: escolha Node.js, Python, Go ou Java, clique em *Ver versões disponíveis* e em *Instalar versão*. Dá para ter várias versões ao mesmo tempo.

| | Node.js | Python | Go | Java (JDK) |
|---|---|---|---|---|
| Fonte | Zip oficial de nodejs.org | `python-build-standalone` (com `pip` e `venv`) | Zip oficial de go.dev | Eclipse Temurin (Adoptium) |
| Pasta | `bin\node\<versão>` | `bin\python\<versão>` | `bin\go\<1.x>` | `bin\java\<major>` |
| Versões oferecidas | LTS ativas + a mais nova | 3.9 em diante | as 4 últimas 1.x estáveis | LTS + a mais nova (17+) |
| Dependências | `npm install` | `.venv` + `pip install -r requirements.txt` | `go mod download` | Maven/Gradle (wrapper do projeto) |
| Variáveis | `NODE_ENV` | `VIRTUAL_ENV` | `GOROOT`, `GOPATH` | `JAVA_HOME`, `SERVER_PORT`, `QUARKUS_HTTP_PORT` |
| Integridade | — | — | SHA-256 verificado | SHA-256 verificado |

- **Tornar padrão**: usada pelos apps que escolhem "Padrão".
- **Atualizar**: *Verificar atualizações* mostra novos patches (ex.: 22.11 → 22.12); os apps que usam a versão são parados e religados sozinhos.
- **Remover**: só se nenhum app usa a versão.
- O **terminal do site** passa a usar o Node padrão (ou o do app) e, em apps Python, o `.venv` do projeto.

## 3. Criar um app

**Painel → Novo app**.

| Modelo | O que cria | Comando |
|---|---|---|
| Node.js — Express | `package.json`, `server.js`, `.gitignore` | `npm run dev` (recarrega ao salvar) |
| Node.js — Fastify | idem | `npm run dev` |
| Python — FastAPI | `requirements.txt`, `main.py` (docs em `/docs`) | `python -m uvicorn main:app --reload --host 127.0.0.1 --port {PORT}` |
| Python — Flask | `requirements.txt`, `app.py` | `python -m flask --app app run --debug --host 127.0.0.1 --port {PORT}` |
| Python — Django | projeto `config/` (via `django-admin`) | `python manage.py runserver 127.0.0.1:{PORT}` |
| Go / Java | nada (só preenche o comando) | veja a seção 5 |
| Pasta que já tem um app | nada; o painel **detecta** a linguagem e sugere o comando | — |

Marque *Instalar dependências ao criar* para o RDR Local já rodar `npm install` ou criar o `.venv` e instalar o `requirements.txt`. Depois é só abrir o endereço.

**Django:** o RDR Local ajusta `ALLOWED_HOSTS`, `CSRF_TRUSTED_ORIGINS` e o cabeçalho de HTTPS no `settings.py` para funcionar atrás do proxy. Só use isso em desenvolvimento.

## 4. Frameworks e comandos prontos

| Projeto | Linguagem | Comando de início |
|---|---|---|
| Vite (React, Vue, Svelte) | Node.js | `npm run dev` (com `server.port: Number(process.env.PORT)` e `allowedHosts: true`; o modelo já vem pronto) |
| Next.js | Node.js | `npm run dev -- -H 127.0.0.1 -p {PORT}` |
| Nuxt | Node.js | `npm run dev -- --host 127.0.0.1 --port {PORT}` |
| NestJS | Node.js | `npm run start:dev` (leia `PORT` em `main.ts`: `process.env.PORT`) |
| Express/Koa/Fastify próprio | Node.js | `npm run dev` ou `node server.js` |
| FastAPI | Python | `python -m uvicorn main:app --reload --host 127.0.0.1 --port {PORT}` |
| Django | Python | `python manage.py runserver 127.0.0.1:{PORT}` |
| Flask | Python | `python -m flask --app app run --debug --port {PORT}` |
| Gin / Fiber / `net/http` | Go | `go run .` (o app lê `PORT`) |
| Spring Boot (Maven) | Java | `mvnw.cmd spring-boot:run` (a porta vem de `SERVER_PORT`, definida pelo RDR Local) |
| Spring Boot (Gradle) | Java | `gradlew.bat bootRun` |
| Quarkus | Java | `mvnw.cmd quarkus:dev` (usa `QUARKUS_HTTP_PORT`) |

Sobre Vite/Next: o HMR (recarga ao vivo) usa WebSocket, que o proxy já suporta. Se o Vite recusar o domínio, adicione `server.allowedHosts: true` no `vite.config`.

## 4.1 Modelos prontos (Novo app)

| Modelo | O que cria |
|---|---|
| Node.js — Express / Fastify | `package.json`, `server.js`, `npm install` |
| TypeScript — Express (tsx) | `src/server.ts`, `tsconfig.json`, `npm run dev` com recarga automática |
| Vite — React + TypeScript | projeto Vite pronto para o domínio local (HMR via `wss`) |
| Next.js (TypeScript) | `app/`, `next.config.mjs` com `allowedDevOrigins` |
| Python — FastAPI / Flask / Django | `.venv`, `requirements.txt`, projeto base |
| Go — servidor HTTP | `go.mod`, `main.go` (lê `PORT`) |
| Java — Spring Boot | projeto Maven gerado pelo **start.spring.io** (Java 21, Spring Web, Actuator) |

JavaScript e TypeScript usam o mesmo runtime (Node.js): TypeScript roda com `tsx` em desenvolvimento e `tsc` para build.

## 5. Outras linguagens (comando próprio)

Go, Java, Node.js e Python são baixados pelo próprio RDR Local (seção 2). Para as demais, use **Linguagem → Comando próprio**. O app usa o que estiver instalado no PATH do Windows. Instale uma vez:

| Linguagem | Como baixar (PowerShell) | Conferir |
|---|---|---|
| Maven (sem wrapper) | `winget install Apache.Maven` | `mvn -v` |
| .NET | `winget install Microsoft.DotNet.SDK.8` | `dotnet --version` |
| Ruby | `winget install RubyInstallerTeam.RubyWithDevKit.3.3` | `ruby -v` |
| Bun / Deno | `winget install Oven-sh.Bun` / `winget install DenoLand.Deno` | `bun -v` / `deno --version` |

Feche e abra o RDR Local depois de instalar, para ele enxergar o novo PATH. Em *Novo app* escolha *Pasta que já tem um app* e confira o comando. Para atualizar essas linguagens, rode `winget upgrade <pacote>`.

**Banco no app:** use as portas do RDR Local: MariaDB `127.0.0.1:3307` (usuário `root`, sem senha), PostgreSQL `127.0.0.1:5433` (usuário `postgres`, sem senha), Redis `127.0.0.1:6380`. Ponha isso nas **Variáveis de ambiente** do app (ex.: `DATABASE_URL=postgres://postgres@127.0.0.1:5433/meuapp`).

## 6. Dia a dia

| Botão na lista de sites | Faz |
|---|---|
| ▶ / ❚❚ (app) | Inicia / para o app |
| ↻ | Reinicia o app (útil após mudar `.env` ou dependências) |
| Pacote | Instala dependências de novo (`npm install` / `pip`) |
| Log do app | Mostra `logs\app-<id>.log` (saída padrão e erros) |
| Terminal | Abre o terminal já com Node/Python (e `.venv`) do projeto |
| Editar | Muda comando, porta, versão, variáveis, aliases |

O **Diagnóstico** confere se o runtime existe, se o app está ligado e se algo está escutando na porta.

## 7. Problemas comuns

| Sintoma | Causa e solução |
|---|---|
| "Node.js/Python não está instalado" | Instale em Componentes e PHP → Linguagens |
| "A porta N já está em uso" | Outro programa usa a porta; feche-o ou edite o app para outra porta |
| 502 Bad Gateway | O app não escuta em `127.0.0.1:PORT`. Confira o log e use `PORT`/`{PORT}` |
| O app liga e some | Erro de código ou dependência faltando: veja o log; clique no ícone de pacote |
| "App caiu" na lista | Caiu 5 vezes em 1 minuto; corrija o erro e inicie de novo |
| Django `DisallowedHost` / CSRF | Projeto criado fora do RDR Local: adicione o domínio em `ALLOWED_HOSTS` e `CSRF_TRUSTED_ORIGINS` |
| `npm`/`python` não encontrado no terminal | Instale a linguagem em Componentes (ou, para Go/Java, no PATH do Windows) |
| Mudei o PATH do Windows e o app não vê | Feche e reabra o RDR Local (ícone da bandeja → Sair) |

## 8. Segurança

- Os apps escutam só em `127.0.0.1`: não ficam visíveis na sua rede.
- Variáveis de ambiente ficam em `config.json` em texto puro: não guarde segredos de produção.
- O **Túnel público** (Cloudflared) também funciona com apps; qualquer pessoa com o link acessa o app enquanto o túnel estiver ligado.
- O comando de início roda com as suas permissões: só use projetos em que você confia.
