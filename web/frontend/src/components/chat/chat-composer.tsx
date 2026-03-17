import { IconArrowUp } from "@tabler/icons-react"
import type { KeyboardEvent } from "react"
import { useTranslation } from "react-i18next"
import TextareaAutosize from "react-textarea-autosize"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface ChatComposerProps {
  input: string
  onInputChange: (value: string) => void
  onSend: () => void
  onHistoryUp?: (currentInput: string) => string | null
  onHistoryDown?: () => string | null
  onHistoryReset?: () => void
  isConnected: boolean
  hasDefaultModel: boolean
}

export function ChatComposer({
  input,
  onInputChange,
  onSend,
  onHistoryUp,
  onHistoryDown,
  onHistoryReset,
  isConnected,
  hasDefaultModel,
}: ChatComposerProps) {
  const { t } = useTranslation()
  const canInput = isConnected && hasDefaultModel

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      onSend()
      return
    }

    // Arrow Up: navigate to older history entry
    if (e.key === "ArrowUp" && onHistoryUp) {
      // Only intercept when cursor is at the very beginning of the text
      const textarea = e.currentTarget
      if (textarea.selectionStart === 0 && textarea.selectionEnd === 0) {
        e.preventDefault()
        const historyText = onHistoryUp(input)
        if (historyText !== null) {
          onInputChange(historyText)
        }
      }
      return
    }

    // Arrow Down: navigate to newer history entry
    if (e.key === "ArrowDown" && onHistoryDown) {
      const textarea = e.currentTarget
      const atEnd = textarea.selectionStart === textarea.value.length
      if (atEnd) {
        e.preventDefault()
        const historyText = onHistoryDown()
        if (historyText !== null) {
          onInputChange(historyText)
        }
      }
      return
    }
  }

  const handleChange = (value: string) => {
    onHistoryReset?.()
    onInputChange(value)
  }

  return (
    <div className="bg-background shrink-0 px-4 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))] md:px-8 md:pb-8 lg:px-24 xl:px-48">
      <div className="bg-card border-border/80 mx-auto flex max-w-[1000px] flex-col rounded-2xl border p-3 shadow-md">
        <TextareaAutosize
          value={input}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t("chat.placeholder")}
          disabled={!canInput}
          className={cn(
            "max-h-[200px] min-h-[60px] resize-none border-0 bg-transparent px-2 py-1 text-[15px] shadow-none transition-colors focus-visible:ring-0 focus-visible:outline-none dark:bg-transparent",
            !canInput && "cursor-not-allowed",
          )}
          minRows={1}
          maxRows={8}
        />

        <div className="mt-2 flex items-center justify-between px-1">
          <div className="flex items-center gap-1">{/* action buttons */}</div>

          <Button
            size="icon"
            className="size-8 rounded-full bg-violet-500 text-white transition-transform hover:bg-violet-600 active:scale-95"
            onClick={onSend}
            disabled={!input.trim() || !isConnected}
          >
            <IconArrowUp className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}
