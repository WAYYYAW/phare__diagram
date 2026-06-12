package main

import (
	"database/sql"
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

	_ "modernc.org/sqlite"
)

var (
	dbPath = "analytics.db"
	bind   = ":7999"
)

var db *sql.DB
var gifPixel []byte

func init() {
	var err error
	gifPixel, err = base64.StdEncoding.DecodeString("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7")
	if err != nil {
		log.Fatalf("failed to decode gif pixel: %v", err)
	}
}

// ---- SQLite Initialization ----

func initDB() error {
	database, err := sql.Open("sqlite", dbPath+"?_journal_mode=WAL&_cache_size=-8000&_busy_timeout=5000")
	if err != nil {
		return err
	}
	db = database

	if err := db.Ping(); err != nil {
		return err
	}

	// Enable WAL mode and foreign keys
	if _, err := db.Exec("PRAGMA journal_mode=WAL"); err != nil {
		return err
	}
	if _, err := db.Exec("PRAGMA synchronous=NORMAL"); err != nil {
		return err
	}

	// Create schema
	schema := `
	CREATE TABLE IF NOT EXISTS analytics (
		id         INTEGER PRIMARY KEY AUTOINCREMENT,
		ts         TEXT    NOT NULL,
		ts_date    TEXT    NOT NULL,
		ip         TEXT    NOT NULL DEFAULT '',
		ua         TEXT    NOT NULL DEFAULT '',
		payload    TEXT    NOT NULL DEFAULT '{}'
	);
	CREATE INDEX IF NOT EXISTS idx_analytics_ts_date ON analytics(ts_date);
	`
	if _, err := db.Exec(schema); err != nil {
		return err
	}

	log.Printf("SQLite database initialized: %s", dbPath)
	return nil
}

// ---- Entry helpers ----

type analyticsEntry struct {
	Ts      string              `json:"ts"`
	Ip      string              `json:"ip"`
	Ua      string              `json:"ua"`
	Payload map[string][]string `json:"payload"`
}

// tsDate extracts YYYY-MM-DD from an RFC3339 timestamp.
func tsDate(ts string) string {
	if len(ts) >= 10 {
		return ts[:10]
	}
	return ts
}

// ---- HTTP Handlers ----

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
		ct := r.Header.Get("Content-Type")
		body, err := io.ReadAll(r.Body)
		r.Body.Close()
		if err != nil {
			return
		}

		if strings.HasPrefix(ct, "application/json") {
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
			rawQuery := string(body)
			vals, err := parseQueryString(rawQuery)
			if err != nil {
				return
			}
			payload = vals
		}
	} else {
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

	ua := r.UserAgent()
	cleanPayload := make(map[string][]string)
	for k, vals := range payload {
		if k == "userAgent" || k == "ua" {
			continue
		}
		cleanPayload[k] = vals
	}

	// Store to SQLite
	payloadJSON, err := json.Marshal(cleanPayload)
	if err != nil {
		log.Printf("marshal payload error: %v", err)
		return
	}

	dateStr := tsDate(tsFormat)

	_, err = db.Exec(
		"INSERT INTO analytics (ts, ts_date, ip, ua, payload) VALUES (?, ?, ?, ?, ?)",
		tsFormat, dateStr, realIP, ua, string(payloadJSON),
	)
	if err != nil {
		log.Printf("db insert error: %v", err)
		return
	}
	log.Printf("analytics stored: ts=%s ip=%s type=%s", tsFormat, realIP, paramFirst(payload, "type"))
}

// ---- Query Handlers ----

// queryRows runs a SELECT query and returns the results as a JSON array.
func queryRows(query string, args ...interface{}) ([]byte, error) {
	rows, err := db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var entries []analyticsEntry
	for rows.Next() {
		var ts, ip, ua, payloadStr string
		if err := rows.Scan(&ts, &ip, &ua, &payloadStr); err != nil {
			log.Printf("row scan error: %v", err)
			continue
		}
		var payload map[string][]string
		if err := json.Unmarshal([]byte(payloadStr), &payload); err != nil {
			payload = map[string][]string{}
		}
		entries = append(entries, analyticsEntry{
			Ts:      ts,
			Ip:      ip,
			Ua:      ua,
			Payload: payload,
		})
	}
	if entries == nil {
		entries = []analyticsEntry{}
	}

	return json.Marshal(entries)
}

