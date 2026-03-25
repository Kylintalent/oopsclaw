package main

import (
	"embed"
	"io/fs"
	"log"
	"mime"
	"net/http"
	"path"
	"strings"
)

//go:embed all:dist
var frontendFS embed.FS

// SPAFallback is a package-level handler function that serves the SPA index.html.
// It is set during registerEmbedRoutes and can be used by API handlers to serve
// the frontend when a browser requests an API path that conflicts with a SPA route.
var SPAFallback http.HandlerFunc

// registerEmbedRoutes sets up the HTTP handler to serve the embedded frontend files
func registerEmbedRoutes(mux *http.ServeMux) {
	// Register correct MIME type for SVG files
	// Go's built-in mime.TypeByExtension returns "image/svg" which is incorrect
	// The correct MIME type per RFC 6838 is "image/svg+xml"
	if err := mime.AddExtensionType(".svg", "image/svg+xml"); err != nil {
		log.Printf("Warning: failed to register SVG MIME type: %v", err)
	}

	// Attempt to get the subdirectory 'dist' where Vite usually builds
	subFS, err := fs.Sub(frontendFS, "dist")
	if err != nil {
		// Log a warning if dist doesn't exist yet (e.g., during development before a frontend build)
		log.Printf(
			"Warning: no 'dist' folder found in embedded frontend. " +
				"Ensure you run `pnpm build:backend` in the frontend directory " +
				"before building the Go backend.",
		)
		return
	}

	fileServer := http.FileServer(http.FS(subFS))

	// serveFrontend handles static file serving and SPA fallback.
	serveFrontend := func(w http.ResponseWriter, r *http.Request, urlPath string) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			http.NotFound(w, r)
			return
		}

		cleanPath := path.Clean(strings.TrimPrefix(urlPath, "/"))
		if cleanPath == "." {
			cleanPath = ""
		}

		// Existing static files/directories should be served directly.
		if cleanPath != "" {
			if _, statErr := fs.Stat(subFS, cleanPath); statErr == nil {
				// Rewrite the request path so the file server finds the file
				rewritten := r.Clone(r.Context())
				rewritten.URL.Path = "/" + cleanPath
				fileServer.ServeHTTP(w, rewritten)
				return
			}
			// Missing asset-like paths should remain 404.
			if strings.Contains(path.Base(cleanPath), ".") {
				rewritten := r.Clone(r.Context())
				rewritten.URL.Path = "/" + cleanPath
				fileServer.ServeHTTP(w, rewritten)
				return
			}
		}

		// SPA fallback: serve index.html
		indexReq := r.Clone(r.Context())
		indexReq.URL.Path = "/"
		fileServer.ServeHTTP(w, indexReq)
	}

	// Set the package-level SPAFallback so API handlers can serve index.html
	// when a browser navigates to a path that conflicts with an API route.
	SPAFallback = func(w http.ResponseWriter, r *http.Request) {
		indexReq := r.Clone(r.Context())
		indexReq.URL.Path = "/"
		fileServer.ServeHTTP(w, indexReq)
	}

	// Serve frontend under /oopsclaw/ prefix (for nginx reverse proxy).
	mux.Handle(
		"/oopsclaw/",
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Strip the /oopsclaw prefix to get the actual resource path
			stripped := strings.TrimPrefix(r.URL.Path, "/oopsclaw")
			if stripped == "" {
				stripped = "/"
			}
			serveFrontend(w, r, stripped)
		}),
	)

	// Also serve frontend at root / for direct access (localhost:18800).
	mux.Handle(
		"/",
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Redirect root to /oopsclaw/ for consistency
			if r.URL.Path == "/" {
				http.Redirect(w, r, "/oopsclaw/", http.StatusFound)
				return
			}
			serveFrontend(w, r, r.URL.Path)
		}),
	)
}
