const API_URL = 'http://127.0.0.1:7999/analytics/view';
const AUTO_REFRESH_S = 30;
let rawData = [];
let refreshTimer = null;
let countdown = AUTO_REFRESH_S;
let logFilterType = '';
let rawModalOpen = false;

function setLogFilter(type) {
    logFilterType = type;
    document.querySelectorAll('.log-filter').forEach(function(b) {
        b.classList.toggle('active', b.getAttribute('data-type') === type);
    });
    var label = document.getElementById('log-type-label');
    if (label) label.textContent = type ? type : '全部';
    processData();
}

function showRawData(entry) {
    var title = entryType(entry);
    if (!title) title = 'page_view';
    title += ' @ ' + new Date(entry.ts).toLocaleString('zh-CN');
    if (entry.ip) title += ' | ' + entry.ip.split(':')[0];
    document.getElementById('modalTitle').textContent = title;
    document.getElementById('modalBody').textContent = JSON.stringify(entry, null, 2);
    document.getElementById('rawModal').classList.add('open');
    rawModalOpen = true;
}

function closeRawModal(e) {
    if (e && e.target !== e.currentTarget) return;
    document.getElementById('rawModal').classList.remove('open');
    rawModalOpen = false;
}
document.addEventListener('keydown', function(e) { if (e.key === 'Escape' && rawModalOpen) closeRawModal(); });