// respondJSON writes a JSON response with CORS headers.
func respondJSON(w http.ResponseWriter, data []byte) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Write(data)
}

func handleView(w http.ResponseWriter, r *http.Request) {
	data, err := queryRows("SELECT ts, ip, ua, payload FROM analytics ORDER BY id")
	if err != nil {
		log.Printf("handleView error: %v", err)
		respondJSON(w, []byte("[]"))
		return
	}
	respondJSON(w, data)
}

// handleDayView returns analytics entries for a specific date (YYYY-MM-DD).
//
//	GET /analytics/day?date=2026-06-12
func handleDayView(w http.ResponseWriter, r *http.Request) {
	date := r.URL.Query().Get("date")
	if date == "" {
		http.Error(w, "missing date parameter", http.StatusBadRequest)
		return
	}
	// Validate date format (basic check)
	if len(date) != 10 || date[4] != '-' || date[7] != '-' {
		http.Error(w, "invalid date format, expected YYYY-MM-DD", http.StatusBadRequest)
		return
	}

	data, err := queryRows(
		"SELECT ts, ip, ua, payload FROM analytics WHERE ts_date = ? ORDER BY id",
		date,
	)
	if err != nil {
		log.Printf("handleDayView error: %v", err)
		respondJSON(w, []byte("[]"))
		return
	}
	respondJSON(w, data)
}

// handleSearchView returns analytics entries matching a payload field/value.
//
//	GET /analytics/search?field=type&value=page_view
//
// Uses SQLite's json_extract on the stored JSON payload string.
func handleSearchView(w http.ResponseWriter, r *http.Request) {
	field := r.URL.Query().Get("field")
	value := r.URL.Query().Get("value")
	if field == "" || value == "" {
		http.Error(w, "missing field or value parameter", http.StatusBadRequest)
		return
	}

	// Build a query using json_extract to match the first array element.
	// payload is stored as JSON like {"type":["page_view"],...}
	// json_extract(payload, '$."field"[0]') extracts the first array value.
	query := `SELECT ts, ip, ua, payload FROM analytics WHERE json_extract(payload, ?) = ? ORDER BY id`
	path := "$.\"" + field + "\"[0]"

	data, err := queryRows(query, path, value)
	if err != nil {
		log.Printf("handleSearchView error: %v", err)
		respondJSON(w, []byte("[]"))
		return
	}
	respondJSON(w, data)
}

func handleDashboard(w http.ResponseWriter, r *http.Request) {
	http.ServeFile(w, r, "analytics.html")
}

// ---- Dashboard Data Aggregation ----

// pval returns the first value for key in the payload map, or "".
func pval(payload map[string][]string, key string) string {
	if vals, ok := payload[key]; ok && len(vals) > 0 {
		return vals[0]
	}
	return ""
}

// parseIntSafe parses an int from a string, returning 0 on failure.
func parseIntSafe(s string) int {
	if s == "" {
		return 0
	}
	v, err := strconv.Atoi(s)
	if err != nil {
		return 0
	}
	return v
}

// parseFloatSafe parses a float from a string, returning 0 on failure.
func parseFloatSafe(s string) float64 {
	if s == "" {
		return 0
	}
	v, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return 0
	}
	return v
}

// uaOS returns a concise OS label from a user-agent string.
func uaOS(ua string) string {
	if strings.Contains(ua, "Windows") {
		return "Windows"
	}
	if strings.Contains(ua, "Android") {
		return "Android"
	}
	if strings.Contains(ua, "iPhone") || strings.Contains(ua, "iPad") {
		if strings.Contains(ua, "iPad") {
			return "iPadOS"
		}
		return "iOS"
	}
	if strings.Contains(ua, "Macintosh") || strings.Contains(ua, "Mac OS") {
		return "macOS"
	}
	if strings.Contains(ua, "Linux") {
		return "Linux"
	}
	return "未知"
}

