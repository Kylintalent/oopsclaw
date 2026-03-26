package cron

import (
	"encoding/json"
	"log"
	"os"
	"path/filepath"
	"sync"

	"github.com/sipeed/picoclaw/pkg/fileutil"
)

// ExecutionRecord represents a single execution of a cron job.
type ExecutionRecord struct {
	ID         string `json:"id"`
	JobID      string `json:"jobId"`
	JobName    string `json:"jobName"`
	StartAtMS  int64  `json:"startAtMs"`
	EndAtMS    int64  `json:"endAtMs"`
	DurationMS int64  `json:"durationMs"`
	Status     string `json:"status"`
	Error      string `json:"error,omitempty"`
}

// HistoryStore persists execution records to disk.
type HistoryStore struct {
	Records []ExecutionRecord `json:"records"`
}

// HistoryService manages cron job execution history with a capped ring buffer.
type HistoryService struct {
	storePath  string
	maxRecords int
	store      *HistoryStore
	mu         sync.RWMutex
}

// NewHistoryService creates a HistoryService that persists records alongside the job store.
func NewHistoryService(cronStorePath string, maxRecords int) *HistoryService {
	if maxRecords <= 0 {
		maxRecords = 200
	}
	historyPath := filepath.Join(filepath.Dir(cronStorePath), "history.json")
	service := &HistoryService{
		storePath:  historyPath,
		maxRecords: maxRecords,
		store:      &HistoryStore{Records: []ExecutionRecord{}},
	}
	service.load()
	return service
}

// Load reloads the history store from disk, picking up records written by other processes.
func (hs *HistoryService) Load() {
	hs.mu.Lock()
	defer hs.mu.Unlock()
	hs.load()
}

func (hs *HistoryService) load() {
	data, err := os.ReadFile(hs.storePath)
	if err != nil {
		if !os.IsNotExist(err) {
			log.Printf("[cron-history] failed to load history: %v", err)
		}
		return
	}
	if err := json.Unmarshal(data, hs.store); err != nil {
		log.Printf("[cron-history] failed to parse history: %v", err)
		hs.store = &HistoryStore{Records: []ExecutionRecord{}}
	}
}

func (hs *HistoryService) save() error {
	data, err := json.MarshalIndent(hs.store, "", "  ")
	if err != nil {
		return err
	}
	return fileutil.WriteFileAtomic(hs.storePath, data, 0o600)
}

// AddRecord appends an execution record, evicting the oldest when the cap is reached.
func (hs *HistoryService) AddRecord(record ExecutionRecord) {
	hs.mu.Lock()
	defer hs.mu.Unlock()

	hs.store.Records = append(hs.store.Records, record)

	if len(hs.store.Records) > hs.maxRecords {
		excess := len(hs.store.Records) - hs.maxRecords
		hs.store.Records = hs.store.Records[excess:]
	}

	if err := hs.save(); err != nil {
		log.Printf("[cron-history] failed to save history: %v", err)
	}
}

// ListRecords returns execution records, optionally filtered by job ID.
// Records are returned in reverse chronological order (newest first).
func (hs *HistoryService) ListRecords(jobID string, offset, limit int) ([]ExecutionRecord, int) {
	hs.mu.RLock()
	defer hs.mu.RUnlock()

	var filtered []ExecutionRecord
	if jobID == "" {
		filtered = hs.store.Records
	} else {
		for _, record := range hs.store.Records {
			if record.JobID == jobID {
				filtered = append(filtered, record)
			}
		}
	}

	total := len(filtered)

	// Reverse to newest-first order
	reversed := make([]ExecutionRecord, total)
	for i, record := range filtered {
		reversed[total-1-i] = record
	}

	if offset >= total {
		return []ExecutionRecord{}, total
	}

	end := offset + limit
	if end > total {
		end = total
	}

	return reversed[offset:end], total
}

// ClearHistory removes all execution records for a specific job, or all records if jobID is empty.
func (hs *HistoryService) ClearHistory(jobID string) {
	hs.mu.Lock()
	defer hs.mu.Unlock()

	if jobID == "" {
		hs.store.Records = []ExecutionRecord{}
	} else {
		var kept []ExecutionRecord
		for _, record := range hs.store.Records {
			if record.JobID != jobID {
				kept = append(kept, record)
			}
		}
		hs.store.Records = kept
	}

	if err := hs.save(); err != nil {
		log.Printf("[cron-history] failed to save history after clear: %v", err)
	}
}
