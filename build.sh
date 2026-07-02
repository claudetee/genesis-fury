#!/usr/bin/env bash
# GENESIS FURY 构建：esbuild 打包（借用 main_backend 的 esbuild 二进制，本地零安装）
# 用法: ./build.sh [--watch] [--check]
set -euo pipefail
cd "$(dirname "$0")"

ESBUILD=/workspace/repos/main_backend/node_modules/.bin/esbuild

if [[ "${1:-}" == "--check" ]]; then
  node tools/typecheck.mjs
  exit $?
fi

ARGS=(src/main.ts --bundle --outfile=dist/bundle.js --format=iife --target=es2020 --sourcemap --minify)
if [[ "${1:-}" == "--watch" ]]; then
  "$ESBUILD" "${ARGS[@]}" --watch
else
  "$ESBUILD" "${ARGS[@]}"
  echo "✓ dist/bundle.js $(du -h dist/bundle.js | cut -f1)"
fi