// uaBrowser returns a concise browser label from a user-agent string.
func uaBrowser(ua string) string {
	if strings.Contains(ua, "MicroMessenger") {
		return "微信"
	}
	if strings.Contains(ua, "Edg/") || strings.Contains(ua, "Edge/") {
		return "Edge"
	}
	if strings.Contains(ua, "Firefox/") || strings.Contains(ua, "FxiOS/") {
		return "Firefox"
	}
	if strings.Contains(ua, "CriOS/") || strings.Contains(ua, "Chrome/") {
		return "Chrome"
	}
	if strings.Contains(ua, "Safari/") {
		return "Safari"
	}
	if strings.Contains(ua, "QQ/") || strings.Contains(ua, "QQBrowser") {
		return "QQ"
	}
	return "其他"
}

// uaModel extracts a device model hint from a user-agent string (Android only).
func uaModel(ua string) string {
	idx := strings.Index(ua, "Android")
	if idx < 0 {
		return ""
	}
	after := ua[idx+7:]
	if semi := strings.Index(after, ";"); semi >= 0 {
		after = after[semi+1:]
	}
	after = strings.TrimSpace(after)
	if build := strings.Index(after, " Build"); build >= 0 {
		after = after[:build]
	}
	if paren := strings.Index(after, ")"); paren >= 0 {
		after = after[:paren]
	}
	after = strings.TrimSpace(after)
	if after == "" || after == "K" || after == "Unknown" || after == "Generic" || after == "Android" {
		return ""
	}
	return after
}

// entryType extracts the event type from a payload.
func entryType(payload map[string][]string) string {
	t := pval(payload, "type")
	if t == "" || t == "visit" || t == "page_visit" {
		return "page_view"
	}
	return t
}

// isPageView checks if an entry is a page view.
func isPageView(payload map[string][]string) bool {
	t := entryType(payload)
	return t == "" || t == "page_view"
}

// DashboardStats is the aggregated payload returned by /analytics/stats.
type DashboardStats struct {
	TotalPV         int                  `json:"total_pv"`
	TotalSessions   int                  `json:"total_sessions"`
	TotalIPs        int                  `json:"total_ips"`
	TotalUIDs       int                  `json:"total_uids"`
	BounceRate      string               `json:"bounce_rate"`
	AvgSession      string               `json:"avg_session"`
	AvgFCP          string               `json:"avg_fcp"`
	AvgWasm         string               `json:"avg_wasm"`
	Trend           map[string]int       `json:"trend"`
	OS              map[string]int       `json:"os"`
	Browser         map[string]int       `json:"browser"`
	Resolution      map[string]int       `json:"res"`
	Cores           map[string]int       `json:"cores"`
	Model           map[string]int       `json:"model"`
	Language        map[string]int       `json:"lang"`
	Viewport        map[string]int       `json:"viewport"`
	PixelRatio      map[string]int       `json:"pixel_ratio"`
	Timezone        map[string]int       `json:"timezone"`
	Referrer        map[string]int       `json:"referrer"`
	SessionDurs     []int                `json:"session_durations"`
	FCPVals         []int                `json:"fcp_vals"`
	LCPVals         []int                `json:"lcp_vals"`
	WasmVals        []int                `json:"wasm_vals"`
	WasmDecodeVals  []int                `json:"wasm_decode_vals"`
	WasmCompileVals []int                `json:"wasm_compile_vals"`
	WasmInitVals    []int                `json:"wasm_init_vals"`
	RecentLogs      []DashboardRecentLog `json:"recent_logs"`
	Visitors        []DashboardVisitor   `json:"visitors"`
}

type DashboardRecentLog struct {
	Ts      string `json:"ts"`
	IP      string `json:"ip"`
	OS      string `json:"os"`
	Browser string `json:"browser"`
	FCP     string `json:"fcp"`
}

type DashboardVisitor struct {
	LastSeen string `json:"last_seen"`
	UID      string `json:"uid"`
	IP       string `json:"ip"`
	Device   string `json:"device"`
	Model    string `json:"model"`
	Brand    string `json:"brand"`
	Browser  string `json:"browser"`
	Visits   int    `json:"visits"`
	HBCount  int    `json:"hb_count"`
}

