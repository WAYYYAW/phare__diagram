package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
	_ "time/tzdata"
)

var (
	out  = "analytics.jsonl"
	bind = ":7999"
)

var gifPixel []byte

// writeCh is the async write channel — HTTP handlers drop JSON lines here and
// return immediately. A dedicated goroutine consumes the channel and writes
// single-threaded to the JSONL file, eliminating concurrent-write contention.
var writeCh = make(chan []byte, 4096)

func init() {
	var err error
	gifPixel, err = base64.StdEncoding.DecodeString("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7")
	if err != nil {
		log.Fatalf("failed to decode gif pixel: %v", err)
	}
	go writerLoop()
	log.Printf("writerLoop started, channel capacity=%d", cap(writeCh))
}

// writerLoop is the sole goroutine responsible for writing to the analytics
// file. It drains writeCh and appends every line. A full channel causes the
// HTTP handler to drop the entry (non-blocking send) so a slow disk cannot
// block the HTTP server.
func writerLoop() {
	for line := range writeCh {
		f, err := os.OpenFile(out, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
		if err != nil {
			log.Printf("open file error: %v", err)
			continue
		}
		if _, err := f.Write(line); err != nil {
			log.Printf("write error: %v", err)
		}
		f.Close()
		log.Printf("wrote %d bytes to %s", len(line), out)
	}
}

func main() {
	if v := os.Getenv("ANALYTICS_FILE"); v != "" {
		out = v
	}
	if v := os.Getenv("ANALYTICS_BIND"); v != "" {
		bind = v
	}

	mux := http.NewServeMux()

	// 托管同目录下的 index.html
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" && r.URL.Path != "/index.html" {
			http.NotFound(w, r)
			return
		}
		http.ServeFile(w, r, "index.html")
	})

	mux.HandleFunc("/analytics", handleAnalytics)
	mux.HandleFunc("/analytics/view", handleView)
	mux.HandleFunc("/analytics/dashboard", handleDashboard)
	mux.HandleFunc("/analytics/dashboard.css", func(w http.ResponseWriter, r *http.Request) {
		http.ServeFile(w, r, "analytics.css")
	})
	mux.HandleFunc("/analytics/dashboard.js", func(w http.ResponseWriter, r *http.Request) {
		http.ServeFile(w, r, "analytics.js")
	})
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("ok"))
	})

	srv := &http.Server{
		Addr:         bind,
		Handler:      mux,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 10 * time.Second,
	}

	log.Printf("server listening on %s, serving index.html & writing analytics to %s (async)", bind, out)
	if err := srv.ListenAndServe(); err != nil {
		log.Fatal(err)
	}
}

