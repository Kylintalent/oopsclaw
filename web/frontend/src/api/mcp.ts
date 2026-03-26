export interface MCPServerConfig {
  enabled: boolean
  command: string
  args?: string[]
  env?: Record<string, string>
  env_file?: string
  type?: string
  url?: string
  headers?: Record<string, string>
}

export interface MCPDiscoveryConfig {
  enabled: boolean
  ttl: number
  max_search_results: number
  use_bm25: boolean
  use_regex: boolean
}

export interface MCPConfigResponse {
  enabled: boolean
  discovery: MCPDiscoveryConfig
  servers: Record<string, MCPServerConfig>
}

interface MCPActionResponse {
  status: string
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(path, options)
  if (!res.ok) {
    let message = `API error: ${res.status} ${res.statusText}`
    try {
      const body = (await res.json()) as {
        error?: string
        errors?: string[]
      }
      if (Array.isArray(body.errors) && body.errors.length > 0) {
        message = body.errors.join("; ")
      } else if (typeof body.error === "string" && body.error.trim() !== "") {
        message = body.error
      }
    } catch {
      // ignore invalid body
    }
    throw new Error(message)
  }
  return res.json() as Promise<T>
}

export async function getMCPConfig(): Promise<MCPConfigResponse> {
  return request<MCPConfigResponse>("/oopsclaw/mcp")
}

export async function updateMCPServer(
  name: string,
  server: MCPServerConfig,
): Promise<MCPActionResponse> {
  return request<MCPActionResponse>(
    `/oopsclaw/mcp/servers/${encodeURIComponent(name)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(server),
    },
  )
}

export async function deleteMCPServer(
  name: string,
): Promise<MCPActionResponse> {
  return request<MCPActionResponse>(
    `/oopsclaw/mcp/servers/${encodeURIComponent(name)}`,
    {
      method: "DELETE",
    },
  )
}

export async function setMCPServerEnabled(
  name: string,
  enabled: boolean,
): Promise<MCPActionResponse> {
  return request<MCPActionResponse>(
    `/oopsclaw/mcp/servers/${encodeURIComponent(name)}/state`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    },
  )
}

export async function setMCPEnabled(
  enabled: boolean,
): Promise<MCPActionResponse> {
  return request<MCPActionResponse>("/oopsclaw/mcp/state", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled }),
  })
}

export async function updateMCPDiscovery(
  discovery: MCPDiscoveryConfig,
): Promise<MCPActionResponse> {
  return request<MCPActionResponse>("/oopsclaw/mcp/discovery", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(discovery),
  })
}