// loadDashboardStats reads all analytics entries and computes aggregated stats.
func loadDashboardStats() *DashboardStats {
	rows, err := db.Query("SELECT ts, ip, ua, payload FROM analytics ORDER BY id")
	if err != nil {
		log.Printf("loadDashboardStats query error: %v", err)
		return nil
	}
	defer rows.Close()

	// Raw entries grouped by type
	type rawEntry struct {
		ts      string
		ip      string
		ua      string
		payload map[string][]string
	}
	var allEntries []rawEntry

	for rows.Next() {
		var ts, ip, ua, payloadStr string
		if err := rows.Scan(&ts, &ip, &ua, &payloadStr); err != nil {
			continue
		}
		var payload map[string][]string
		json.Unmarshal([]byte(payloadStr), &payload)
		if payload == nil {
			payload = map[string][]string{}
		}
		allEntries = append(allEntries, rawEntry{ts, ip, ua, payload})
	}

	if len(allEntries) == 0 {
		return &DashboardStats{
			Trend:      map[string]int{},
			OS:         map[string]int{},
			Browser:    map[string]int{},
			Resolution: map[string]int{},
			Cores:      map[string]int{},
			Model:      map[string]int{},
			Language:   map[string]int{},
			Viewport:   map[string]int{},
			PixelRatio: map[string]int{},
			Timezone:   map[string]int{},
			Referrer:   map[string]int{},
		}
	}

	// Separate entries by type
	type wasmTiming struct {
		total, decode, compile, init int
	}
	type uaHEInfo struct {
		model, brand string
	}

	var pageViews []rawEntry
	var heartbeats []rawEntry
	var unloads []rawEntry
	fcpBySid := make(map[string]int)
	lcpBySid := make(map[string]int)
	wasmBySid := make(map[string]wasmTiming)
	uaheBySid := make(map[string]uaHEInfo)

	for _, e := range allEntries {
		pl := e.payload
		t := entryType(pl)
		switch t {
		case "page_view":
			pageViews = append(pageViews, e)
		case "heartbeat":
			heartbeats = append(heartbeats, e)
		case "page_unload":
			unloads = append(unloads, e)
		}

		sid := pval(pl, "session_id")

		// Perf / web_vitals data can be in separate entries or inline in page_view
		if t == "web_vitals" || t == "perf" || (t == "page_view" && pval(pl, "fcp") != "") {
			fcpStr := pval(pl, "fcp")
			lcpStr := pval(pl, "lcp")
			if fcpStr != "" && sid != "" {
				if v, err := strconv.Atoi(fcpStr); err == nil {
					fcpBySid[sid] = v
				}
			}
			if lcpStr != "" && sid != "" {
				if v, err := strconv.Atoi(lcpStr); err == nil {
					lcpBySid[sid] = v
				}
			}

			// WASM timing
			totalStr := pval(pl, "wasm_total_ms")
			if totalStr != "" && sid != "" {
				if v, err := strconv.Atoi(totalStr); err == nil {
					wt := wasmBySid[sid]
					wt.total = v
					wt.decode, _ = strconv.Atoi(pval(pl, "wasm_decode_ms"))
					wt.compile, _ = strconv.Atoi(pval(pl, "wasm_compile_ms"))
					wt.init, _ = strconv.Atoi(pval(pl, "wasm_init_ms"))
					wasmBySid[sid] = wt
				}
			}
		}

		// UA high-entropy (from ua_he events or perf events)
		if t == "ua_he" || (t == "perf" && pval(pl, "ua_arch") != "") {
			if sid != "" {
				info := uaheBySid[sid]
				if m := pval(pl, "ua_model"); m != "" {
					info.model = m
				}
				if b := pval(pl, "ua_brand"); b != "" {
					info.brand = b
				}
				uaheBySid[sid] = info
			}
		}
	}

	// ---- KPI ----
	totalPV := len(pageViews)
	uidSet := make(map[string]bool)
	ipSet := make(map[string]bool)
	sessionSet := make(map[string]bool)
	pvBySid := make(map[string]int)
	firstView := make(map[string]string)  // sid → first ts
	lastUnload := make(map[string]string) // sid → last unload ts
	hbElapsedBySid := make(map[string][]int)

	for _, e := range allEntries {
		pl := e.payload
		sid := pval(pl, "session_id")
		uid := pval(pl, "uid")

		if uid != "" {
			uidSet[uid] = true
		}
		ipBase := e.ip
		if idx := strings.LastIndex(ipBase, ":"); idx >= 0 {
			ipBase = ipBase[:idx]
		}
		ipSet[ipBase] = true

		t := entryType(pl)

		if sid != "" {
			sessionSet[sid] = true
			if t == "page_view" || t == "visit" {
				pvBySid[sid]++
				if _, ok := firstView[sid]; !ok || e.ts < firstView[sid] {
					// ts is ISO string, string comparison works for chronological order
					if firstView[sid] == "" || e.ts < firstView[sid] {
						firstView[sid] = e.ts
					}
				}
			}
			if t == "page_unload" {
				if lastUnload[sid] == "" || e.ts > lastUnload[sid] {
					lastUnload[sid] = e.ts
				}
			}
			if t == "heartbeat" {
				elapsed := parseIntSafe(pval(pl, "elapsed"))
				if elapsed > 0 && elapsed < 86400 {
					hbElapsedBySid[sid] = append(hbElapsedBySid[sid], elapsed)
				}
			}
		}
	}

	// Bounce rate: sessions with exactly 1 PV
	bounces := 0
	totalSidCount := 0
	for _, pvCount := range pvBySid {
		totalSidCount++
		if pvCount == 1 {
			bounces++
		}
	}
	bounceRate := "-"
	if totalSidCount > 0 {
		bounceRate = strconv.Itoa(bounces*100/totalSidCount) + "%"
	}

	// Session duration: prefer heartbeat elapsed (max), fallback to unload-based
	var sessionDurs []int
	usedHbSids := make(map[string]bool)
	for sid, els := range hbElapsedBySid {
		maxEl := 0
		for _, el := range els {
			if el > maxEl {
				maxEl = el
			}
		}
		if maxEl > 0 && maxEl < 86400 {
			sessionDurs = append(sessionDurs, maxEl)
			usedHbSids[sid] = true
		}
	}
	if len(sessionDurs) == 0 {
		for sid, fts := range firstView {
			if lut, ok := lastUnload[sid]; ok {
				// Parse timestamps for duration calculation
				ft, err1 := time.Parse(time.RFC3339, fts)
				lt, err2 := time.Parse(time.RFC3339, lut)
				if err1 == nil && err2 == nil {
					dur := int(lt.Sub(ft).Seconds())
					if dur > 0 && dur < 86400 {
						sessionDurs = append(sessionDurs, dur)
					}
				}
			}
		}
	}

	avgSession := "-"
	if len(sessionDurs) > 0 {
		sum := 0
		for _, d := range sessionDurs {
			sum += d
		}
		avgSession = strconv.Itoa(sum/len(sessionDurs)) + "s"
	}

	// FCP / Wasm averages
	var fcpVals, lcpVals []int
	for _, v := range fcpBySid {
		fcpVals = append(fcpVals, v)
	}
	for _, v := range lcpBySid {
		lcpVals = append(lcpVals, v)
	}

	var wasmVals, wasmDecodeVals, wasmCompileVals, wasmInitVals []int
	for _, wt := range wasmBySid {
		wasmVals = append(wasmVals, wt.total)
		wasmDecodeVals = append(wasmDecodeVals, wt.decode)
		wasmCompileVals = append(wasmCompileVals, wt.compile)
		wasmInitVals = append(wasmInitVals, wt.init)
	}

	avgFCP := "-"
	if len(fcpVals) > 0 {
		sum := 0
		for _, v := range fcpVals {
			sum += v
		}
		avgFCP = strconv.Itoa(sum/len(fcpVals)) + "ms"
	}

	avgWasm := "-"
	if len(wasmVals) > 0 {
		sum := 0
		for _, v := range wasmVals {
			sum += v
		}
		avgWasm = strconv.Itoa(sum/len(wasmVals)) + "ms"
	}

	// ---- Distribution maps ----
	trend := make(map[string]int)
	osCount := make(map[string]int)
	browserCount := make(map[string]int)
	resCount := make(map[string]int)
	coresCount := make(map[string]int)
	modelCount := make(map[string]int)
	langCount := make(map[string]int)
	viewportCount := make(map[string]int)
	pixelRatioCount := make(map[string]int)
	timezoneCount := make(map[string]int)
	referrerCount := make(map[string]int)

	// UV map
	type uvInfo struct {
		lastSeen string
		ip       string
		device   string
		model    string
		brand    string
		browser  string
		visits   int
		uid      string
		hbCount  int
	}
	uvMap := make(map[string]*uvInfo)

	// Heartbeat count per SID
	hbCountBySid := make(map[string]int)
	for _, e := range heartbeats {
		sid := pval(e.payload, "session_id")
		if sid != "" {
			hbCountBySid[sid]++
		}
	}

	// SID → uvKey mapping
	sidToUVKey := make(map[string]string)
	for _, e := range pageViews {
		sid := pval(e.payload, "session_id")
		if sid == "" {
			continue
		}
		ipBase := e.ip
		if idx := strings.LastIndex(ipBase, ":"); idx >= 0 {
			ipBase = ipBase[:idx]
		}
		osLbl := uaOS(e.ua)
		key := sid + "|" + ipBase + "|" + osLbl
		sidToUVKey[sid] = key
	}

	// Process page views for distribution
	for _, e := range pageViews {
		pl := e.payload
		sid := pval(pl, "session_id")
		uid := pval(pl, "uid")

		// Trend: use date from ts (first 10 chars for YYYY-MM-DD, but dashboard uses locale format)
		// For the trend chart, the dashboard uses Date.toLocaleDateString('zh-CN') which
		// produces "2026/6/12". We'll use the raw date and let the dashboard format it.
		dateStr := ""
		if len(e.ts) >= 10 {
			dateStr = e.ts[:10]
		}
		if dateStr != "" {
			trend[dateStr]++
		}

		osLbl := uaOS(e.ua)
		browserLbl := uaBrowser(e.ua)

		osCount[osLbl]++
		browserCount[browserLbl]++

		// Model from UA high-entropy, fallback to UA string
		model := ""
		if sid != "" {
			if info, ok := uaheBySid[sid]; ok && info.model != "" {
				model = info.model
			}
		}
		if model == "" {
			model = uaModel(e.ua)
		}
		if model != "" {
			modelCount[model]++
		}

		lang := pval(pl, "language")
		if lang != "" {
			langCount[lang]++
		} else {
			langCount["未知"]++
		}

		ref := pval(pl, "referrer")
		if ref == "" || ref == "direct" {
			ref = "直接访问"
		}
		referrerCount[ref]++

		res := pval(pl, "resolution")
		if res != "" {
			resCount[res]++
		}
		viewport := pval(pl, "viewport")
		if viewport != "" {
			viewportCount[viewport]++
		}
		pr := pval(pl, "pixelRatio")
		if pr != "" {
			pixelRatioCount["×"+pr]++
		}
		tz := pval(pl, "timezone")
		if tz != "" {
			timezoneCount[tz]++
		}
		cores := pval(pl, "cores")
		if cores != "" {
			coresCount[cores+" 核"]++
		}

		// Build UV map
		ipBase := e.ip
		if idx := strings.LastIndex(ipBase, ":"); idx >= 0 {
			ipBase = ipBase[:idx]
		}
		uvKey := sid
		if uvKey == "" {
			uvKey = ipBase + "|" + osLbl
		}

		brand := ""
		if sid != "" {
			if info, ok := uaheBySid[sid]; ok {
				brand = info.brand
			}
		}
		device := osLbl
		if model != "" {
			device = osLbl + " " + model
		}

		if existing, ok := uvMap[uvKey]; ok {
			existing.visits++
			if e.ts > existing.lastSeen {
				existing.lastSeen = e.ts
				existing.browser = browserLbl
				existing.device = device
				existing.model = model
				existing.brand = brand
			}
		} else {
			uvMap[uvKey] = &uvInfo{
				lastSeen: e.ts,
				ip:       ipBase,
				device:   device,
				model:    model,
				brand:    brand,
				browser:  browserLbl,
				visits:   1,
				uid:      uid,
			}
		}
	}

	// Apply heartbeat counts to UV map
	for sid, cnt := range hbCountBySid {
		if key, ok := sidToUVKey[sid]; ok {
			if uv, ok := uvMap[key]; ok {
				uv.hbCount = cnt
			}
		}
	}

	// Build recent logs (latest 20 page views)
	var recentLogs []DashboardRecentLog
	start := 0
	if len(pageViews) > 20 {
		start = len(pageViews) - 20
	}
	for _, e := range pageViews[start:] {
		sid := pval(e.payload, "session_id")
		fcpStr := "-"
		if sid != "" {
			if v, ok := fcpBySid[sid]; ok {
				fcpStr = strconv.Itoa(v) + "ms"
			}
		}
		recentLogs = append(recentLogs, DashboardRecentLog{
			Ts: e.ts,
			IP: e.ip[:strings.LastIndex(e.ip, ":")],
			OS: func() string {
				m := uaModel(e.ua)
				if m == "" {
					return uaOS(e.ua)
				}
				return uaOS(e.ua) + " " + m
			}(),
			Browser: uaBrowser(e.ua),
			FCP:     fcpStr,
		})
	}

	// Build visitors list
	var visitors []DashboardVisitor
	for _, uv := range uvMap {
		modelInfo := uv.model
		if uv.brand != "" && uv.brand != uv.model {
			modelInfo = uv.brand + " " + uv.model
		}
		uidShort := ""
		if len(uv.uid) > 8 {
			uidShort = uv.uid[:8] + "…"
		} else {
			uidShort = uv.uid
		}
		visitors = append(visitors, DashboardVisitor{
			LastSeen: uv.lastSeen,
			UID:      uidShort,
			IP:       uv.ip,
			Device:   uv.device,
			Model:    modelInfo,
			Brand:    uv.brand,
			Browser:  uv.browser,
			Visits:   uv.visits,
			HBCount:  uv.hbCount,
		})
	}
	// Sort visitors by lastSeen descending
	for i := 0; i < len(visitors); i++ {
		for j := i + 1; j < len(visitors); j++ {
			if visitors[j].LastSeen > visitors[i].LastSeen {
				visitors[i], visitors[j] = visitors[j], visitors[i]
			}
		}
	}

	return &DashboardStats{
		TotalPV:         totalPV,
		TotalSessions:   len(sessionSet),
		TotalIPs:        len(ipSet),
		TotalUIDs:       len(uidSet),
		BounceRate:      bounceRate,
		AvgSession:      avgSession,
		AvgFCP:          avgFCP,
		AvgWasm:         avgWasm,
		Trend:           trend,
		OS:              osCount,
		Browser:         browserCount,
		Resolution:      resCount,
		Cores:           coresCount,
		Model:           modelCount,
		Language:        langCount,
		Viewport:        viewportCount,
		PixelRatio:      pixelRatioCount,
		Timezone:        timezoneCount,
		Referrer:        referrerCount,
		SessionDurs:     sessionDurs,
		FCPVals:         fcpVals,
		LCPVals:         lcpVals,
		WasmVals:        wasmVals,
		WasmDecodeVals:  wasmDecodeVals,
		WasmCompileVals: wasmCompileVals,
		WasmInitVals:    wasmInitVals,
		RecentLogs:      recentLogs,
		Visitors:        visitors,
	}
}

