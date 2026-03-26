package api

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/sipeed/picoclaw/pkg/config"
	"github.com/sipeed/picoclaw/pkg/cron"
)

// cronService lazily initializes and returns the shared CronService instance.
// It reads the config to determine the correct workspace path where jobs.json
// is stored, matching the path used by the gateway process.
func (h *Handler) cronService() *cron.CronService {
	if h.cronSvc == nil {
		cfg, err := config.LoadConfig(h.configPath)
		if err != nil {
			// Fallback to config directory if config cannot be loaded
			storePath := filepath.Join(filepath.Dir(h.configPath), "cron", "jobs.json")
			h.cronSvc = cron.NewCronService(storePath, nil)
		} else {
			storePath := filepath.Join(cfg.WorkspacePath(), "cron", "jobs.json")
			h.cronSvc = cron.NewCronService(storePath, nil)
		}
	}
	return h.cronSvc
}

// registerCronRoutes binds cron job management endpoints to the ServeMux.
func (h *Handler) registerCronRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /oopsclaw/cron/jobs", h.handleListCronJobs)
	mux.HandleFunc("GET /oopsclaw/cron/jobs/{id}", h.handleGetCronJob)
	mux.HandleFunc("POST /oopsclaw/cron/jobs", h.handleAddCronJob)
	mux.HandleFunc("PUT /oopsclaw/cron/jobs/{id}", h.handleUpdateCronJob)
	mux.HandleFunc("DELETE /oopsclaw/cron/jobs/{id}", h.handleDeleteCronJob)
	mux.HandleFunc("POST /oopsclaw/cron/jobs/{id}/enable", h.handleEnableCronJob)
	mux.HandleFunc("POST /oopsclaw/cron/jobs/{id}/disable", h.handleDisableCronJob)
	mux.HandleFunc("GET /oopsclaw/cron/history", h.handleListCronHistory)
	mux.HandleFunc("DELETE /oopsclaw/cron/history", h.handleClearCronHistory)
	mux.HandleFunc("GET /oopsclaw/cron/status", h.handleCronStatus)
}

