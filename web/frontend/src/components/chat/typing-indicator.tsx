import { useAtomValue } from "jotai"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"

import { chatAtom } from "@/store/chat"

export function TypingIndicator() {
  const { t } = useTranslation()
  const { stepCount, taskStartTime, stepSummaries } = useAtomValue(chatAtom)

  // Elapsed seconds since the task started, updated every second.
  const [elapsedSeconds, setElapsedSeconds] = useState(0)

  useEffect(() => {
    if (!taskStartTime) {
      setElapsedSeconds(0)
      return
    }
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

      <div className="bg-card inline-flex w-fit max-w-md flex-col gap-3 rounded-xl border px-5 py-4">
        {/* Animated dots + status label */}
        <div className="flex items-center gap-2">
          <span className="size-2 animate-bounce rounded-full bg-violet-400/70 [animation-delay:-0.3s]" />
          <span className="size-2 animate-bounce rounded-full bg-violet-400/70 [animation-delay:-0.15s]" />
          <span className="size-2 animate-bounce rounded-full bg-violet-400/70" />
          {isMultiStep ? (
            <span className="ml-1 text-xs font-medium text-violet-500">
              {t("chat.running.inProgress")}
            </span>
          ) : (
            <span className="text-muted-foreground ml-1 text-xs">
              {t("chat.thinking.step1")}
            </span>
          )}
        </div>

        {/* Progress bar */}
        <div className="bg-muted relative h-1 w-full overflow-hidden rounded-full">
          <div className="absolute inset-0 animate-[shimmer_2s_infinite] rounded-full bg-gradient-to-r from-violet-500/60 via-violet-400/80 to-violet-500/60 bg-[length:200%_100%]" />
        </div>

        {/* Step counter + elapsed time */}
        {isMultiStep && (
          <div className="flex items-center gap-3 text-xs">
            <span className="rounded-md bg-violet-500/10 px-2 py-0.5 font-semibold text-violet-600 dark:text-violet-400">
              {t("chat.running.stepsCompleted", { count: stepCount })}
            </span>
            <span className="text-muted-foreground">
              {t("chat.running.elapsed", { seconds: elapsedSeconds })}
            </span>
          </div>
        )}

        {/* Step summaries — scrollable list of completed steps */}
        {stepSummaries.length > 0 && (
          <div className="border-border/50 flex max-h-48 flex-col gap-1 overflow-y-auto border-t pt-2">
            {stepSummaries.map((summary, index) => (
              <div key={index} className="flex items-start gap-2 text-xs">
                <span className="mt-0.5 shrink-0 text-violet-500">✓</span>
                <span className="text-foreground/80 leading-snug">{summary}</span>
              </div>
            ))}
            {/* "Next step" placeholder — last item is always the current running step */}
            <div className="flex items-start gap-2 text-xs">
              <span className="mt-0.5 shrink-0 animate-pulse text-violet-400">›</span>
              <span className="text-muted-foreground italic leading-snug">
                {t("chat.running.nextStep")}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
