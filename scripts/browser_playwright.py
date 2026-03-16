#!/usr/bin/env python3
"""
Playwright browser automation driver for OopsClaw AI agent.

Usage:
    python3 browser_playwright.py '<json_action>'

Action JSON format:
    {
        "action": "navigate" | "click" | "type" | "search" | "get_text" | "screenshot" | "close",
        "url": "https://...",          # for navigate
        "selector": "css or text",    # for click/type
        "text": "input text",         # for type/search
        "search_engine": "baidu" | "google" | "bing",  # for search (default: google)
        "session_id": "optional-id",  # reuse existing browser session
        "cdp_port": 9222              # Chrome remote debugging port (default: 9222)
    }

Output JSON format:
    {
        "success": true/false,
        "text": "page text content",
        "title": "page title",
        "url": "current url",
        "screenshot": "/tmp/playwright_screenshot_xxx.png",
        "error": "error message if failed"
    }

连接已有 Chrome 的方法：
    macOS:
        /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --remote-debugging-port=9222 --no-first-run &
    或者在已有 Chrome 中打开：
        chrome://flags/#enable-remote-debugging  （部分版本支持）

    脚本会自动尝试连接 localhost:9222，成功则复用已有浏览器（共享 cookies/登录态），
    失败则回退到启动新的 Chrome 实例。
"""

import json
import os
import sys
import tempfile
import time
import hashlib

SESSION_DIR = os.path.join(tempfile.gettempdir(), "picoclaw_playwright_sessions")
os.makedirs(SESSION_DIR, exist_ok=True)


def get_session_file(session_id: str) -> str:
    return os.path.join(SESSION_DIR, f"{session_id}.json")


def load_session_state(session_id: str) -> dict:
    path = get_session_file(session_id)
    if os.path.exists(path):
        try:
            with open(path) as f:
                return json.load(f)
        except Exception:
            pass
    return {}


def save_session_state(session_id: str, state: dict):
    path = get_session_file(session_id)
    with open(path, "w") as f:
        json.dump(state, f)


def extract_page_text(page) -> str:
    """Extract readable text from the page, stripping scripts/styles."""
    try:
        text = page.evaluate("""() => {
            const clone = document.cloneNode(true);
            clone.querySelectorAll('script, style, noscript, svg').forEach(el => el.remove());
            return (clone.body || clone).innerText || clone.textContent || '';
        }""")
        lines = [line.strip() for line in text.splitlines() if line.strip()]
        return "\n".join(lines[:200])  # limit to 200 lines
    except Exception:
        return ""