func handleAnalytics(w http.ResponseWriter, r *http.Request) {
	log.Printf("analytics request: method=%s url=%s remote=%s", r.Method, r.URL.String(), r.RemoteAddr)

	// Return 1x1 transparent GIF for image-beacon (GET) requests; plain OK for
	// navigator.sendBeacon (POST) requests.
	if r.Method == http.MethodGet {
		w.Header().Set("Content-Type", "image/gif")
		w.WriteHeader(http.StatusOK)
		w.Write(gifPixel)
	} else {
		w.WriteHeader(http.StatusOK)
	}

	// Build the payload map from either query string (GET) or request body (POST).
	var payload map[string][]string

	if r.Method == http.MethodPost {
		// navigator.sendBeacon sends text/plain with URL-encoded body, or
		// application/json. Handle both.
		ct := r.Header.Get("Content-Type")
		body, err := io.ReadAll(r.Body)
		r.Body.Close()
		if err != nil {
			return
		}

		if strings.HasPrefix(ct, "application/json") {
			// JSON body — parse into a flat map
			var raw map[string]interface{}
			if err := json.Unmarshal(body, &raw); err != nil {
				return
			}
			payload = make(map[string][]string)
			for k, v := range raw {
				switch vv := v.(type) {
				case string:
					payload[k] = []string{vv}
				case float64:
					payload[k] = []string{strconv.FormatFloat(vv, 'f', -1, 64)}
				default:
					payload[k] = []string{strings.TrimSpace(string(body))}
				}
			}
		} else {
			// text/plain or application/x-www-form-urlencoded
			rawQuery := string(body)
			// ParseQuery returns map[string][]string
			vals, err := parseQueryString(rawQuery)
			if err != nil {
				return
			}
			payload = vals
		}
	} else {
		// GET: use query parameters directly
		payload = r.URL.Query()
	}

	// Try to extract real IP (works behind reverse proxies)
	realIP := r.Header.Get("X-Forwarded-For")
	if realIP == "" {
		realIP = r.Header.Get("X-Real-IP")
	}
	if realIP == "" {
		realIP = r.RemoteAddr
	}

	// Build a server-stamped timestamp, using the client's timezone if provided.
	now := time.Now()
	tsFormat := now.UTC().Format(time.RFC3339)

	if tzStr := paramFirst(payload, "timezone"); tzStr != "" {
		if loc, err := time.LoadLocation(tzStr); err == nil {
			tsFormat = now.In(loc).Format(time.RFC3339)
		} else {
			log.Printf("invalid timezone received: %s, err: %v", tzStr, err)
		}
	}

	// Keep payload values as []string for backward compatibility with the
	// analytics dashboard which expects p.platform[0], p.resolution[0], etc.
	ua := r.UserAgent()
	cleanPayload := make(map[string][]string)
	for k, vals := range payload {
		if k == "userAgent" || k == "ua" {
			continue // captured at top level
		}
		cleanPayload[k] = vals
	}

	entry := map[string]interface{}{
		"ts":      tsFormat,
		"ip":      realIP,
		"ua":      ua,
		"payload": cleanPayload,
	}
	line, err := json.Marshal(entry)
	if err != nil {
		log.Printf("marshal error: %v", err)
		return
	}
	line = append(line, '\n')

	// Non-blocking send into the write channel: if the channel is full the
	// entry is dropped (logged) rather than blocking the HTTP handler.
	select {
	case writeCh <- line:
		log.Printf("write enqueued: %s", string(line[:min(len(line), 120)]))
	default:
		log.Printf("write channel full (%d pending), dropping entry", len(writeCh))
	}
}

// paramFirst returns the first value for key, or "".
func paramFirst(payload map[string][]string, key string) string {
	if vals, ok := payload[key]; ok && len(vals) > 0 {
		return vals[0]
	}
	return ""
}

// parseQueryString is a minimal url.Values-like parser that avoids importing
// net/url just for ParseQuery which we need for POST body text/plain payloads.
func parseQueryString(s string) (map[string][]string, error) {
	m := make(map[string][]string)
	for _, part := range strings.Split(s, "&") {
		if part == "" {
			continue
		}
		kv := strings.SplitN(part, "=", 2)
		key := kv[0]
		var val string
		if len(kv) > 1 {
			val = kv[1]
		}
		m[key] = append(m[key], val)
	}
	return m, nil
}

func handleDashboard(w http.ResponseWriter, r *http.Request) {
	http.ServeFile(w, r, "analytics.html")
}

func handleView(w http.ResponseWriter, r *http.Request) {
	data, err := os.ReadFile(out)
	if err != nil {
		if os.IsNotExist(err) {
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte("[]"))
			return
		}
		http.Error(w, "read error", http.StatusInternalServerError)
		return
	}

	lines := bytes.Split(bytes.TrimRight(data, "\n"), []byte("\n"))
	parts := make([]string, 0, len(lines))
	for _, line := range lines {
		if len(line) > 0 {
			parts = append(parts, string(line))
		}
	}
	w.Header().Set("Content-Type", "application/json")
	// 放开 view 接口的跨域，方便你偶尔在别的终端直接 fetch 这个数据
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Write([]byte("[" + strings.Join(parts, ",") + "]"))
}
