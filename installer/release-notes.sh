#!/usr/bin/env bash
# Imprime, a partir do CHANGELOG.md, as notas da versão pedida (o texto abaixo de "## <versão>", sem o título).
# Uso: installer/release-notes.sh 1.10.0     (falha se a seção não existir ou estiver vazia)
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION="${1:?informe a versão, ex.: 1.10.0}"
notes="$(awk -v v="$VERSION" '
  { sub(/\r$/, "") }
  $0 == "## " v { on = 1; next }
  /^## / { if (on) exit }
  on { print }
' CHANGELOG.md | sed -e '/./,$!d')"
if [ -z "$(printf '%s' "$notes" | tr -d '[:space:]')" ]; then
  echo "CHANGELOG.md não tem a seção '## $VERSION' (ou ela está vazia)." >&2
  exit 1
fi
printf '%s\n' "$notes"