def _print_execution_plan(action_data: dict, script_path: str):
    """Print the full execution plan to stderr before running anything."""
    import json as _json
    action = action_data.get("action", "navigate")
    print("=" * 60, file=sys.stderr, flush=True)
    print("[playwright] 📋 执行计划预览", file=sys.stderr, flush=True)
    print("=" * 60, file=sys.stderr, flush=True)
    print(f"[playwright] 脚本路径: {script_path}", file=sys.stderr, flush=True)
    print(f"[playwright] 操作类型: {action}", file=sys.stderr, flush=True)
    print(f"[playwright] 完整参数:\n{_json.dumps(action_data, ensure_ascii=False, indent=2)}", file=sys.stderr, flush=True)
    print(f"[playwright] 执行命令: python3 {script_path} '{_json.dumps(action_data, ensure_ascii=False)}'", file=sys.stderr, flush=True)

    browser_step = f"连接浏览器守护进程（端口 {_DAEMON_CDP_PORT}），若未启动则自动启动"

    # Print action-specific plan
    if action == "close_browser":
        print(f"[playwright] 执行步骤:", file=sys.stderr, flush=True)
        print(f"[playwright]   1. 读取守护进程状态文件 (~/.picoclaw/browser_daemon.json)", file=sys.stderr, flush=True)
        print(f"[playwright]   2. 发送 SIGTERM 关闭 Chrome 守护进程", file=sys.stderr, flush=True)
        print(f"[playwright]   3. 删除状态文件", file=sys.stderr, flush=True)
        print("=" * 60, file=sys.stderr, flush=True)
        print("[playwright] ⏳ 开始执行…", file=sys.stderr, flush=True)
        return
    if action == "navigate":
        url = action_data.get("url", "")
        print(f"[playwright] 执行步骤:", file=sys.stderr, flush=True)
        print(f"[playwright]   1. {browser_step}", file=sys.stderr, flush=True)
        print(f"[playwright]   2. 新建标签页，导航到: {url}", file=sys.stderr, flush=True)
        print(f"[playwright]   3. 等待页面加载完成", file=sys.stderr, flush=True)
        print(f"[playwright]   4. 提取页面文本内容", file=sys.stderr, flush=True)
    elif action == "search":
        query = action_data.get("text", "")
        engine = action_data.get("search_engine", "google")
        search_urls = {
            "google": f"https://www.google.com/search?q={query}",
            "baidu": f"https://www.baidu.com/s?wd={query}",
            "bing": f"https://www.bing.com/search?q={query}",
        }
        url = search_urls.get(engine, search_urls["google"])
        print(f"[playwright] 执行步骤:", file=sys.stderr, flush=True)
        print(f"[playwright]   1. {browser_step}", file=sys.stderr, flush=True)
        print(f"[playwright]   2. 新建标签页，导航到搜索引擎: {url}", file=sys.stderr, flush=True)
        print(f"[playwright]   3. 等待搜索结果加载", file=sys.stderr, flush=True)
        print(f"[playwright]   4. 截图保存结果", file=sys.stderr, flush=True)
        print(f"[playwright]   5. 提取页面文本内容", file=sys.stderr, flush=True)
    elif action == "click":
        selector = action_data.get("selector", "")
        url = action_data.get("url", "")
        print(f"[playwright] 执行步骤:", file=sys.stderr, flush=True)
        if url:
            print(f"[playwright]   1. {browser_step}，导航到: {url}", file=sys.stderr, flush=True)
        else:
            print(f"[playwright]   1. {browser_step}", file=sys.stderr, flush=True)
        print(f"[playwright]   2. 定位元素: {selector!r}", file=sys.stderr, flush=True)
        print(f"[playwright]   3. 点击元素（先尝试 CSS 选择器，再尝试文字匹配）", file=sys.stderr, flush=True)
        print(f"[playwright]   4. 等待页面响应并截图", file=sys.stderr, flush=True)
    elif action == "type":
        selector = action_data.get("selector", "")
        text = action_data.get("text", "")
        url = action_data.get("url", "")
        print(f"[playwright] 执行步骤:", file=sys.stderr, flush=True)
        if url:
            print(f"[playwright]   1. {browser_step}，导航到: {url}", file=sys.stderr, flush=True)
        else:
            print(f"[playwright]   1. {browser_step}", file=sys.stderr, flush=True)
        print(f"[playwright]   2. 定位输入框: {selector!r}", file=sys.stderr, flush=True)
        print(f"[playwright]   3. 填入文字: {text!r}", file=sys.stderr, flush=True)
    elif action == "get_text":
        url = action_data.get("url", "")
        print(f"[playwright] 执行步骤:", file=sys.stderr, flush=True)
        print(f"[playwright]   1. {browser_step}", file=sys.stderr, flush=True)
        print(f"[playwright]   2. 新建标签页，导航到: {url}", file=sys.stderr, flush=True)
        print(f"[playwright]   3. 提取页面全部可见文本", file=sys.stderr, flush=True)
    elif action == "screenshot":
        url = action_data.get("url", "")
        print(f"[playwright] 执行步骤:", file=sys.stderr, flush=True)
        if url:
            print(f"[playwright]   1. {browser_step}，导航到: {url}", file=sys.stderr, flush=True)
        else:
            print(f"[playwright]   1. {browser_step}", file=sys.stderr, flush=True)
        print(f"[playwright]   2. 截图当前页面", file=sys.stderr, flush=True)
    print("=" * 60, file=sys.stderr, flush=True)
    print("[playwright] ⏳ 开始执行…", file=sys.stderr, flush=True)