const mockData = [
    // First session: full probe set + heartbeats + unload
    {"ip":"223.160.165.158:39046","payload":{"uid":["mock-uid-1"],"session_id":["mock-s1"],"type":["page_view"],"platform":["Linux aarch64"],"cores":["8"],"resolution":["1080x2400"]},"ts":"2026-06-09T17:42:22+08:00","ua":"Mozilla/5.0 (Linux; Android 16; PJF110 Build/BP4A.251205.006) AppleWebKit/537.36"},
    {"ip":"223.160.165.158:39046","payload":{"uid":["mock-uid-1"],"session_id":["mock-s1"],"type":["ua_he"],"ua_model":["PJF110"],"ua_brand":["OnePlus"]},"ts":"2026-06-09T17:42:23+08:00","ua":"Mozilla/5.0 (Linux; Android 16)"},
    {"ip":"223.160.165.158:39046","payload":{"uid":["mock-uid-1"],"session_id":["mock-s1"],"type":["heartbeat"],"seq":["1"],"elapsed":["0"]},"ts":"2026-06-09T17:42:23+08:00","ua":"Mozilla/5.0 (Linux; Android 16)"},
    {"ip":"223.160.165.158:39046","payload":{"uid":["mock-uid-1"],"session_id":["mock-s1"],"type":["heartbeat"],"seq":["2"],"elapsed":["62"]},"ts":"2026-06-09T17:43:25+08:00","ua":"Mozilla/5.0 (Linux; Android 16)"},
    {"ip":"223.160.165.158:39046","payload":{"uid":["mock-uid-1"],"session_id":["mock-s1"],"type":["web_vitals"],"fcp":["310"],"lcp":["890"]},"ts":"2026-06-09T17:42:23+08:00","ua":"Mozilla/5.0"},
    {"ip":"223.160.165.158:39046","payload":{"uid":["mock-uid-1"],"session_id":["mock-s1"],"type":["wasm_timing"],"wasm_total_ms":["245"],"wasm_decode_ms":["80"],"wasm_compile_ms":["150"],"wasm_init_ms":["15"]},"ts":"2026-06-09T17:42:23+08:00","ua":"Mozilla/5.0"},
    {"ip":"223.160.165.158:39046","payload":{"uid":["mock-uid-1"],"session_id":["mock-s1"],"type":["page_unload"],"elapsed":["125"],"url":["http://test"]},"ts":"2026-06-09T17:44:25+08:00","ua":"Mozilla/5.0"},
    // Second visit: same uid, new session_id, lightweight (throttled)
    {"ip":"112.33.44.55:8080","payload":{"uid":["mock-uid-1"],"session_id":["mock-s2"],"type":["page_view"],"language":["zh-CN"]},"ts": new Date(Date.now() - 3600000).toISOString(),"ua":"Mozilla/5.0 (Linux; Android 16)"},
    // Third session: different uid
    {"ip":"120.22.33.44:443","payload":{"uid":["mock-uid-2"],"session_id":["mock-s3"],"type":["page_view"],"platform":["Windows"],"resolution":["1920x1080"],"cores":["12"],"language":["en-US"]},"ts": new Date(Date.now() - 86400000 * 2).toISOString(),"ua":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0"}
];

// --- Data helpers ---

function pval(p, key) {
    return (p && p[key] && p[key].length > 0) ? p[key][0] : null;
}

function entryType(item) {
    return pval(item.payload, 'type') || '';
}

function isPageView(item) {
    var t = entryType(item);
    return t === '' || t === 'page_view';
}

function getEnrichments() {
    var webVitals = [];
    var wasmTiming = [];
    rawData.forEach(function(item) {
        var t = entryType(item);
        var p = item.payload || {};
        var sid = pval(p, 'session_id');
        if (t === 'web_vitals') {
            webVitals.push({ fcp: parseInt(pval(p, 'fcp')), lcp: parseInt(pval(p, 'lcp')), sid: sid });
        } else if (t === 'wasm_timing') {
            wasmTiming.push({
                total: parseInt(pval(p, 'wasm_total_ms')),
                decode: parseInt(pval(p, 'wasm_decode_ms')),
                compile: parseInt(pval(p, 'wasm_compile_ms')),
                init: parseInt(pval(p, 'wasm_init_ms')),
                sid: sid
            });
        } else if (t === 'page_view' && (pval(p, 'fcp') || pval(p, 'wasm_total_ms'))) {
            // Consolidated format: vitals and wasm timing are inline
            if (pval(p, 'fcp')) {
                webVitals.push({ fcp: parseInt(pval(p, 'fcp')), lcp: parseInt(pval(p, 'lcp')), sid: sid });
            }
            if (pval(p, 'wasm_total_ms')) {
                wasmTiming.push({
                    total: parseInt(pval(p, 'wasm_total_ms')),
                    decode: parseInt(pval(p, 'wasm_decode_ms')),
                    compile: parseInt(pval(p, 'wasm_compile_ms')),
                    init: parseInt(pval(p, 'wasm_init_ms')),
                    sid: sid
                });
            }
        } else if (t === 'perf') {
            // Merged perf probe: vitals + wasm + ua_he all in one
            if (pval(p, 'fcp') || pval(p, 'lcp')) {
                webVitals.push({ fcp: parseInt(pval(p, 'fcp')), lcp: parseInt(pval(p, 'lcp')), sid: sid });
            }
            if (pval(p, 'wasm_total_ms')) {
                wasmTiming.push({
                    total: parseInt(pval(p, 'wasm_total_ms')),
                    decode: parseInt(pval(p, 'wasm_decode_ms')),
                    compile: parseInt(pval(p, 'wasm_compile_ms')),
                    init: parseInt(pval(p, 'wasm_init_ms')),
                    sid: sid
                });
            }
        }
    });
    return { webVitals: webVitals, wasmTiming: wasmTiming };
}

// Build a session→FCP lookup from enrichment data
function buildPerfLookup(enrichments) {
    var fcpBySid = {};
    var lcpBySid = {};
    var wasmBySid = {};
    enrichments.webVitals.forEach(function(v) {
if (v.sid) {
    if (v.fcp && !isNaN(v.fcp)) fcpBySid[v.sid] = v.fcp;
    if (v.lcp && !isNaN(v.lcp)) lcpBySid[v.sid] = v.lcp;
}
    });
    enrichments.wasmTiming.forEach(function(w) {
if (w.sid && w.total && !isNaN(w.total)) wasmBySid[w.sid] = w.total;
    });
    return { fcpBySid: fcpBySid, lcpBySid: lcpBySid, wasmBySid: wasmBySid };
}

// Build a session→UA details lookup from ua_he or perf entries
function buildUaHeLookup() {
    var bySid = {};
    var byUid = {};
    rawData.forEach(function(item) {
var t = entryType(item);
if (t !== 'ua_he' && t !== 'perf') return;
var p = item.payload || {};
var sid = pval(p, 'session_id');
var uid = pval(p, 'uid');
// Skip perf entries without UA fields
if (t === 'perf' && !pval(p, 'ua_model') && !pval(p, 'ua_brand')) return;
var info = {};
if (pval(p, 'ua_model')) info.model = pval(p, 'ua_model');
if (pval(p, 'ua_brand')) info.brand = pval(p, 'ua_brand');
if (pval(p, 'ua_brand_ver')) info.brandVer = pval(p, 'ua_brand_ver');
if (pval(p, 'ua_arch')) info.arch = pval(p, 'ua_arch');
if (pval(p, 'ua_plat_ver')) info.platVer = pval(p, 'ua_plat_ver');
if (pval(p, 'ua_bit')) info.bits = pval(p, 'ua_bit');
if (sid) bySid[sid] = info;
if (uid) byUid[uid] = info;
    });
    return { bySid: bySid, byUid: byUid };
}

// Calculate session duration: prefer heartbeat elapsed, fallback to unload-based
function buildSessionDuration() {
    var hbBySid = {};    // sid → [elapsed, ...]
    var firstView = {};  // sid → first page_view timestamp (ms)
    var lastUnload = {}; // sid → last page_unload timestamp (ms)

    rawData.forEach(function(item) {
var t = entryType(item);
var sid = pval(item.payload, 'session_id');
if (!sid) return;
var ts = new Date(item.ts).getTime();
if (isNaN(ts)) return;

if (t === 'page_view') {
    if (!firstView[sid] || ts < firstView[sid]) firstView[sid] = ts;
} else if (t === 'page_unload') {
    if (!lastUnload[sid] || ts > lastUnload[sid]) lastUnload[sid] = ts;
} else if (t === 'heartbeat') {
    var el = parseInt(pval(item.payload, 'elapsed'));
    if (el && el > 0 && el < 86400) {
        if (!hbBySid[sid]) hbBySid[sid] = [];
        hbBySid[sid].push(el);
    }
}
    });

    var durations = [];
    // Prefer heartbeat (more accurate active usage)
    for (var sid in hbBySid) {
var maxEl = Math.max.apply(null, hbBySid[sid]);
if (maxEl > 0 && maxEl < 86400) durations.push(maxEl);
    }
    // Fallback: unload-based for sessions without heartbeat
    if (durations.length === 0) {
for (var sid in firstView) {
    if (lastUnload[sid]) {
        var dur = Math.round((lastUnload[sid] - firstView[sid]) / 1000);
        if (dur > 0 && dur < 86400) durations.push(dur);
    }
}
    }
    return durations;
}

// --- Fetch ---

// Normalise — promote inline vitals/wasm fields so
// getEnrichments can pick them up from page_view entries.
function normaliseEntry(item) {
    if (!item || !item.payload) return item;
    var p = item.payload;

    // Canonicalise type
    if (p.type) {
        if (p.type[0] === 'visit' || p.type[0] === 'page_visit') p.type[0] = 'page_view';
    } else if (p.typePage) {
        p.type = ['page_view'];
    }

    // Inline vitals/wasm: promote to top-level payload fields
    // (getEnrichments will pick them up when it reads fcp/lcp/wasm_total_ms)
    if (p.wasm_t !== undefined)     p.wasm_total_ms    = p.wasm_t;
    if (p.wasm_d !== undefined)     p.wasm_decode_ms   = p.wasm_d;
    if (p.wasm_c !== undefined)     p.wasm_compile_ms  = p.wasm_c;
    if (p.wasm_i !== undefined)     p.wasm_init_ms     = p.wasm_i;

    return item;
}

async function fetchData() {
    try {
        const response = await fetch(API_URL);
        if (!response.ok) throw new Error("HTTP " + response.status);
        rawData = (await response.json()).map(normaliseEntry);
        processData();
        document.getElementById('last-update-card') && (document.getElementById('last-update-card').innerText = new Date().toLocaleTimeString('zh-CN'));
    } catch (error) {
        console.warn("接口请求失败，使用模拟数据:", error);
        rawData = mockData;
        processData();
    }
    resetCountdown();
}

function resetCountdown() {
    countdown = AUTO_REFRESH_S;
    updateCountdown();
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(function() {
        countdown--;
        updateCountdown();
        if (countdown <= 0) { fetchData(); }
    }, 1000);
}

function updateCountdown() {
    var el = document.getElementById('refresh-countdown');
    if (el) el.innerText = countdown + 's 后自动刷新';
}

// --- UA 解析 ---

function getDeviceModel(ua) {
    if (!ua) return null;
    const m = ua.match(/Android[^;]*;\s*([^;)]+?)(?:\s+Build|\))/i);
    if (m && m[1]) {
        const model = m[1].trim();
        if (model && !['K', 'Unknown', 'Generic', 'Android'].includes(model) && model.length > 1) return model;
    }
    return null;
}

