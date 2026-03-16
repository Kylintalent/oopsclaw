package tools

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

// OpenBrowserTool allows the AI agent to open a URL in the system's default browser.
type OpenBrowserTool struct{}

func NewOpenBrowserTool() *OpenBrowserTool {
	return &OpenBrowserTool{}
}

func (t *OpenBrowserTool) Name() string {
	return "open_browser"
}

func (t *OpenBrowserTool) Description() string {
	return "Open a URL in the system's default web browser. Use this to open web pages, local files, or any URL the user wants to view."
}

func (t *OpenBrowserTool) Parameters() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"url": map[string]any{
				"type":        "string",
				"description": "The URL to open in the browser (e.g. https://example.com or file:///path/to/file.html)",
			},
		},
		"required": []string{"url"},
	}
}

func (t *OpenBrowserTool) Execute(ctx context.Context, args map[string]any) *ToolResult {
	url, ok := args["url"].(string)
	if !ok || strings.TrimSpace(url) == "" {
		return ErrorResult("url is required")
	}

	url = strings.TrimSpace(url)

	// Only allow http, https, and file schemes for safety
	lowered := strings.ToLower(url)
	if !strings.HasPrefix(lowered, "http://") &&
		!strings.HasPrefix(lowered, "https://") &&
		!strings.HasPrefix(lowered, "file://") {
		return ErrorResult(fmt.Sprintf("unsupported URL scheme: only http, https, and file:// are allowed, got: %q", url))
	}

	if err := openBrowser(url); err != nil {
		return ErrorResult(fmt.Sprintf("failed to open browser: %v", err))
	}

	return &ToolResult{
		ForLLM:  fmt.Sprintf("Successfully opened %q in the default browser.", url),
		ForUser: fmt.Sprintf("🌐 Opened in browser: %s", url),
		IsError: false,
	}
}

func openBrowser(url string) error {
	switch runtime.GOOS {
	case "darwin":
		return exec.Command("open", url).Start()
	case "linux":
		return exec.Command("xdg-open", url).Start()
	case "windows":
		return exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start()
	default:
		return fmt.Errorf("unsupported platform: %s", runtime.GOOS)
	}
}

// ---------------------------------------------------------------------------
// BrowserUseTool — Playwright-based browser automation
// ---------------------------------------------------------------------------

// browserActionResult is the JSON response from the Python Playwright script.
type browserActionResult struct {
	Success    bool   `json:"success"`
	Title      string `json:"title"`
	URL        string `json:"url"`
	Text       string `json:"text"`
	Screenshot string `json:"screenshot"`
	Error      string `json:"error"`
	Message    string `json:"message"` // used by close_browser action
}

// BrowserUseTool drives a real Chromium browser via Playwright (Python).
// It supports navigating to URLs, filling forms, clicking elements, and
// performing searches — and streams each step's reasoning to the user.
type BrowserUseTool struct {
	// scriptPath is the absolute path to browser_playwright.py.
	scriptPath string
}

func NewBrowserUseTool() *BrowserUseTool {
	// Resolve the script path relative to the executable's working directory.
	scriptPath := findPlaywrightScript()
	return &BrowserUseTool{scriptPath: scriptPath}
}

// findPlaywrightScript locates browser_playwright.py by checking several
// candidate directories (cwd, executable dir, repo root).
func findPlaywrightScript() string {
	candidates := []string{
		"scripts/browser_playwright.py",
	}

	// Also try relative to the executable
	if exePath, err := os.Executable(); err == nil {
		exeDir := filepath.Dir(exePath)
		candidates = append(candidates,
			filepath.Join(exeDir, "scripts", "browser_playwright.py"),
			filepath.Join(exeDir, "..", "scripts", "browser_playwright.py"),
		)
	}

	for _, candidate := range candidates {
		if _, err := os.Stat(candidate); err == nil {
			abs, _ := filepath.Abs(candidate)
			return abs
		}
	}

	// Fallback — will produce a clear error at runtime
	abs, _ := filepath.Abs("scripts/browser_playwright.py")
	return abs
}

func (t *BrowserUseTool) Name() string {
	return "browser_use"
}

func (t *BrowserUseTool) Description() string {
	return `Automate a real Chromium browser using Playwright. A persistent browser daemon is kept running between calls so you can perform multi-step flows (fill forms, navigate, click) without reopening the browser each time.

Supported actions:
- navigate: open a URL and read the page content
- search: go to a search engine, fill the search box, click search, return results
- click: click a button or link on the current/specified page
- type: fill a form field with text
- get_text: fetch and return the visible text of a page
- screenshot: take a screenshot of the current/specified page
- close_browser: explicitly close the persistent browser daemon when the task is fully complete

Usage pattern for multi-step tasks:
1. Use navigate/click/type/search repeatedly — the browser stays open between calls.
2. Call close_browser only when the entire task is done.

Use this tool when you need to interact with web pages beyond simple HTTP fetches — e.g. JavaScript-heavy sites, login forms, or multi-step flows. Each action shows its progress in the chat.`
}

