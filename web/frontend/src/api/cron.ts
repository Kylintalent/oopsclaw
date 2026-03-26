// Cron Jobs API — manage scheduled tasks and execution history

export interface CronSchedule {
  kind: "at" | "every" | "cron"
  atMs?: number
  everyMs?: number
  expr?: string
  tz?: string
}

export interface CronPayload {
  kind: string
  message: string
  command?: string
  deliver: boolean
  channel?: string
  to?: string
}

export interface CronJobState {
  nextRunAtMs?: number
  lastRunAtMs?: number
  lastStatus?: string
  lastError?: string
}

export interface CronJob {
  id: string
  name: string
  enabled: boolean
  schedule: CronSchedule
  payload: CronPayload
  state: CronJobState
  createdAtMs: number
  updatedAtMs: number
  deleteAfterRun: boolean
}

export interface ExecutionRecord {
  id: string
  jobId: string
  jobName: string
  startAtMs: number
  endAtMs: number
  durationMs: number
  status: string
  error?: string
}

export interface HistoryResponse {
  records: ExecutionRecord[]
  total: number
  offset: number
  limit: number
}

export interface AddCronJobRequest {
  name: string
  schedule: CronSchedule
  message: string
  deliver: boolean
  channel: string
  to: string
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(path, options)
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`API error: ${res.status} ${text}`)
  }
  return res.json() as Promise<T>
}

export async function getCronJobs(includeDisabled = true): Promise<CronJob[]> {
  return request<CronJob[]>(
    `/oopsclaw/cron/jobs?include_disabled=${includeDisabled}`,
  )
}

export async function getCronJob(id: string): Promise<CronJob> {
  return request<CronJob>(`/oopsclaw/cron/jobs/${encodeURIComponent(id)}`)
}

export async function addCronJob(job: AddCronJobRequest): Promise<CronJob> {
  return request<CronJob>("/oopsclaw/cron/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(job),
  })
}

export async function updateCronJob(
  id: string,
  job: Partial<CronJob>,
): Promise<{ status: string }> {
  return request<{ status: string }>(
    `/oopsclaw/cron/jobs/${encodeURIComponent(id)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(job),
    },
  )
}

export async function deleteCronJob(
  id: string,
): Promise<{ status: string }> {
  return request<{ status: string }>(
    `/oopsclaw/cron/jobs/${encodeURIComponent(id)}`,
    { method: "DELETE" },
  )
}

export async function enableCronJob(id: string): Promise<CronJob> {
  return request<CronJob>(
    `/oopsclaw/cron/jobs/${encodeURIComponent(id)}/enable`,
    { method: "POST" },
  )
}

export async function disableCronJob(id: string): Promise<CronJob> {
  return request<CronJob>(
    `/oopsclaw/cron/jobs/${encodeURIComponent(id)}/disable`,
    { method: "POST" },
  )
}

export async function getCronHistory(
  jobId?: string,
  offset = 0,
  limit = 50,
): Promise<HistoryResponse> {
  const params = new URLSearchParams({
    offset: offset.toString(),
    limit: limit.toString(),
  })
  if (jobId) {
    params.set("job_id", jobId)
  }
  return request<HistoryResponse>(
    `/oopsclaw/cron/history?${params.toString()}`,
  )
}

export async function clearCronHistory(
  jobId?: string,
): Promise<{ status: string }> {
  const params = jobId ? `?job_id=${encodeURIComponent(jobId)}` : ""
  return request<{ status: string }>(`/oopsclaw/cron/history${params}`, {
    method: "DELETE",
  })
}

export async function getCronStatus(): Promise<{
  enabled: boolean
  jobs: number
  nextWakeAtMS: number | null
}> {
  return request(`/oopsclaw/cron/status`)
}