function getOSCategory(ua, platform) {
    ua = ua || ''; platform = platform || '';
    if (ua.includes('Windows') || /^Win/i.test(platform)) return 'Windows';
    if (platform === 'iPhone' || platform === 'iPad') return platform === 'iPad' ? 'iPadOS' : 'iOS';
    if (ua.includes('iPhone')) return 'iOS';
    if (ua.includes('iPad')) return 'iPadOS';
    if (ua.includes('Android') || ua.toLowerCase().includes('android')) return 'Android';
    if (ua.includes('OpenHarmony')) return 'OpenHarmony';
    if (platform.includes('Mac') && !ua.includes('Macintosh')) return 'iOS / iPadOS';
    if (platform.includes('Mac') || ua.includes('Macintosh')) return 'macOS';
    if (ua.includes('X11') || platform.includes('Linux')) return 'Linux';
    return platform || '未知';
}

function getOSDetail(ua, platform) {
    ua = ua || ''; platform = platform || '';
    if (ua.includes('Android')) {
        const ver = (ua.match(/Android\s*([\d.]+)/i) || [])[1] || '';
        const model = getDeviceModel(ua);
        if (model && ver) return `Android ${ver} (${model})`;
        if (ver) return `Android ${ver}`;
        return 'Android';
    }
    if (ua.includes('iPhone') || platform === 'iPhone') {
        const ver = (ua.match(/iPhone\s*OS\s*([\d_]+)/i) || [])[1];
        return ver ? `iOS ${ver.replace(/_/g, '.')}` : 'iOS';
    }
    if (ua.includes('iPad') || platform === 'iPad') {
        const ver = (ua.match(/CPU\s*(?:OS|iPhone\s*OS)\s*([\d_]+)/i) || [])[1];
        return ver ? `iPadOS ${ver.replace(/_/g, '.')}` : 'iPadOS';
    }
    if (ua.includes('OpenHarmony')) {
        const ver = (ua.match(/OpenHarmony\s*([\d.]+)/) || [])[1];
        return ver ? `OpenHarmony ${ver}` : 'OpenHarmony';
    }
    if (ua.includes('Windows NT 10.0')) return 'Windows 10/11';
    if (ua.includes('Windows NT 6.1'))  return 'Windows 7';
    if (ua.includes('Windows NT 6.3'))  return 'Windows 8.1';
    if (/^Win/i.test(platform)) return 'Windows';
    if (platform.includes('Mac') || ua.includes('Macintosh')) {
        if (ua.includes('iPhone') || ua.includes('iPad') || platform === 'iPhone' || platform === 'iPad')
            return getOSDetail(ua, platform === 'iPhone' ? 'iPhone' : 'iPad');
        const ver = (ua.match(/Mac OS X\s*([\d_]+)/) || [])[1];
        return ver ? `macOS ${ver.replace(/_/g, '.')}` : 'macOS';
    }
    if (platform.includes('Linux')) {
        if (platform === 'Linux x86_64') return 'Linux (x86_64)';
        if (platform === 'Linux aarch64' || platform === 'Linux armv81') return 'Linux (ARM)';
        return platform;
    }
    return platform || '未知';
}

