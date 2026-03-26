import { IconLoader2 } from "@tabler/icons-react"
import { useEffect, useState } from "react"

import { addCronJob } from "@/api/cron"
import type { AddCronJobRequest, CronSchedule } from "@/api/cron"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"

interface AddCronJobSheetProps {
  open: boolean
  onClose: () => void
  onSaved: () => void
}

export function AddCronJobSheet({
  open,
  onClose,
  onSaved,
}: AddCronJobSheetProps) {
  const [saving, setSaving] = useState(false)
  const [name, setName] = useState("")
  const [scheduleKind, setScheduleKind] = useState<"every" | "cron" | "at">("every")
  const [everySeconds, setEverySeconds] = useState("")
  const [cronExpr, setCronExpr] = useState("")
  const [atTime, setAtTime] = useState("")
  const [message, setMessage] = useState("")
  const [channel, setChannel] = useState("")
  const [deliver, setDeliver] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<"name" | "message" | "schedule", string>>
  >({})
  const [serverError, setServerError] = useState("")

  useEffect(() => {
    if (open) {
      setName("")
      setScheduleKind("every")
      setEverySeconds("")
      setCronExpr("")
      setAtTime("")
      setMessage("")
      setChannel("")
      setDeliver(false)
      setFieldErrors({})
      setServerError("")
    }
  }, [open])

  const validate = (): boolean => {
    const errors: Partial<Record<"name" | "message" | "schedule", string>> = {}
    if (!name.trim()) errors.name = "请输入任务名称"
    if (!message.trim()) errors.message = "请输入消息内容"

    if (scheduleKind === "every") {
      const seconds = Number(everySeconds)
      if (!everySeconds.trim() || isNaN(seconds) || seconds <= 0) {
        errors.schedule = "间隔秒数必须大于 0"
      }
    } else if (scheduleKind === "cron") {
      if (!cronExpr.trim()) errors.schedule = "请输入 Cron 表达式"
    } else if (scheduleKind === "at") {
      if (!atTime.trim()) errors.schedule = "请选择执行时间"
    }

    setFieldErrors(errors)
    return Object.keys(errors).length === 0
  }

  const handleSave = async () => {
    if (!validate()) return
    setSaving(true)
    setServerError("")
    try {
      let schedule: CronSchedule
      if (scheduleKind === "every") {
        schedule = {
          kind: "every",
          everyMs: Number(everySeconds) * 1000,
        }
      } else if (scheduleKind === "cron") {
        schedule = {
          kind: "cron",
          expr: cronExpr.trim(),
        }
      } else {
        schedule = {
          kind: "at",
          atMs: new Date(atTime).getTime(),
        }
      }

      const request: AddCronJobRequest = {
        name: name.trim(),
        schedule,
        message: message.trim(),
        channel: channel.trim(),
        deliver,
        to: "",
      }

      await addCronJob(request)
      onSaved()
      onClose()
    } catch (e) {
      setServerError(e instanceof Error ? e.message : "创建定时任务失败")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent
        side="right"
        className="flex flex-col gap-0 p-0 data-[side=right]:!w-full data-[side=right]:sm:!w-[560px] data-[side=right]:sm:!max-w-[560px]"
      >
        <SheetHeader className="border-b-muted border-b px-6 py-5">
          <SheetTitle className="text-base">添加定时任务</SheetTitle>
          <SheetDescription className="text-xs">
            创建新的定时任务，在指定的时间间隔或时间点执行命令
          </SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="space-y-5 px-6 py-5">
            <div className="space-y-1.5">
              <Label>任务名称</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="请输入任务名称"
                aria-invalid={!!fieldErrors.name}
              />
              {fieldErrors.name && (
                <p className="text-destructive text-xs">{fieldErrors.name}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label>调度类型</Label>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant={scheduleKind === "every" ? "default" : "outline"}
                  onClick={() => setScheduleKind("every")}
                >
                  固定间隔
                </Button>
                <Button
                  size="sm"
                  variant={scheduleKind === "cron" ? "default" : "outline"}
                  onClick={() => setScheduleKind("cron")}
                >
                  Cron 表达式
                </Button>
                <Button
                  size="sm"
                  variant={scheduleKind === "at" ? "default" : "outline"}
                  onClick={() => setScheduleKind("at")}
                >
                  一次性
                </Button>
              </div>
            </div>

            {scheduleKind === "every" && (
              <div className="space-y-1.5">
                <Label>间隔时间（秒）</Label>
                <Input
                  value={everySeconds}
                  onChange={(e) => setEverySeconds(e.target.value)}
                  placeholder="60"
                  type="number"
                  min={1}
                  aria-invalid={!!fieldErrors.schedule}
                />
                {fieldErrors.schedule && (
                  <p className="text-destructive text-xs">{fieldErrors.schedule}</p>
                )}
              </div>
            )}

            {scheduleKind === "cron" && (
              <div className="space-y-1.5">
                <Label>Cron 表达式</Label>
                <Input
                  value={cronExpr}
                  onChange={(e) => setCronExpr(e.target.value)}
                  placeholder="*/5 * * * *"
                  className="font-mono text-sm"
                  aria-invalid={!!fieldErrors.schedule}
                />
                {fieldErrors.schedule && (
                  <p className="text-destructive text-xs">{fieldErrors.schedule}</p>
                )}
              </div>
            )}

            {scheduleKind === "at" && (
              <div className="space-y-1.5">
                <Label>执行时间</Label>
                <Input
                  value={atTime}
                  onChange={(e) => setAtTime(e.target.value)}
                  type="datetime-local"
                  aria-invalid={!!fieldErrors.schedule}
                />
                {fieldErrors.schedule && (
                  <p className="text-destructive text-xs">{fieldErrors.schedule}</p>
                )}
              </div>
            )}

            <div className="space-y-1.5">
              <Label>消息 / 命令</Label>
              <Textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="请输入要执行的消息或命令"
                rows={4}
                aria-invalid={!!fieldErrors.message}
              />
              {fieldErrors.message && (
                <p className="text-destructive text-xs">{fieldErrors.message}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label>频道</Label>
              <Input
                value={channel}
                onChange={(e) => setChannel(e.target.value)}
                placeholder="请输入频道（可选）"
              />
            </div>

            {serverError && (
              <p className="text-destructive bg-destructive/10 rounded-md px-3 py-2 text-sm">
                {serverError}
              </p>
            )}
          </div>
        </div>

        <SheetFooter className="border-t-muted border-t px-6 py-4">
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            取消
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <IconLoader2 className="size-4 animate-spin" />}
            创建
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}