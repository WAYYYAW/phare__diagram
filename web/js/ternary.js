const TERN_Y_TOP = Math.sqrt(3) / 2;
const TERN_MIN = 0;
const TERN_MAX = 1300;
const SURFACE_COLORS = ['#4CAF50', '#2196F3', '#FF9800', '#9C27B0',
    '#E91E63', '#00BCD4', '#795548', '#607D8B'];
let ternShowCoords = false;
let ternActiveTab = 'tPtTab';
let ternShowAxes = false;
let ternShowIsoFill = true;
let ternCollapsed = { pt: false, ln: false, sf: false };
const TERN_COONS_LOW_N = 18;
const TERN_COONS_HIGH_N = 60;
const TERN_ISO_EPS = 1e-6;
const TERN_JOIN_EPS = 1e-4;
const TERN_FACE_AREA_EPS = 5e-6;
let ternModelVersion = 0;
let ternSliderRaf = 0;
let ternPendingIsoTemp = null;
let ternIsDraggingIso = false;

// ---- Persistent zero-copy mesh cache ----
//
// Meshes are owned by WASM and referenced via handles. JS binds fresh
// TypedArray views on demand so it survives WASM memory growth.
let ternMeshCache = Object.create(null);

function ternBumpModelVersion() {
    ternModelVersion += 1;
}

function ternReleaseMeshEntry(entry) {
    if (!entry) return;
    ['low', 'high'].forEach(kind => {
        var mesh = entry[kind];
        if (mesh && mesh.handle) {
            try { XubenBridge.ternary.freeCoonsMesh(mesh.handle); } catch (e) {}
        }
    });
}

function ternInvalidateMeshCache() {
    Object.keys(ternMeshCache).forEach(key => ternReleaseMeshEntry(ternMeshCache[key]));
    ternMeshCache = Object.create(null);
    ternBumpModelVersion();
}

function ternMeshCacheKey(idxJSON, is3Edge, surfaceIndex) {
    return [surfaceIndex, is3Edge ? '3' : '4', idxJSON].join('|');
}

function ternGetCachedMesh(ptsJSON, lnsJSON, idxJSON, is3Edge, si, lod) {
    var key = ternMeshCacheKey(idxJSON, is3Edge, si);
    var entry = ternMeshCache[key];
    if (!entry || entry.version !== ternModelVersion) {
        ternReleaseMeshEntry(entry);
        entry = { version: ternModelVersion, low: null, high: null };
        ternMeshCache[key] = entry;
    }

    var kind = lod === 'high' ? 'high' : 'low';
    if (!entry[kind]) {
        entry[kind] = ternBuildMeshHandle(ptsJSON, lnsJSON, idxJSON, is3Edge, kind);
    }
    if (!entry[kind]) return null;

    var views = ternBindMeshViews(entry[kind]);
    if (views) return views;

    ternReleaseMeshHandle(entry[kind]);
    entry[kind] = ternBuildMeshHandle(ptsJSON, lnsJSON, idxJSON, is3Edge, kind);
    if (!entry[kind]) return null;
    return ternBindMeshViews(entry[kind]);
}

function ternReleaseMeshHandle(mesh) {
    if (!mesh || !mesh.handle) return;
    try { XubenBridge.ternary.freeCoonsMesh(mesh.handle); } catch (e) {}
}

function ternBuildMeshHandle(ptsJSON, lnsJSON, idxJSON, is3Edge, kind) {
    var n = kind === 'high' ? TERN_COONS_HIGH_N : TERN_COONS_LOW_N;
    var meta = is3Edge
        ? XubenBridge.ternary.buildCoons3Edge(ptsJSON, lnsJSON, idxJSON, n)
        : XubenBridge.ternary.buildCoons4Edge(ptsJSON, lnsJSON, idxJSON, n);
    if (!meta || !meta.numVerts || !meta.handle) return null;
    return meta;
}

function ternBindMeshViews(meta) {
    var mem = getWasmMemory();
    if (!mem) return null;
    if (!ternValidateMeshMeta(meta, mem.byteLength)) return null;

    return {
        handle: meta.handle,
        numVerts: meta.numVerts,
        numTris: meta.numTris,
        xs: new Float64Array(mem, meta.ptrX, meta.numVerts),
        ys: new Float64Array(mem, meta.ptrY, meta.numVerts),
        zs: new Float64Array(mem, meta.ptrZ, meta.numVerts),
        is: new Int32Array(mem, meta.ptrI, meta.numTris),
        js: new Int32Array(mem, meta.ptrJ, meta.numTris),
        ks: new Int32Array(mem, meta.ptrK, meta.numTris),
    };
}

function ternValidateMeshMeta(meta, byteLength) {
    function inRange(ptr, bytes) {
        return Number.isInteger(ptr) && ptr >= 0 && ptr + bytes <= byteLength;
    }
    return inRange(meta.ptrX, meta.numVerts * 8) &&
        inRange(meta.ptrY, meta.numVerts * 8) &&
        inRange(meta.ptrZ, meta.numVerts * 8) &&
        inRange(meta.ptrI, meta.numTris * 4) &&
        inRange(meta.ptrJ, meta.numTris * 4) &&
        inRange(meta.ptrK, meta.numTris * 4);
}

// getWasmMemory returns the WASM linear memory ArrayBuffer, trying multiple
// access paths in order of preference.  WASM memory can grow, so we fetch a
// fresh buffer reference every time.
function getWasmMemory() {
    // Helper: scan exports for any WebAssembly.Memory (Go uses "mem" or "memory")
    function findMem(ex) {
        if (!ex) return null;
        // Try standard keys
        var m = (ex.memory || ex.mem);
        if (m instanceof WebAssembly.Memory) return m.buffer;
        // Fallback: scan all exports
        for (var k in ex) {
            if (ex[k] instanceof WebAssembly.Memory) return ex[k].buffer;
        }
        return null;
    }

    var buf;

    // Path 1: lexical go variable (set by wasm_exec.js)
    try { if (typeof go !== 'undefined') { buf = findMem(go._inst && go._inst.exports); if (buf) return buf; } } catch(e) {}

    // Path 2: window.__go fallback
    try { if (window.__go) { buf = findMem(window.__go._inst && window.__go._inst.exports); if (buf) return buf; } } catch(e) {}

    // Path 3: window.__wasmInst
    try { if (window.__wasmInst) { buf = findMem(window.__wasmInst.exports); if (buf) return buf; } } catch(e) {}

    return null;
}

let ternHighPrecision = false;