func (t *BrowserUseTool) Parameters() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"action": map[string]any{
				"type":        "string",
				"enum":        []string{"navigate", "search", "click", "type", "get_text", "screenshot", "close_browser"},
				"description": "The browser action to perform. Use close_browser to shut down the persistent browser daemon after the task is fully complete.",
			},
			"url": map[string]any{
				"type":        "string",
				"description": "Target URL (required for navigate, get_text, screenshot; optional for click/type to first navigate there).",
			},
			"selector": map[string]any{
				"type":        "string",
				"description": "CSS selector or visible text to identify the element to click or fill (required for click and type).",
			},
			"text": map[string]any{
				"type":        "string",
				"description": "Text to type into a field (required for type), or search query (required for search).",
			},
			"search_engine": map[string]any{
				"type":        "string",
				"enum":        []string{"google", "baidu", "bing"},
				"description": "Search engine to use for the search action (default: google).",
			},
		},
		"required": []string{"action"},
	}
}

func (t *BrowserUseTool) Execute(ctx context.Context, args map[string]any) *ToolResult {
	action, _ := args["action"].(string)
	if action == "" {
		return ErrorResult("action is required")
	}

	// Build a human-readable step description for the user.
	stepDescription := t.describeStep(action, args)

	// Verify the Playwright script exists.
	if _, err := os.Stat(t.scriptPath); err != nil {
		return &ToolResult{
			ForLLM: fmt.Sprintf("Playwright script not found at %q: %v", t.scriptPath, err),
			ForUser: fmt.Sprintf(
				"❌ **找不到 Playwright 脚本**\n\n"+
					"**脚本路径**：`%s`\n"+
					"**错误**：%v\n\n"+
					"请确认 `scripts/browser_playwright.py` 文件存在于项目根目录。",
				t.scriptPath, err,
			),
			IsError: true,
		}
	}

	// Serialize args to JSON for the Python script.
	actionJSONBytes, err := json.MarshalIndent(args, "", "  ")
	if err != nil {
		return ErrorResult(fmt.Sprintf("failed to serialize action: %v", err))
	}
	actionJSON := string(actionJSONBytes)

	// Build the full shell command string for display.
	displayCommand := fmt.Sprintf("python3 %s '%s'", t.scriptPath, string(actionJSONBytes))

	// Run the Python Playwright script with a generous timeout.
	execCtx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()

	cmd := exec.CommandContext(execCtx, "python3", t.scriptPath, actionJSON)
	var stdoutBuf, stderrBuf bytes.Buffer
	cmd.Stdout = &stdoutBuf
	cmd.Stderr = &stderrBuf

	runErr := cmd.Run()

	stderrOutput := strings.TrimSpace(stderrBuf.String())
	stdoutOutput := strings.TrimSpace(stdoutBuf.String())

	// Parse the JSON result from stdout.
	var result browserActionResult
	if parseErr := json.Unmarshal([]byte(stdoutOutput), &result); parseErr != nil {
		errDetail := stderrOutput
		if runErr != nil {
			errDetail = fmt.Sprintf("exit error: %v\nstderr:\n%s", runErr, stderrOutput)
		}
		return &ToolResult{
			ForLLM: fmt.Sprintf("Browser automation failed. Could not parse output: %s\nRaw stdout: %s", errDetail, stdoutOutput),
			ForUser: fmt.Sprintf(
				"## 🤖 浏览器自动化执行过程\n\n"+
					"### 📋 任务\n%s\n\n"+
					"### 📁 脚本路径\n```\n%s\n```\n\n"+
					"### 📥 传入参数\n```json\n%s\n```\n\n"+
					"### ⚙️ 执行命令\n```bash\n%s\n```\n\n"+
					"### 📤 执行日志\n```\n%s\n```\n\n"+
					"### 📄 原始输出\n```\n%s\n```\n\n"+
					"### ❌ 结果\n解析输出失败：%v",
				stepDescription,
				t.scriptPath,
				actionJSON,
				displayCommand,
				stderrOutput,
				stdoutOutput,
				parseErr,
			),
			IsError: true,
		}
	}

	if !result.Success {
		// Browser navigation failures are often due to wrong URLs or page issues.
		// Stop the agent from continuing to try more URLs.
		return FatalErrorResult(fmt.Sprintf(
			"## 🤖 浏览器自动化执行过程\n\n"+
				"### 📋 任务\n%s\n\n"+
				"### 📁 脚本路径\n```\n%s\n```\n\n"+
				"### 📥 传入参数\n```json\n%s\n```\n\n"+
				"### ⚙️ 执行命令\n```bash\n%s\n```\n\n"+
				"### 📤 执行日志\n```\n%s\n```\n\n"+
				"### ❌ 结果\n%s\n\n"+
				"**任务已停止**：浏览器操作失败，不再继续尝试其他操作。",
			stepDescription,
			t.scriptPath,
			actionJSON,
			displayCommand,
			stderrOutput,
			result.Error,
		))
	}

	// close_browser returns a simple message, not page content.
	if action == "close_browser" {
		message := result.Message
		if message == "" {
			message = "浏览器守护进程已关闭"
		}
		return &ToolResult{
			ForLLM: fmt.Sprintf("Browser daemon closed: %s", message),
			ForUser: fmt.Sprintf(
				"## 🤖 浏览器自动化执行过程\n\n"+
					"### 📋 任务\n%s\n\n"+
					"### 📁 脚本路径\n```\n%s\n```\n\n"+
					"### 📥 传入参数\n```json\n%s\n```\n\n"+
					"### ⚙️ 执行命令\n```bash\n%s\n```\n\n"+
					"### 📤 执行日志\n```\n%s\n```\n\n"+
					"### ✅ 执行结果\n🛑 %s",
				stepDescription,
				t.scriptPath,
				actionJSON,
				displayCommand,
				stderrOutput,
				message,
			),
			IsError: false,
		}
	}

	// Build the LLM context (full page text, truncated to avoid token overflow).
	pageText := result.Text
	if len(pageText) > 8000 {
		pageText = pageText[:8000] + "\n…[内容已截断]"
	}

	llmContent := fmt.Sprintf(
		"Browser action %q succeeded.\nPage title: %s\nCurrent URL: %s\nPage text:\n%s",
		action, result.Title, result.URL, pageText,
	)

	screenshotLine := ""
	if result.Screenshot != "" {
		screenshotLine = fmt.Sprintf("\n- 📸 截图已保存：`%s`", result.Screenshot)
	}

	// Build the fully transparent user-facing message.
	userMessage := fmt.Sprintf(
		"## 🤖 浏览器自动化执行过程\n\n"+
			"### 📋 任务\n%s\n\n"+
			"### 📁 脚本路径\n```\n%s\n```\n\n"+
			"### 📥 传入参数\n```json\n%s\n```\n\n"+
			"### ⚙️ 执行命令\n```bash\n%s\n```\n\n"+
			"### 📤 执行日志\n```\n%s\n```\n\n"+
			"### ✅ 执行结果\n"+
			"- 📄 页面标题：%s\n"+
			"- 🔗 当前 URL：%s%s\n\n"+
			"### 📝 页面内容（前800字）\n```\n%s\n```",
		stepDescription,
		t.scriptPath,
		actionJSON,
		displayCommand,
		stderrOutput,
		result.Title,
		result.URL,
		screenshotLine,
		truncateString(pageText, 800),
	)

	toolResult := &ToolResult{
		ForLLM:  llmContent,
		ForUser: userMessage,
		IsError: false,
	}

	// Attach screenshot if one was taken.
	if result.Screenshot != "" {
		toolResult.Media = []string{result.Screenshot}
	}

	return toolResult
}

