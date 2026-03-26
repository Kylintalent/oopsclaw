package api

import (
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/sipeed/picoclaw/pkg/config"
)

type mcpStateRequest struct {
	Enabled bool `json:"enabled"`
}

type mcpServerRequest struct {
	config.MCPServerConfig
}

type mcpDiscoveryRequest struct {
	Enabled          bool `json:"enabled"`
	TTL              *int  `json:"ttl,omitempty"`
	MaxSearchResults *int  `json:"max_search_results,omitempty"`
	UseBM25          *bool `json:"use_bm25,omitempty"`
	UseRegex         *bool `json:"use_regex,omitempty"`
}

func (h *Handler) registerMCPRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /oopsclaw/mcp", h.handleGetMCP)
	mux.HandleFunc("PUT /oopsclaw/mcp/state", h.handleUpdateMCPState)
	mux.HandleFunc("PUT /oopsclaw/mcp/discovery", h.handleUpdateMCPDiscovery)
	mux.HandleFunc("PUT /oopsclaw/mcp/servers/{name}", h.handleUpdateMCPServer)
	mux.HandleFunc("DELETE /oopsclaw/mcp/servers/{name}", h.handleDeleteMCPServer)
	mux.HandleFunc("PUT /oopsclaw/mcp/servers/{name}/state", h.handleUpdateMCPServerState)
}

func (h *Handler) handleGetMCP(w http.ResponseWriter, r *http.Request) {
	cfg, err := config.LoadConfig(h.configPath)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to load config: %v", err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(cfg.Tools.MCP)
}

func (h *Handler) handleUpdateMCPState(w http.ResponseWriter, r *http.Request) {
	cfg, err := config.LoadConfig(h.configPath)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to load config: %v", err), http.StatusInternalServerError)
		return
	}

	var req mcpStateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, fmt.Sprintf("Invalid JSON: %v", err), http.StatusBadRequest)
		return
	}

	cfg.Tools.MCP.Enabled = req.Enabled

	if err := config.SaveConfig(h.configPath, cfg); err != nil {
		http.Error(w, fmt.Sprintf("Failed to save config: %v", err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

func (h *Handler) handleUpdateMCPDiscovery(w http.ResponseWriter, r *http.Request) {
	cfg, err := config.LoadConfig(h.configPath)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to load config: %v", err), http.StatusInternalServerError)
		return
	}

	var req mcpDiscoveryRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, fmt.Sprintf("Invalid JSON: %v", err), http.StatusBadRequest)
		return
	}

	cfg.Tools.MCP.Discovery.Enabled = req.Enabled
	if req.TTL != nil {
		cfg.Tools.MCP.Discovery.TTL = *req.TTL
	}
	if req.MaxSearchResults != nil {
		cfg.Tools.MCP.Discovery.MaxSearchResults = *req.MaxSearchResults
	}
	if req.UseBM25 != nil {
		cfg.Tools.MCP.Discovery.UseBM25 = *req.UseBM25
	}
	if req.UseRegex != nil {
		cfg.Tools.MCP.Discovery.UseRegex = *req.UseRegex
	}

	if err := config.SaveConfig(h.configPath, cfg); err != nil {
		http.Error(w, fmt.Sprintf("Failed to save config: %v", err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

func (h *Handler) handleUpdateMCPServer(w http.ResponseWriter, r *http.Request) {
	cfg, err := config.LoadConfig(h.configPath)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to load config: %v", err), http.StatusInternalServerError)
		return
	}

	name := r.PathValue("name")
	if name == "" {
		http.Error(w, "Server name is required", http.StatusBadRequest)
		return
	}

	var req mcpServerRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, fmt.Sprintf("Invalid JSON: %v", err), http.StatusBadRequest)
		return
	}

	if cfg.Tools.MCP.Servers == nil {
		cfg.Tools.MCP.Servers = make(map[string]config.MCPServerConfig)
	}
	cfg.Tools.MCP.Servers[name] = req.MCPServerConfig

	if err := config.SaveConfig(h.configPath, cfg); err != nil {
		http.Error(w, fmt.Sprintf("Failed to save config: %v", err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

func (h *Handler) handleDeleteMCPServer(w http.ResponseWriter, r *http.Request) {
	cfg, err := config.LoadConfig(h.configPath)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to load config: %v", err), http.StatusInternalServerError)
		return
	}

	name := r.PathValue("name")
	if name == "" {
		http.Error(w, "Server name is required", http.StatusBadRequest)
		return
	}

	if cfg.Tools.MCP.Servers == nil {
		http.Error(w, fmt.Sprintf("Server %q not found", name), http.StatusNotFound)
		return
	}

	if _, exists := cfg.Tools.MCP.Servers[name]; !exists {
		http.Error(w, fmt.Sprintf("Server %q not found", name), http.StatusNotFound)
		return
	}

	delete(cfg.Tools.MCP.Servers, name)

	if err := config.SaveConfig(h.configPath, cfg); err != nil {
		http.Error(w, fmt.Sprintf("Failed to save config: %v", err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

func (h *Handler) handleUpdateMCPServerState(w http.ResponseWriter, r *http.Request) {
	cfg, err := config.LoadConfig(h.configPath)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to load config: %v", err), http.StatusInternalServerError)
		return
	}

	name := r.PathValue("name")
	if name == "" {
		http.Error(w, "Server name is required", http.StatusBadRequest)
		return
	}

	var req mcpStateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, fmt.Sprintf("Invalid JSON: %v", err), http.StatusBadRequest)
		return
	}

	if cfg.Tools.MCP.Servers == nil {
		http.Error(w, fmt.Sprintf("Server %q not found", name), http.StatusNotFound)
		return
	}

	server, exists := cfg.Tools.MCP.Servers[name]
	if !exists {
		http.Error(w, fmt.Sprintf("Server %q not found", name), http.StatusNotFound)
		return
	}

	server.Enabled = req.Enabled
	cfg.Tools.MCP.Servers[name] = server

	if err := config.SaveConfig(h.configPath, cfg); err != nil {
		http.Error(w, fmt.Sprintf("Failed to save config: %v", err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}
