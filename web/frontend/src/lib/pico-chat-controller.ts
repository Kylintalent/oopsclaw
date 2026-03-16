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

// After each message.create the backend may still be running more steps.
// We keep isTyping=true for a short window so the indicator stays visible.
// If typing.start arrives within that window (next step starting) we cancel
// the timer and stay in typing mode. If nothing arrives the task is done.
const TYPING_LINGER_MS = 800
let typingLingerTimer: ReturnType<typeof setTimeout> | null = null

function clearTypingLinger() {
  if (typingLingerTimer !== null) {
    clearTimeout(typingLingerTimer)
    typingLingerTimer = null
  }
}

function scheduleTypingClear() {
  clearTypingLinger()
  typingLingerTimer = setTimeout(() => {
    typingLingerTimer = null
    updateChatStore({ isTyping: false, stepCount: 0, taskStartTime: null })
  }, TYPING_LINGER_MS)
}

// Extract a concise one-line summary from a message for the TypingIndicator.
// Strips markdown headings/bullets, takes the first meaningful line, and
// truncates to 80 characters so it fits in the progress panel.
function extractStepSummary(content: string): string {
  const lines = content.split("\n")
  for (const rawLine of lines) {
    // Strip leading markdown syntax: headings (#), bullets (- * +), bold (**), backticks
    const cleaned = rawLine
      .replace(/^#+\s*/, "")
      .replace(/^[-*+]\s+/, "")
      .replace(/\*\*/g, "")
      .replace(/`/g, "")
      .trim()
    if (cleaned.length > 0) {
      return cleaned.length > 80 ? cleaned.slice(0, 79) + "…" : cleaned
    }
  }
  return ""
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

      // The backend always sends typing.stop BEFORE message.create, so
      // isTyping is already false when we get here. We re-enable it and
      // schedule a short linger window. If the next step's typing.start
      // arrives within TYPING_LINGER_MS the timer is cancelled and the
      // indicator stays visible. If nothing arrives the task is done and
      // the timer fires to clear the indicator.
      scheduleTypingClear()

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

    case "typing.start":
      // Cancel any pending linger timer — the next step is starting.
      clearTypingLinger()
      // Reset everything including summaries when a new task begins.
      updateChatStore({ isTyping: true, stepCount: 0, taskStartTime: Date.now(), stepSummaries: [] })
      break

    case "typing.stop":
      // typing.stop always arrives BEFORE the corresponding message.create.
      // Do NOT clear isTyping here — the linger timer set by message.create
      // will handle the final cleanup after the message has been rendered.
      // Just cancel any existing linger so we don't double-fire.
      clearTypingLinger()
      break

    case "error":
      console.error("Pico error:", payload)
      clearTypingLinger()
      updateChatStore({ isTyping: false, stepCount: 0, taskStartTime: null })
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

  clearTypingLinger()
  updateChatStore({
    connectionState: "disconnected",
    isTyping: false,
    stepCount: 0,
    taskStartTime: null,
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