function getBrowser(ua) {
    if (!ua) return "未知";
    if (ua.includes("MicroMessenger")) return "微信";
    if (ua.includes("MQQBrowser"))   return "QQ 浏览器";
    if (/QQ\//i.test(ua) || ua.includes("QQBrowser")) return "QQ 浏览器";
    if (ua.includes("Quark/"))       return "夸克";
    if (ua.includes("VivoBrowser"))  return "vivo 浏览器";
    if (ua.includes("HeyTapBrowser")) return "欢太浏览器";
    if (ua.includes("SLBrowser"))    return "搜狗浏览器";
    if (ua.includes("UCBrowser") || ua.includes("UBrowser")) return "UC 浏览器";
    if (ua.includes("XiaoMi/MiuiBrowser") || ua.includes("MiuiBrowser")) return "小米浏览器";
    if (ua.includes("Edg/") || ua.includes("Edge/")) return "Edge";
    if (ua.includes("Firefox/") || ua.includes("FxiOS/")) return "Firefox";
    if (ua.includes("CriOS/"))       return "Chrome";
    if (ua.includes("Chrome/"))      return "Chrome";
    if (ua.includes("Safari/"))      return "Safari";
    return "其他";
}

// --- Process ---

function processData() {
    if (rawData.length === 0) return;

    const pageViews = rawData.filter(isPageView);
    const enrichments = getEnrichments();
    const perf = buildPerfLookup(enrichments);
    const uaHe = buildUaHeLookup();
    const sessionDurations = buildSessionDuration();

    // --- KPI ---
    document.getElementById('total-pv').innerText = pageViews.length;

    const sessionSet = new Set();
    pageViews.forEach(function(item) {
        var sid = pval(item.payload, 'session_id');
        if (sid) sessionSet.add(sid);
    });
    var totalSessions = sessionSet.size || pageViews.length;
    document.getElementById('total-sessions').innerText = totalSessions;

    const uniqueIPs = new Set(pageViews.map(function(item) { return item.ip.split(':')[0]; }));
    document.getElementById('total-ip').innerText = uniqueIPs.size;

    // Unique UIDs
    const uidSet = new Set();
    rawData.forEach(function(item) {
        var u = pval(item.payload, 'uid');
        if (u) uidSet.add(u);
    });
    document.getElementById('total-uid').innerText = uidSet.size || '-';

    // Bounce rate: sessions with only 1 PV
    var pvBySid = {};
    pageViews.forEach(function(item) {
        var sid = pval(item.payload, 'session_id');
        if (sid) pvBySid[sid] = (pvBySid[sid] || 0) + 1;
    });
    var bounces = 0, totalSid = 0;
    for (var sid in pvBySid) { totalSid++; if (pvBySid[sid] === 1) bounces++; }
    var bounceRate = totalSid > 0 ? Math.round(bounces / totalSid * 100) + '%' : '-';
    document.getElementById('bounce-rate').innerText = bounceRate;

    // Avg session duration
    var avgDur = sessionDurations.length > 0
        ? Math.round(sessionDurations.reduce(function(a,b){return a+b;},0) / sessionDurations.length) + 's'
        : '-';
    document.getElementById('avg-session').innerText = avgDur;

    // Avg FCP
    var fcpVals = enrichments.webVitals.map(function(v) { return v.fcp; }).filter(function(v) { return v && !isNaN(v); });
    var avgFcp = fcpVals.length > 0 ? Math.round(fcpVals.reduce(function(a,b){return a+b;},0) / fcpVals.length) + 'ms' : '-';
    document.getElementById('avg-fcp').innerText = avgFcp;

    // Avg Wasm total
    var wasmVals = enrichments.wasmTiming.map(function(w) { return w.total; }).filter(function(v) { return v && !isNaN(v); });
    var avgWasm = wasmVals.length > 0 ? Math.round(wasmVals.reduce(function(a,b){return a+b;},0) / wasmVals.length) + 'ms' : '-';
    document.getElementById('avg-wasm').innerText = avgWasm;



    // --- Aggregation ---
    const datesCount = {};
    const osCount = {};      // { osCategory → Set<session_id> }
    const osCountPv = {};    // for backward-compat total display
    const resCount = {};
    const viewportCount = {};
    const pixelRatioCount = {};
    const timezoneCount = {};
    const coresCount = {};
    const browserCount = {};
    const modelCount = {};
    const langCount = {};
    const referrerCount = {};
    const uvMap = new Map();

    pageViews.forEach(function(item) {
        const dateStr = new Date(item.ts).toLocaleDateString('zh-CN');
        datesCount[dateStr] = (datesCount[dateStr] || 0) + 1;

        var p = item.payload || {};
        var rawPlatform = pval(p, 'platform') || '';
        var ua = item.ua || pval(p, 'userAgent') || '';
        var sid = pval(p, 'session_id');
        var visitorUid = pval(p, 'uid') || '';

        var osCategory = getOSCategory(ua, rawPlatform);
        var osDetail   = getOSDetail(ua, rawPlatform);
        var browser    = getBrowser(ua);

        // Session-based counting
        if (osCategory) {
            if (!osCount[osCategory]) osCount[osCategory] = new Set();
            if (sid) osCount[osCategory].add(sid);
        }
        if (browser) {
            if (!browserCount[browser]) browserCount[browser] = new Set();
            if (sid) browserCount[browser].add(sid);
        }
        // PV-based counts for resolution/cores/etc (these should stay PV-based)
        if (osCategory) osCountPv[osCategory] = (osCountPv[osCategory] || 0) + 1;

        // Enrich with ua_he data (from separate ua_he entry or merged perf entry)
        var uaInfo = (sid && uaHe.bySid[sid]) || uaHe.byUid[visitorUid] || null;
        var model = uaInfo && uaInfo.model ? uaInfo.model : null;
        if (!model) model = getDeviceModel(ua);
        if (model) modelCount[model] = (modelCount[model] || 0) + 1;

        // Language
        var lang = pval(p, 'language') || '未知';
        langCount[lang] = (langCount[lang] || 0) + 1;

        // Referrer
        var ref = pval(p, 'referrer') || 'direct';
        if (ref === '' || ref === 'direct') ref = '直接访问';
        else if (ref.indexOf(location.hostname) > -1) ref = '站内导航';
        else { try { ref = new URL(ref).hostname; } catch(e) {} }
        referrerCount[ref] = (referrerCount[ref] || 0) + 1;

                var ipBase = item.ip.split(':')[0];
                // Strictly group by UID; fallback to session_id for legacy data
                var uvKey = visitorUid || ('_uidless_' + sid) || ipBase + '|' + osCategory;
        if (!uvMap.has(uvKey)) {
            uvMap.set(uvKey, {
                ip: ipBase, device: osDetail, osCategory: osCategory,
                browser: browser, visits: 1, sessions: sid ? 1 : 0,
                lastSeen: new Date(item.ts), firstSeen: new Date(item.ts),
                uid: visitorUid,
                model: model || '',
                brand: uaInfo ? uaInfo.brand || '' : '',
                hbCount: 0,
                sessionIds: sid ? [sid] : [],
            });
        } else {
            var uvData = uvMap.get(uvKey);
            uvData.visits += 1;
            if (sid && uvData.sessionIds.indexOf(sid) < 0) {
                uvData.sessionIds.push(sid);
                uvData.sessions += 1;
            }
            var currentTs = new Date(item.ts);
            if (currentTs > uvData.lastSeen) uvData.lastSeen = currentTs;
            if (currentTs < uvData.firstSeen) uvData.firstSeen = currentTs;
            // Prefer the most complete entry (one with resolution)
            if (pval(p, 'resolution')) {
                uvData.browser = browser;
                uvData.device = osDetail;
                uvData.model = model || uvData.model;
                uvData.brand = (uaInfo && uaInfo.brand) || uvData.brand;
            }
        }

        if (pval(p, 'resolution')) resCount[pval(p, 'resolution')] = (resCount[pval(p, 'resolution')] || 0) + 1;
        if (pval(p, 'viewport')) viewportCount[pval(p, 'viewport')] = (viewportCount[pval(p, 'viewport')] || 0) + 1;
        if (pval(p, 'pixelRatio')) {
            var pr = pval(p, 'pixelRatio');
            pixelRatioCount['×' + pr] = (pixelRatioCount['×' + pr] || 0) + 1;
        }
        if (pval(p, 'timezone')) timezoneCount[pval(p, 'timezone')] = (timezoneCount[pval(p, 'timezone')] || 0) + 1;
        if (pval(p, 'cores')) coresCount[pval(p, 'cores') + ' 核'] = (coresCount[pval(p, 'cores') + ' 核'] || 0) + 1;
    });

    // Fill missing dates in last 7 days
    var filledDates = {};
    for (var i = 6; i >= 0; i--) {
        var d = new Date(Date.now() - i * 86400000);
        var key = d.toLocaleDateString('zh-CN');
        filledDates[key] = datesCount[key] || 0;
    }

    // Count heartbeats per uid (cross-session)
    var hbCountByUid = {};
    rawData.forEach(function(item) {
        if (entryType(item) !== 'heartbeat') return;
        var u = pval(item.payload, 'uid') || pval(item.payload, 'session_id');
        if (u) hbCountByUid[u] = (hbCountByUid[u] || 0) + 1;
    });
    uvMap.forEach(function(uv) {
        var k = uv.uid || uv.uid;
        uv.hbCount = hbCountByUid[k] || 0;
    });

    // Convert session Sets to lengths for charts
    var osCountFinal = {};
    for (var k in osCount) osCountFinal[k] = osCount[k].size;
    var browserCountFinal = {};
    for (var k in browserCount) browserCountFinal[k] = browserCount[k].size;

    // --- Render ---
    renderTrendChart(filledDates);
    renderOSChart(osCountFinal);
    renderResChart(resCount);
    renderCoresChart(coresCount);
    renderBrowserChart(browserCountFinal);

    // New charts
    renderModelChart(modelCount);
    renderLangChart(langCount);
    renderDurationChart(sessionDurations);

    // Device/channel charts
    renderViewportChart(viewportCount);
    renderPixelRatioChart(pixelRatioCount);
    renderTimezoneChart(timezoneCount);
    renderReferrerChart(referrerCount);

    // Performance charts
    renderFCPChart(enrichments.webVitals);
    renderLCPChart(enrichments.webVitals);
    renderWasmBreakdownChart(enrichments.wasmTiming);

    // Log table — filtered by type, then show latest 50
    var logItems = logFilterType
        ? rawData.filter(function(i) { return entryType(i) === logFilterType; })
        : rawData.slice();
    logItems = logItems.slice().reverse().slice(0, 50);
    renderLogTable(logItems);

    var uvArray = Array.from(uvMap.values()).sort(function(a, b) { return b.lastSeen - a.lastSeen; });
    renderUVTable(uvArray);
}

// --- Tables ---

function renderLogTable(logs) {
    var tbody = document.getElementById('log-table-body');
    tbody.innerHTML = '';
    logs.forEach(function(log, idx) {
        var tr = document.createElement('tr');
        tr.className = "row-click";
        tr.onclick = function() { showRawData(log); };
        var time = new Date(log.ts).toLocaleString('zh-CN', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit', second:'2-digit' });
        var ip = log.ip.split(':')[0];
        var p = log.payload || {};
        var t = entryType(log) || 'page_view';
        var label = t;
        var summary = '';
        switch (t) {
            case 'page_view':
                summary = (pval(p, 'resolution') || '') + ' ' + (pval(p, 'platform') || '');
                break;
            case 'perf':
                summary = '';
                if (pval(p, 'fcp')) summary += 'FCP=' + pval(p, 'fcp') + 'ms ';
                if (pval(p, 'wasm_total_ms')) summary += 'WASM=' + pval(p, 'wasm_total_ms') + 'ms';
                if (pval(p, 'ua_model')) summary += (summary ? ' ' : '') + pval(p, 'ua_model');
                if (!summary) summary = Object.keys(p).slice(0, 3).join(', ');
                break;
            case 'heartbeat':
                summary = 'seq=' + (pval(p, 'seq') || '') + ' elapsed=' + (pval(p, 'elapsed') || '') + 's';
                break;
            case 'ua_he':
                summary = (pval(p, 'ua_model') || '') + ' ' + (pval(p, 'ua_arch') || '') + ' ' + (pval(p, 'ua_bit') || '');
                break;
            case 'web_vitals':
                summary = 'FCP=' + (pval(p, 'fcp') || '-') + 'ms LCP=' + (pval(p, 'lcp') || '-') + 'ms';
                break;
            case 'wasm_timing':
                summary = 'total=' + (pval(p, 'wasm_total_ms') || '-') + 'ms dec=' + (pval(p, 'wasm_decode_ms') || '-') + 'ms';
                break;
            case 'page_unload':
                summary = 'elapsed=' + (pval(p, 'elapsed') || '-') + 's';
                break;
            default:
                summary = Object.keys(p).slice(0, 3).join(', ');
        }
        var typeClass = 'bg-slate-100 text-slate-600';
        if (t === 'page_view') typeClass = 'bg-blue-100 text-blue-700';
        else if (t === 'perf') typeClass = 'bg-purple-100 text-purple-700';
        else if (t === 'heartbeat') typeClass = 'bg-emerald-100 text-emerald-700';
        else if (t === 'page_unload') typeClass = 'bg-amber-100 text-amber-700';
        else if (t === 'ua_he') typeClass = 'bg-purple-100 text-purple-700';
        else if (t === 'web_vitals') typeClass = 'bg-rose-100 text-rose-700';
        else if (t === 'wasm_timing') typeClass = 'bg-cyan-100 text-cyan-700';
        tr.innerHTML =
            '<td class="px-3 py-2 whitespace-nowrap text-slate-500 text-xs">' + time + '</td>' +
            '<td class="px-3 py-2"><span class="inline-block px-1.5 py-0.5 rounded text-xs font-medium ' + typeClass + '">' + label + '</span></td>' +
            '<td class="px-3 py-2 whitespace-nowrap font-mono text-slate-700 text-xs">' + ip + '</td>' +
            '<td class="px-3 py-2 text-slate-500 text-xs truncate max-w-[200px]">' + summary + '</td>' +
            '<td class="px-3 py-2 text-xs"><span class="text-blue-500 cursor-pointer">👁</span></td>';
        tbody.appendChild(tr);
    });
}

function renderUVTable(uvList) {
    var tbody = document.getElementById('uv-table-body');
    tbody.innerHTML = '';
    uvList.forEach(function(uv) {
        var tr = document.createElement('tr');
        tr.className = "row-click";
        tr.onclick = function() { showVisitorRaw(uv); };
        var time = uv.lastSeen.toLocaleString('zh-CN', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
        var first = uv.firstSeen.toLocaleString('zh-CN', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
        var modelInfo = uv.model;
        if (uv.brand && uv.brand !== uv.model) modelInfo = uv.brand + (uv.model ? ' ' + uv.model : '');
        tr.innerHTML =
            '<td class="px-3 py-2 whitespace-nowrap text-slate-500 text-xs" title="' + first + '">' + first + '</td>' +
            '<td class="px-3 py-2 font-mono text-xs text-slate-500 truncate max-w-[72px]" title="' + uv.uid + '">' + (uv.uid ? uv.uid.slice(0, 8) + '…' : '-') + '</td>' +
            '<td class="px-3 py-2 whitespace-nowrap font-mono font-medium text-slate-800 text-xs">' + uv.ip + '</td>' +
            '<td class="px-3 py-2 text-slate-600 text-xs">' + uv.device + '</td>' +
            '<td class="px-3 py-2 text-slate-500 text-xs truncate max-w-[90px]" title="' + modelInfo + '">' + modelInfo + '</td>' +
            '<td class="px-3 py-2 text-slate-500 text-xs">' + uv.browser + '</td>' +
            '<td class="px-3 py-2 text-center"><span class="inline-flex items-center justify-center px-2 py-0.5 rounded-full text-xs font-bold bg-indigo-100 text-indigo-800">' + uv.visits + '</span></td>' +
            '<td class="px-3 py-2 text-center text-xs text-slate-500">' + uv.sessions + '</td>' +
            '<td class="px-3 py-2 text-center text-xs text-slate-500">' + (uv.hbCount > 0 ? uv.hbCount : '-') + '</td>';
        tbody.appendChild(tr);
    });
}

function showVisitorRaw(uv) {
    var uid = uv.uid || '';
    var sid = uv.sessionIds && uv.sessionIds.length > 0 ? uv.sessionIds : [];
    var entries = rawData.filter(function(i) {
        var pu = pval(i.payload, 'uid');
        if (uid && pu === uid) return true;
        var ps = pval(i.payload, 'session_id');
        if (sid.length > 0 && ps && sid.indexOf(ps) >= 0) return true;
        return false;
    });
    var title = '访客 ' + (uid ? uid.slice(0, 8) + '…' : uv.ip) + ' (' + entries.length + ' 条记录)';
    document.getElementById('modalTitle').textContent = title;
    document.getElementById('modalBody').textContent = JSON.stringify(entries, null, 2);
    document.getElementById('rawModal').classList.add('open');
    rawModalOpen = true;
}

// --- Charts ---
Chart.defaults.maintainAspectRatio = false;
Chart.defaults.responsive = true;

var charts = {};

function destroyChart(key) {
    if (charts[key]) { charts[key].destroy(); charts[key] = null; }
}

function renderTrendChart(dataObj) {
    destroyChart('trend');
    var ctx = document.getElementById('trendChart').getContext('2d');
    var labels = Object.keys(dataObj);
    var values = Object.values(dataObj);
    charts.trend = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'PV',
                data: values,
                borderColor: 'rgb(59, 130, 246)',
                backgroundColor: 'rgba(59, 130, 246, 0.1)',
                borderWidth: 2, tension: 0.3, fill: true,
                pointRadius: values.map(function(v) { return v > 0 ? 3 : 0; }),
            }]
        },
        options: {
            plugins: { legend: { display: false } },
            scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } }
        }
    });
}

