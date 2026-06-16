(function() {
    var STORAGE_KEY = '_xu_analytics_v1';
    var ENDPOINT = window.__XUBEN_ANALYTICS_ENDPOINT__ || 'http://127.0.0.1:7999/analytics';

    var throttled = false;
    var last = localStorage.getItem(STORAGE_KEY);
    if (last && Date.now() - parseInt(last, 10) < 3600000) {
        throttled = true;
    }

    // --- Persistent Visitor UID ---
    var uid = localStorage.getItem('_xu_uid');
    if (!uid) {
        uid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            var r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
        localStorage.setItem('_xu_uid', uid);
    }

    // --- Session ID ---
    var sid = sessionStorage.getItem('_xu_sid');
    if (!sid) {
        sid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            var r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
        sessionStorage.setItem('_xu_sid', sid);
    }

    function beacon(data) {
        var parts = [];
        for (var key in data) {
            if (data.hasOwnProperty(key) && data[key] !== undefined && data[key] !== null && data[key] !== '') {
                parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(data[key]));
            }
        }
        var img = new Image();
        img.src = ENDPOINT + '?' + parts.join('&');
    }

    // ============================================================
    // Probe 1: page_view (synchronous, always)
    // ============================================================
    var main = {
        uid:         uid,
        session_id:  sid,
        type:        'page_view',
        url:         location.href,
        referrer:    document.referrer || 'direct',
        language:    navigator.language,
    };

    if (!throttled) {
        localStorage.setItem(STORAGE_KEY, String(Date.now()));
        main.resolution    = screen.width + 'x' + screen.height;
        main.viewport      = window.innerWidth + 'x' + window.innerHeight;
        main.pixelRatio    = window.devicePixelRatio || 1;
        main.platform      = navigator.platform;
        main.timezone      = Intl.DateTimeFormat().resolvedOptions().timeZone;
        main.cores         = navigator.hardwareConcurrency || 'unknown';
        main.cookieEnabled = navigator.cookieEnabled;
        if (navigator.userAgentData) {
            main.uaPlatform = navigator.userAgentData.platform || '';
            main.uaMobile   = String(navigator.userAgentData.mobile);
        }
    }

    beacon(main);

    // ============================================================
    // Probe 2: perf (FCP + LCP + UA high-entropy + WASM timing)
    // Delayed until WASM timing arrives, so all data merges into one.
    // 30s timeout force-sends whatever is available.
    // ============================================================
    var perfData = { uid: uid, session_id: sid, type: 'perf' };
    var perfSent = false;
    var perfTimer = null;

    function flushPerf() {
        if (perfSent) return;
        if (Object.keys(perfData).length <= 3) return;
        perfSent = true;
        if (perfTimer) clearTimeout(perfTimer);
        beacon(perfData);
    }

    // --- UA high-entropy (throttled, Chrome-only) ---
    // Only adds to perfData, does NOT trigger flush.
    if (!throttled && navigator.userAgentData && navigator.userAgentData.getHighEntropyValues) {
        navigator.userAgentData.getHighEntropyValues([
            'architecture', 'model', 'platformVersion', 'bitness', 'fullVersionList'
        ]).then(function(ua) {
            if (ua.architecture)   perfData.ua_arch = ua.architecture;
            if (ua.model)          perfData.ua_model = ua.model;
            if (ua.platformVersion) perfData.ua_plat_ver = ua.platformVersion;
            if (ua.bitness)        perfData.ua_bit = ua.bitness;
            if (ua.fullVersionList) {
                var b = ua.fullVersionList.filter(function(x) {
                    return x.brand.indexOf('Not') !== 0 && x.brand.indexOf('Google') === -1;
                });
                if (b.length > 0) {
                    perfData.ua_brand = b[0].brand;
                    perfData.ua_brand_ver = b[0].version;
                }
            }
        }).catch(function(){});
    }

    // --- Web Vitals: FCP + LCP ---
    // Only adds to perfData, does NOT trigger flush.
    try {
        (function() {
            var po = new PerformanceObserver(function(list) {
                list.getEntries().forEach(function(e) {
                    if (e.name === 'first-contentful-paint' && !perfData.fcp)
                        perfData.fcp = Math.round(e.startTime);
                    if (e.entryType === 'largest-contentful-paint')
                        perfData.lcp = Math.round(e.startTime);
                });
            });
            po.observe({ type: 'paint', buffered: true });
            po.observe({ type: 'largest-contentful-paint', buffered: true });
        })();
    } catch(e) {}

    // --- WASM timing: arrival triggers perf flush (all data merged) ---
    var wtCheck = setInterval(function() {
        if (window.__xubenWasmTiming) {
            clearInterval(wtCheck);
            var w = window.__xubenWasmTiming;
            perfData.wasm_decode_ms  = w.decodeMs;
            perfData.wasm_compile_ms = w.compileMs;
            perfData.wasm_init_ms    = w.initMs;
            perfData.wasm_total_ms   = w.totalMs;
            flushPerf();
        }
    }, 200);

    // Force-flush after 30s (WASM may never arrive, or too slow)
    perfTimer = setTimeout(function() {
        clearInterval(wtCheck);
        if (!perfSent) {
            perfSent = true;
            beacon(perfData);
        }
    }, 30000);

    // ============================================================
    // Probe 3: Heartbeat (every 60s while visible)
    // ============================================================
    var PAGE_LOAD_TS = Date.now();
    var hbSeq = 0;

    function sendHeartbeat() {
        if (document.visibilityState !== 'visible') return;
        hbSeq++;
        beacon({
            uid: uid, session_id: sid, type: 'heartbeat',
            seq: hbSeq, elapsed: Math.round((Date.now() - PAGE_LOAD_TS) / 1000),
        });
    }

    document.addEventListener('visibilitychange', function() {
        if (document.visibilityState === 'visible') sendHeartbeat();
    });
    sendHeartbeat();
    setInterval(sendHeartbeat, 60000);

    // ============================================================
    // Probe 4: Page unload (fetch keepalive)
    // ============================================================
    window.addEventListener('beforeunload', function() {
        try {
            fetch(ENDPOINT + '?uid=' + encodeURIComponent(uid) +
                  '&session_id=' + encodeURIComponent(sid) +
                  '&type=page_unload&elapsed=' + Math.round((Date.now() - PAGE_LOAD_TS) / 1000) +
                  '&url=' + encodeURIComponent(location.href),
                  { method: 'GET', keepalive: true });
        } catch(e) {}
    });
})();