function togglePrecision(high) {
    ternHighPrecision = high;
    XubenBridge.ternary.setPrecision(high);
    ternInvalidateMeshCache();
    renderTernaryCharts();
}

function ternCurrentLod() {
    if (ternIsDraggingIso) return 'low';
    return ternHighPrecision ? 'high' : 'low';
}

function ternSetDragging(active) {
    ternIsDraggingIso = active;
}

function ternScheduleIsoUpdate() {
    if (ternSliderRaf) return;
    ternSliderRaf = requestAnimationFrame(() => {
        ternSliderRaf = 0;
        if (ternPendingIsoTemp == null) return;
        AppState.ternary.isoTemp = ternPendingIsoTemp;
        renderTernary2d();
        renderTernary3d();
    });
}

function ternUpdateIsoPlane3d(val) {
    try {
        var chart3d = document.getElementById('ternaryChart3d');
        if (!chart3d || !chart3d.data) return;
        var traces = chart3d.data;
        for (var i = traces.length - 1; i >= 0; i--) {
            if (traces[i].type === 'mesh3d' && traces[i].name && traces[i].name.indexOf('等温面') >= 0) {
                Plotly.restyle('ternaryChart3d', { z: [[val, val, val]], name: [[`等温面 ${val}°C`]] }, i);
                break;
            }
        }
    } catch (e) {}
}

function ternReadSceneCamera() {
    try {
        var chart3d = document.getElementById('ternaryChart3d');
        if (!chart3d || !chart3d._fullLayout || !chart3d._fullLayout.scene || !chart3d._fullLayout.scene.camera) {
            return null;
        }
        return JSON.parse(JSON.stringify(chart3d._fullLayout.scene.camera));
    } catch (e) {
        return null;
    }
}

function ternPointEq2d(a, b, eps = TERN_JOIN_EPS) {
    return Math.abs(a[0] - b[0]) <= eps && Math.abs(a[1] - b[1]) <= eps;
}

function ternDedupSegmentPoints(points, eps = TERN_JOIN_EPS) {
    const out = [];
    points.forEach(pt => {
        if (!out.some(existing => ternPointEq2d(existing, pt, eps))) {
            out.push(pt);
        }
    });
    return out;
}

function ternAppendSegmentPoint(points, pt) {
    if (points.length === 0 || !ternPointEq2d(points[points.length - 1], pt)) {
        points.push(pt);
    }
}

function ternBuildContourPolylines(segments) {
    const remaining = segments
        .filter(seg => seg && seg.length === 2 && !ternPointEq2d(seg[0], seg[1]))
        .map(seg => [seg[0], seg[1]]);
    const polylines = [];

    while (remaining.length > 0) {
        const seed = remaining.pop();
        const line = [seed[0], seed[1]];
        let extended = true;

        while (extended) {
            extended = false;
            for (let i = remaining.length - 1; i >= 0; i--) {
                const seg = remaining[i];
                const start = line[0];
                const end = line[line.length - 1];
                if (ternPointEq2d(seg[0], end)) {
                    ternAppendSegmentPoint(line, seg[1]);
                } else if (ternPointEq2d(seg[1], end)) {
                    ternAppendSegmentPoint(line, seg[0]);
                } else if (ternPointEq2d(seg[1], start)) {
                    line.unshift(seg[0]);
                } else if (ternPointEq2d(seg[0], start)) {
                    line.unshift(seg[1]);
                } else {
                    continue;
                }
                remaining.splice(i, 1);
                extended = true;
            }
        }

        polylines.push(line);
    }

    return polylines;
}

function ternPolygonArea(points) {
    let area = 0;
    for (let i = 0; i < points.length; i++) {
        const a = points[i];
        const b = points[(i + 1) % points.length];
        area += a[0] * b[1] - b[0] * a[1];
    }
    return area / 2;
}