function renderOSChart(dataObj) {
    destroyChart('os');
    var ctx = document.getElementById('osChart').getContext('2d');
    var colors = ['#3b82f6', '#10b981', '#f59e0b', '#6366f1', '#ec4899', '#64748b', '#0ea5e9', '#ef4444'];
    charts.os = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: Object.keys(dataObj),
            datasets: [{ data: Object.values(dataObj), backgroundColor: colors, borderWidth: 0 }]
        },
        options: { cutout: '60%', plugins: { legend: { position: 'right', labels: { boxWidth: 10, font: { size: 11 } } } } }
    });
}

function renderResChart(dataObj) {
    destroyChart('res');
    var sorted = Object.entries(dataObj).sort(function(a, b) { return b[1] - a[1]; }).slice(0, 5);
    var ctx = document.getElementById('resChart').getContext('2d');
    charts.res = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: sorted.map(function(item) { return item[0]; }),
            datasets: [{ data: sorted.map(function(item) { return item[1]; }), backgroundColor: '#8b5cf6', borderRadius: 4 }]
        },
        options: { indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, ticks: { stepSize: 1 } } } }
    });
}

function renderCoresChart(dataObj) {
    destroyChart('cores');
    var ctx = document.getElementById('coresChart').getContext('2d');
    var colors = ['#f43f5e', '#0ea5e9', '#10b981', '#f59e0b', '#8b5cf6', '#64748b'];
    charts.cores = new Chart(ctx, {
        type: 'pie',
        data: {
            labels: Object.keys(dataObj),
            datasets: [{ data: Object.values(dataObj), backgroundColor: colors, borderWidth: 0 }]
        },
        options: { plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 10 } } } } }
    });
}