// describeStep returns a human-readable description of what the tool is about to do.
func (t *BrowserUseTool) describeStep(action string, args map[string]any) string {
	url, _ := args["url"].(string)
	selector, _ := args["selector"].(string)
	text, _ := args["text"].(string)
	engine, _ := args["search_engine"].(string)
	if engine == "" {
		engine = "google"
	}

	switch action {
	case "navigate":
		return fmt.Sprintf("打开网页 %s", url)
	case "search":
		return fmt.Sprintf("在 %s 搜索「%s」", engine, text)
	case "click":
		if url != "" {
			return fmt.Sprintf("打开 %s 并点击「%s」", url, selector)
		}
		return fmt.Sprintf("点击页面元素「%s」", selector)
	case "type":
		if url != "" {
			return fmt.Sprintf("打开 %s 并在「%s」输入「%s」", url, selector, text)
		}
		return fmt.Sprintf("在「%s」输入「%s」", selector, text)
	case "get_text":
		return fmt.Sprintf("读取页面文本：%s", url)
	case "screenshot":
		if url != "" {
			return fmt.Sprintf("截图页面：%s", url)
		}
		return "截图当前页面"
	case "close_browser":
		return "关闭浏览器守护进程"
	default:
		return fmt.Sprintf("执行浏览器操作：%s", action)
	}
}

// truncateString returns at most maxLen runes of s.
func truncateString(s string, maxLen int) string {
	runes := []rune(s)
	if len(runes) <= maxLen {
		return s
	}
	return string(runes[:maxLen]) + "…"
}
