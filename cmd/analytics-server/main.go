package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
	_ "time/tzdata"
)

var (
	mu   sync.Mutex
	out  = "analytics.jsonl"
	bind = ":7999"
)

var gifPixel []byte

func init() {
	gifPixel, _ = base64.StdEncoding.DecodeString("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7")
}

func main() {
	if v := os.Getenv("ANALYTICS_FILE"); v != "" {
		out = v
	}
	if v := os.Getenv("ANALYTICS_BIND"); v != "" {
		bind = v
	}

	mux := http.NewServeMux()

	//托管同目录下的 index.html
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" && r.URL.Path != "/index.html" {
			http.NotFound(w, r)
			return
		}
		http.ServeFile(w, r, "index.html")
	})

	mux.HandleFunc("/analytics", handleAnalytics)
	mux.HandleFunc("/analytics/view", handleView)
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

	log.Printf("server listening on %s, serving index.html & writing analytics to %s", bind, out)
	if err := srv.ListenAndServe(); err != nil {
		log.Fatal(err)
	}
}

func handleAnalytics(w http.ResponseWriter, r *http.Request) {
	// 返回 1x1 透明 GIF
	w.Header().Set("Content-Type", "image/gif")
	w.WriteHeader(http.StatusOK)
	w.Write(gifPixel)

	if r.Method != http.MethodGet {
		return
	}

	// 尝试从请求头提取更准确的真实 IP (应对反向代理场景)
	realIP := r.Header.Get("X-Forwarded-For")
	if realIP == "" {
		realIP = r.Header.Get("X-Real-IP")
	}
	if realIP == "" {
		realIP = r.RemoteAddr
	}

	// 动态处理前端传来的时区
	now := time.Now()
	tsFormat := now.UTC().Format(time.RFC3339) // 默认回退为 UTC

	if tzStr := r.URL.Query().Get("timezone"); tzStr != "" {
		if loc, err := time.LoadLocation(tzStr); err == nil {
			tsFormat = now.In(loc).Format(time.RFC3339)
		} else {
			// 如果前端传了乱七八糟的时区导致解析失败，打印个日志，时间依然走默认的 UTC
			log.Printf("invalid timezone received: %s, err: %v", tzStr, err)
		}
	}

	entry := map[string]interface{}{
		"ts":      tsFormat, // 使用处理过带有时区信息的格式化时间
		"ip":      realIP,
		"ua":      r.UserAgent(),
		"payload": r.URL.Query(),
	}
	line, _ := json.Marshal(entry)
	line = append(line, '\n')

	mu.Lock()
	defer mu.Unlock()
	f, err := os.OpenFile(out, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		log.Printf("open file error: %v", err)
		return
	}
	defer f.Close()
	if _, err := f.Write(line); err != nil {
		log.Printf("write error: %v", err)
	}
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
