import {
  IconChevronDown,
  IconChevronUp,
  IconLoader2,
  IconPlug,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import * as React from "react"
import { toast } from "sonner"

import {
  getMCPConfig,
  setMCPServerEnabled,
  setMCPEnabled,
  updateMCPServer,
  deleteMCPServer,
  updateMCPDiscovery,
  type MCPServerConfig,
  type MCPDiscoveryConfig,
} from "@/api/mcp"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

function parseKeyValuePairs(text: string): Record<string, string> {
  const result: Record<string, string> = {}
  if (!text.trim()) return result
  text.split(",").forEach((pair) => {
    const [key, value] = pair.split("=").map((s) => s.trim())
    if (key) result[key] = value || ""
  })
  return result
}

function formatKeyValuePairs(obj?: Record<string, string>): string {
  if (!obj) return ""
  return Object.entries(obj)
    .map(([key, value]) => `${key}=${value}`)
    .join(", ")
}

export function MCPPage() {
  const queryClient = useQueryClient()
  const { data, isLoading, error } = useQuery({
    queryKey: ["mcp"],
    queryFn: getMCPConfig,
  })

  const [discoveryExpanded, setDiscoveryExpanded] = React.useState(false)
  const [editingServer, setEditingServer] = React.useState<string | null>(null)
  const [isAddingServer, setIsAddingServer] = React.useState(false)
  const [newServerName, setNewServerName] = React.useState("")
  const [serverForm, setServerForm] = React.useState<MCPServerConfig>({
    enabled: true,
    command: "",
    type: "stdio",
  })
  const [discoveryForm, setDiscoveryForm] = React.useState<MCPDiscoveryConfig>({
    enabled: false,
    ttl: 300,
    max_search_results: 10,
    use_bm25: true,
    use_regex: false,
  })

  const toggleMCPMutation = useMutation({
    mutationFn: async (enabled: boolean) => setMCPEnabled(enabled),
    onSuccess: (_, enabled) => {
      toast.success(enabled ? "MCP enabled" : "MCP disabled")
      void queryClient.invalidateQueries({ queryKey: ["mcp"] })
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to toggle MCP")
    },
  })

  const toggleServerMutation = useMutation({
    mutationFn: async ({ name, enabled }: { name: string; enabled: boolean }) =>
      setMCPServerEnabled(name, enabled),
    onSuccess: (_, variables) => {
      toast.success(
        variables.enabled
          ? "Server enabled"
          : "Server disabled",
      )
      void queryClient.invalidateQueries({ queryKey: ["mcp"] })
    },
    onError: (err) => {
      toast.error(
        err instanceof Error ? err.message : "Failed to toggle server",
      )
    },
  })

  const updateServerMutation = useMutation({
    mutationFn: async ({ name, server }: { name: string; server: MCPServerConfig }) =>
      updateMCPServer(name, server),
    onSuccess: () => {
      toast.success("Server updated")
      setEditingServer(null)
      setIsAddingServer(false)
      void queryClient.invalidateQueries({ queryKey: ["mcp"] })
    },
    onError: (err) => {
      toast.error(
        err instanceof Error ? err.message : "Failed to update server",
      )
    },
  })

  const deleteServerMutation = useMutation({
    mutationFn: async (name: string) => deleteMCPServer(name),
    onSuccess: (_, name) => {
      toast.success("Server deleted")
      if (editingServer === name) {
        setEditingServer(null)
      }
      void queryClient.invalidateQueries({ queryKey: ["mcp"] })
    },
    onError: (err) => {
      toast.error(
        err instanceof Error ? err.message : "Failed to delete server",
      )
    },
  })

  const updateDiscoveryMutation = useMutation({
    mutationFn: async (discovery: MCPDiscoveryConfig) =>
      updateMCPDiscovery(discovery),
    onSuccess: () => {
      toast.success("Discovery settings updated")
      void queryClient.invalidateQueries({ queryKey: ["mcp"] })
    },
    onError: (err) => {
      toast.error(
        err instanceof Error ? err.message : "Failed to update discovery settings",
      )
    },
  })

  const handleEditServer = (name: string, config: MCPServerConfig) => {
    setServerForm({ ...config })
    setEditingServer(name)
    setIsAddingServer(false)
  }

  const handleAddServer = () => {
    setServerForm({
      enabled: true,
      command: "",
      type: "stdio",
    })
    setNewServerName("")
    setEditingServer(null)
    setIsAddingServer(true)
  }

  const handleSaveNewServer = () => {
    if (!newServerName.trim()) {
      toast.error("Server name is required")
      return
    }
    updateServerMutation.mutate({ name: newServerName.trim(), server: serverForm })
  }

  const handleSaveExistingServer = (name: string) => {
    updateServerMutation.mutate({ name, server: serverForm })
  }

  const handleDeleteServer = (name: string) => {
    if (confirm(`Are you sure you want to delete server "${name}"?`)) {
      deleteServerMutation.mutate(name)
    }
  }

  const handleSaveDiscovery = () => {
    updateDiscoveryMutation.mutate(discoveryForm)
  }

  const handleDiscoveryFormChange = (
    field: keyof MCPDiscoveryConfig,
    value: boolean | number,
  ) => {
    setDiscoveryForm((prev) => ({ ...prev, [field]: value }))
  }

  const handleServerFormChange = (
    field: keyof MCPServerConfig,
    value: string | boolean | string[] | Record<string, string>,
  ) => {
    setServerForm((prev) => ({ ...prev, [field]: value }))
  }

  React.useEffect(() => {
    if (data?.discovery) {
      setDiscoveryForm(data.discovery)
    }
  }, [data])

  const serverEntries = Object.entries(data?.servers || {})

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="MCP Servers" />

      <div className="flex-1 overflow-auto px-6 py-3">
        <div className="w-full max-w-6xl space-y-6">
          {isLoading ? (
            <div className="text-muted-foreground py-6 text-sm">Loading...</div>
          ) : error ? (
            <div className="text-destructive py-6 text-sm">
              Failed to load MCP configuration
            </div>
          ) : (
            <section className="space-y-5">
              {/* MCP Global Toggle */}
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle>Model Context Protocol</CardTitle>
                      <CardDescription>
                        Enable MCP to connect to external tools and services
                      </CardDescription>
                    </div>
                    <Switch
                      checked={data?.enabled ?? false}
                      onCheckedChange={(checked) => toggleMCPMutation.mutate(checked)}
                      disabled={toggleMCPMutation.isPending}
                    />
                  </div>
                </CardHeader>
              </Card>

              {/* Discovery Configuration */}
              <Card>
                <CardHeader>
                  <Button
                    variant="ghost"
                    className="w-full justify-between px-0"
                    onClick={() => setDiscoveryExpanded(!discoveryExpanded)}
                  >
                    <div className="flex items-center gap-2">
                      <IconPlug className="size-4" />
                      <span className="font-semibold">Discovery Settings</span>
                    </div>
                    {discoveryExpanded ? (
                      <IconChevronUp className="size-4" />
                    ) : (
                      <IconChevronDown className="size-4" />
                    )}
                  </Button>
                </CardHeader>
                {discoveryExpanded && (
                  <CardContent className="space-y-4">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="discovery-enabled">Enable Discovery</Label>
                      <Switch
                        id="discovery-enabled"
                        checked={discoveryForm.enabled}
                        onCheckedChange={(checked) =>
                          handleDiscoveryFormChange("enabled", checked)
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="discovery-ttl">TTL (seconds)</Label>
                      <Input
                        id="discovery-ttl"
                        type="number"
                        value={discoveryForm.ttl}
                        onChange={(e) =>
                          handleDiscoveryFormChange("ttl", parseInt(e.target.value) || 0)
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="discovery-max-results">Max Search Results</Label>
                      <Input
                        id="discovery-max-results"
                        type="number"
                        value={discoveryForm.max_search_results}
                        onChange={(e) =>
                          handleDiscoveryFormChange("max_search_results", parseInt(e.target.value) || 0)
                        }
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <Label htmlFor="discovery-bm25">Use BM25</Label>
                      <Switch
                        id="discovery-bm25"
                        checked={discoveryForm.use_bm25}
                        onCheckedChange={(checked) =>
                          handleDiscoveryFormChange("use_bm25", checked)
                        }
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <Label htmlFor="discovery-regex">Use Regex</Label>
                      <Switch
                        id="discovery-regex"
                        checked={discoveryForm.use_regex}
                        onCheckedChange={(checked) =>
                          handleDiscoveryFormChange("use_regex", checked)
                        }
                      />
                    </div>
                    <Button
                      onClick={handleSaveDiscovery}
                      disabled={updateDiscoveryMutation.isPending}
                    >
                      {updateDiscoveryMutation.isPending ? (
                        <IconLoader2 className="mr-2 size-4 animate-spin" />
                      ) : null}
                      Save Discovery Settings
                    </Button>
                  </CardContent>
                )}
              </Card>

              {/* Server List */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold">Servers</h3>
                  <Button
                    onClick={handleAddServer}
                    disabled={isAddingServer}
                    size="sm"
                  >
                    <IconPlus className="mr-2 size-4" />
                    Add Server
                  </Button>
                </div>

                {isAddingServer && (
                  <ServerForm
                    isNew
                    serverName={newServerName}
                    onNameChange={setNewServerName}
                    form={serverForm}
                    onChange={handleServerFormChange}
                    onSave={handleSaveNewServer}
                    onCancel={() => setIsAddingServer(false)}
                    isLoading={updateServerMutation.isPending}
                  />
                )}

                {serverEntries.map(([name, config]) => {
                  const isEditing = editingServer === name
                  const isPending =
                    toggleServerMutation.isPending &&
                    toggleServerMutation.variables?.name === name

                  return (
                    <Card
                      key={name}
                      className={cn(
                        "gap-4 border transition-colors",
                        config.enabled &&
                          "border-emerald-200/70 bg-emerald-50/50",
                        !config.enabled &&
                          "border-border/60 bg-card/70",
                      )}
                    >
                      {!isEditing ? (
                        <>
                          <CardHeader>
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                              <div className="min-w-0 flex-1">
                                <CardTitle className="font-mono text-sm break-all">
                                  {name}
                                </CardTitle>
                                <CardDescription className="mt-1 flex items-center gap-2">
                                  <span className="inline-flex items-center rounded-md bg-muted px-2 py-1 text-xs font-medium">
                                    {config.type || "stdio"}
                                  </span>
                                  <span className="truncate">
                                    {config.type === "http" || config.type === "sse"
                                      ? config.url
                                      : config.command}
                                  </span>
                                </CardDescription>
                              </div>
                              <div className="flex shrink-0 items-center gap-2 self-start">
                                <Switch
                                  checked={config.enabled}
                                  onCheckedChange={(checked) =>
                                    toggleServerMutation.mutate({
                                      name,
                                      enabled: checked,
                                    })
                                  }
                                  disabled={isPending}
                                />
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => handleEditServer(name, config)}
                                >
                                  Edit
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => handleDeleteServer(name)}
                                  disabled={deleteServerMutation.isPending}
                                >
                                  <IconTrash className="size-4" />
                                </Button>
                              </div>
                            </div>
                          </CardHeader>
                        </>
                      ) : (
                        <CardContent>
                          <ServerForm
                            isNew={false}
                            serverName={name}
                            form={serverForm}
                            onChange={handleServerFormChange}
                            onSave={() => handleSaveExistingServer(name)}
                            onCancel={() => setEditingServer(null)}
                            isLoading={updateServerMutation.isPending}
                          />
                        </CardContent>
                      )}
                    </Card>
                  )
                })}

                {serverEntries.length === 0 && !isAddingServer && (
                  <Card className="border-dashed">
                    <CardContent className="text-muted-foreground py-10 text-center text-sm">
                      No servers configured. Click "Add Server" to get started.
                    </CardContent>
                  </Card>
                )}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  )
}

interface ServerFormProps {
  isNew: boolean
  serverName: string
  onNameChange?: (name: string) => void
  form: MCPServerConfig
  onChange: (field: keyof MCPServerConfig, value: string | boolean | string[] | Record<string, string>) => void
  onSave: () => void
  onCancel: () => void
  isLoading: boolean
}

function ServerForm({
  isNew,
  serverName,
  onNameChange,
  form,
  onChange,
  onSave,
  onCancel,
  isLoading,
}: ServerFormProps) {
  return (
    <Card>
      <CardContent className="space-y-4 pt-4">
        <div className="space-y-2">
          <Label htmlFor="server-name">Server Name</Label>
          <Input
            id="server-name"
            value={serverName}
            onChange={(e) => onNameChange?.(e.target.value)}
            placeholder="my-mcp-server"
            disabled={!isNew}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="server-type">Type</Label>
          <select
            id="server-type"
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            value={form.type || "stdio"}
            onChange={(e) => onChange("type", e.target.value)}
          >
            <option value="stdio">stdio</option>
            <option value="sse">sse</option>
            <option value="http">http</option>
          </select>
        </div>
        {form.type !== "http" && form.type !== "sse" ? (
          <>
            <div className="space-y-2">
              <Label htmlFor="server-command">Command</Label>
              <Input
                id="server-command"
                value={form.command}
                onChange={(e) => onChange("command", e.target.value)}
                placeholder="npx, python, /path/to/server"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="server-args">Arguments (comma-separated)</Label>
              <Textarea
                id="server-args"
                value={form.args?.join(", ") || ""}
                onChange={(e) =>
                  onChange("args", e.target.value.split(",").map((s) => s.trim()).filter(Boolean))
                }
                placeholder="--arg1, --arg2"
                rows={2}
              />
            </div>
          </>
        ) : (
          <div className="space-y-2">
            <Label htmlFor="server-url">URL</Label>
            <Input
              id="server-url"
              value={form.url || ""}
              onChange={(e) => onChange("url", e.target.value)}
              placeholder="https://example.com/mcp"
            />
          </div>
        )}
        <div className="space-y-2">
          <Label htmlFor="server-env">Environment Variables (key=value, comma-separated)</Label>
          <Textarea
            id="server-env"
            value={formatKeyValuePairs(form.env)}
            onChange={(e) => onChange("env", parseKeyValuePairs(e.target.value))}
            placeholder="KEY1=value1, KEY2=value2"
            rows={2}
          />
        </div>
        {(form.type === "http" || form.type === "sse") && (
          <div className="space-y-2">
            <Label htmlFor="server-headers">Headers (key=value, comma-separated)</Label>
            <Textarea
              id="server-headers"
              value={formatKeyValuePairs(form.headers)}
              onChange={(e) => onChange("headers", parseKeyValuePairs(e.target.value))}
              placeholder="Authorization=Bearer token, Content-Type=application/json"
              rows={2}
            />
          </div>
        )}
        <div className="space-y-2">
          <Label htmlFor="server-env-file">Env File Path</Label>
          <Input
            id="server-env-file"
            value={form.env_file || ""}
            onChange={(e) => onChange("env_file", e.target.value)}
            placeholder="/path/to/.env"
          />
        </div>
        <div className="flex gap-2">
          <Button onClick={onSave} disabled={isLoading}>
            {isLoading ? (
              <IconLoader2 className="mr-2 size-4 animate-spin" />
            ) : null}
            {isNew ? "Add Server" : "Save Changes"}
          </Button>
          <Button variant="outline" onClick={onCancel} disabled={isLoading}>
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