def _is_chrome_debugging_available(port: int) -> bool:
    """Check if Chrome is already running with remote debugging on the given port."""
    import urllib.request
    try:
        with urllib.request.urlopen(f"http://localhost:{port}/json/version", timeout=1) as resp:
            return resp.status == 200
    except Exception:
        return False



# ─────────────────────────────────────────────────────────────────────────────
# 浏览器守护进程管理
# 守护进程模式：Chrome 以 --remote-debugging-port 启动后常驻，
# 后续每次调用直接通过 CDP 连接，无需重新打开浏览器。
# 只有显式调用 close_browser action 才会真正关闭浏览器。
# ─────────────────────────────────────────────────────────────────────────────

_DAEMON_DIR = os.path.join(os.path.expanduser("~"), ".picoclaw")
_DAEMON_STATE_FILE = os.path.join(_DAEMON_DIR, "browser_daemon.json")
_CHROME_PROFILE_DIR = os.path.join(_DAEMON_DIR, "chrome_profile")
_DAEMON_CDP_PORT = 19222  # 守护进程专用端口，避免与用户 Chrome 冲突


def _load_daemon_state() -> dict:
    """读取守护进程状态文件，返回 {cdp_port, pid} 或空 dict。"""
    if not os.path.exists(_DAEMON_STATE_FILE):
        return {}
    try:
        with open(_DAEMON_STATE_FILE) as state_file:
            return json.load(state_file)
    except Exception:
        return {}


def _save_daemon_state(cdp_port: int, pid: int):
    """将守护进程信息写入状态文件。"""
    os.makedirs(_DAEMON_DIR, exist_ok=True)
    with open(_DAEMON_STATE_FILE, "w") as state_file:
        json.dump({"cdp_port": cdp_port, "pid": pid}, state_file)


def _clear_daemon_state():
    """删除守护进程状态文件。"""
    try:
        os.remove(_DAEMON_STATE_FILE)
    except FileNotFoundError:
        pass


def _is_daemon_alive(state: dict) -> bool:
    """检查状态文件中记录的守护进程是否仍在运行且 CDP 端口可用。"""
    if not state:
        return False
    pid = state.get("pid")
    cdp_port = state.get("cdp_port")
    if not pid or not cdp_port:
        return False
    # 检查进程是否存活
    try:
        os.kill(pid, 0)  # signal 0 只检查进程是否存在，不发送信号
    except (ProcessLookupError, PermissionError):
        return False
    # 检查 CDP 端口是否可用
    return _is_chrome_debugging_available(cdp_port)


def _start_browser_daemon() -> dict:
    """
    启动 Chrome 守护进程（带 --remote-debugging-port），写入状态文件。
    返回 {cdp_port, pid}。
    """
    import subprocess as _subprocess

    os.makedirs(_CHROME_PROFILE_DIR, exist_ok=True)
    cdp_port = _DAEMON_CDP_PORT

    chrome_binary = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    if not os.path.exists(chrome_binary):
        # 尝试其他常见路径
        for candidate in [
            "/usr/bin/google-chrome",
            "/usr/bin/chromium-browser",
            "/usr/bin/chromium",
        ]:
            if os.path.exists(candidate):
                chrome_binary = candidate
                break
        else:
            raise RuntimeError(
                "找不到 Chrome/Chromium 可执行文件，请确认已安装 Google Chrome"
            )

    chrome_args = [
        chrome_binary,
        f"--remote-debugging-port={cdp_port}",
        f"--user-data-dir={_CHROME_PROFILE_DIR}",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-default-apps",
    ]

    _log(f"启动 Chrome 守护进程: port={cdp_port}, profile={_CHROME_PROFILE_DIR}")
    _log(f"命令: {' '.join(chrome_args)}")

    proc = _subprocess.Popen(
        chrome_args,
        stdout=_subprocess.DEVNULL,
        stderr=_subprocess.DEVNULL,
        start_new_session=True,  # 脱离当前进程组，成为独立守护进程
    )

    # 等待 CDP 端口就绪（最多 10 秒）
    for wait_attempt in range(20):
        time.sleep(0.5)
        if _is_chrome_debugging_available(cdp_port):
            _log(f"Chrome 守护进程已就绪（pid={proc.pid}, port={cdp_port}）")
            _save_daemon_state(cdp_port, proc.pid)
            return {"cdp_port": cdp_port, "pid": proc.pid}

    raise RuntimeError(f"Chrome 守护进程启动超时，CDP 端口 {cdp_port} 未就绪")