func handleDashboardStats(w http.ResponseWriter, r *http.Request) {
	stats := loadDashboardStats()
	if stats == nil {
		respondJSON(w, []byte("{}"))
		return
	}
	data, err := json.Marshal(stats)
	if err != nil {
		log.Printf("handleDashboardStats marshal error: %v", err)
		respondJSON(w, []byte("{}"))
		return
	}
	respondJSON(w, data)
}

// ---- Utility ----

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

func main() {
	if v := os.Getenv("ANALYTICS_DB"); v != "" {
		dbPath = v
	}
	if v := os.Getenv("ANALYTICS_BIND"); v != "" {
		bind = v
	}

	if err := initDB(); err != nil {
		log.Fatalf("failed to initialize database: %v", err)
	}

	mux := http.NewServeMux()

	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" && r.URL.Path != "/index.html" {
			http.NotFound(w, r)
			return
		}
		http.ServeFile(w, r, "index.html")
	})

	mux.HandleFunc("/analytics", handleAnalytics)
	mux.HandleFunc("/analytics/view", handleView)
	mux.HandleFunc("/analytics/day", handleDayView)
	mux.HandleFunc("/analytics/search", handleSearchView)
	mux.HandleFunc("/analytics/stats", handleDashboardStats)
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

	log.Printf("server listening on %s, database: %s", bind, dbPath)
	if err := srv.ListenAndServe(); err != nil {
		log.Fatal(err)
	}
}
