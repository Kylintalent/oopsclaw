#!/bin/bash
set -e

PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_ROOT"

# 1. 构建前端（直接输出到 web/backend/dist，供 Go embed 使用）
echo "📦 构建前端..."
cd web/frontend && pnpm install --frozen-lockfile && pnpm build:backend
cd "$PROJECT_ROOT"

# 2. 构建两个二进制
echo "🔨 构建二进制..."
mkdir -p build
CGO_ENABLED=0 go build -tags stdjson -o build/oopsclaw ./cmd/picoclaw
CGO_ENABLED=0 go build -tags stdjson -o build/oopsclaw-launcher ./web/backend

# 3. 重启 Launcher
echo "🚀 重启 Launcher..."
pkill -f oopsclaw-launcher || true
./build/oopsclaw-launcher