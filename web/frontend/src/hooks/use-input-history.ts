import { useCallback, useRef, useState } from "react"

const STORAGE_KEY = "picoclaw_input_history"
const MAX_HISTORY_SIZE = 10

function loadHistory(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.slice(0, MAX_HISTORY_SIZE) : []
  } catch {
    return []
  }
}

function saveHistory(history: string[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history))
  } catch {
    // localStorage may be full or unavailable
  }
}

/**
 * Manages a ring of recent user inputs (up to 10), persisted in localStorage.
 *
 * - `pushHistory(text)` — add a new entry (deduplicates consecutive).
 * - `navigateUp()` / `navigateDown()` — move through history, returns the entry text.
 * - `resetNavigation()` — reset the cursor (call when user types manually).
 */
export function useInputHistory() {
  const [history, setHistory] = useState<string[]>(loadHistory)

  // Navigation cursor: -1 means "not navigating" (current draft).
  // 0 = most recent entry, 1 = second most recent, etc.
  const cursorRef = useRef(-1)

  // Stash the user's in-progress draft so we can restore it when they
  // navigate back down past the newest history entry.
  const draftRef = useRef("")

  const pushHistory = useCallback((text: string) => {
    if (!text.trim()) return

    setHistory((prev) => {
      // Remove duplicate if the same text already exists
      const filtered = prev.filter((entry) => entry !== text)
      const updated = [text, ...filtered].slice(0, MAX_HISTORY_SIZE)
      saveHistory(updated)
      return updated
    })

    // Reset navigation state after sending
    cursorRef.current = -1
    draftRef.current = ""
  }, [])

  /**
   * Navigate to an older history entry.
   * Returns the text to display, or `null` if already at the oldest entry.
   */
  const navigateUp = useCallback(
    (currentInput: string): string | null => {
      const latestHistory = loadHistory()
      if (latestHistory.length === 0) return null

      // Save draft when first entering history navigation
      if (cursorRef.current === -1) {
        draftRef.current = currentInput
      }

      const nextCursor = cursorRef.current + 1
      if (nextCursor >= latestHistory.length) return null // already at oldest

      cursorRef.current = nextCursor
      return latestHistory[nextCursor]
    },
    [],
  )

  /**
   * Navigate to a newer history entry (or back to the draft).
   * Returns the text to display, or `null` if already at the draft.
   */
  const navigateDown = useCallback((): string | null => {
    if (cursorRef.current <= -1) return null // already at draft

    const nextCursor = cursorRef.current - 1
    cursorRef.current = nextCursor

    if (nextCursor === -1) {
      // Back to the user's original draft
      return draftRef.current
    }

    const latestHistory = loadHistory()
    return latestHistory[nextCursor] ?? draftRef.current
  }, [])

  /** Reset navigation cursor (call when user types manually). */
  const resetNavigation = useCallback(() => {
    cursorRef.current = -1
  }, [])

  return {
    history,
    pushHistory,
    navigateUp,
    navigateDown,
    resetNavigation,
  }
}