function renderBrowserChart(dataObj) {
    destroyChart('browser');
    var sorted = Object.entries(dataObj).sort(function(a, b) { return b[1] - a[1]; });
    var ctx = document.getElementById('browserChart').getContext('2d');
    charts.browser = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: sorted.map(function(item) { return item[0]; }),
            datasets: [{ data: sorted.map(function(item) { return item[1]; }), backgroundColor: '#06b6d4', borderRadius: 4 }]
        },
        options: { indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, ticks: { stepSize: 1 } } } }
    });
}

function renderFCPChart(vitals) {
    destroyChart('fcp');
    var vals = vitals.map(function(v) { return v.fcp; }).filter(function(v) { return v && !isNaN(v); });
    if (vals.length === 0) return;
    var ctx = document.getElementById('fcpChart').getContext('2d');
    var buckets = histogram(vals, [0, 500, 1000, 1500, 2000, 3000]);
    charts.fcp = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: ['<0.5s', '0.5-1s', '1-1.5s', '1.5-2s', '2-3s', '>3s'],
            datasets: [{ data: buckets, backgroundColor: '#f43f5e', borderRadius: 3 }]
        },
        options: {
            plugins: { legend: { display: false } },
            scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } }
        }
    });
}

function renderLCPChart(vitals) {
    destroyChart('lcp');
    var vals = vitals.map(function(v) { return v.lcp; }).filter(function(v) { return v && !isNaN(v); });
    if (vals.length === 0) return;
    var ctx = document.getElementById('lcpChart').getContext('2d');
    var buckets = histogram(vals, [0, 1000, 2500, 4000, 6000]);
    charts.lcp = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: ['<1s', '1-2.5s', '2.5-4s', '4-6s', '>6s'],
            datasets: [{ data: buckets, backgroundColor: '#f59e0b', borderRadius: 3 }]
        },
        options: {
            plugins: { legend: { display: false } },
            scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } }
        }
    });
}