def _close_browser_daemon() -> dict:
    """关闭守护进程，删除状态文件。"""
    import signal as _signal

    state = _load_daemon_state()
    if not state:
        return {"success": True, "message": "没有正在运行的浏览器守护进程"}

    pid = state.get("pid")
    cdp_port = state.get("cdp_port")
    _clear_daemon_state()

    if pid:
        try:
            os.kill(pid, _signal.SIGTERM)
            _log(f"已发送 SIGTERM 给守护进程 pid={pid}")
            # 等待进程退出
            for _ in range(10):
                time.sleep(0.3)
                try:
                    os.kill(pid, 0)
                except ProcessLookupError:
                    break
            else:
                # 强制 kill
                try:
                    os.kill(pid, _signal.SIGKILL)
                    _log(f"已发送 SIGKILL 给守护进程 pid={pid}")
                except ProcessLookupError:
                    pass
        except ProcessLookupError:
            _log(f"守护进程 pid={pid} 已不存在")

    return {
        "success": True,
        "message": f"浏览器守护进程已关闭（pid={pid}, port={cdp_port}）",
    }


def run_action(action_data: dict) -> dict:
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        return {
            "success": False,
            "error": "playwright not installed. Run: pip3 install playwright && playwright install chromium",
        }

    action = action_data.get("action", "navigate")

    # Print full execution plan to stderr before doing anything.
    _print_execution_plan(action_data, __file__)

    # close_browser 不需要 Playwright，直接处理
    if action == "close_browser":
        return _close_browser_daemon()

    # ── 确保守护进程在运行 ──────────────────────────────────────────────────
    daemon_state = _load_daemon_state()
    if _is_daemon_alive(daemon_state):
        cdp_port = daemon_state["cdp_port"]
        _log(f"复用已有浏览器守护进程（pid={daemon_state['pid']}, port={cdp_port}）")
    else:
        _log("未检测到活跃的浏览器守护进程，正在启动新的守护进程…")
        try:
            daemon_state = _start_browser_daemon()
            cdp_port = daemon_state["cdp_port"]
        except Exception as startup_err:
            return {"success": False, "error": f"启动浏览器守护进程失败: {startup_err}"}

    # ── 通过 CDP 连接守护进程，执行操作 ────────────────────────────────────
    with sync_playwright() as pw:
        try:
            browser = pw.chromium.connect_over_cdp(f"http://localhost:{cdp_port}")
            _log(f"已通过 CDP 连接到浏览器（port={cdp_port}）")
        except Exception as cdp_err:
            # CDP 连接失败，可能守护进程崩溃了，清除状态并报错
            _clear_daemon_state()
            return {
                "success": False,
                "error": f"CDP 连接失败（port={cdp_port}）: {cdp_err}，请重试以重新启动浏览器",
            }

        # 使用已有 context（保留所有 cookies/登录态）
        contexts = browser.contexts
        if contexts:
            context = contexts[0]
            _log("复用已有浏览器 context（保留登录态）")
        else:
            context = browser.new_context(
                viewport={"width": 1280, "height": 800},
                user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            )
            _log("创建新的浏览器 context")

        # 新建标签页执行操作（不影响用户当前浏览的其他标签页）
        page = context.new_page()

        try:
            result = _execute_action(page, action, action_data)
        except Exception as exc:
            result = {"success": False, "error": str(exc)}
        finally:
            # 只关闭本次新建的标签页，浏览器守护进程保持运行
            try:
                page.close()
            except Exception:
                pass
            # 注意：不关闭 browser/context，守护进程继续运行

    return result


def _log(msg: str):
    """Write a timestamped log line to stderr so Go can capture and display it."""
    print(f"[playwright] {msg}", file=sys.stderr, flush=True)



