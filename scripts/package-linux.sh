#!/bin/bash
set -e

# ─────────────────────────────────────────────────────────────────────────────
# OopsClaw Linux 打包脚本
#
# 将 oopsclaw + oopsclaw-launcher 打包成一个可分发的 .tar.gz
# 收到的人解压后运行 ./start.sh 即可一键启动
#
# 用法:
#   ./scripts/package-linux.sh                # 自动检测当前架构
#   GOARCH=amd64 ./scripts/package-linux.sh   # 交叉编译 x86_64
#   GOARCH=arm64 ./scripts/package-linux.sh   # 交叉编译 ARM64
# ─────────────────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

# 检测架构
ARCH="${GOARCH:-$(uname -m)}"
case "$ARCH" in
  x86_64)    ARCH="amd64" ;;
  aarch64)   ARCH="arm64" ;;
  arm64)     ARCH="arm64" ;;
  armv7l)    ARCH="arm" ; export GOARM=7 ;;
esac

VERSION=$(git describe --tags --always --dirty 2>/dev/null || echo "dev")
GIT_COMMIT=$(git rev-parse --short=8 HEAD 2>/dev/null || echo "dev")
BUILD_TIME=$(date +%FT%T%z)
GO_VERSION=$(go version | awk '{print $3}')
CONFIG_PKG="github.com/sipeed/picoclaw/pkg/config"

LDFLAGS="-X ${CONFIG_PKG}.Version=${VERSION} -X ${CONFIG_PKG}.GitCommit=${GIT_COMMIT} -X ${CONFIG_PKG}.BuildTime=${BUILD_TIME} -X ${CONFIG_PKG}.GoVersion=${GO_VERSION} -s -w"

PACKAGE_NAME="oopsclaw-${VERSION}-linux-${ARCH}"
PACKAGE_DIR="build/${PACKAGE_NAME}"

echo "=============================================="
echo "  OopsClaw Linux 打包"
echo "  版本:   ${VERSION}"
echo "  架构:   linux/${ARCH}"
echo "  输出:   build/${PACKAGE_NAME}.tar.gz"
echo "=============================================="
echo ""

# ── 1. 构建前端（直接输出到 web/backend/dist，供 Go embed 使用）────────────
echo "📦 [1/5] 构建前端..."
cd web/frontend && pnpm install --frozen-lockfile && pnpm build:backend
cd "$PROJECT_ROOT"

# ── 2. 构建 oopsclaw 二进制 ──────────────────────────────────────────────────
echo "🔨 [2/5] 构建 oopsclaw (linux/${ARCH})..."
mkdir -p "${PACKAGE_DIR}"
CGO_ENABLED=0 GOOS=linux GOARCH="$ARCH" go build \
  -tags stdjson \
  -ldflags "$LDFLAGS" \
  -o "${PACKAGE_DIR}/oopsclaw" \
  ./cmd/picoclaw

# ── 3. 构建 oopsclaw-launcher 二进制 ────────────────────────────────────────
echo "🔨 [3/5] 构建 oopsclaw-launcher (linux/${ARCH})..."
CGO_ENABLED=0 GOOS=linux GOARCH="$ARCH" go build \
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
LOG_FILE="${SCRIPT_DIR}/oopsclaw.log"
PID_FILE="${SCRIPT_DIR}/oopsclaw.pid"
export PATH="${SCRIPT_DIR}:${PATH}"

# 确保可执行
chmod +x "${SCRIPT_DIR}/oopsclaw" "${SCRIPT_DIR}/oopsclaw-launcher"

