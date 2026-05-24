#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN="$ROOT/.build/debug/app-store-slides-tool"

needs_build=0
if [[ ! -x "$BIN" ]]; then
  needs_build=1
elif find "$ROOT/Package.swift" "$ROOT/Sources" -type f -newer "$BIN" | grep -q .; then
  needs_build=1
fi

if [[ "$needs_build" == "1" ]]; then
  swift build --package-path "$ROOT"
fi

if [[ "$*" != *"--config"* ]]; then
  echo "error: pass --config <path> or use the editor with --config-dir" >&2
  exit 1
fi

"$BIN" "$@"
