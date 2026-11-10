# Plano do projeto: especificação, tarefas e diário

## A ideia

Hoje boa parte do desenvolvimento acontece com apoio de agentes de IA (Claude Code, Codex, Cursor). Para o agente (e para você, daqui a duas semanas) saber **o que fazer** e **onde o projeto parou**, o RDR Local usa o **desenvolvimento guiado por especificação**: o que o projeto deve fazer fica escrito, o trabalho vira tarefas verificáveis e o andamento é registrado.

Tudo isso são **arquivos em `docs/`**, versionados no Git. Não existe banco de dados do RDR Local por trás: o painel lê e escreve os **mesmos arquivos** que o agente edita. Por isso o plano vai com o projeto, aparece no diff e funciona com qualquer agente.

## Os três arquivos

Seguem o padrão `NN-DD-MM-AAAA-nome.md` e são achados pelo final do nome:

| Arquivo | Para quê |
|---|---|
| `…-especificacao.md` | A fonte da verdade: objetivo, requisitos, critérios de aceitação, fora do escopo e decisões. Muda **antes** do comportamento. |
| `…-tarefas.md` | As fases (títulos `##`) e as tarefas (uma por linha). É o que o Painel mostra. |
| `…-diario.md` | Registro cronológico: o que foi feito, onde parou e o próximo passo. |

Nomes sem número e data (`tarefas.md`, `diario.md`) também são reconhecidos.

### Formato das tarefas

```markdown
## Fase 1 — Fundação
- [x] Preparar o ambiente
- [~] Cadastro de veículos
- [ ] Busca com filtros
- [-] Importar planilha antiga (não será feito: o cliente cancelou)

## Descobertas
- [ ] Imagens grandes travam a listagem
```

Estados: `[ ]` a fazer · `[~]` em andamento · `[x]` feito · `[-]` não será feito (sai do total). As fases são os títulos `##`. A fase **Descobertas** recebe o que surgir no caminho. Tarefas dentro de blocos de código e comentários são ignoradas.

### Formato do diário

```markdown
## 10/11/2026
- 14:32 Terminei o login. Falta o reset de senha.
  Próximo passo: e-mail de recuperação.
```

Uma seção por dia (`## DD/MM/AAAA`), uma anotação por linha, no **fim** do arquivo. Linhas recuadas continuam a anotação anterior.

## Como ativar

- **Projetos novos** (Laravel, WordPress, pasta PHP e apps) já nascem com os três arquivos e com a regra de fluxo no `CLAUDE.md` e no `AGENTS.md`.
- **Projetos que já existem:** ícone de ajustes na linha do site → aba **Plano** → **Ativar plano**. Cria só o que falta em `docs/` (com o próximo número) e **acrescenta** a seção *Fluxo de trabalho* ao `CLAUDE.md` e ao `AGENTS.md` (cria os que não existirem). Nada existente é sobrescrito e, rodando de novo, nada se duplica.

## No painel

- **Painel → Plano dos projetos:** um cartão por projeto com a barra de progresso (feitas ÷ total), a fase atual, as tarefas em andamento e a última anotação do diário. Clique para abrir o plano.
- **Aba Plano** (Ferramentas do projeto):
  - **Tarefas:** troque o estado de cada tarefa, adicione tarefas a uma fase ou crie uma fase nova (ela entra antes de *Descobertas*).
  - **Diário:** escreva uma anotação; ela entra sob a seção de hoje.
  - **Especificação:** leitura. Para editar, use o editor ou peça ao agente.

## O fluxo que o agente segue

A seção *Fluxo de trabalho* do `CLAUDE.md`/`AGENTS.md` manda o agente:

1. Ler a especificação e as tarefas antes de codificar; se a tarefa pedir algo que a especificação não cobre, perguntar e propor mudar a especificação **antes** de mudar o comportamento.
2. Trabalhar **uma tarefa por vez**, marcando `[~]` ao começar.
3. Marcar `[x]` só quando a tarefa estiver pronta **e verificada** (teste passando ou conferido na tela); `[-]` com o motivo se não será feita.
4. Pôr tarefas novas na fase **Descobertas**, sem apagar nem reescrever as existentes.
5. Ao terminar a sessão, acrescentar ao diário o que foi feito, onde parou e o próximo passo.
6. Atualizar a especificação no mesmo commit se o comportamento mudou.

O RDR Local atualiza o Painel sozinho a partir dos arquivos (a cada poucos segundos).

## Edição ao mesmo tempo (você e o agente)

O painel faz **edições mínimas**: trocar o estado troca um caractere, adicionar acrescenta uma linha. Antes de mudar o estado de uma tarefa, ele confere se a linha ainda é a mesma que você viu. Se o agente editou o arquivo no meio do caminho, o painel **recusa** e pede para recarregar, em vez de marcar a tarefa errada. Se os dois gravarem no mesmo instante, vale quem gravar por último, por isso o Git é a rede de segurança.

## Limites desta versão

- Os arquivos são lidos até 400 KB.
- O diário só é lido pelas últimas 30 seções.
- Ainda não há ferramentas de MCP para o agente listar e marcar tarefas: ele edita os arquivos diretamente.
- Não há modelos de especificação por tipo de funcionalidade.