case "${1:-start}" in
  start)
    # 检查是否已在运行
    if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
      echo "  ⚠️  OopsClaw 已在运行 (PID: $(cat "$PID_FILE"))"
      echo "  日志: $LOG_FILE"
      exit 0
    fi

    echo ""
    echo "  🐾 OopsClaw 后台启动中..."
    echo ""

    # 后台启动，日志写入文件
    nohup "${SCRIPT_DIR}/oopsclaw-launcher" -no-browser -public "${@:2}" \
      > "$LOG_FILE" 2>&1 &
    LAUNCHER_PID=$!
    echo "$LAUNCHER_PID" > "$PID_FILE"

    # 等待 1 秒确认进程存活
    sleep 1
    if kill -0 "$LAUNCHER_PID" 2>/dev/null; then
      echo "  ✅ OopsClaw 已在后台启动 (PID: $LAUNCHER_PID)"
      echo "  访问: http://localhost:18800"
      echo "  日志: $LOG_FILE"
      echo ""
      echo "  查看日志: tail -f $LOG_FILE"
      echo "  停止服务: $0 stop"
    else
      echo "  ❌ 启动失败，请查看日志: $LOG_FILE"
      rm -f "$PID_FILE"
      exit 1
    fi
    ;;

  stop)
    if [ -f "$PID_FILE" ]; then
      PID=$(cat "$PID_FILE")
      if kill -0 "$PID" 2>/dev/null; then
        echo "  🛑 停止 OopsClaw (PID: $PID)..."
        kill "$PID"
        # 等待进程退出
        for i in $(seq 1 10); do
          if ! kill -0 "$PID" 2>/dev/null; then
            break
          fi
          sleep 1
        done
        # 强制杀死
        if kill -0 "$PID" 2>/dev/null; then
          kill -9 "$PID"
        fi
        rm -f "$PID_FILE"
        echo "  ✅ 已停止"
      else
        echo "  进程已不存在，清理 PID 文件"
        rm -f "$PID_FILE"
      fi
    else
      echo "  未找到运行中的 OopsClaw"
    fi
    ;;

  restart)
    "$0" stop
    sleep 1
    "$0" start "${@:2}"
    ;;

  status)
    if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
      echo "  ✅ OopsClaw 运行中 (PID: $(cat "$PID_FILE"))"
    else
      echo "  ⚫ OopsClaw 未运行"
    fi
    ;;

  log|logs)
    if [ -f "$LOG_FILE" ]; then
      tail -f "$LOG_FILE"
    else
      echo "  未找到日志文件"
    fi
    ;;

  *)
    echo "用法: $0 {start|stop|restart|status|logs}"
    echo ""
    echo "  start   [选项]  后台启动 OopsClaw"
    echo "  stop            停止 OopsClaw"
    echo "  restart [选项]  重启 OopsClaw"
    echo "  status          查看运行状态"
    echo "  logs            查看实时日志"
    echo ""
    echo "  选项会传递给 oopsclaw-launcher，如: $0 start -port 8080"
    ;;
esac
STARTSCRIPT

chmod +x "${PACKAGE_DIR}/start.sh"

cat > "${PACKAGE_DIR}/README.txt" << 'README'
OopsClaw - AI Agent 工具
========================

快速开始:
  1. 打开终端，cd 到本目录
  2. 运行: ./start.sh
  3. 浏览器打开 http://localhost:18800

首次使用:
  - 启动后在 Web 界面中配置你的 AI 模型（API Key 等）
  - 配置文件保存在 ~/.picoclaw/config.json

命令行选项:
  ./start.sh                    # 默认启动
  ./start.sh -port 8080         # 指定端口
  ./start.sh -public            # 允许局域网访问
  ./start.sh -no-browser        # 不自动打开浏览器
  ./start.sh config.json        # 指定配置文件路径

后台运行（服务器场景）:
  nohup ./start.sh -no-browser -public > oopsclaw.log 2>&1 &

设置为 systemd 服务:
  sudo cp oopsclaw.service /etc/systemd/system/
  sudo systemctl enable oopsclaw
  sudo systemctl start oopsclaw
README

# 生成 systemd service 文件（方便服务器部署）
cat > "${PACKAGE_DIR}/oopsclaw.service" << 'SYSTEMD'
[Unit]
Description=OopsClaw AI Agent
After=network.target

[Service]
Type=simple
ExecStart=/opt/oopsclaw/start.sh -no-browser -public
WorkingDirectory=/opt/oopsclaw
Restart=on-failure
RestartSec=5
User=root

[Install]
WantedBy=multi-user.target
SYSTEMD

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
echo ""
echo "  服务器部署:"
echo "    tar -xzf ${PACKAGE_NAME}.tar.gz -C /opt/"
echo "    mv /opt/${PACKAGE_NAME} /opt/oopsclaw"
echo "    cp /opt/oopsclaw/oopsclaw.service /etc/systemd/system/"
echo "    systemctl enable --now oopsclaw"
echo "=============================================="
