#!/bin/bash
set -e

# 1. 构建前端
rm -rf web/frontend/dist
cd web/frontend && pnpm build
cd /Users/langxian/goland/picoclaw

# 2. 同步前端产物到 Launcher embed 目录（重要！Launcher embed 的是 web/backend/dist）
cp -r web/frontend/dist/. web/backend/dist/

# 3. 构建两个二进制
rm -rf build/*
CGO_ENABLED=0 go build -tags stdjson -o build/picoclaw ./cmd/picoclaw
CGO_ENABLED=0 go build -tags stdjson -o build/picoclaw-launcher ./web/backend

# 4. 重启 Launcher
pkill -f picoclaw-launcher || true
./build/picoclaw-launcher