function renderWasmBreakdownChart(timing) {
    destroyChart('wasm');
    // Stacked bar: decode + compile + init per sample
    var samples = timing.filter(function(w) { return w.total && !isNaN(w.total); }).slice(0, 30);
    if (samples.length === 0) return;
    var ctx = document.getElementById('wasmBreakdownChart').getContext('2d');
    var labels = samples.map(function(_, i) { return '#' + (i+1); });
    charts.wasm = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                { label: '解析', data: samples.map(function(w){return w.decode||0;}), backgroundColor: '#0ea5e9' },
                { label: '编译', data: samples.map(function(w){return w.compile||0;}), backgroundColor: '#f59e0b' },
                { label: '初始化', data: samples.map(function(w){return w.init||0;}), backgroundColor: '#10b981' },
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true } },
            plugins: { legend: { position: 'top', labels: { boxWidth: 10, font: { size: 9 } } } }
        }
    });
}

function renderModelChart(dataObj) {
    destroyChart('model');
    var sorted = Object.entries(dataObj).sort(function(a,b){return b[1]-a[1];}).slice(0, 8);
    if (sorted.length === 0) return;
    var ctx = document.getElementById('modelChart').getContext('2d');
    var colors = ['#6366f1','#ec4899','#14b8a6','#f97316','#8b5cf6','#06b6d4','#ef4444','#84cc16'];
    charts.model = new Chart(ctx, {
        type: 'doughnut',
        data: { labels: sorted.map(function(i){return i[0];}), datasets: [{ data: sorted.map(function(i){return i[1];}), backgroundColor: colors, borderWidth: 0 }] },
        options: { cutout: '55%', plugins: { legend: { position: 'right', labels: { boxWidth: 10, font: { size: 10 } } } } }
    });
}

