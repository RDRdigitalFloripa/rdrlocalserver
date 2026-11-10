#!/usr/bin/env bash
# Gera o instalador do RDR Local (Windows) em Linux/macOS/WSL. Requer: makensis (pacote nsis), npm, tar. Requer tambem python3 + Pillow (imagem lateral com a versao).
# Uso: installer/build.sh [versao]    -> saida: installer/dist/RDR-Local-Setup-<versao>.exe
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION="${1:-$(node -p "require('./package.json').version")}"
NODE_VER="${NODE_VER:-24.22.0}"          # Node LTS embutido (pacote npm node-win-x64)
STAGE="$(mktemp -d)"; trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$STAGE/app" "$STAGE/runtime" "$STAGE/launcher" installer/dist installer/.cache

# 1) Node.js embutido (cache para nao baixar de novo)
if [ ! -f "installer/.cache/node-$NODE_VER.exe" ]; then
  T="$(mktemp -d)"; (cd "$T" && npm pack "node-win-x64@$NODE_VER" >/dev/null && tar xzf node-win-x64-*.tgz)
  cp "$T/package/bin/node.exe" "installer/.cache/node-$NODE_VER.exe"; rm -rf "$T"
fi
cp "installer/.cache/node-$NODE_VER.exe" "$STAGE/runtime/node.exe"

# 2) Programa (sem dados, sem instalador)
tar --exclude=./bin --exclude=./data --exclude=./config --exclude=./logs --exclude=./installer \
    --exclude=./node_modules --exclude=./start-silent.vbs --exclude=./start.bat -cf - . | tar -xf - -C "$STAGE/app"

# 3) Launcher / bandeja
cp installer/launcher.vbs installer/open.vbs installer/tray.ps1 installer/stop.ps1 installer/tasks.ps1 installer/rdr-local.ico "$STAGE/launcher/"

# 4) Instalador
cd installer
python3 make-side.py "$VERSION"
makensis -V2 -DSTAGE="$STAGE" -DVERSION="$VERSION" rdr-local.nsi
mv "RDR-Local-Setup-$VERSION.exe" dist/
# O .sha256 leva só o nome do arquivo (sem "dist/"), para "sha256sum -c" funcionar na pasta do download.
(cd dist && sha256sum "RDR-Local-Setup-$VERSION.exe" | tee "RDR-Local-Setup-$VERSION.sha256")