function ternCross2d(a, b, c) {
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function ternCanonicalPointKey(pt, eps = TERN_JOIN_EPS) {
    return `${Math.round(pt[0] / eps)}:${Math.round(pt[1] / eps)}`;
}

function ternPointOnSegment2d(pt, a, b, eps = TERN_JOIN_EPS) {
    const cross = (pt[0] - a[0]) * (b[1] - a[1]) - (pt[1] - a[1]) * (b[0] - a[0]);
    if (Math.abs(cross) > eps) return false;
    const dot = (pt[0] - a[0]) * (b[0] - a[0]) + (pt[1] - a[1]) * (b[1] - a[1]);
    if (dot < -eps) return false;
    const lenSq = (b[0] - a[0]) * (b[0] - a[0]) + (b[1] - a[1]) * (b[1] - a[1]);
    if (dot - lenSq > eps) return false;
    return true;
}

function ternSegmentParam(pt, a, b) {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const lenSq = dx * dx + dy * dy;
    if (lenSq <= TERN_JOIN_EPS) return 0;
    return ((pt[0] - a[0]) * dx + (pt[1] - a[1]) * dy) / lenSq;
}

function ternPointInTriangle2d(pt, tri, eps = TERN_JOIN_EPS) {
    const [a, b, c] = tri;
    const v0x = c[0] - a[0], v0y = c[1] - a[1];
    const v1x = b[0] - a[0], v1y = b[1] - a[1];
    const v2x = pt[0] - a[0], v2y = pt[1] - a[1];
    const dot00 = v0x * v0x + v0y * v0y;
    const dot01 = v0x * v1x + v0y * v1y;
    const dot02 = v0x * v2x + v0y * v2y;
    const dot11 = v1x * v1x + v1y * v1y;
    const dot12 = v1x * v2x + v1y * v2y;
    const denom = dot00 * dot11 - dot01 * dot01;
    if (Math.abs(denom) <= eps) return false;
    const inv = 1 / denom;
    const u = (dot11 * dot02 - dot01 * dot12) * inv;
    const v = (dot00 * dot12 - dot01 * dot02) * inv;
    return u >= -eps && v >= -eps && u + v <= 1 + eps;
}

function ternPolygonCentroid(points) {
    let area2 = 0;
    let cx = 0;
    let cy = 0;
    for (let i = 0; i < points.length; i++) {
        const a = points[i];
        const b = points[(i + 1) % points.length];
        const cross = a[0] * b[1] - b[0] * a[1];
        area2 += cross;
        cx += (a[0] + b[0]) * cross;
        cy += (a[1] + b[1]) * cross;
    }
    if (Math.abs(area2) <= TERN_JOIN_EPS) {
        const sx = points.reduce((sum, pt) => sum + pt[0], 0);
        const sy = points.reduce((sum, pt) => sum + pt[1], 0);
        return [sx / points.length, sy / points.length];
    }
    return [cx / (3 * area2), cy / (3 * area2)];
}

function ternSegmentIntersection2d(a, b, c, d, eps = TERN_JOIN_EPS) {
    const r = [b[0] - a[0], b[1] - a[1]];
    const s = [d[0] - c[0], d[1] - c[1]];
    const denom = r[0] * s[1] - r[1] * s[0];
    const cma = [c[0] - a[0], c[1] - a[1]];
    const numerT = cma[0] * s[1] - cma[1] * s[0];
    const numerU = cma[0] * r[1] - cma[1] * r[0];

    if (Math.abs(denom) <= eps) {
        return null;
    }
    const t = numerT / denom;
    const u = numerU / denom;
    if (t < -eps || t > 1 + eps || u < -eps || u > 1 + eps) {
        return null;
    }
    return [
        a[0] + t * r[0],
        a[1] + t * r[1],
    ];
}

function ternSplitSegmentsAtIntersections(segments) {
    const split = [];

    for (let i = 0; i < segments.length; i++) {
        const [a, b] = segments[i];
        const pts = [[a[0], a[1]], [b[0], b[1]]];
        for (let j = 0; j < segments.length; j++) {
            if (i === j) continue;
            const [c, d] = segments[j];
            const hit = ternSegmentIntersection2d(a, b, c, d);
            if (hit) {
                pts.push(hit);
            }
        }
        const dedup = ternDedupSegmentPoints(pts);
        dedup.sort((p1, p2) => ternSegmentParam(p1, a, b) - ternSegmentParam(p2, a, b));
        for (let k = 0; k < dedup.length - 1; k++) {
            if (!ternPointEq2d(dedup[k], dedup[k + 1])) {
                split.push([dedup[k], dedup[k + 1]]);
            }
        }
    }

    return split;
}

function ternSimplifyPolygon(points) {
    let out = points.slice();
    let changed = true;
    while (changed && out.length >= 3) {
        changed = false;
        const next = [];
        for (let i = 0; i < out.length; i++) {
            const prev = out[(i - 1 + out.length) % out.length];
            const curr = out[i];
            const following = out[(i + 1) % out.length];
            const edgeLen = Math.hypot(curr[0] - prev[0], curr[1] - prev[1]);
            const collinear = Math.abs(ternCross2d(prev, curr, following)) <= TERN_JOIN_EPS;
            if (edgeLen <= TERN_JOIN_EPS || collinear) {
                changed = true;
                continue;
            }
            next.push(curr);
        }
        out = next;
    }
    return out;
}

function ternExtractBoundaryLoops(polys) {
    const edgeMap = new Map();

    function addEdge(a, b) {
        if (ternPointEq2d(a, b)) return;
        const ka = ternCanonicalPointKey(a);
        const kb = ternCanonicalPointKey(b);
        const undirected = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
        const existing = edgeMap.get(undirected);
        if (existing) {
            existing.count += 1;
            return;
        }
        edgeMap.set(undirected, {
            count: 1,
            start: [a[0], a[1]],
            end: [b[0], b[1]],
        });
    }

    polys.forEach(poly => {
        if (!poly || poly.length < 3) return;
        for (let i = 0; i < poly.length; i++) {
            addEdge(poly[i], poly[(i + 1) % poly.length]);
        }
    });

    const segments = [];
    edgeMap.forEach(edge => {
        if (edge.count === 1) {
            segments.push([edge.start, edge.end]);
        }
    });

    return ternBuildContourPolylines(segments)
        .map(line => {
            const pts = line.slice();
            if (pts.length >= 3 && ternPointEq2d(pts[0], pts[pts.length - 1])) {
                pts.pop();
            }
            return pts;
        })
        .filter(line => line.length >= 3 && Math.abs(ternPolygonArea(line)) > TERN_JOIN_EPS);
}

function ternPlotlyPolygonPoints(points) {
    const xs = [];
    const ys = [];
    points.forEach(pt => {
        xs.push(pt[0]);
        ys.push(pt[1]);
    });
    xs.push(points[0][0], null);
    ys.push(points[0][1], null);
    return { x: xs, y: ys };
}

// Collapsible section helpers
function toggleCollapse(sectionEl, key) {
    sectionEl.classList.toggle('collapsed');
    ternCollapsed[key] = sectionEl.classList.contains('collapsed');
}

function collapsibleWrap(label, count, content, key) {
    var collapsed = ternCollapsed[key] ? ' collapsed' : '';
    var icon = ternCollapsed[key] ? '▶' : '▼';
    return '<div class="collapsible-section' + collapsed + '" data-key="' + key + '">' +
        '<div class="collapsible-header" onclick="toggleCollapse(this.parentElement,\'' + key + '\')">' +
            '<span class="collapsible-icon">' + icon + '</span>' +
            '<span>' + label + '</span>' +
            '<span class="collapsible-badge">' + count + '</span>' +
        '</div>' +
        '<div class="collapsible-body">' + content + '</div>' +
    '</div>';
}

function renderTernary() {
    const state = AppState.ternary;
    ternInvalidateMeshCache();
    ternPendingIsoTemp = state.isoTemp;
    renderTernaryToolbar();
    renderTernaryCharts();
}

function renderTernaryToolbar() {
    const container = document.getElementById('ternaryToolbar');
    const state = AppState.ternary;

    let html = `
        <div class="card">
            <div class="card-title">三元数据管理</div>
            <div class="tabs">
                <button class="tab-btn ${ternActiveTab === 'tPtTab' ? 'active' : ''}" data-tab="tPtTab" onclick="switchTernaryTab('tPtTab')">特征点</button>
                <button class="tab-btn ${ternActiveTab === 'tLnTab' ? 'active' : ''}" data-tab="tLnTab" onclick="switchTernaryTab('tLnTab')">边界线</button>
                <button class="tab-btn ${ternActiveTab === 'tSfTab' ? 'active' : ''}" data-tab="tSfTab" onclick="switchTernaryTab('tSfTab')">曲面</button>
            </div>
            <div id="tPtTab" class="tab-panel ${ternActiveTab === 'tPtTab' ? 'active' : ''}">
                ${renderTernaryPoints()}
            </div>
            <div id="tLnTab" class="tab-panel ${ternActiveTab === 'tLnTab' ? 'active' : ''}">
                ${renderTernaryLines()}
            </div>
            <div id="tSfTab" class="tab-panel ${ternActiveTab === 'tSfTab' ? 'active' : ''}">
                ${renderTernarySurfaces()}
            </div>
        </div>
        <div class="ternary-toolbar-actions">
            <button class="btn btn-danger" onclick="clearTernary()">🗑 清空全部</button>
            <button class="btn btn-primary" onclick="saveTernary()">💾 保存相图</button>
            <button class="btn" onclick="loadTernary()">📂 导入相图</button>
            <label class="ternary-toggle coords">
                <input type="checkbox" ${ternShowCoords ? 'checked' : ''} onchange="ternShowCoords=this.checked;renderTernaryCharts();"> 点击显示坐标
            </label>
            <label class="ternary-toggle">
                <input type="checkbox" ${ternShowAxes ? 'checked' : ''} onchange="ternShowAxes=this.checked;renderTernaryCharts();"> 轴
            </label>
            <label class="ternary-toggle">
                <input type="checkbox" ${ternShowIsoFill ? 'checked' : ''} onchange="ternShowIsoFill=this.checked;renderTernary2d();"> 等温上方填色
            </label>
            <label class="ternary-toggle precision">
                <input type="checkbox" id="ternPrecisionToggle" ${ternHighPrecision ? 'checked' : ''} onchange="togglePrecision(this.checked)"> 高精度
            </label>
        </div>
        ${ternBuildIsoSlider()}
        <div class="caption">数据: ${state.points.length}点 / ${state.lines.length}线 / ${state.surfs.length}面 | 等温面: ${state.isoTemp != null ? state.isoTemp + '°C' : '无'}</div>
    `;
    container.innerHTML = html;
}

function renderTernaryPoints() {
    const state = AppState.ternary;
    let rows = '';
    state.points.forEach((p, i) => {
        const c = Math.max(0, 100 - p.a - p.b);
        rows += `<tr>
            <td><input type="text" value="${p.label || ''}" onchange="onTernPtEdit(${i},'label',this.value)"></td>
            <td><input type="number" value="${p.a}" step="1" min="0" max="100" onchange="onTernPtEdit(${i},'a',parseFloat(this.value)||0)"></td>
            <td><input type="number" value="${p.b}" step="1" min="0" max="100" onchange="onTernPtEdit(${i},'b',parseFloat(this.value)||0)"></td>
            <td>${c.toFixed(1)}</td>
            <td><input type="number" value="${p.temp}" step="10" onchange="onTernPtEdit(${i},'temp',parseFloat(this.value)||0)"></td>
            <td><button class="btn btn-danger ternary-action-btn" onclick="removeTernPt(${i})">✕</button></td>
        </tr>`;
    });

    var tableHTML = rows
        ? `<table class="data-table">
            <thead><tr><th>标签</th><th>A%</th><th>B%</th><th>C%</th><th>T °C</th><th></th></tr></thead>
            <tbody>${rows}</tbody></table>`
        : '<div class="empty-state">暂无数据</div>';

    var body = '<div class="grid-4 ternary-editor-row">' +
            '<div class="form-group"><input type="number" id="tPtA" value="33.3" step="1" min="0" max="100" placeholder="A%"></div>' +
            '<div class="form-group"><input type="number" id="tPtB" value="33.3" step="1" min="0" max="100" placeholder="B%"></div>' +
            '<div class="form-group"><input type="number" id="tPtT" value="800" step="10" placeholder="T °C"></div>' +
            '<div class="form-group"><input type="text" id="tPtLabel" placeholder="标签（留空自动）"></div>' +
        '</div>' +
        '<button class="btn btn-primary btn-full ternary-editor-add" onclick="addTernPt()">➕ 添加点</button>';

    if (rows) {
        body += collapsibleWrap('特征点列表', state.points.length + '个', tableHTML, 'pt');
    } else {
        body += tableHTML;
    }

    return body;
}

function renderTernaryLines() {
    const state = AppState.ternary;
    let rows = '';
    state.lines.forEach((l, i) => {
        rows += `<tr>
            <td><input type="text" value="${l.start || ''}" onchange="onTernLnEdit(${i},'start',this.value)"></td>
            <td><input type="text" value="${l.end || ''}" onchange="onTernLnEdit(${i},'end',this.value)"></td>
            <td><input type="number" value="${l.curve_x || 0}" step="5" onchange="onTernLnEdit(${i},'curve_x',parseFloat(this.value)||0)"></td>
            <td><input type="number" value="${l.curve_y || 0}" step="5" onchange="onTernLnEdit(${i},'curve_y',parseFloat(this.value)||0)"></td>
            <td><input type="number" value="${l.curve_z || 0}" step="5" onchange="onTernLnEdit(${i},'curve_z',parseFloat(this.value)||0)"></td>
            <td><button class="btn btn-danger ternary-action-btn" onclick="removeTernLn(${i})">✕</button></td>
        </tr>`;
    });

    var tableHTML = rows
        ? `<table class="data-table">
            <thead><tr><th>起点</th><th>终点</th><th>曲率X</th><th>曲率Y</th><th>曲率Z</th><th></th></tr></thead>
            <tbody>${rows}</tbody></table>`
        : '<div class="empty-state">暂无数据</div>';

    var body = '<div class="grid-4 ternary-editor-row">' +
            '<div class="form-group"><input type="text" id="tLnStart" placeholder="起点标签"></div>' +
            '<div class="form-group"><input type="text" id="tLnEnd" placeholder="终点标签"></div>' +
            '<div class="form-group"><input type="number" id="tLnCx" value="0" step="5" placeholder="曲率X"></div>' +
            '<div class="form-group"><input type="number" id="tLnCy" value="0" step="5" placeholder="曲率Y"></div>' +
        '</div>' +
        '<div class="grid-2 ternary-editor-row">' +
            '<div class="form-group"><input type="number" id="tLnCz" value="0" step="5" placeholder="曲率Z"></div>' +
            '<div class="form-group"><button class="btn btn-primary btn-full" onclick="addTernLn()">➕ 添加线</button></div>' +
        '</div>';

    if (rows) {
        body += collapsibleWrap('边界线列表', state.lines.length + '条', tableHTML, 'ln');
    } else {
        body += tableHTML;
    }

    return body;
}

function renderTernarySurfaces() {
    const state = AppState.ternary;
    var formHTML = '<div class="form-row ternary-surface-form"><div class="form-group"><input type="text" id="sfInput" placeholder="标签序列，如 ABC 或 ADGF"></div><div class="form-group ternary-surface-action"><button class="btn btn-primary" onclick="addTernSurface()">🔧 生成曲面</button></div></div>';

    if (state.surfs.length > 0) {
        var rows = '';
        state.surfs.forEach((s, i) => {
            rows += '<tr>' +
                '<td class="ternary-surface-index">' + (i+1) + '</td>' +
                '<td><input type="text" value="' + s.line_labels.join(', ') + '" onchange="onTernSfEdit(' + i + ', this.value)"></td>' +
                '<td><button class="btn btn-danger ternary-action-btn" onclick="removeTernSf(' + i + ')">✕</button></td>' +
            '</tr>';
        });
        var tableHTML = '<table class="data-table"><thead><tr><th>#</th><th>边界线</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>';
        return formHTML + collapsibleWrap('曲面列表', state.surfs.length + '个', tableHTML, 'sf');
    }
    return formHTML + '<div class="empty-state">暂无曲面</div>';
}

function removeTernSf(idx) {
    AppState.ternary.surfs.splice(idx, 1);
    renderTernary();
}

function onTernSfEdit(idx, raw) {
    const parts = raw.split(',').map(s => s.trim().toUpperCase()).filter(s => s.length >= 2);
    AppState.ternary.surfs[idx].line_labels = parts;
    ternInvalidateMeshCache();
    renderTernaryCharts();
}

function switchTernaryTab(tabId) {
    ternActiveTab = tabId;
    renderTernaryToolbar();
}

function onTernPtEdit(idx, field, value) {
    AppState.ternary.points[idx][field] = value;
    ternInvalidateMeshCache();
    renderTernaryToolbar();
    renderTernaryCharts();
}

function onTernLnEdit(idx, field, value) {
    AppState.ternary.lines[idx][field] = value;
    ternInvalidateMeshCache();
    renderTernaryCharts();
}

function addTernPt() {
    const state = AppState.ternary;
    const a = parseFloat(document.getElementById('tPtA').value) || 0;
    const b = parseFloat(document.getElementById('tPtB').value) || 0;
    const c = Math.max(0, 100 - a - b);
    const temp = parseFloat(document.getElementById('tPtT').value) || 0;
    const label = document.getElementById('tPtLabel').value.trim() || nextAutoLabel(state.points.map(p => p.label));
    if (state.points.some(p => p.label === label)) { alert('标签已存在'); return; }
    state.points.push({ label, a, b, c, temp });
    renderTernary();
}

function removeTernPt(idx) {
    const state = AppState.ternary;
    const label = state.points[idx].label;
    state.points.splice(idx, 1);
    state.lines = state.lines.filter(l => l.start !== label && l.end !== label);
    renderTernary();
}

function addTernLn() {
    const state = AppState.ternary;
    const start = document.getElementById('tLnStart').value.trim();
    const end = document.getElementById('tLnEnd').value.trim();
    const curve_x = parseFloat(document.getElementById('tLnCx').value) || 0;
    const curve_y = parseFloat(document.getElementById('tLnCy').value) || 0;
    const curve_z = parseFloat(document.getElementById('tLnCz').value) || 0;

    if (!start || !end) { alert('起点和终点不能为空'); return; }
    if (start === end) { alert('不能自环'); return; }
    const labels = new Set(state.points.map(p => p.label));
    if (!labels.has(start)) { alert(`起点 '${start}' 不存在`); return; }
    if (!labels.has(end)) { alert(`终点 '${end}' 不存在`); return; }
    const pair = [start, end, curve_x, curve_y, curve_z].sort().join('|');
    if (state.lines.some(l => [l.start, l.end, l.curve_x, l.curve_y, l.curve_z].sort().join('|') === pair)) { alert('两点间已存在曲率z相同的连线'); return; }
    state.lines.push({ start, end, curve_x, curve_y, curve_z });
    renderTernary();
}

function removeTernLn(idx) {
    AppState.ternary.lines.splice(idx, 1);
    renderTernary();
}

function addTernSurface() {
    const state = AppState.ternary;
    const raw = document.getElementById('sfInput').value.trim().toUpperCase();
    if (raw.length < 3 || raw.length > 4) {
        alert('请输入3或4个顶点标签，如 ABC 或 ADGF');
        return;
    }

    // Auto-expand vertex sequence to edge pairs: "ABC" → AB, BC, CA
    const pairs = [];
    for (let i = 0; i < raw.length; i++) {
        pairs.push(raw[i] + raw[(i + 1) % raw.length]);
    }

    // Validate each character is a known point
    const pointLabels = new Set(state.points.map(p => p.label));
    for (const ch of raw) {
        if (!pointLabels.has(ch)) {
            alert(`顶点 '${ch}' 不存在`);
            return;
        }
    }

    // Validate each pair matches an existing line
    const indices = [];
    const seen = new Set();
    for (const pair of pairs) {
        let found = -1;
        for (let i = 0; i < state.lines.length; i++) {
            const ln = state.lines[i];
            if ((ln.start === pair[0] && ln.end === pair[1]) ||
                (ln.start === pair[1] && ln.end === pair[0])) {
                found = i; break;
            }
        }
        if (found < 0) {
            alert(`边界线${pair}不存在，已自动添加`);
            state.lines.push({ start: pair[0], end: pair[1], curve_x: 0, curve_y: 0, curve_z: 0 });
            found = state.lines.length - 1;
        }
        if (seen.has(found)) { alert(`边界线 ${pair} 重复使用`); return; }
        seen.add(found);
        indices.push(found);
    }

    state.surfs.push({ line_labels: pairs });
    renderTernary();
}

function ternBuildIsoSlider() {
    const state = AppState.ternary;
    const val = state.isoTemp != null ? state.isoTemp : 650;
    const step = 10;
    return `<div class="ternary-iso-slider">
        <span class="ternary-iso-label">等温面 T</span>
        <input type="range" id="ternIsoSlider" min="${TERN_MIN}" max="${TERN_MAX}" value="${val}" step="${step}"
            oninput="ternIsoSliderChange(parseInt(this.value), 'slider')"
            onpointerdown="ternSetDragging(true)"
            onpointerup="ternFinalizeIsoDrag(parseInt(this.value))"
            onchange="ternFinalizeIsoDrag(parseInt(this.value))"
            class="ternary-iso-range">
        <input type="number" id="ternIsoInput" value="${val}" min="${TERN_MIN}" max="${TERN_MAX}" step="${step}"
            onchange="ternIsoSliderChange(parseInt(this.value)||${TERN_MIN}, 'input')"
            class="ternary-iso-input">
    </div>`;
}

function ternIsoSliderChange(val, src) {
    ternPendingIsoTemp = val;
    if (src !== 'slider') {
        const slider = document.getElementById('ternIsoSlider');
        if (slider) slider.value = val;
    }
    if (src !== 'input') {
        const input = document.getElementById('ternIsoInput');
        if (input) input.value = val;
    }
    if (src === 'input') {
        AppState.ternary.isoTemp = val;
        renderTernaryCharts();
        return;
    }
    ternSetDragging(true);
    ternScheduleIsoUpdate();
}

function ternFinalizeIsoDrag(val) {
    ternPendingIsoTemp = val;
    ternSetDragging(false);
    AppState.ternary.isoTemp = val;
    const input = document.getElementById('ternIsoInput');
    if (input) input.value = val;
    const slider = document.getElementById('ternIsoSlider');
    if (slider) slider.value = val;
    renderTernaryCharts();
}

function clearTernary() {
    AppState.ternary.points = [];
    AppState.ternary.lines = [];
    AppState.ternary.surfs = [];
    AppState.ternary.isoTemp = null;
    renderTernary();
}

function saveTernary() {
    const state = AppState.ternary;
    const data = {
        points: state.points.map(p => ({ label: p.label, a: p.a, b: p.b, c: p.c, temp: p.temp })),
        lines: state.lines.map(l => ({ start: l.start, end: l.end, curve_x: l.curve_x, curve_y: l.curve_y, curve_z: l.curve_z })),
        surfaces: state.surfs.map(s => ({ line_labels: s.line_labels })),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ternary_3d_save.json';
    a.click();
    URL.revokeObjectURL(url);
}

function loadTernary() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            try {
                const data = JSON.parse(ev.target.result);
                const state = AppState.ternary;
                state.points = (data.points || []).map(p => ({ label: p.label, a: p.a, b: p.b, c: p.c, temp: p.temp }));
                state.lines = (data.lines || []).map(l => ({ start: l.start, end: l.end, curve_x: l.curve_x, curve_y: l.curve_y, curve_z: l.curve_z }));
                state.surfs = (data.surfaces || []).map(s => ({ line_labels: s.line_labels }));
                state.isoTemp = null;
                renderTernary();
            } catch(err) {
                alert('文件格式错误');
            }
        };
        reader.readAsText(file);
    };
    input.click();
}

