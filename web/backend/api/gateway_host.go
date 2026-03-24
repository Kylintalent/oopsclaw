package api

import (
	"net"
	"net/http"
	"strconv"
	"strings"

	"github.com/sipeed/picoclaw/pkg/config"
)

func (h *Handler) effectiveLauncherPublic() bool {
	if h.serverPublicExplicit {
		return h.serverPublic
	}

	cfg, err := h.loadLauncherConfig()
	if err == nil {
		return cfg.Public
	}

	return h.serverPublic
}

func (h *Handler) gatewayHostOverride() string {
	if h.effectiveLauncherPublic() {
		return "0.0.0.0"
	}
	return ""
}

func (h *Handler) effectiveGatewayBindHost(cfg *config.Config) string {
	if override := h.gatewayHostOverride(); override != "" {
		return override
	}
	if cfg == nil {
		return ""
	}
	return strings.TrimSpace(cfg.Gateway.Host)
}

func gatewayProbeHost(bindHost string) string {
	if bindHost == "" || bindHost == "0.0.0.0" {
		return "127.0.0.1"
	}
	return bindHost
}

func requestHostName(r *http.Request) string {
	reqHost, _, err := net.SplitHostPort(r.Host)
	if err == nil {
		return reqHost
	}
	if strings.TrimSpace(r.Host) != "" {
		return r.Host
	}
	return "127.0.0.1"
}

func (h *Handler) buildWsURL(r *http.Request, cfg *config.Config) string {
	// When accessed through a reverse proxy (X-Forwarded-Host or X-Forwarded-Proto present),
	// return a WebSocket URL that goes through the proxy instead of directly to the gateway port.
	// The proxy must forward /pico/ws to the gateway.
	if forwardedHost := r.Header.Get("X-Forwarded-Host"); forwardedHost != "" {
		scheme := "ws"
		if proto := r.Header.Get("X-Forwarded-Proto"); proto == "https" {
			scheme = "wss"
		}
		return scheme + "://" + forwardedHost + "/pico/ws"
	}

	host := h.effectiveGatewayBindHost(cfg)
	if host == "" || host == "0.0.0.0" {
		host = requestHostName(r)
	}
	return "ws://" + net.JoinHostPort(host, strconv.Itoa(cfg.Gateway.Port)) + "/pico/ws"
}
