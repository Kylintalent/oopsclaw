import { useAtomValue } from "jotai"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"

import { chatAtom } from "@/store/chat"

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  return `${minutes}m ${remainingSeconds}s`
}

// Rotating thinking phase labels — cycles through i18n keys based on elapsed time.
const THINKING_PHASES = [
  "chat.thinking.step1",
  "chat.thinking.step2",
  "chat.thinking.step3",
  "chat.thinking.step4",
  "chat.thinking.step5",
  "chat.thinking.step6",
] as const

function getThinkingPhase(seconds: number): string {
  // Rotate every 4 seconds, loop back after all phases
  const index = Math.min(
    Math.floor(seconds / 4),
    THINKING_PHASES.length - 1,
  )
  return THINKING_PHASES[index]
}

export function TypingIndicator() {
  const { t } = useTranslation()
  const { taskDone, stepCount, taskStartTime, stepSummaries } =
    useAtomValue(chatAtom)

  // Live elapsed seconds, ticking every second while the task runs.
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  // Snapshot of elapsed time captured when taskDone transitions to true.
  const [doneElapsed, setDoneElapsed] = useState(0)

  // Tick the elapsed counter while the task is running.
  useEffect(() => {
    if (!taskStartTime || taskDone) {
      return
    }
    setElapsedSeconds(Math.floor((Date.now() - taskStartTime) / 1000))
    const timer = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - taskStartTime) / 1000))
    }, 1000)
    return () => clearInterval(timer)
  }, [taskStartTime, taskDone])

  // Freeze the elapsed time when the task finishes.
  useEffect(() => {
    if (taskDone && taskStartTime) {
      setDoneElapsed(Math.floor((Date.now() - taskStartTime) / 1000))
    }
    if (!taskDone) {
      setDoneElapsed(0)
      setElapsedSeconds(0)
    }
  }, [taskDone, taskStartTime])

  const displayedElapsed = taskDone ? doneElapsed : elapsedSeconds
  const isMultiStep = stepCount > 0

  // Dynamic thinking phase text that rotates based on elapsed time
  const thinkingText = t(getThinkingPhase(displayedElapsed))

  // Status label and colors
  const statusColor = taskDone ? "emerald" : "violet"

  return (
    <div className="flex w-full flex-col gap-1.5">
      <div className="text-muted-foreground flex items-center gap-2 px-1 text-xs opacity-70">
        <span>OopsClaw</span>
      </div>

      <div className="bg-card inline-flex w-fit max-w-lg flex-col gap-3 rounded-xl border px-5 py-4">
        {/* Status header with step counter */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            {taskDone ? (
              <>
                <span className="size-2.5 rounded-full bg-emerald-500" />
                <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                  {t("chat.running.completed")}
                </span>
              </>
            ) : (
              <>
                <span className="size-2 animate-bounce rounded-full bg-violet-400/70 [animation-delay:-0.3s]" />
                <span className="size-2 animate-bounce rounded-full bg-violet-400/70 [animation-delay:-0.15s]" />
                <span className="size-2 animate-bounce rounded-full bg-violet-400/70" />
                <span className="ml-1 text-xs font-semibold text-violet-500">
                  {isMultiStep
                    ? t("chat.running.inProgress")
                    : thinkingText}
                </span>
              </>
            )}
          </div>

          {/* Elapsed time badge — always show when running */}
          {!taskDone && (
            <span className="text-muted-foreground whitespace-nowrap text-[11px] tabular-nums">
              ⏱ {formatElapsed(displayedElapsed)}
            </span>
          )}
          {taskDone && (
            <span className="text-muted-foreground whitespace-nowrap text-[11px] tabular-nums">
              ⏱ {formatElapsed(displayedElapsed)}
            </span>
          )}
        </div>

        {/* Dynamic thinking phase hint — shown while waiting */}
        {!taskDone && !isMultiStep && displayedElapsed >= 2 && (
          <div className="text-muted-foreground flex items-center gap-2 text-[11px]">
            <span className="animate-pulse">💭</span>
            <span className="italic">{thinkingText}</span>
          </div>
        )}

        {/* Multi-step: show current thinking phase between steps */}
        {!taskDone && isMultiStep && (
          <div className="text-muted-foreground flex items-center gap-2 text-[11px]">
            <span className="animate-pulse">⚙️</span>
            <span className="italic">{t("chat.running.nextStep")}</span>
          </div>
        )}

        {/* Step progress bar */}
        {isMultiStep && (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-[11px]">
              <span
                className={`font-semibold ${
                  taskDone
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-violet-600 dark:text-violet-400"
                }`}
              >
                {taskDone
                  ? t("chat.running.stepsFinished", { count: stepCount })
                  : t("chat.running.stepCurrent", { current: stepCount })}
              </span>
            </div>
            {taskDone ? (
              <div className="h-1.5 w-full rounded-full bg-emerald-500/50" />
            ) : (
              <div className="bg-muted relative h-1.5 w-full overflow-hidden rounded-full">
                <div className="absolute inset-0 animate-[shimmer_2s_infinite] rounded-full bg-gradient-to-r from-violet-500/60 via-violet-400/80 to-violet-500/60 bg-[length:200%_100%]" />
              </div>
            )}
          </div>
        )}

        {/* No steps yet — simple progress bar */}
        {!isMultiStep && !taskDone && (
          <div className="bg-muted relative h-1.5 w-full overflow-hidden rounded-full">
            <div className="absolute inset-0 animate-[shimmer_2s_infinite] rounded-full bg-gradient-to-r from-violet-500/60 via-violet-400/80 to-violet-500/60 bg-[length:200%_100%]" />
          </div>
        )}

        {/* Step summaries — scrollable list with step numbers */}
        {stepSummaries.length > 0 && (
          <div className="border-border/50 flex max-h-64 flex-col gap-2 overflow-y-auto border-t pt-2">
            {stepSummaries.map((summary, index) => {
              const summaryLines = summary.split("\n")
              const title = summaryLines[0] || ""
              const details = summaryLines.slice(1)

              return (
                <div key={index} className="flex items-start gap-2 text-xs">
                  {/* Step number badge */}
                  <span
                    className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white ${
                      taskDone || index < stepSummaries.length - 1
                        ? `bg-${statusColor}-500`
                        : "animate-pulse bg-violet-400"
                    }`}
                    style={{
                      backgroundColor:
                        taskDone || index < stepSummaries.length - 1
                          ? "rgb(16 185 129)"
                          : "rgb(167 139 250)",
                    }}
                  >
                    {index + 1}
                  </span>
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-foreground/90 font-medium leading-snug">
                      {title}
                    </span>
                    {details.map((detail, detailIndex) => (
                      <span
                        key={detailIndex}
                        className="text-muted-foreground break-all leading-snug"
                      >
                        {detail}
                      </span>
                    ))}
                  </div>
                </div>
              )
            })}
            {/* Show "next step" only while still running */}
            {!taskDone && (
              <div className="flex items-start gap-2 text-xs">
                <span className="mt-0.5 flex size-5 shrink-0 animate-pulse items-center justify-center rounded-full bg-violet-300/50 text-[10px] font-bold text-violet-500">
                  {stepSummaries.length + 1}
                </span>
                <span className="text-muted-foreground mt-0.5 italic leading-snug">
                  {t("chat.running.nextStep")}
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
