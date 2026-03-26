import {
  IconClock,
  IconHistory,
  IconLoader2,
  IconPlayerPause,
  IconPlayerPlay,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import * as React from "react"
import { toast } from "sonner"
import dayjs from "dayjs"

import {
  clearCronHistory,
  deleteCronJob,
  disableCronJob,
  enableCronJob,
  getCronHistory,
  getCronJobs,
  type CronJob,
} from "@/api/cron"
import { AddCronJobSheet } from "./add-cron-job-sheet"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

const UNIX_MS_THRESHOLD = 1e12

function normalizeUnixTimestamp(timestamp: number): number {
  return timestamp < UNIX_MS_THRESHOLD ? timestamp * 1000 : timestamp
}

function formatTime(ms?: number): string {
  if (!ms) return "Never"
  const date = dayjs(normalizeUnixTimestamp(ms))
  if (!date.isValid()) return "Invalid"
  const now = dayjs()
  const isToday = date.isSame(now, "day")
  const isThisYear = date.isSame(now, "year")
  if (isToday) {
    return date.format("HH:mm:ss")
  }
  if (isThisYear) {
    return date.format("MMM D HH:mm")
  }
  return date.format("YYYY-MM-DD HH:mm")
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  const minutes = Math.floor(ms / 60000)
  const seconds = Math.floor((ms % 60000) / 1000)
  return `${minutes}m ${seconds}s`
}

function formatSchedule(schedule: CronJob["schedule"]): string {
  if (schedule.kind === "at" && schedule.atMs) {
    return `At ${formatTime(schedule.atMs)}`
  }
  if (schedule.kind === "every" && schedule.everyMs) {
    const seconds = schedule.everyMs / 1000
    if (seconds < 60) return `Every ${seconds}s`
    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = seconds % 60
    if (remainingSeconds === 0) return `Every ${minutes}m`
    return `Every ${minutes}m ${remainingSeconds}s`
  }
  if (schedule.kind === "cron" && schedule.expr) {
    return schedule.expr
  }
  return "Unknown"
}

type TabValue = "tasks" | "history"

export function CronPage() {
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = React.useState<TabValue>("tasks")
  const [isAddSheetOpen, setIsAddSheetOpen] = React.useState(false)
  const [historyJobFilter, setHistoryJobFilter] = React.useState("")

  const {
    data: jobs = [],
    isLoading: isLoadingJobs,
    error: jobsError,
  } = useQuery({
    queryKey: ["cronJobs"],
    queryFn: () => getCronJobs(true),
  })

  const {
    data: historyResponse,
    isLoading: isLoadingHistory,
    error: historyError,
  } = useQuery({
    queryKey: ["cronHistory", historyJobFilter],
    queryFn: () => getCronHistory(historyJobFilter || undefined),
    enabled: activeTab === "history",
  })

  const enableMutation = useMutation({
    mutationFn: enableCronJob,
    onSuccess: () => {
      toast.success("Task enabled")
      void queryClient.invalidateQueries({ queryKey: ["cronJobs"] })
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to enable task")
    },
  })

  const disableMutation = useMutation({
    mutationFn: disableCronJob,
    onSuccess: () => {
      toast.success("Task disabled")
      void queryClient.invalidateQueries({ queryKey: ["cronJobs"] })
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to disable task")
    },
  })

  const deleteMutation = useMutation({
    mutationFn: deleteCronJob,
    onSuccess: () => {
      toast.success("Task deleted")
      void queryClient.invalidateQueries({ queryKey: ["cronJobs"] })
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to delete task")
    },
  })

  const clearHistoryMutation = useMutation({
    mutationFn: () => clearCronHistory(historyJobFilter || undefined),
    onSuccess: () => {
      toast.success("History cleared")
      void queryClient.invalidateQueries({ queryKey: ["cronHistory"] })
    },
    onError: (err) => {
      toast.error(
        err instanceof Error ? err.message : "Failed to clear history",
      )
    },
  })

  const handleToggleJob = (job: CronJob) => {
    if (job.enabled) {
      disableMutation.mutate(job.id)
    } else {
      enableMutation.mutate(job.id)
    }
  }

  const handleDeleteJob = (job: CronJob) => {
    if (confirm(`Are you sure you want to delete "${job.name}"?`)) {
      deleteMutation.mutate(job.id)
    }
  }

  const handleClearHistory = () => {
    if (
      confirm(
        historyJobFilter
          ? `Clear history for this task?`
          : `Clear all execution history?`,
      )
    ) {
      clearHistoryMutation.mutate()
    }
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Scheduled Tasks">
        <Button
          size="sm"
          variant="outline"
          onClick={() => setIsAddSheetOpen(true)}
        >
          <IconPlus className="size-4" />
          Add Task
        </Button>
      </PageHeader>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 sm:px-6">
        <div className="w-full max-w-6xl space-y-6">
          <div className="flex gap-2 border-b">
            <button
              className={cn(
                "px-4 py-2 text-sm font-medium transition-colors",
                activeTab === "tasks"
                  ? "border-b-2 border-primary text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
              onClick={() => setActiveTab("tasks")}
            >
              Tasks
            </button>
            <button
              className={cn(
                "px-4 py-2 text-sm font-medium transition-colors",
                activeTab === "history"
                  ? "border-b-2 border-primary text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
              onClick={() => setActiveTab("history")}
            >
              History
            </button>
          </div>

          {activeTab === "tasks" && (
            <div className="space-y-4">
              {isLoadingJobs ? (
                <div className="flex items-center justify-center py-12">
                  <IconLoader2 className="size-6 animate-spin text-muted-foreground" />
                </div>
              ) : jobsError ? (
                <Card>
                  <CardContent className="py-12 text-center text-destructive">
                    Failed to load tasks
                  </CardContent>
                </Card>
              ) : jobs.length === 0 ? (
                <Card>
                  <CardContent className="py-12 text-center text-muted-foreground">
                    <div className="flex flex-col items-center gap-3">
                      <IconClock className="size-8 opacity-50" />
                      <p>No scheduled tasks yet</p>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setIsAddSheetOpen(true)}
                      >
                        <IconPlus className="size-4" />
                        Create First Task
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-3">
                  {jobs.map((job) => (
                    <Card key={job.id}>
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1 space-y-2">
                            <div className="flex items-center gap-2">
                              <h3 className="font-medium">{job.name}</h3>
                              <span
                                className={cn(
                                  "rounded-full px-2 py-0.5 text-xs font-medium",
                                  job.enabled
                                    ? "bg-green-500/10 text-green-700 dark:text-green-300"
                                    : "bg-muted text-muted-foreground",
                                )}
                              >
                                {job.enabled ? "Enabled" : "Disabled"}
                              </span>
                            </div>
                            <div className="text-muted-foreground text-xs">
                              <div className="flex items-center gap-2">
                                <IconClock className="size-3" />
                                <span>{formatSchedule(job.schedule)}</span>
                              </div>
                              <div className="mt-1">
                                Last run:{" "}
                                {job.state.lastRunAtMs ? (
                                  <span
                                    className={cn(
                                      job.state.lastStatus === "ok"
                                        ? "text-green-600 dark:text-green-400"
                                        : "text-red-600 dark:text-red-400",
                                    )}
                                  >
                                    {job.state.lastStatus === "ok"
                                      ? "OK"
                                      : "Error"}
                                  </span>
                                ) : (
                                  <span>Never</span>
                                )}
                                {job.state.lastRunAtMs && (
                                  <span className="text-muted-foreground ml-1">
                                    ({formatTime(job.state.lastRunAtMs)})
                                  </span>
                                )}
                              </div>
                              <div>
                                Next run:{" "}
                                {job.state.nextRunAtMs
                                  ? formatTime(job.state.nextRunAtMs)
                                  : "Not scheduled"}
                              </div>
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <Button
                              size="icon-xs"
                              variant="ghost"
                              onClick={() => handleToggleJob(job)}
                              disabled={
                                enableMutation.isPending ||
                                disableMutation.isPending
                              }
                            >
                              {job.enabled ? (
                                <IconPlayerPause className="size-4" />
                              ) : (
                                <IconPlayerPlay className="size-4" />
                              )}
                            </Button>
                            <Button
                              size="icon-xs"
                              variant="ghost"
                              onClick={() => handleDeleteJob(job)}
                              disabled={deleteMutation.isPending}
                            >
                              <IconTrash className="size-4" />
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === "history" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-4">
                <Input
                  placeholder="Filter by job ID..."
                  value={historyJobFilter}
                  onChange={(e) => setHistoryJobFilter(e.target.value)}
                  className="max-w-sm"
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleClearHistory}
                  disabled={clearHistoryMutation.isPending}
                >
                  <IconTrash className="size-4" />
                  Clear History
                </Button>
              </div>

              {isLoadingHistory ? (
                <div className="flex items-center justify-center py-12">
                  <IconLoader2 className="size-6 animate-spin text-muted-foreground" />
                </div>
              ) : historyError ? (
                <Card>
                  <CardContent className="py-12 text-center text-destructive">
                    Failed to load history
                  </CardContent>
                </Card>
              ) : !historyResponse?.records?.length ? (
                <Card>
                  <CardContent className="py-12 text-center text-muted-foreground">
                    <div className="flex flex-col items-center gap-3">
                      <IconHistory className="size-8 opacity-50" />
                      <p>No execution history</p>
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-3">
                  {historyResponse.records.map((record) => (
                    <Card key={record.id}>
                      <CardContent className="p-4">
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <h3 className="font-medium">{record.jobName}</h3>
                            <span
                              className={cn(
                                "rounded-full px-2 py-0.5 text-xs font-medium",
                                record.status === "ok"
                                  ? "bg-green-500/10 text-green-700 dark:text-green-300"
                                  : "bg-red-500/10 text-red-700 dark:text-red-300",
                              )}
                            >
                              {record.status.toUpperCase()}
                            </span>
                          </div>
                          <div className="text-muted-foreground text-xs">
                            <div>Start: {formatTime(record.startAtMs)}</div>
                            <div>
                              Duration: {formatDuration(record.durationMs)}
                            </div>
                            {record.error && (
                              <div className="mt-1 text-destructive">
                                Error: {record.error}
                              </div>
                            )}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <AddCronJobSheet
        open={isAddSheetOpen}
        onClose={() => setIsAddSheetOpen(false)}
        onSaved={() => {
          setIsAddSheetOpen(false)
          void queryClient.invalidateQueries({ queryKey: ["cronJobs"] })
        }}
      />
    </div>
  )
}