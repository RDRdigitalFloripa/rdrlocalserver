# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 RDR Digital - https://github.com/RDRdigitalFloripa/rdrlocalserver
#
# Compila o pgvector para o PostgreSQL do RDR Local (binários da EDB), testa de verdade e gera os zips de release.
# Roda no GitHub (.github/workflows/pgvector.yml) e também na sua máquina, se houver o Visual C++ (Build Tools):
#
#   powershell -ExecutionPolicy Bypass -File installer\build-pgvector.ps1 -PgvectorTag v0.8.7 `
#     -PgvectorCommit f37c13f68b57d2c3472b2214fbcff699d6d34876 -Revisao r1 -Saida .\saida -Alvos 17:17.6-1
#
# Cada alvo é "<versão principal>:<versão da EDB>". A extensão só serve para a MESMA versão principal do PostgreSQL.
# Saída por alvo: pgvector-<versão>-pg<principal>-win-x64.zip (+ .sha256) com lib\vector.dll e share\extension\*.
param(
  [Parameter(Mandatory)][string]$PgvectorTag,
  [Parameter(Mandatory)][ValidatePattern('^[0-9a-f]{40}$')][string]$PgvectorCommit,
  [Parameter(Mandatory)][ValidatePattern('^r\d+$')][string]$Revisao,
  [Parameter(Mandatory)][string]$Saida,
  [string[]]$Alvos = @('16:16.10-1', '17:17.6-1'),
  [int]$Porta = 55432,
  # só para teste local: pasta de um PostgreSQL (com bin, lib, share e include) já extraído, usada no lugar do download (um único alvo)
  [string]$PgLocal = ''
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Falha($msg) { throw $msg }
function Conferir($msg) { if ($LASTEXITCODE -ne 0) { Falha "$msg (código $LASTEXITCODE)" } }
# Roda o pg_ctl e espera SÓ ELE: "Start-Process -Wait" esperaria também o servidor que o "pg_ctl start" deixa rodando (e travaria para sempre)
function PgCtl($exe, [string[]]$argumentos) {
  $p = Start-Process -FilePath $exe -ArgumentList $argumentos -PassThru -WindowStyle Hidden
  $p.WaitForExit()
  return $p.ExitCode
}
if ($PgLocal -and $Alvos.Count -ne 1) { Falha '-PgLocal só vale com um único alvo.' }

$versao = $PgvectorTag.TrimStart('v')
$trab = Join-Path ([IO.Path]::GetTempPath()) ("rdr-pgvector-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $trab, $Saida | Out-Null
$Saida = (Resolve-Path $Saida).Path
$tar = Join-Path $env:SystemRoot 'System32\tar.exe'

# --- código-fonte do pgvector: tag + commit conferido (a tag poderia ser movida) ---
$fonte = Join-Path $trab 'fonte'
git clone --quiet --branch $PgvectorTag --depth 1 https://github.com/pgvector/pgvector.git $fonte; Conferir 'git clone do pgvector falhou'
$commit = (git -C $fonte rev-parse HEAD).Trim()
if ($commit -ne $PgvectorCommit) { Falha "A tag $PgvectorTag aponta para $commit, não para $PgvectorCommit. Abortado." }
Write-Host "pgvector $PgvectorTag @ $commit"

# --- Visual C++ ---
$vsw = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
if (-not (Test-Path $vsw)) { Falha 'vswhere.exe não encontrado: instale o Visual Studio Build Tools (C++).' }
$vs = (& $vsw -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath | Select-Object -First 1)
if (-not $vs) { Falha 'Visual C++ (x64) não encontrado.' }
$vcvars = Join-Path $vs 'VC\Auxiliary\Build\vcvars64.bat'
if (-not (Test-Path $vcvars)) { Falha "vcvars64.bat não encontrado em $vs" }

foreach ($alvo in $Alvos) {
  $principal, $edb = $alvo.Split(':')
  if ($principal -notmatch '^\d+$' -or $edb -notmatch '^\d+\.\d+-\d+$') { Falha "Alvo inválido: $alvo (use 17:17.6-1)" }
  Write-Host "`n===== PostgreSQL $principal ($edb) ====="
  $dir = Join-Path $trab "pg$principal"
  New-Item -ItemType Directory -Force -Path $dir | Out-Null

  # PostgreSQL da EDB: o MESMO zip que o RDR Local instala (cabeçalhos e postgres.lib para compilar, binários para testar)
  $pgroot = Join-Path $dir 'pgsql'
  if ($PgLocal) {
    New-Item -ItemType Directory -Force -Path $pgroot | Out-Null
    foreach ($d in 'bin', 'lib', 'share', 'include') { robocopy (Join-Path $PgLocal $d) (Join-Path $pgroot $d) /E /NFL /NDL /NJH /NJS /NP | Out-Null }
  } else {
    $zipPg = Join-Path $dir 'pg.zip'
    Invoke-WebRequest -Uri "https://get.enterprisedb.com/postgresql/postgresql-$edb-windows-x64-binaries.zip" -OutFile $zipPg
    & $tar -xf $zipPg -C $dir; Conferir 'não consegui extrair o PostgreSQL'
    Remove-Item $zipPg -Force
  }
  foreach ($f in 'bin\postgres.exe', 'include\server\postgres.h', 'lib\postgres.lib') { if (-not (Test-Path (Join-Path $pgroot $f))) { Falha "O zip da EDB não trouxe $f" } }

  # compilar (cópia limpa do código para cada versão principal; OPTFLAGS vazio = sem /arch:AVX2, serve em qualquer processador)
  $src = Join-Path $dir 'pgvector'
  Copy-Item $fonte $src -Recurse
  $bat = Join-Path $dir 'compilar.bat'
  @(
    '@echo off',
    "call `"$vcvars`" >nul || exit /b 1",
    "set `"PGROOT=$pgroot`"",
    "cd /d `"$src`" || exit /b 1",
    'nmake /nologo /F Makefile.win || exit /b 1'
  ) | Set-Content -Path $bat -Encoding ascii
  & cmd.exe /c "`"$bat`""; Conferir 'nmake falhou'
  foreach ($f in 'vector.dll', 'vector.control', "sql\vector--$versao.sql") { if (-not (Test-Path (Join-Path $src $f))) { Falha "A compilação não gerou $f" } }

  # pacote: mesma estrutura de pastas do PostgreSQL, para copiar por cima
  $pac = Join-Path $dir 'pacote'
  New-Item -ItemType Directory -Force -Path (Join-Path $pac 'lib'), (Join-Path $pac 'share\extension') | Out-Null
  Copy-Item (Join-Path $src 'vector.dll') (Join-Path $pac 'lib')
  Copy-Item (Join-Path $src 'vector.control') (Join-Path $pac 'share\extension')
  Copy-Item (Join-Path $src 'sql\vector--*.sql') (Join-Path $pac 'share\extension')
  Copy-Item (Join-Path $src 'LICENSE') (Join-Path $pac 'share\extension\pgvector-LICENSE.txt')

  # teste de verdade: instala o pacote num PostgreSQL de teste, sobe, cria a extensão e consulta
  Copy-Item (Join-Path $pac '*') $pgroot -Recurse -Force
  $dados = Join-Path $dir 'dados'
  & (Join-Path $pgroot 'bin\initdb.exe') -D $dados -U postgres -A trust -E UTF8 --no-locale | Out-Null; Conferir 'initdb falhou'
  $pgctl = Join-Path $pgroot 'bin\pg_ctl.exe'
  $logpg = Join-Path $dir 'postgres.log'
  # sem pipe (o servidor herdaria a saída e o pipe nunca fecharia) e sem "-Wait" (ver PgCtl)
  $cod = PgCtl $pgctl @('start', '-D', "`"$dados`"", '-w', '-t', '60', '-l', "`"$logpg`"", '-o', "`"-p $Porta -c listen_addresses=127.0.0.1`"")
  if ($cod -ne 0) { if (Test-Path $logpg) { Get-Content $logpg -Tail 20 }; Falha 'o PostgreSQL de teste não iniciou' }
  try {
    $psql = Join-Path $pgroot 'bin\psql.exe'
    $sql = "CREATE EXTENSION vector; SELECT extversion FROM pg_extension WHERE extname='vector'; SELECT '[1,2,3]'::vector <-> '[1,2,4]'::vector; CREATE TABLE t(id int, e vector(3)); INSERT INTO t VALUES (1,'[1,2,3]'),(2,'[4,5,6]'); CREATE INDEX ON t USING hnsw (e vector_l2_ops); SELECT id FROM t ORDER BY e <-> '[3,3,3]' LIMIT 1;"
    $saidaSql = & $psql -h 127.0.0.1 -p $Porta -U postgres -d postgres -At -v ON_ERROR_STOP=1 -c $sql 2>&1
    Conferir "psql falhou: $saidaSql"
    $linhas = @($saidaSql | Where-Object { $_ -match '^[\d.]+$' })
    if ($linhas.Count -lt 3 -or $linhas[0] -ne $versao -or $linhas[1] -ne '1' -or $linhas[2] -ne '1') { Falha "Resposta inesperada do teste: $($saidaSql -join ' | ')" }
    Write-Host "Teste ok: extensão $($linhas[0]), distância $($linhas[1]), vizinho mais próximo $($linhas[2])."
  } finally {
    PgCtl $pgctl @('stop', '-D', "`"$dados`"", '-m', 'fast', '-w', '-t', '60') | Out-Null
  }

  # zip + SHA-256 (bsdtar do Windows grava com "/" nos caminhos)
  $nome = "pgvector-$versao-pg$principal-win-x64.zip"
  $zipSaida = Join-Path $Saida $nome
  if (Test-Path $zipSaida) { Remove-Item $zipSaida -Force }
  & $tar -a -c -f $zipSaida -C $pac lib share; Conferir 'não consegui criar o zip'
  $hash = (Get-FileHash $zipSaida -Algorithm SHA256).Hash.ToLower()
  Set-Content -Path ($zipSaida -replace '\.zip$', '.sha256') -Value "$hash  $nome" -Encoding ascii
  Write-Host "$nome  $hash"
  Remove-Item $dir -Recurse -Force
}
Remove-Item $trab -Recurse -Force -ErrorAction SilentlyContinue
Write-Host "`nPronto: $Saida"