# URL 关键词：出现这些说明当前是登录/鉴权页面
_AUTH_URL_KEYWORDS = [
    "login", "signin", "sign-in", "sign_in",
    "auth", "oauth", "sso", "passport",
    "account/login", "user/login", "session/new",
    "\u767b\u5f55", "\u9274\u6743",
]

# 页面标题/内容关键词：出现这些说明当前是登录/鉴权页面
_AUTH_CONTENT_KEYWORDS = [
    "sign in", "sign-in", "log in", "login", "log-in",
    "please login", "please sign in",
    "\u8bf7\u767b\u5f55", "\u767b\u5f55", "\u767b\u9646", "\u8d26\u53f7\u767b\u5f55", "\u7528\u6237\u767b\u5f55",
    "authentication required", "unauthorized",
]


def _is_auth_page(page) -> bool:
    """Detect whether the current page is a login/auth page."""
    current_url = page.url.lower()
    if any(keyword in current_url for keyword in _AUTH_URL_KEYWORDS):
        return True
    try:
        title = page.title().lower()
        if any(keyword in title for keyword in _AUTH_CONTENT_KEYWORDS):
            return True
        text_sample = page.evaluate("""() => {
            const body = document.body;
            return body ? (body.innerText || body.textContent || \'\').slice(0, 2000) : \'\';
        }""").lower()
        if any(keyword in text_sample for keyword in _AUTH_CONTENT_KEYWORDS):
            return True
    except Exception:
        pass
    return False


def _wait_for_auth_if_needed(page, auth_timeout_seconds: int = 60) -> bool:
    """
    If the current page looks like a login/auth page, wait up to
    auth_timeout_seconds for the user to complete authentication manually.

    Uses page.wait_for_url() so Playwright's event loop stays active and
    can detect navigation events while the user logs in.

    Returns True if auth was detected and completed.
    Returns False if no auth was needed.
    Raises TimeoutError if auth was needed but timed out.
    """
    if not _is_auth_page(page):
        return False

    import urllib.parse as _urlparse

    auth_url = page.url
    auth_host = _urlparse.urlparse(auth_url).netloc

    _log("=" * 50)
    _log("\U0001f510 \u68c0\u6d4b\u5230\u767b\u5f55/\u9274\u6743\u9875\u9762\uff01")
    _log(f"   \u5f53\u524d URL: {auth_url}")
    _log(f"   \u767b\u5f55\u57df\u540d: {auth_host}")
    _log(f"   \u8bf7\u5728\u6d4f\u89c8\u5668\u4e2d\u624b\u52a8\u5b8c\u6210\u767b\u5f55\uff0c\u6700\u591a\u7b49\u5f85 {auth_timeout_seconds} \u79d2\u2026")
    _log("=" * 50)

    # Use page.wait_for_url() with a predicate: succeed when the hostname
    # is no longer the auth domain. This keeps Playwright's event loop
    # running so navigation events are processed correctly.
    def _left_auth_domain(url: str) -> bool:
        host = _urlparse.urlparse(url).netloc
        return bool(host) and host != auth_host

    try:
        page.wait_for_url(
            _left_auth_domain,
            timeout=auth_timeout_seconds * 1000,
            wait_until="commit",
        )
        current_url = page.url
        _log(f"\u2705 \u767b\u5f55\u6210\u529f\uff01\u5df2\u8df3\u8f6c\u5230: {current_url}")
        page.wait_for_timeout(1500)
        return True
    except Exception:
        raise TimeoutError(
            f"\u767b\u5f55\u7b49\u5f85\u8d85\u65f6\uff08{auth_timeout_seconds}s\uff09\u3002\u8bf7\u5148\u5728\u6d4f\u89c8\u5668\u4e2d\u767b\u5f55\u540e\u518d\u91cd\u8bd5\u3002"
        )


def _navigate_with_auth(page, url: str, auth_timeout_seconds: int = 60):
    """Navigate to a URL and handle auth pages by waiting for manual login."""
    page.goto(url, wait_until="domcontentloaded", timeout=30000)
    page.wait_for_timeout(800)
    _wait_for_auth_if_needed(page, auth_timeout_seconds)


