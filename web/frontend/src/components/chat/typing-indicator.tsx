import { useAtomValue } from "jotai"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"

import { chatAtom } from "@/store/chat"

export function TypingIndicator() {
  const { t } = useTranslation()
  const { stepCount, taskStartTime } = useAtomValue(chatAtom)

  // Elapsed seconds since the task started, updated every second.
  const [elapsedSeconds, setElapsedSeconds] = useState(0)

  useEffect(() => {
    if (!taskStartTime) {
      setElapsedSeconds(0)
      return
    }
    // Compute immediately so there's no 1-second delay on first render.
    setElapsedSeconds(Math.floor((Date.now() - taskStartTime) / 1000))

    const timer = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - taskStartTime) / 1000))
    }, 1000)
    return () => clearInterval(timer)
  }, [taskStartTime])

  const isMultiStep = stepCount > 0

  return (
    <div className="flex w-full flex-col gap-1.5">
      <div className="text-muted-foreground flex items-center gap-2 px-1 text-xs opacity-70">
        <span>OopsClaw</span>
      </div>
      <div className="bg-card inline-flex w-fit max-w-sm flex-col gap-3 rounded-xl border px-5 py-4">
        <div className="flex items-center gap-2">
          <span className="size-2 animate-bounce rounded-full bg-violet-400/70 [animation-delay:-0.3s]" />
          <span className="size-2 animate-bounce rounded-full bg-violet-400/70 [animation-delay:-0.15s]" />
          <span className="size-2 animate-bounce rounded-full bg-violet-400/70" />
          {isMultiStep && (
            <span className="text-muted-foreground ml-1 text-xs">
              {t("chat.running.inProgress")}
            </span>
          )}
        </div>

        <div className="bg-muted relative h-1 w-36 overflow-hidden rounded-full">
          <div className="absolute inset-0 animate-[shimmer_2s_infinite] rounded-full bg-gradient-to-r from-violet-500/60 via-violet-400/80 to-violet-500/60 bg-[length:200%_100%]" />
        </div>

        {isMultiStep ? (
          <div className="flex flex-col gap-1">
            <p className="text-muted-foreground text-xs">
              {t("chat.running.stepsCompleted", { count: stepCount })}
            </p>
            <p className="text-muted-foreground text-xs">
              {t("chat.running.elapsed", { seconds: elapsedSeconds })}
            </p>
          </div>
        ) : (
          <p className="text-muted-foreground text-xs">
            {t("chat.thinking.step1")}
          </p>
        )}
      </div>
    </div>
  )
}
