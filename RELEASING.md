# Como publicar uma versão

A release é gerada pelo GitHub Actions (`.github/workflows/release.yml`). Ela é o que o painel consulta em *Componentes e PHP → Verificar atualizações*, então **sem release publicada ninguém é avisado da versão nova**.

## Publicar

1. **Suba a versão** em todos os lugares:
   - `package.json` (`"version"`);
   - `public/index.html` (rodapé `RDR LOCAL SERVER vX.Y.Z`);
   - `CHANGELOG.md`: nova seção `## X.Y.Z` com as novidades (o texto vira as notas da release);
   - cabeçalhos de versão dos documentos em `docs/`, `README.md` e `LEIA-ME.txt`.
2. Rode `npm test` (ou confira o fluxo **Testes** verde na `main`; veja `TESTING.md`), faça o commit e envie para a `main`.
3. Crie e envie a tag, com o **mesmo número** do `package.json`:

   ```bash
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```

4. Acompanhe em **Actions → Release**. Em poucos minutos a release aparece em **Releases** com dois arquivos: `RDR-Local-Setup-X.Y.Z.exe` e `RDR-Local-Setup-X.Y.Z.sha256`.

O fluxo para sem publicar nada se: a tag não bater com o `package.json`, o rodapé do painel estiver com outra versão, o `CHANGELOG.md` não tiver a seção da versão, o código tiver erro de sintaxe, o instalador sair pequeno demais ou o SHA-256 não conferir.

## Testar o build sem publicar

**Actions → Release → Run workflow** (na `main`). Gera o instalador e guarda como artefato por 7 dias, sem criar release. Baixe, instale numa máquina de teste e só depois crie a tag.

## Conferir um download

```powershell
Get-FileHash .\RDR-Local-Setup-X.Y.Z.exe -Algorithm SHA256
```

O valor deve ser igual ao do arquivo `.sha256`. Em Linux/Git Bash: `sha256sum -c RDR-Local-Setup-X.Y.Z.sha256` na pasta do download.

## Como o painel usa a release

`lib/appupdate.js` consulta `releases/latest` do repositório (constante `REPO`). Só oferece "Baixar e instalar" se a release tiver o `.exe` **e** o `.sha256` com esses nomes exatos; baixa só de `github.com/<repositório>/releases/download/…` e abre o instalador apenas se o SHA-256 conferir. O repositório precisa ser público.

## Publicar o pgvector (extensão do PostgreSQL)

O pgvector não publica binários para Windows; o RDR Local compila os seus (`installer/build-pgvector.ps1`, chamado por `.github/workflows/pgvector.yml`). Isso é **separado** da release do app e só se refaz ao subir a versão do pgvector ou o PostgreSQL de referência.

1. Em `.github/workflows/pgvector.yml`, ajuste `PGVECTOR_TAG`, `PGVECTOR_COMMIT` (o commit completo da tag, para conferir que ela não foi movida) e, se for só refazer o build, `REVISAO` (`r2`, `r3`…). Em `lib/components.js`, ajuste `PGVECTOR.version` e `PGVECTOR.rev` para os mesmos valores.
2. **Actions → pgvector (Windows) → Run workflow**, sem marcar nada: compila para o PostgreSQL 16 e 17, **testa** (sobe o PostgreSQL, `CREATE EXTENSION vector`, consulta e índice HNSW) e guarda os zips como artefato por 7 dias.
3. Rode de novo marcando **publicar**: cria a release `pgvector-<tag>-<revisão>` (que **não** é a "latest", então o painel não a confunde com uma versão do app) com os zips e os `.sha256`. O resumo da execução lista os SHA-256.
4. Cole os SHA-256 em `PGVECTOR.sha256` (`lib/components.js`), um por versão principal do PostgreSQL. **Sem isso o painel recusa instalar** (e a publicação do app para: o fluxo *Release* confere que nenhum hash está vazio). Depois siga *Publicar* acima.

Para rodar na sua máquina (precisa do Visual Studio Build Tools com C++): `installer\build-pgvector.ps1 -PgvectorTag v0.8.7 -PgvectorCommit <commit> -Revisao r1 -Saida .\saida -Alvos 17:17.6-1`.

## Se algo der errado

- **Falhou antes de publicar:** corrija, mova a tag para o novo commit (`git tag -f vX.Y.Z && git push -f origin vX.Y.Z`) e o fluxo roda de novo. Só faça isso se nenhuma release dessa versão tiver sido criada.
- **Release publicada com problema:** não reaproveite o número. Apague a release em *Releases* (quem ainda não baixou deixa de ver), corrija e publique a próxima versão (X.Y.Z+1).

## Limites atuais

- O instalador **não tem assinatura digital** e **não está planejado** assinar: o projeto é gratuito e não banca certificado. O SmartScreen pode avisar na primeira vez; a integridade se confere pelo SHA-256 publicado junto.
- O build usa o NSIS do Ubuntu (`apt`). Se a imagem do runner mudar e o build quebrar, a falha aparece no log da etapa *Gerar o instalador*.
