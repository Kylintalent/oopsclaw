import { getDefaultStore } from "jotai"
import { toast } from "sonner"

import { getPicoToken } from "@/api/pico"
import { getSessionHistory } from "@/api/sessions"
import i18n from "@/i18n"
import {
  clearStoredSessionId,
  generateSessionId,
  normalizeUnixTimestamp,
  readStoredSessionId,
} from "@/lib/pico-chat-state"
import { type ChatMessage, getChatState, updateChatStore } from "@/store/chat"
import { gatewayAtom } from "@/store/gateway"

interface PicoMessage {
  type: string
  id?: string
  session_id?: string
  timestamp?: number | string
  payload?: Record<string, unknown>
}

const store = getDefaultStore()

let wsRef: WebSocket | null = null
let isConnecting = false
let msgIdCounter = 0
let activeSessionIdRef = getChatState().activeSessionId
let initialized = false
let unsubscribeGateway: (() => void) | null = null
let hydratePromise: Promise<void> | null = null
let connectionGeneration = 0

// --- Typing state machine ---
// The backend sends messages in this order for each step:
//   typing.start → [agent runs] → typing.stop → message.create
// If another step follows, a new typing.start arrives shortly after message.create.
// If no typing.start arrives after message.create, the task is done.
//
// We track a "pending done" timer that fires after message.create. If typing.start
// arrives before the timer fires, we cancel it (task continues). Otherwise the
// timer marks the task as done.
//
// We also track whether we are in a "typing started" state (between typing.start
// and the final completion). This is separate from the linger timer.
let pendingDoneTimer: ReturnType<typeof setTimeout> | null = null

// How long to wait after message.create for a typing.start before declaring done.
// The backend sends typing.start almost immediately after message.create in the
// same agent loop, so 2 seconds is very generous.
const PENDING_DONE_MS = 2000

function clearPendingDone() {
  if (pendingDoneTimer !== null) {
    clearTimeout(pendingDoneTimer)
    pendingDoneTimer = null
  }
}

function schedulePendingDone() {
  clearPendingDone()
  pendingDoneTimer = setTimeout(() => {
    pendingDoneTimer = null
    // No typing.start arrived → task is truly done.
    updateChatStore({ isTyping: false, taskDone: true })
  }, PENDING_DONE_MS)
}