function renderLangChart(dataObj) {
    destroyChart('lang');
    var sorted = Object.entries(dataObj).sort(function(a,b){return b[1]-a[1];}).slice(0, 6);
    if (sorted.length === 0) return;
    var ctx = document.getElementById('langChart').getContext('2d');
    var colors = ['#3b82f6','#10b981','#f59e0b','#6366f1','#ec4899','#64748b'];
    charts.lang = new Chart(ctx, {
        type: 'doughnut',
        data: { labels: sorted.map(function(i){return i[0];}), datasets: [{ data: sorted.map(function(i){return i[1];}), backgroundColor: colors, borderWidth: 0 }] },
        options: { cutout: '55%', plugins: { legend: { position: 'right', labels: { boxWidth: 10, font: { size: 10 } } } } }
    });
}

function renderDurationChart(durations) {
    destroyChart('duration');
    if (durations.length === 0) return;
    var ctx = document.getElementById('durationChart').getContext('2d');
    var buckets = histogram(durations, [30, 120, 300, 600, 1800]);
    charts.duration = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: ['<30s', '30s-2m', '2-5m', '5-10m', '10-30m', '>30m'],
            datasets: [{ data: buckets, backgroundColor: '#8b5cf6', borderRadius: 3 }]
        },
        options: {
            plugins: { legend: { display: false } },
            scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } }
        }
    });
}

function renderViewportChart(dataObj) {
    destroyChart('viewport');
    var sorted = Object.entries(dataObj).sort(function(a,b){return b[1]-a[1];}).slice(0, 6);
    if (sorted.length === 0) return;
    var ctx = document.getElementById('viewportChart').getContext('2d');
    charts.viewport = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: sorted.map(function(i){return i[0];}),
            datasets: [{ data: sorted.map(function(i){return i[1];}), backgroundColor: '#0ea5e9', borderRadius: 4 }]
        },
        options: { indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, ticks: { stepSize: 1 } } } }
    });
}

function renderPixelRatioChart(dataObj) {
    destroyChart('pixelRatio');
    var entries = Object.entries(dataObj).sort(function(a,b){return b[1]-a[1];});
    if (entries.length === 0) return;
    var ctx = document.getElementById('pixelRatioChart').getContext('2d');
    var colors = ['#6366f1','#ec4899','#14b8a6','#f97316','#8b5cf6','#06b6d4'];
    charts.pixelRatio = new Chart(ctx, {
        type: 'doughnut',
        data: { labels: entries.map(function(i){return i[0];}), datasets: [{ data: entries.map(function(i){return i[1];}), backgroundColor: colors, borderWidth: 0 }] },
        options: { cutout: '55%', plugins: { legend: { position: 'right', labels: { boxWidth: 10, font: { size: 10 } } } } }
    });
}

function renderTimezoneChart(dataObj) {
    destroyChart('timezone');
    var sorted = Object.entries(dataObj).sort(function(a,b){return b[1]-a[1];}).slice(0, 8);
    if (sorted.length === 0) return;
    var ctx = document.getElementById('timezoneChart').getContext('2d');
    charts.timezone = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: sorted.map(function(i){return i[0];}),
            datasets: [{ data: sorted.map(function(i){return i[1];}), backgroundColor: '#10b981', borderRadius: 4 }]
        },
        options: { indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, ticks: { stepSize: 1 } } } }
    });
}

function renderReferrerChart(dataObj) {
    destroyChart('referrer');
    var sorted = Object.entries(dataObj).sort(function(a,b){return b[1]-a[1];}).slice(0, 8);
    if (sorted.length === 0) return;
    var ctx = document.getElementById('referrerChart').getContext('2d');
    var colors = ['#3b82f6','#10b981','#f59e0b','#6366f1','#ec4899','#64748b','#0ea5e9','#84cc16'];
    charts.referrer = new Chart(ctx, {
        type: 'doughnut',
        data: { labels: sorted.map(function(i){return i[0];}), datasets: [{ data: sorted.map(function(i){return i[1];}), backgroundColor: colors, borderWidth: 0 }] },
        options: { cutout: '55%', plugins: { legend: { position: 'right', labels: { boxWidth: 10, font: { size: 10 } } } } }
    });
}

// Histogram helper: count values into buckets defined by thresholds
function histogram(vals, thresholds) {
    var buckets = new Array(thresholds.length + 1).fill(0);
    vals.forEach(function(v) {
        var placed = false;
        for (var i = 0; i < thresholds.length; i++) {
            if (v < thresholds[i]) { buckets[i]++; placed = true; break; }
        }
        if (!placed) buckets[thresholds.length]++;
    });
    return buckets;
}

// --- Init ---
fetchData();