function renderTernaryCharts() {
    renderTernary3d();
    renderTernary2d();
}

// ---- 3D View ----

function renderTernary3d() {
    const state = AppState.ternary;
    const traces = [];
    const currentCamera = ternReadSceneCamera();

    // Base triangle
    const triX = [0, 1, 0.5, 0];
    const triY = [0, 0, TERN_Y_TOP, 0];
    traces.push({
        x: triX, y: triY, z: [0, 0, 0, 0],
        mode: 'lines', line: { color: 'black', width: 3 }, name: '底面',
        type: 'scatter3d', showlegend: true,
        hoverinfo: ternShowCoords ? 'x+y+z' : 'skip',
    });

    // Vertical edges
    [[0, 0], [1, 0], [0.5, TERN_Y_TOP]].forEach(([cx, cy]) => {
        traces.push({
            x: [cx, cx], y: [cy, cy], z: [TERN_MIN, TERN_MAX],
            mode: 'lines', line: { color: '#999', width: 1, dash: 'dash' },
            type: 'scatter3d', showlegend: false, hoverinfo: 'skip'
        });
    });

    // Vertex labels
    [[0, 0, 'A'], [1, 0, 'B'], [0.5, TERN_Y_TOP, 'C']].forEach(([cx, cy, lbl]) => {
        traces.push({
            x: [cx], y: [cy], z: [TERN_MIN],
            mode: 'text', text: [lbl], textfont: { size: 14, color: '#C62828' },
            type: 'scatter3d', showlegend: false, hoverinfo: 'skip'
        });
        traces.push({
            x: [cx], y: [cy], z: [TERN_MAX],
            mode: 'text', text: [lbl], textfont: { size: 10, color: '#E53935' },
            type: 'scatter3d', showlegend: false, hoverinfo: 'skip'
        });
    });

    // Temperature grid
    for (let i = 1; i <= 5; i++) {
        const tVal = TERN_MIN + (i / 6) * (TERN_MAX - TERN_MIN);
        traces.push({
            x: triX, y: triY, z: [tVal, tVal, tVal, tVal],
            mode: 'lines', line: { color: '#CCC', width: 0.5 },
            type: 'scatter3d', showlegend: false, hoverinfo: 'skip'
        });
    }

    // Points
    const validPts = state.points.filter(p => p.a != null);
    if (validPts.length > 0) {
        const tx = [], ty = [], tz = [], tlbls = [], thovers = [];
        validPts.forEach(p => {
            const r = XubenBridge.ternary.to3d(p.a, p.b, p.c, p.temp);
            tx.push(r.x); ty.push(r.y); tz.push(r.z); tlbls.push(p.label);
            thovers.push(`${p.label}<br>A=${p.a}% B=${p.b}% C=${p.c}%<br>T=${p.temp}°C`);
        });
        traces.push({
            x: tx, y: ty, z: tz,
            mode: 'markers+text',
            marker: { size: 6, color: '#E53935', line: { width: 1, color: 'white' } },
            text: tlbls, textposition: 'top center',
            textfont: { size: 11, color: '#C62828' },
            name: '数据点', type: 'scatter3d',
            hoverinfo: ternShowCoords ? 'text' : 'skip',
            hovertext: thovers,
        });
    }

    // Lines
    let lnFirst = true;
    state.lines.forEach(ln => {
        const sp = state.points.find(p => p.label === ln.start);
        const ep = state.points.find(p => p.label === ln.end);
        if (!sp || !ep) return;
        const spJSON = JSON.stringify(sp);
        const epJSON = JSON.stringify(ep);
        const curve = XubenBridge.ternary.buildBezier(spJSON, epJSON, ln.curve_x, ln.curve_y, ln.curve_z);
        if (!curve) return;
        traces.push({
            x: curve.xs, y: curve.ys, z: curve.zs,
            mode: 'lines',
            line: { color: '#1565C0', width: 3 },
            name: `${ln.start}-${ln.end}`,
            showlegend: lnFirst,
            type: 'scatter3d',
            hoverinfo: 'skip'
        });
        lnFirst = false;
    });

    // Surfaces
    state.surfs.forEach((s, si) => {
        const indices = [];
        for (const pair of s.line_labels) {
            for (let j = 0; j < state.lines.length; j++) {
                const ln = state.lines[j];
                if ((ln.start === pair[0] && ln.end === pair[1]) ||
                    (ln.start === pair[1] && ln.end === pair[0])) {
                    indices.push(j); break;
                }
            }
        }
        if (indices.length < 3) return;

        try {
            const ptsJSON = JSON.stringify(state.points);
            const lnsJSON = JSON.stringify(state.lines);
            const idxJSON = JSON.stringify(indices);
            const zcData = ternGetCachedMesh(ptsJSON, lnsJSON, idxJSON, indices.length === 3, si, ternCurrentLod());
            if (zcData) {
                const color = SURFACE_COLORS[si % SURFACE_COLORS.length];
                traces.push({
                    x: zcData.xs, y: zcData.ys, z: zcData.zs,
                    i: zcData.is, j: zcData.js, k: zcData.ks,
                    type: 'mesh3d',
                    color: color,
                    opacity: 0.6,
                    name: '曲面#' + (si + 1),
                    hoverinfo: ternShowCoords ? 'x+y+z' : 'skip',
                });
            }
        } catch(e) {
            console.error('Surface error:', e);
        }
    });

    // Isothermal plane
    if (state.isoTemp != null) {
        const t = state.isoTemp;
        traces.push({
            x: [0, 1, 0.5], y: [0, 0, TERN_Y_TOP], z: [t, t, t],
            i: [0], j: [1], k: [2],
            type: 'mesh3d',
            color: '#FF8C00',
            opacity: 0.3,
            name: `等温面 ${t}°C`,
            hoverinfo: 'skip'
        });
    }

    // Hoverable base plane (when coords enabled)
    if (ternShowCoords) {
        traces.push({
            x: [0, 1, 0.5], y: [0, 0, TERN_Y_TOP], z: [0, 0, 0],
            i: [0], j: [1], k: [2],
            type: 'mesh3d',
            color: 'rgba(255,255,255,0)',
            opacity: 0.01,
            name: '坐标面',
            hoverinfo: 'x+y+z',
            showlegend: false,
        });
    }

    const sceneConfig = {
        xaxis: { visible: ternShowAxes, range: [-0.12, 1.12] },
        yaxis: { visible: ternShowAxes, range: [-0.12, TERN_Y_TOP + 0.12] },
        zaxis: { visible: ternShowAxes, title: 'T °C', range: [TERN_MIN, TERN_MAX] },
        aspectmode: 'manual',
        aspectratio: { x: 1, y: 1, z: 0.5 },
        camera: currentCamera || { eye: { x: 1.5, y: 1.5, z: 1.0 } },
    };

    if (ternShowCoords && ternShowAxes) {
        sceneConfig.xaxis = {
            visible: true, range: [-0.12, 1.12],
            title: { text: 'B →' },
            tickvals: [0, 0.25, 0.5, 0.75, 1],
            ticktext: ['0%', '25%', '50%', '75%', '100%'],
            zeroline: false,
        };
        sceneConfig.yaxis = {
            visible: true, range: [-0.12, TERN_Y_TOP + 0.12],
            title: { text: 'C →' },
            tickvals: [0, TERN_Y_TOP * 0.25, TERN_Y_TOP * 0.5, TERN_Y_TOP * 0.75, TERN_Y_TOP],
            ticktext: ['0%', '25%', '50%', '75%', '100%'],
            zeroline: false,
        };
    }

    const layout = {
        scene: sceneConfig,
        autosize: true,
        margin: { l: 0, r: 0, t: 30, b: 0 },
        legend: { orientation: 'h', yanchor: 'top', y: -0.12, xanchor: 'center', x: 0.5, font: { size: 9 } },
        hovermode: ternShowCoords ? 'closest' : false,
        uirevision: 'ternary-3d',
    };

    Plotly.react('ternaryChart3d', traces, layout, { responsive: true });
}

