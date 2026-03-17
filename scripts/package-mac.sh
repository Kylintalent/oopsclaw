#!/bin/bash
set -e

# ─────────────────────────────────────────────────────────────────────────────
# PicoClaw macOS 打包脚本
#
# 将 picoclaw + picoclaw-launcher 打包成一个可分发的 .tar.gz
# 收到的人解压后运行 ./start.sh 即可一键启动
#
# 用法:
#   ./scripts/package-mac.sh              # 自动检测当前 Mac 架构
#   GOARCH=amd64 ./scripts/package-mac.sh # 交叉编译 Intel Mac
#   GOARCH=arm64 ./scripts/package-mac.sh # 交叉编译 Apple Silicon
# ─────────────────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

# 检测架构
ARCH="${GOARCH:-$(uname -m)}"
case "$ARCH" in
  x86_64) ARCH="amd64" ;;
  arm64)  ARCH="arm64" ;;
esac

VERSION=$(git describe --tags --always --dirty 2>/dev/null || echo "dev")
GIT_COMMIT=$(git rev-parse --short=8 HEAD 2>/dev/null || echo "dev")
BUILD_TIME=$(date +%FT%T%z)
GO_VERSION=$(go version | awk '{print $3}')
CONFIG_PKG="github.com/sipeed/picoclaw/pkg/config"

LDFLAGS="-X ${CONFIG_PKG}.Version=${VERSION} -X ${CONFIG_PKG}.GitCommit=${GIT_COMMIT} -X ${CONFIG_PKG}.BuildTime=${BUILD_TIME} -X ${CONFIG_PKG}.GoVersion=${GO_VERSION} -s -w"

PACKAGE_NAME="oopsclaw-${VERSION}-darwin-${ARCH}"
PACKAGE_DIR="build/${PACKAGE_NAME}"

echo "=============================================="
echo "  OopsClaw macOS 打包"
echo "  版本:   ${VERSION}"
echo "  架构:   darwin/${ARCH}"
echo "  输出:   build/${PACKAGE_NAME}.tar.gz"
echo "=============================================="
echo ""

# ── 1. 构建前端（直接输出到 web/backend/dist，供 Go embed 使用）────────────
echo "📦 [1/5] 构建前端..."
cd web/frontend && pnpm install --frozen-lockfile && pnpm build:backend
cd "$PROJECT_ROOT"

# ── 2. 构建 oopsclaw 二进制 ──────────────────────────────────────────────────
echo "🔨 [2/5] 构建 oopsclaw (darwin/${ARCH})..."
CGO_ENABLED=0 GOOS=darwin GOARCH="$ARCH" go build \
  -tags stdjson \
  -ldflags "$LDFLAGS" \
  -o "${PACKAGE_DIR}/oopsclaw" \
  ./cmd/picoclaw

# ── 3. 构建 oopsclaw-launcher 二进制 ────────────────────────────────────────
echo "🔨 [3/5] 构建 oopsclaw-launcher (darwin/${ARCH})..."
CGO_ENABLED=0 GOOS=darwin GOARCH="$ARCH" go build \
  -tags stdjson \
  -ldflags "-s -w" \
  -o "${PACKAGE_DIR}/oopsclaw-launcher" \
  ./web/backend

# ── 4. 生成启动脚本和说明 ───────────────────────────────────────────────────
echo "📝 [4/5] 生成启动脚本..."

cat > "${PACKAGE_DIR}/start.sh" << 'STARTSCRIPT'
#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
export PATH="${SCRIPT_DIR}:${PATH}"

echo ""
echo "  🐾 OopsClaw 启动中..."
echo ""

# 确保可执行
chmod +x "${SCRIPT_DIR}/oopsclaw" "${SCRIPT_DIR}/oopsclaw-launcher"

# 启动 launcher（它会自动管理 oopsclaw 进程）
exec "${SCRIPT_DIR}/oopsclaw-launcher" "$@"
STARTSCRIPT

chmod +x "${PACKAGE_DIR}/start.sh"

cat > "${PACKAGE_DIR}/README.txt" << 'README'
OopsClaw - AI Agent 工具
========================

快速开始:
  1. 打开终端，cd 到本目录
  2. 运行: ./start.sh
  3. 浏览器会自动打开 http://localhost:18800

首次使用:
  - 启动后在 Web 界面中配置你的 AI 模型（API Key 等）
  - 配置文件保存在 ~/.picoclaw/config.json

命令行选项:
  ./start.sh                    # 默认启动
  ./start.sh -port 8080         # 指定端口
  ./start.sh -public            # 允许局域网访问
  ./start.sh -no-browser        # 不自动打开浏览器
  ./start.sh config.json        # 指定配置文件路径

如果 macOS 提示"无法验证开发者":
  1. 打开"系统设置" → "隐私与安全性"
  2. 找到被阻止的程序，点击"仍要打开"
  或者运行:
    xattr -cr ./oopsclaw ./oopsclaw-launcher
README

# ── 5. 打包 ─────────────────────────────────────────────────────────────────
echo "📦 [5/5] 打包 tar.gz..."
cd build
tar -czf "${PACKAGE_NAME}.tar.gz" "${PACKAGE_NAME}"
cd "$PROJECT_ROOT"

# 计算文件大小
SIZE=$(du -sh "build/${PACKAGE_NAME}.tar.gz" | awk '{print $1}')

echo ""
echo "=============================================="
echo "  ✅ 打包完成！"
echo ""
echo "  输出文件: build/${PACKAGE_NAME}.tar.gz (${SIZE})"
echo "  目录内容:"
ls -lh "${PACKAGE_DIR}/" | tail -n +2 | awk '{printf "    %-30s %s\n", $NF, $5}'
echo ""
echo "  分发方式:"
echo "    发送 build/${PACKAGE_NAME}.tar.gz 给对方"
echo "    对方解压后运行 ./start.sh 即可"
echo "=============================================="
