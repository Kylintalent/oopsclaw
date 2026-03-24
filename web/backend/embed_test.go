package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestSPAFallbackUnderOopsclaw(t *testing.T) {
	mux := http.NewServeMux()
	registerEmbedRoutes(mux)

	// Unknown paths under /oopsclaw/ should get SPA fallback (200 with index.html)
	req := httptest.NewRequest(http.MethodGet, "/oopsclaw/some-route", nil)
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rr.Code, http.StatusOK)
	}
}

func TestRootRedirectsToOopsclaw(t *testing.T) {
	mux := http.NewServeMux()
	registerEmbedRoutes(mux)

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusFound {
		t.Fatalf("status = %d, want %d", rr.Code, http.StatusFound)
	}
	if loc := rr.Header().Get("Location"); loc != "/oopsclaw/" {
		t.Fatalf("Location = %q, want /oopsclaw/", loc)
	}
}

func TestMissingAssetStays404(t *testing.T) {
	mux := http.NewServeMux()
	registerEmbedRoutes(mux)

	req := httptest.NewRequest(http.MethodGet, "/assets/not-found.js", nil)
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want %d", rr.Code, http.StatusNotFound)
	}
}