// ---- 2D Projection ----

function renderTernary2d() {
    const state = AppState.ternary;
    const traces = [];
    const isoTemp = state.isoTemp != null ? state.isoTemp : 0;

    const triX = [0, 1, 0.5, 0];
    const triY = [0, 0, TERN_Y_TOP, 0];

    // ---- Surface projection (Coons patches → 2D filled polygons) ----
    state.surfs.forEach((s, si) => {
        const sfIndices = [];
        for (const pair of s.line_labels) {
            for (let j = 0; j < state.lines.length; j++) {
                const ln = state.lines[j];
                if ((ln.start === pair[0] && ln.end === pair[1]) ||
                    (ln.start === pair[1] && ln.end === pair[0])) {
                    sfIndices.push(j); break;
                }
            }
        }
        if (sfIndices.length < 3) return;

        try {
            const ptsJSON = JSON.stringify(state.points);
            const lnsJSON = JSON.stringify(state.lines);
            const idxJSON = JSON.stringify(sfIndices);
            const zcData = ternGetCachedMesh(ptsJSON, lnsJSON, idxJSON, sfIndices.length === 3, si, ternCurrentLod());
            if (!zcData) return;

            const xs = zcData.xs, ys = zcData.ys, zs = zcData.zs;
            const is = zcData.is, js = zcData.js, ks = zcData.ks;
            const numTris = zcData.numTris;
            const baseColor = SURFACE_COLORS[si % SURFACE_COLORS.length];

            const abovePolys = [];
            const sfContour = [];
            const poly2d = (x1, y1, x2, y2, x3, y3) => [[x1, y1], [x2, y2], [x3, y3]];

            for (var ti = 0; ti < numTris; ti++) {
                var i0 = is[ti], i1 = js[ti], i2 = ks[ti];
                var x0 = xs[i0], y0 = ys[i0], z0 = zs[i0];
                var x1 = xs[i1], y1 = ys[i1], z1 = zs[i1];
                var x2 = xs[i2], y2 = ys[i2], z2 = zs[i2];
                var px = [x0, x1, x2], py = [y0, y1, y2], pz = [z0, z1, z2];
                var signed = [z0 - isoTemp, z1 - isoTemp, z2 - isoTemp];
                var onPlane = signed.map(v => Math.abs(v) <= TERN_ISO_EPS);
                var flags = signed.map((v, idx) => (onPlane[idx] ? 0 : +(v > 0)));
                var above = flags[0] + flags[1] + flags[2];
                var allOnPlane = onPlane[0] && onPlane[1] && onPlane[2];
                if (allOnPlane) {
                    sfContour.push([[x0, y0], [x1, y1]]);
                    sfContour.push([[x1, y1], [x2, y2]]);
                    sfContour.push([[x2, y2], [x0, y0]]);
                    continue;
                }

                var triPts = [[x0, y0], [x1, y1], [x2, y2]];
                var triAbove = [];
                var triBelow = [];
                triPts.forEach((pt, idx) => {
                    if (onPlane[idx]) {
                        triAbove.push(pt);
                        triBelow.push(pt);
                    } else if (signed[idx] > 0) {
                        triAbove.push(pt);
                    } else {
                        triBelow.push(pt);
                    }
                });

                var ips = [];
                for (var e = 0; e < 3; e++) {
                    var ea = e, eb = (e + 1) % 3;
                    var pa = triPts[ea], pb = triPts[eb];
                    var za = signed[ea], zb = signed[eb];

                    if (onPlane[ea] && onPlane[eb]) {
                        ips.push(pa, pb);
                        continue;
                    }
                    if (onPlane[ea]) {
                        ips.push(pa);
                        continue;
                    }
                    if (onPlane[eb]) {
                        ips.push(pb);
                        continue;
                    }
                    if (za * zb < 0) {
                        var t = (isoTemp - pz[ea]) / (pz[eb] - pz[ea]);
                        ips.push([
                            px[ea] + t * (px[eb] - px[ea]),
                            py[ea] + t * (py[eb] - py[ea]),
                        ]);
                    }
                }
                ips = ternDedupSegmentPoints(ips);

                if (above === 3) {
                    abovePolys.push(poly2d(x0, y0, x1, y1, x2, y2));
                } else {
                    if (ips.length === 2) {
                        sfContour.push([ips[0], ips[1]]);
                    } else if (ips.length === 3) {
                        sfContour.push([ips[0], ips[1]]);
                        sfContour.push([ips[1], ips[2]]);
                        sfContour.push([ips[2], ips[0]]);
                    }

                    triAbove = ternDedupSegmentPoints(triAbove.concat(ips));
                    triBelow = ternDedupSegmentPoints(triBelow.concat(ips));
                    if (triAbove.length >= 3) {
                        abovePolys.push([triAbove[0], triAbove[1], triAbove[2]]);
                        if (triAbove.length === 4) {
                            abovePolys.push([triAbove[0], triAbove[2], triAbove[3]]);
                        }
                    }
                    if (triBelow.length < 3 && above >= 2) {
                        abovePolys.push(poly2d(x0, y0, x1, y1, x2, y2));
                    }
                }
            }

            // Above-plane fill
            if (ternShowIsoFill && abovePolys.length > 0) {
                const footprintLoops = ternExtractBoundaryLoops(abovePolys);
                const ax = [], ay = [];
                let fillMode = 'none';
                footprintLoops.forEach(loop => {
                    const plotPts = ternPlotlyPolygonPoints(loop);
                    ax.push(...plotPts.x);
                    ay.push(...plotPts.y);
                });
                if (footprintLoops.length > 0) {
                    fillMode = 'fallback';
                }
                if (ax.length > 0) {
                    traces.push({
                        x: ax, y: ay,
                        mode: 'lines', line: { color: 'rgba(0,0,0,0)', width: 0.1 },
                        type: 'scatter', fill: 'toself',
                        fillcolor: baseColor + '55',
                        name: `面#${si + 1} 上方`, showlegend: true, hoverinfo: 'skip',
                    });
                }
            }

            // Surface intersection contour
            if (sfContour.length > 0) {
                const cx = [], cy = [];
                const polylines = ternBuildContourPolylines(ternSplitSegmentsAtIntersections(sfContour));
                polylines.forEach(line => {
                    line.forEach(pt => {
                        cx.push(pt[0]);
                        cy.push(pt[1]);
                    });
                    cx.push(null);
                    cy.push(null);
                });
                traces.push({
                    x: cx, y: cy,
                    mode: 'lines', line: { color: '#D32F2F', width: 3 },
                    type: 'scatter', name: `交线#${si + 1}`, showlegend: true, hoverinfo: 'skip',
                });
            }
        } catch(e) { console.error('Surface 2D error:', e); }
    });

    // ---- Base triangle outline ----
    traces.push({
        x: triX, y: triY, mode: 'lines',
        line: { color: 'black', width: 2 },
        type: 'scatter', showlegend: false, hoverinfo: 'skip',
    });

    // ---- Vertex labels ----
    traces.push({
        x: [-0.02, 1.02, 0.5], y: [-0.06, -0.06, TERN_Y_TOP + 0.06],
        mode: 'text', text: ['A', 'B', 'C'],
        textfont: { size: 14, color: 'black' },
        type: 'scatter', showlegend: false, hoverinfo: 'skip',
    });

    // ---- Projected lines ----
    state.lines.forEach(ln => {
        const sp = state.points.find(p => p.label === ln.start);
        const ep = state.points.find(p => p.label === ln.end);
        if (!sp || !ep) return;
        const spJSON = JSON.stringify(sp);
        const epJSON = JSON.stringify(ep);
        const curve = XubenBridge.ternary.buildBezier(spJSON, epJSON, ln.curve_x, ln.curve_y, ln.curve_z);
        if (!curve) return;
        traces.push({
            x: curve.xs, y: curve.ys,
            mode: 'lines',
            line: { color: '#1565C0', width: 1, dash: 'dot' },
            type: 'scatter', showlegend: false, hoverinfo: 'skip',
        });
    });

    // ---- Projected points ----
    const validPts = state.points.filter(p => p.a != null);
    if (validPts.length > 0) {
        const tx = [], ty = [], tlbls = [];
        validPts.forEach(p => {
            const r = XubenBridge.ternary.to3d(p.a, p.b, p.c, p.temp);
            tx.push(r.x); ty.push(r.y); tlbls.push(p.label);
        });
        traces.push({
            x: tx, y: ty,
            mode: 'markers+text',
            marker: { size: 5, color: '#E53935' },
            text: tlbls, textposition: 'top center',
            textfont: { size: 9, color: '#C62828' },
            type: 'scatter', showlegend: false,
        });
    }

    const layout = {
        xaxis: { visible: false, range: [-0.06, 1.06], scaleanchor: 'y', scaleratio: 1 },
        yaxis: { visible: false, range: [-0.06, TERN_Y_TOP + 0.06] },
        autosize: true,
        margin: { l: 10, r: 10, t: 30, b: 10 },
        plot_bgcolor: 'white',
        showlegend: true,
        legend: { orientation: 'h', yanchor: 'bottom', y: 1.02, xanchor: 'center', x: 0.5, font: { size: 9 } },
    };

    Plotly.react('ternaryChart2d', traces, layout, { responsive: true });
}
