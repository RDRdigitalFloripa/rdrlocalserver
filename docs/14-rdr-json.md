# rdr.json: o ambiente do projeto dentro do repositório

## Para que serve

Hoje o domínio, a versão do PHP, o banco e os serviços de um projeto ficam só no RDR Local de quem os criou. O `rdr.json` guarda isso **dentro do projeto**, no Git. Quem clona o repositório aplica o arquivo e o RDR Local monta o mesmo ambiente: site com HTTPS, banco criado, serviços ligados e `.env` alinhado.

## Como usar

**Quem já tem o projeto funcionando**
1. Na lista de sites, clique no ícone **rdr.json** da linha do site (ele aparece em todo site com pasta).
2. Confirme *Gerar rdr.json*. O arquivo é criado na pasta do projeto.
3. Faça o commit do arquivo.

**Quem acabou de clonar**
- Pelo terminal, na pasta do projeto: `rdr up` (ou `rdr up C:\www\meu-projeto`). Mostra o que vai fazer, aplica e imprime o resultado.
- Pelo painel: cadastre um site apontando para a pasta clonada e clique no ícone **rdr.json** (ele fica destacado quando a pasta tem o arquivo). O painel mostra a prévia e só aplica quando você confirma.

Aplicar de novo **não duplica nada**: o site é atualizado, o banco que já existe é mantido e o `.env` é reajustado.

## Formato

```json
{
  "rdr": 1,
  "name": "Loja de carros",
  "domain": "loja.test",
  "aliases": ["www.loja.test"],
  "type": "php",
  "php": "8.4",
  "docroot": "public",
  "cors": false,
  "env": { "APP_ENV": "local" },
  "database": { "engine": "mariadb", "name": "loja" },
  "services": ["redis", "mailpit"]
}
```

| Campo | Obrigatório | O que faz |
|---|---|---|
| `rdr` | sim | Versão do formato. Hoje, sempre `1`. |
| `name` | não | Nome do site (padrão: nome da pasta). |
| `domain` | não | Domínio (`.test`, `.local`, `.host` ou `.localhost`). Padrão: nome + terminação das Configurações. |
| `aliases` | não | Lista de domínios extras. Curinga (`*.loja.test`) exige o DNS local. |
| `type` | não | `php` (padrão) ou `app`. |
| `php` | não | Versão do PHP (ex.: `8.4`). Se não estiver instalada, o RDR Local avisa e usa o padrão. |
| `docroot` | não | Pasta pública, como `public`. Padrão: automática. |
| `cors` | não | Liberar CORS (APIs). |
| `env` | não | Variáveis de ambiente do site (`CHAVE: valor`). **Vão para o Git: nunca ponha segredos aqui.** |
| `database` | não | `engine` (`mariadb` ou `postgres`) e `name` (letras, números e `_`). O banco é criado se não existir. |
| `services` | não | Serviços a ligar: `mariadb`, `postgres`, `redis`, `mailpit`, `meilisearch`. O motor do banco entra sozinho. |
| `app` | só com `type: "app"` | `runtime` (`node`, `python`, `go`, `java` ou `custom`), `rtVersion`, `cmd` (comando que inicia o app), `autoStart`. |

Campos desconhecidos são ignorados com um aviso.

## O que o RDR Local faz ao aplicar

1. Liga os serviços da lista que estiverem instalados (os que faltam viram aviso).
2. Cria o banco, se ainda não existir (com o motor ligado).
3. Cria ou atualiza o site daquela pasta.
4. Se a pasta tem `.env`, ajusta `APP_URL`, as variáveis `DB_*`, `MAIL_*` (se `mailpit` estiver na lista) e `REDIS_*` (se `redis` estiver). O restante do `.env` fica como está.
5. Em `type: "app"`, inicia o app se o Servidor Web estiver ligado e `autoStart` não for `false`.

## Segurança

- O arquivo só tem **campos declarativos**, validados pelas mesmas regras do cadastro de sites. Ele não executa scripts.
- A única exceção é o `app.cmd`: ele roda um comando na sua máquina. Por isso o painel mostra o comando e pede confirmação, e o `rdr up` só aplica com `--yes`. **Só aplique o `rdr.json` de um app se confiar no projeto.**
- *Gerar rdr.json* **não** exporta as variáveis de ambiente do site nem o conteúdo do `.env`, para não vazar segredo no Git.
- O Caddy não serve o `/rdr.json` no navegador (nem `docs/`, `CLAUDE.md` e `AGENTS.md`) quando ele está na pasta pública.

## Limites desta versão

Não existe, ainda, a lista de processos (fila, agendador, Vite) nem a escolha de versão do banco no arquivo. Aplicar o arquivo não clona o repositório, não roda `composer install` nem `migrate`: isso continua nos comandos do projeto.