// handleListCronJobs returns all cron jobs.
//
//	GET /oopsclaw/cron/jobs?include_disabled=true
func (h *Handler) handleListCronJobs(w http.ResponseWriter, r *http.Request) {
	// Reload from disk to pick up changes made by the gateway process
	_ = h.cronService().Load()

	includeDisabled := r.URL.Query().Get("include_disabled") != "false"
	jobs := h.cronService().ListJobs(includeDisabled)

	if jobs == nil {
		jobs = []cron.CronJob{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(jobs)
}

// handleGetCronJob returns a single cron job by ID.
//
//	GET /oopsclaw/cron/jobs/{id}
func (h *Handler) handleGetCronJob(w http.ResponseWriter, r *http.Request) {
	// Reload from disk to pick up changes made by the gateway process
	_ = h.cronService().Load()

	jobID := r.PathValue("id")
	job := h.cronService().GetJob(jobID)
	if job == nil {
		http.Error(w, "Job not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(job)
}

// addCronJobRequest is the request body for creating a new cron job.
type addCronJobRequest struct {
	Name     string            `json:"name"`
	Schedule cron.CronSchedule `json:"schedule"`
	Message  string            `json:"message"`
	Deliver  bool              `json:"deliver"`
	Channel  string            `json:"channel"`
	To       string            `json:"to"`
}

// handleAddCronJob creates a new cron job.
//
//	POST /oopsclaw/cron/jobs
func (h *Handler) handleAddCronJob(w http.ResponseWriter, r *http.Request) {
	// Reload from disk to pick up changes made by the gateway process
	_ = h.cronService().Load()

	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		http.Error(w, "Failed to read request body", http.StatusBadRequest)
		return
	}
	defer r.Body.Close()

	var req addCronJobRequest
	if err := json.Unmarshal(body, &req); err != nil {
		http.Error(w, fmt.Sprintf("Invalid JSON: %v", err), http.StatusBadRequest)
		return
	}

	if strings.TrimSpace(req.Name) == "" {
		http.Error(w, "Job name is required", http.StatusBadRequest)
		return
	}

	if req.Schedule.Kind == "" {
		http.Error(w, "Schedule kind is required (at, every, or cron)", http.StatusBadRequest)
		return
	}

	job, err := h.cronService().AddJob(req.Name, req.Schedule, req.Message, req.Deliver, req.Channel, req.To)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to add job: %v", err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(job)
}

// handleUpdateCronJob updates an existing cron job.
//
//	PUT /oopsclaw/cron/jobs/{id}
func (h *Handler) handleUpdateCronJob(w http.ResponseWriter, r *http.Request) {
	// Reload from disk to pick up changes made by the gateway process
	_ = h.cronService().Load()

	jobID := r.PathValue("id")

	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		http.Error(w, "Failed to read request body", http.StatusBadRequest)
		return
	}
	defer r.Body.Close()

	var job cron.CronJob
	if err := json.Unmarshal(body, &job); err != nil {
		http.Error(w, fmt.Sprintf("Invalid JSON: %v", err), http.StatusBadRequest)
		return
	}

	job.ID = jobID

	if err := h.cronService().UpdateJob(&job); err != nil {
		http.Error(w, fmt.Sprintf("Failed to update job: %v", err), http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

// handleDeleteCronJob removes a cron job by ID.
//
//	DELETE /oopsclaw/cron/jobs/{id}
func (h *Handler) handleDeleteCronJob(w http.ResponseWriter, r *http.Request) {
	// Reload from disk to pick up changes made by the gateway process
	_ = h.cronService().Load()

	jobID := r.PathValue("id")
	if h.cronService().RemoveJob(jobID) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	} else {
		http.Error(w, "Job not found", http.StatusNotFound)
	}
}

// handleEnableCronJob enables a cron job.
//
//	POST /oopsclaw/cron/jobs/{id}/enable
func (h *Handler) handleEnableCronJob(w http.ResponseWriter, r *http.Request) {
	// Reload from disk to pick up changes made by the gateway process
	_ = h.cronService().Load()

	jobID := r.PathValue("id")
	job := h.cronService().EnableJob(jobID, true)
	if job == nil {
		http.Error(w, "Job not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(job)
}

// handleDisableCronJob disables a cron job.
//
//	POST /oopsclaw/cron/jobs/{id}/disable
func (h *Handler) handleDisableCronJob(w http.ResponseWriter, r *http.Request) {
	// Reload from disk to pick up changes made by the gateway process
	_ = h.cronService().Load()

	jobID := r.PathValue("id")
	job := h.cronService().EnableJob(jobID, false)
	if job == nil {
		http.Error(w, "Job not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(job)
}

// handleListCronHistory returns execution history records.
//
//	GET /oopsclaw/cron/history?job_id=xxx&offset=0&limit=50
func (h *Handler) handleListCronHistory(w http.ResponseWriter, r *http.Request) {
	// Reload history from disk to pick up records written by the gateway process
	h.cronService().History().Load()

	jobID := r.URL.Query().Get("job_id")

	offset := 0
	if offsetStr := r.URL.Query().Get("offset"); offsetStr != "" {
		if parsed, err := strconv.Atoi(offsetStr); err == nil && parsed >= 0 {
			offset = parsed
		}
	}

	limit := 50
	if limitStr := r.URL.Query().Get("limit"); limitStr != "" {
		if parsed, err := strconv.Atoi(limitStr); err == nil && parsed > 0 && parsed <= 200 {
			limit = parsed
		}
	}

	records, total := h.cronService().History().ListRecords(jobID, offset, limit)
	if records == nil {
		records = []cron.ExecutionRecord{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"records": records,
		"total":   total,
		"offset":  offset,
		"limit":   limit,
	})
}

// handleClearCronHistory clears execution history.
//
//	DELETE /oopsclaw/cron/history?job_id=xxx
func (h *Handler) handleClearCronHistory(w http.ResponseWriter, r *http.Request) {
	jobID := r.URL.Query().Get("job_id")
	h.cronService().History().ClearHistory(jobID)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

// handleCronStatus returns the cron service status.
//
//	GET /oopsclaw/cron/status
func (h *Handler) handleCronStatus(w http.ResponseWriter, r *http.Request) {
	// Reload from disk to pick up changes made by the gateway process
	_ = h.cronService().Load()

	status := h.cronService().Status()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(status)
}