// Extract a rich multi-line summary from a message for the TypingIndicator.
// Collects the first meaningful line as a title, plus any URLs and key details
// found in the message body. Returns a structured summary string.
function extractStepSummary(content: string): string {
  const lines = content.split("\n")
  const summaryParts: string[] = []
  const urls: string[] = []

  // Regex to find URLs (http/https)
  const urlPattern = /https?:\/\/[^\s)>\]]+/g

  for (const rawLine of lines) {
    // Extract URLs from the raw line before stripping markdown
    const foundUrls = rawLine.match(urlPattern)
    if (foundUrls) {
      for (const url of foundUrls) {
        if (!urls.includes(url)) {
          urls.push(url)
        }
      }
    }

    // Strip leading markdown syntax: headings (#), bullets (- * +), bold (**), backticks
    const cleaned = rawLine
      .replace(/^#+\s*/, "")
      .replace(/^[-*+]\s+/, "")
      .replace(/^\d+\.\s+/, "")
      .replace(/\*\*/g, "")
      .replace(/`/g, "")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // [text](url) → text
      .trim()

    if (cleaned.length > 0 && summaryParts.length < 3) {
      summaryParts.push(cleaned)
    }
  }

  // Build the final summary: title + details + URLs
  const parts: string[] = []

  if (summaryParts.length > 0) {
    // First line is the title, truncate if needed
    const title = summaryParts[0]
    parts.push(title.length > 120 ? title.slice(0, 119) + "…" : title)
  }

  // Add extra detail lines (2nd and 3rd meaningful lines)
  for (let i = 1; i < summaryParts.length; i++) {
    const detail = summaryParts[i]
    parts.push(detail.length > 100 ? detail.slice(0, 99) + "…" : detail)
  }

  // Append discovered URLs (max 2)
  for (const url of urls.slice(0, 2)) {
    const truncatedUrl = url.length > 80 ? url.slice(0, 79) + "…" : url
    if (!parts.some((p) => p.includes(truncatedUrl.replace("…", "")))) {
      parts.push("🔗 " + truncatedUrl)
    }
  }

  return parts.join("\n")
}

async function loadSessionMessages(sessionId: string): Promise<ChatMessage[]> {
  const detail = await getSessionHistory(sessionId)
  const fallbackTime = detail.updated

  return detail.messages.map((message, index) => ({
    id: `hist-${index}-${Date.now()}`,
    role: message.role,
    content: message.content,
    timestamp: fallbackTime,
  }))
}

function handlePicoMessage(message: PicoMessage) {
  const payload = message.payload || {}

  switch (message.type) {
    case "message.create": {
      const content = (payload.content as string) || ""
      const messageId = (payload.message_id as string) || `pico-${Date.now()}`
      const timestamp =
        message.timestamp !== undefined &&
        Number.isFinite(Number(message.timestamp))
          ? normalizeUnixTimestamp(Number(message.timestamp))
          : Date.now()

      // Extract a one-line summary from the message content for the progress indicator.
      // Take the first non-empty line and truncate to 80 characters.
      const summary = extractStepSummary(content)

      // The backend always sends typing.stop BEFORE message.create.
      // After receiving the message, we schedule a "pending done" timer.
      // If typing.start arrives before the timer fires (next step starting),
      // we cancel it and stay in typing mode. If nothing arrives, the task
      // is truly done and the timer marks it complete.
      schedulePendingDone()

      updateChatStore((prev) => ({
        messages: [
          ...prev.messages,
          {
            id: messageId,
            role: "assistant",
            content,
            timestamp,
          },
        ],
        isTyping: true,
        stepCount: prev.stepCount + 1,
        taskStartTime: prev.taskStartTime ?? Date.now(),
        stepSummaries: summary
          ? [...prev.stepSummaries, summary]
          : prev.stepSummaries,
      }))
      break
    }

    case "message.update": {
      const content = (payload.content as string) || ""
      const messageId = payload.message_id as string
      if (!messageId) {
        break
      }

      updateChatStore((prev) => ({
        messages: prev.messages.map((msg) =>
          msg.id === messageId ? { ...msg, content } : msg,
        ),
      }))
      break
    }

    case "typing.start": {
      // Cancel any pending done timer — the next step is starting.
      clearPendingDone()
      const state = getChatState()
      if (state.stepCount === 0 || state.taskDone) {
        // Brand new task — reset everything.
        updateChatStore({ isTyping: true, taskDone: false, stepCount: 0, taskStartTime: Date.now(), stepSummaries: [] })
      } else {
        // Continuation of an existing multi-step task — just ensure isTyping is true.
        updateChatStore({ isTyping: true, taskDone: false })
      }
      break
    }

    case "typing.stop":
      // typing.stop arrives BEFORE the corresponding message.create.
      // Don't change any state here — message.create will handle the
      // transition and schedule the pending done timer.
      break

    case "error":
      console.error("Pico error:", payload)
      clearPendingDone()
      updateChatStore({ isTyping: false, taskDone: false, stepCount: 0, taskStartTime: null, stepSummaries: [] })
      break

    case "pong":
      break

    default:
      console.log("Unknown pico message type:", message.type)
  }
}

function setActiveSessionId(sessionId: string) {
  activeSessionIdRef = sessionId
  updateChatStore({ activeSessionId: sessionId })
}

export async function connectChat() {
  if (store.get(gatewayAtom).status !== "running") {
    return
  }

  if (
    isConnecting ||
    (wsRef &&
      (wsRef.readyState === WebSocket.OPEN ||
        wsRef.readyState === WebSocket.CONNECTING))
  ) {
    return
  }

  const generation = connectionGeneration + 1
  connectionGeneration = generation
  isConnecting = true
  updateChatStore({ connectionState: "connecting" })

  try {
    const { token, ws_url } = await getPicoToken()

    if (generation !== connectionGeneration) {
      return
    }

    if (!token) {
      console.error("No pico token available")
      updateChatStore({ connectionState: "error" })
      isConnecting = false
      return
    }

    let finalWsUrl = ws_url
    try {
      const parsedUrl = new URL(ws_url)
      const isLocalHost =
        parsedUrl.hostname === "localhost" ||
        parsedUrl.hostname === "127.0.0.1" ||
        parsedUrl.hostname === "0.0.0.0"
      const isBrowserLocal =
        window.location.hostname === "localhost" ||
        window.location.hostname === "127.0.0.1"

      if (isLocalHost && !isBrowserLocal) {
        parsedUrl.hostname = window.location.hostname
        finalWsUrl = parsedUrl.toString()
      }
    } catch (error) {
      console.warn("Could not parse ws_url:", error)
    }

    const url = `${finalWsUrl}?token=${encodeURIComponent(token)}&session_id=${encodeURIComponent(activeSessionIdRef)}`
    const socket = new WebSocket(url)

    if (generation !== connectionGeneration) {
      socket.close()
      return
    }

    socket.onopen = () => {
      if (wsRef !== socket) {
        return
      }
      updateChatStore({ connectionState: "connected" })
      isConnecting = false
    }

    socket.onmessage = (event) => {
      try {
        const message: PicoMessage = JSON.parse(event.data)
        handlePicoMessage(message)
      } catch {
        console.warn("Non-JSON message from pico:", event.data)
      }
    }

    socket.onclose = () => {
      if (wsRef !== socket) {
        return
      }
      wsRef = null
      isConnecting = false
      updateChatStore({
        connectionState: "disconnected",
        isTyping: false,
      })
    }

    socket.onerror = () => {
      if (wsRef !== socket) {
        return
      }
      isConnecting = false
      updateChatStore({ connectionState: "error" })
    }

    wsRef = socket
  } catch (error) {
    if (generation !== connectionGeneration) {
      return
    }
    console.error("Failed to connect to pico:", error)
    updateChatStore({ connectionState: "error" })
    isConnecting = false
  }
}

export function disconnectChat() {
  connectionGeneration += 1

  const socket = wsRef
  wsRef = null
  isConnecting = false

  if (socket) {
    socket.close()
  }

  clearPendingDone()
  updateChatStore({
    connectionState: "disconnected",
    isTyping: false,
    taskDone: false,
    stepCount: 0,
    taskStartTime: null,
    stepSummaries: [],
  })
}

export async function hydrateActiveSession() {
  if (hydratePromise) {
    return hydratePromise
  }

  const state = getChatState()
  const storedSessionId = readStoredSessionId()

  if (
    !storedSessionId ||
    state.hasHydratedActiveSession ||
    state.messages.length > 0 ||
    storedSessionId !== state.activeSessionId
  ) {
    if (!state.hasHydratedActiveSession) {
      updateChatStore({ hasHydratedActiveSession: true })
    }
    return
  }

  hydratePromise = loadSessionMessages(storedSessionId)
    .then((historyMessages) => {
      const currentState = getChatState()
      if (currentState.activeSessionId !== storedSessionId) {
        return
      }

      if (currentState.messages.length > 0) {
        updateChatStore({ hasHydratedActiveSession: true })
        return
      }

      updateChatStore({
        messages: historyMessages,
        isTyping: false,
        hasHydratedActiveSession: true,
      })
    })
    .catch((error) => {
      console.error("Failed to restore last session history:", error)

      const currentState = getChatState()
      if (currentState.activeSessionId !== storedSessionId) {
        return
      }

      if (currentState.messages.length > 0) {
        updateChatStore({ hasHydratedActiveSession: true })
        return
      }

      clearStoredSessionId()
      updateChatStore({
        messages: [],
        isTyping: false,
        hasHydratedActiveSession: true,
      })
    })
    .finally(() => {
      hydratePromise = null
    })

  return hydratePromise
}

export function sendChatMessage(content: string) {
  if (!wsRef || wsRef.readyState !== WebSocket.OPEN) {
    console.warn("WebSocket not connected")
    return
  }

  const id = `msg-${++msgIdCounter}-${Date.now()}`

  updateChatStore((prev) => ({
    messages: [
      ...prev.messages,
      { id, role: "user", content, timestamp: Date.now() },
    ],
    isTyping: true,
    stepCount: 0,
    taskStartTime: Date.now(),
  }))

  wsRef.send(
    JSON.stringify({
      type: "message.send",
      id,
      payload: { content },
    }),
  )
}

export async function switchChatSession(sessionId: string) {
  if (sessionId === activeSessionIdRef) {
    return
  }

  try {
    const historyMessages = await loadSessionMessages(sessionId)

    disconnectChat()
    setActiveSessionId(sessionId)
    updateChatStore({
      messages: historyMessages,
      isTyping: false,
      hasHydratedActiveSession: true,
    })

    if (store.get(gatewayAtom).status === "running") {
      await connectChat()
    }
  } catch (error) {
    console.error("Failed to load session history:", error)
    toast.error(i18n.t("chat.historyOpenFailed"))
  }
}

export async function newChatSession() {
  if (getChatState().messages.length === 0) {
    return
  }

  disconnectChat()
  setActiveSessionId(generateSessionId())
  updateChatStore({
    messages: [],
    isTyping: false,
    hasHydratedActiveSession: true,
  })

  if (store.get(gatewayAtom).status === "running") {
    await connectChat()
  }
}

export function initializeChatStore() {
  if (initialized) {
    return
  }

  initialized = true
  activeSessionIdRef = getChatState().activeSessionId

  const syncConnectionWithGateway = () => {
    if (store.get(gatewayAtom).status === "running") {
      void connectChat()
      return
    }

    disconnectChat()
  }

  unsubscribeGateway = store.sub(gatewayAtom, syncConnectionWithGateway)

  if (!readStoredSessionId()) {
    updateChatStore({ hasHydratedActiveSession: true })
  }

  syncConnectionWithGateway()
}

export function teardownChatStore() {
  unsubscribeGateway?.()
  unsubscribeGateway = null
  initialized = false
  disconnectChat()
}