def _execute_action(page, action: str, data: dict) -> dict:
    from playwright.sync_api import TimeoutError as PlaywrightTimeout

    auth_timeout = int(data.get("auth_timeout", 60))

    if action == "navigate":
        url = data.get("url", "")
        if not url:
            return {"success": False, "error": "url is required for navigate action"}
        _log(f"\u6b65\u9aa4: navigate \u2192 \u6253\u5f00 {url}")
        try:
            _navigate_with_auth(page, url, auth_timeout)
        except TimeoutError as exc:
            return {"success": False, "error": str(exc)}
        _log("\u7b49\u5f85\u9875\u9762\u52a0\u8f7d\u5b8c\u6210 (1s)\u2026")
        page.wait_for_timeout(1000)
        title = page.title()
        _log(f"\u9875\u9762\u52a0\u8f7d\u5b8c\u6210\uff0c\u6807\u9898: {title}")
        return {
            "success": True,
            "title": title,
            "url": page.url,
            "text": extract_page_text(page),
        }

    elif action == "search":
        query = data.get("text", "")
        engine = data.get("search_engine", "google").lower()
        if not query:
            return {"success": False, "error": "text (search query) is required"}

        search_urls = {
            "google": f"https://www.google.com/search?q={query}",
            "baidu": f"https://www.baidu.com/s?wd={query}",
            "bing": f"https://www.bing.com/search?q={query}",
        }
        url = search_urls.get(engine, search_urls["google"])
        _log(f"\u6b65\u9aa4: search \u2192 \u641c\u7d22\u5f15\u64ce={engine}, \u5173\u952e\u8bcd={query!r}")
        _log(f"  \u2192 \u5bfc\u822a\u5230: {url}")
        try:
            _navigate_with_auth(page, url, auth_timeout)
        except TimeoutError as exc:
            return {"success": False, "error": str(exc)}
        _log("\u7b49\u5f85\u641c\u7d22\u7ed3\u679c\u52a0\u8f7d (2s)\u2026")
        page.wait_for_timeout(2000)
        title = page.title()
        _log(f"\u641c\u7d22\u5b8c\u6210\uff0c\u9875\u9762\u6807\u9898: {title}")
        screenshot_path = _take_screenshot(page)
        _log(f"\u622a\u56fe\u5df2\u4fdd\u5b58: {screenshot_path}")
        return {
            "success": True,
            "title": title,
            "url": page.url,
            "text": extract_page_text(page),
            "screenshot": screenshot_path,
        }

    elif action == "click":
        url = data.get("url", "")
        selector = data.get("selector", "")
        if url:
            _log(f"\u6b65\u9aa4: click \u2192 \u5148\u5bfc\u822a\u5230 {url}")
            try:
                _navigate_with_auth(page, url, auth_timeout)
            except TimeoutError as exc:
                return {"success": False, "error": str(exc)}
            page.wait_for_timeout(500)
        if not selector:
            return {"success": False, "error": "selector is required for click action"}

        _log(f"\u6b65\u9aa4: click \u2192 \u5c1d\u8bd5\u70b9\u51fb\u5143\u7d20 selector={selector!r}")
        try:
            page.click(selector, timeout=5000)
            _log(f"  \u2192 CSS \u9009\u62e9\u5668\u70b9\u51fb\u6210\u529f: {selector!r}")
        except Exception as css_err:
            _log(f"  \u2192 CSS \u9009\u62e9\u5668\u5931\u8d25 ({css_err})\uff0c\u5c1d\u8bd5\u6587\u5b57\u5339\u914d\u2026")
            try:
                page.get_by_text(selector).first.click(timeout=5000)
                _log(f"  \u2192 \u6587\u5b57\u5339\u914d\u70b9\u51fb\u6210\u529f: {selector!r}")
            except Exception as exc:
                _log(f"  \u2192 \u70b9\u51fb\u5931\u8d25: {exc}")
                return {"success": False, "error": f"could not click \'{selector}\': {exc}"}

        _log("\u7b49\u5f85\u9875\u9762\u54cd\u5e94 (1.5s)\u2026")
        page.wait_for_timeout(1500)
        try:
            _wait_for_auth_if_needed(page, auth_timeout)
        except TimeoutError as exc:
            return {"success": False, "error": str(exc)}
        title = page.title()
        _log(f"\u70b9\u51fb\u5b8c\u6210\uff0c\u5f53\u524d\u9875\u9762: {title} ({page.url})")
        screenshot_path = _take_screenshot(page)
        _log(f"\u622a\u56fe\u5df2\u4fdd\u5b58: {screenshot_path}")
        return {
            "success": True,
            "title": title,
            "url": page.url,
            "text": extract_page_text(page),
            "screenshot": screenshot_path,
        }

    elif action == "type":
        url = data.get("url", "")
        selector = data.get("selector", "")
        text = data.get("text", "")
        if url:
            _log(f"\u6b65\u9aa4: type \u2192 \u5148\u5bfc\u822a\u5230 {url}")
            try:
                _navigate_with_auth(page, url, auth_timeout)
            except TimeoutError as exc:
                return {"success": False, "error": str(exc)}
            page.wait_for_timeout(500)
        if not selector:
            return {"success": False, "error": "selector is required for type action"}
        if not text:
            return {"success": False, "error": "text is required for type action"}

        _log(f"\u6b65\u9aa4: type \u2192 \u5728 {selector!r} \u4e2d\u586b\u5165 {text!r}")
        try:
            page.fill(selector, text, timeout=5000)
            _log(f"  \u2192 \u586b\u5199\u6210\u529f")
        except Exception as exc:
            _log(f"  \u2192 \u586b\u5199\u5931\u8d25: {exc}")
            return {"success": False, "error": f"could not fill \'{selector}\': {exc}"}

        page.wait_for_timeout(500)
        return {
            "success": True,
            "title": page.title(),
            "url": page.url,
            "text": extract_page_text(page),
        }

    elif action == "get_text":
        url = data.get("url", "")
        if not url:
            return {"success": False, "error": "url is required for get_text action"}
        _log(f"\u6b65\u9aa4: get_text \u2192 \u8bfb\u53d6\u9875\u9762\u6587\u672c: {url}")
        try:
            _navigate_with_auth(page, url, auth_timeout)
        except TimeoutError as exc:
            return {"success": False, "error": str(exc)}
        page.wait_for_timeout(1000)
        title = page.title()
        _log(f"\u9875\u9762\u52a0\u8f7d\u5b8c\u6210\uff0c\u6807\u9898: {title}")
        return {
            "success": True,
            "title": title,
            "url": page.url,
            "text": extract_page_text(page),
        }

    elif action == "screenshot":
        url = data.get("url", "")
        if url:
            _log(f"\u6b65\u9aa4: screenshot \u2192 \u5148\u5bfc\u822a\u5230 {url}")
            try:
                _navigate_with_auth(page, url, auth_timeout)
            except TimeoutError as exc:
                return {"success": False, "error": str(exc)}
            page.wait_for_timeout(1000)
        _log("\u6b65\u9aa4: screenshot \u2192 \u622a\u56fe\u5f53\u524d\u9875\u9762")
        screenshot_path = _take_screenshot(page)
        _log(f"\u622a\u56fe\u5df2\u4fdd\u5b58: {screenshot_path}")
        return {
            "success": True,
            "title": page.title(),
            "url": page.url,
            "screenshot": screenshot_path,
            "text": extract_page_text(page),
        }

    else:
        return {"success": False, "error": f"unknown action: {action}"}

def _take_screenshot(page) -> str:
    timestamp = int(time.time() * 1000)
    path = os.path.join(tempfile.gettempdir(), f"playwright_screenshot_{timestamp}.png")
    page.screenshot(path=path, full_page=False)
    return path


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"success": False, "error": "usage: browser_playwright.py '<json_action>'"}))
        sys.exit(1)

    try:
        action_data = json.loads(sys.argv[1])
    except json.JSONDecodeError as exc:
        print(json.dumps({"success": False, "error": f"invalid JSON: {exc}"}))
        sys.exit(1)

    result = run_action(action_data)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
