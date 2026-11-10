# Ferramentas do projeto

Na lista de sites, o ícone de **ajustes** (três linhas com marcadores) abre *Ferramentas — nome do site*, com atalhos, scripts, auditoria de segurança e o editor do `.env`. Vale para sites com pasta (PHP e apps).

## Atalhos

- **Abrir no VS Code, Cursor ou PhpStorm**: só aparecem os que estão instalados neste PC.
- **Repositório no GitHub**: abre o endereço do remoto `origin` do projeto. Se a URL tiver usuário ou token, eles **não** aparecem no link.
- **Terminal com Claude Code**: abre uma janela de terminal na pasta do projeto já rodando `claude`. Só aparece se o comando `claude` estiver instalado.

## Scripts

Lista os scripts do `composer.json` (com o PHP do site) e do `package.json` (`npm run`) e roda cada um com um clique. A saída aparece no log da tarefa.

- Só roda scripts que **existem** no arquivo do projeto. O nome é validado; o RDR Local nunca monta um comando com texto livre.
- Eventos do Composer (`post-autoload-dump`, `post-update-cmd`…) e ciclos de vida do npm (`postinstall`, `prepare`…) não viram botão, porque rodam sozinhos.
- Scripts que **não terminam** (`dev`, `watch`, `serve`, `vite`…) aparecem como *fica rodando* e não têm botão: use **Processos** (Vite, fila, agendador) ou o **Terminal** do site.
- Um script que passa de **10 minutos** é interrompido.
- Script que termina com código diferente de zero aparece como erro na tarefa, com o código de saída.

> Cuidado: um script é código do projeto. Rode apenas em projetos em que você confia.

## Auditoria de segurança

O botão **Auditar** procura vulnerabilidades conhecidas nas versões **travadas** do projeto:

- **Composer:** `composer audit --locked`, sobre o `composer.lock`.
- **npm:** `npm audit --omit=dev`, sobre o `package-lock.json` (dependências de produção). Projetos com yarn ou pnpm não são auditados aqui.

Usa a internet. O resultado:

- **Com achados:** a tarefa termina em **erro**, para não passar batido, com os pacotes, a gravidade, o aviso e o link.
- **Sem lock:** avisa para rodar `composer install` ou `npm install` antes. Se nenhum lock existir, diz que **nada foi auditado**.
- **Falha ao consultar** (sem internet, resposta inválida): termina em erro como **auditoria incompleta**. Isso nunca é apresentado como "está tudo certo".

## .env

A aba **.env** compara o `.env` do projeto com o `.env.example` (ou `.env.sample` / `.env.dist`):

- **Faltando:** variáveis que existem no exemplo e não no `.env`, com o botão *Adicionar* (uma) ou *Adicionar todas as faltantes*. O valor é copiado do exemplo como está.
- **Só no .env:** variáveis que não estão no exemplo.
- **Para preencher:** variáveis vazias que o exemplo preenche, e a `APP_KEY` vazia.
- **Editar:** troca o valor de uma variável. Valores com espaço vão entre aspas; com `$`, entre aspas simples (sem expansão de variáveis).
- **Sem `.env`:** *Criar a partir do .env.example*.

Valores sensíveis (nomes com `PASSWORD`, `SECRET`, `TOKEN`, `PRIVATE`, `API_KEY`, `APP_KEY`, terminados em `_KEY`, `DSN`, `SALT`…) **nunca** voltam para a tela: aparece só se estão preenchidos. Ao editar um deles, o valor atual não é mostrado.

Antes de qualquer alteração o `.env` atual é copiado para `.env.backup` (o Laravel já ignora esse nome no Git). Só existe **um** backup, o da alteração mais recente. O fim de linha (LF ou CRLF) do arquivo é preservado.

## Limites

Os atalhos de editor e do Claude Code funcionam só no Windows. A edição do `.env` não mexe em comentários nem em linhas que o RDR Local não alterou.
