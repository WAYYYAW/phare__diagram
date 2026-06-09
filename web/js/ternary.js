const TERN_Y_TOP = Math.sqrt(3) / 2;
const TERN_MIN = 0;
const TERN_MAX = 1300;
const SURFACE_COLORS = ['#4CAF50', '#2196F3', '#FF9800', '#9C27B0',
    '#E91E63', '#00BCD4', '#795548', '#607D8B'];
let ternShowCoords = false;
let ternActiveTab = 'tPtTab';
let ternShowAxes = false;

function renderTernary() {
    const state = AppState.ternary;
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
                <button class="tab-btn ${ternActiveTab === 'tIsoTab' ? 'active' : ''}" data-tab="tIsoTab" onclick="switchTernaryTab('tIsoTab')">等温面</button>
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
            <div id="tIsoTab" class="tab-panel ${ternActiveTab === 'tIsoTab' ? 'active' : ''}">
                ${renderTernaryIso()}
            </div>
        </div>
        <div style="display:flex;gap:8px;margin-bottom:12px;">
            <button class="btn btn-danger" onclick="clearTernary()">🗑 清空全部</button>
            <button class="btn btn-primary" onclick="saveTernary()">💾 保存相图</button>
            <button class="btn" onclick="loadTernary()">📂 还原相图</button>
            <label style="display:flex;align-items:center;gap:4px;font-size:12px;cursor:pointer;margin-left:auto;">
                <input type="checkbox" ${ternShowCoords ? 'checked' : ''} onchange="ternShowCoords=this.checked;renderTernaryCharts();"> 显示坐标信息
            </label>
            <label style="display:flex;align-items:center;gap:4px;font-size:12px;cursor:pointer;">
                <input type="checkbox" ${ternShowAxes ? 'checked' : ''} onchange="ternShowAxes=this.checked;renderTernaryCharts();"> 显示坐标轴
            </label>
        </div>
        <div class="caption">数据: ${state.points.length}点 / ${state.lines.length}线 / ${state.surfs.length}面 | 等温面: ${state.isoTemp != null ? state.isoTemp + '°C' : '无'}</div>
        <div id="ternHoverInfo" style="margin-top:6px;font-size:12px;min-height:20px;color:#666;"></div>
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
            <td><button class="btn btn-danger" onclick="removeTernPt(${i})" style="padding:2px 6px;font-size:11px;">✕</button></td>
        </tr>`;
    });

    return `
        <div class="grid-4" style="margin-bottom:8px;">
            <div class="form-group"><input type="number" id="tPtA" value="33.3" step="1" min="0" max="100" placeholder="A%"></div>
            <div class="form-group"><input type="number" id="tPtB" value="33.3" step="1" min="0" max="100" placeholder="B%"></div>
            <div class="form-group"><input type="number" id="tPtT" value="800" step="10" placeholder="T °C"></div>
            <div class="form-group"><input type="text" id="tPtLabel" placeholder="标签（留空自动）"></div>
        </div>
        <button class="btn btn-primary btn-full" onclick="addTernPt()" style="margin-bottom:8px;">➕ 添加点</button>
        <table class="data-table">
            <thead><tr><th>标签</th><th>A%</th><th>B%</th><th>C%</th><th>T °C</th><th></th></tr></thead>
            <tbody>${rows || '<tr><td colspan="6" class="empty-state">暂无数据</td></tr>'}</tbody>
        </table>
    `;
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
            <td><button class="btn btn-danger" onclick="removeTernLn(${i})" style="padding:2px 6px;font-size:11px;">✕</button></td>
        </tr>`;
    });

    return `
        <div class="grid-4" style="margin-bottom:8px;">
            <div class="form-group"><input type="text" id="tLnStart" placeholder="起点标签"></div>
            <div class="form-group"><input type="text" id="tLnEnd" placeholder="终点标签"></div>
            <div class="form-group"><input type="number" id="tLnCx" value="0" step="5" placeholder="曲率X"></div>
            <div class="form-group"><input type="number" id="tLnCy" value="0" step="5" placeholder="曲率Y"></div>
        </div>
        <div class="grid-2" style="margin-bottom:8px;">
            <div class="form-group"><input type="number" id="tLnCz" value="0" step="5" placeholder="曲率Z"></div>
            <div class="form-group"><button class="btn btn-primary btn-full" onclick="addTernLn()">➕ 添加线</button></div>
        </div>
        <table class="data-table">
            <thead><tr><th>起点</th><th>终点</th><th>曲率X</th><th>曲率Y</th><th>曲率Z</th><th></th></tr></thead>
            <tbody>${rows || '<tr><td colspan="6" class="empty-state">暂无数据</td></tr>'}</tbody>
        </table>
    `;
}

function renderTernarySurfaces() {
    const state = AppState.ternary;
    let items = '<div class="form-row" style="margin-bottom:8px;"><div class="form-group"><input type="text" id="sfInput" placeholder="边界线 (逗号分隔, 如 AB, BC, CA)"></div><div class="form-group" style="flex:0 0 auto;"><button class="btn btn-primary" onclick="addTernSurface()">🔧 生成曲面</button></div></div>';

    if (state.surfs.length > 0) {
        items += '<table class="data-table"><thead><tr><th>#</th><th>边界线</th></tr></thead><tbody>';
        state.surfs.forEach((s, i) => {
            items += `<tr><td>${i+1}</td><td>${s.line_labels.join(', ')}</td></tr>`;
        });
        items += '</tbody></table>';
        items += '<button class="btn btn-danger btn-full" onclick="removeLastSurface()" style="margin-top:8px;">🗑 删除最后一个曲面</button>';
    } else {
        items += '<div class="empty-state">暂无曲面</div>';
    }
    return items;
}

function renderTernaryIso() {
    const state = AppState.ternary;
    let html = '<div class="form-row" style="margin-bottom:8px;">';
    html += `<div class="form-group"><input type="number" id="isoTemp" value="${state.isoTemp || 600}" step="50" min="${TERN_MIN}" max="${TERN_MAX}"></div>`;
    html += '<div class="form-group" style="flex:0 0 auto;"><button class="btn btn-primary" onclick="addIso()">生成等温面</button></div>';
    html += '<div class="form-group" style="flex:0 0 auto;"><button class="btn" onclick="clearIso()">清除等温面</button></div>';
    html += '</div>';
    if (state.isoHistory.length > 0) {
        html += `<div class="caption">历史: ${state.isoHistory.map(t => t + '°C').join(', ')}</div>`;
    }
    return html;
}

function switchTernaryTab(tabId) {
    ternActiveTab = tabId;
    document.querySelectorAll('#ternaryToolbar .tab-panel').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('#ternaryToolbar .tab-btn').forEach(el => el.classList.remove('active'));
    document.getElementById(tabId).classList.add('active');
    document.querySelector(`#ternaryToolbar .tab-btn[data-tab="${tabId}"]`).classList.add('active');
}

function onTernPtEdit(idx, field, value) {
    AppState.ternary.points[idx][field] = value;
    renderTernaryCharts();
}

function onTernLnEdit(idx, field, value) {
    AppState.ternary.lines[idx][field] = value;
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
    const pair = [start, end].sort().join('|');
    if (state.lines.some(l => [l.start, l.end].sort().join('|') === pair)) { alert('两点间已存在连线'); return; }
    state.lines.push({ start, end, curve_x, curve_y, curve_z });
    renderTernary();
}

function removeTernLn(idx) {
    AppState.ternary.lines.splice(idx, 1);
    renderTernary();
}

function addTernSurface() {
    const state = AppState.ternary;
    const raw = document.getElementById('sfInput').value.trim().replace(/[，、]/g, ',');
    const parts = raw.split(',').map(s => s.trim().toUpperCase()).filter(s => s.length >= 2);
    if (parts.length !== 3 && parts.length !== 4) {
        alert(`需要3或4条线，输入了${parts.length}条`);
        return;
    }
    const indices = [];
    const seen = new Set();
    for (const pair of parts) {
        const sl = pair[0], el = pair[1];
        let found = -1;
        for (let i = 0; i < state.lines.length; i++) {
            const ln = state.lines[i];
            if ((ln.start === sl && ln.end === el) || (ln.start === el && ln.end === sl)) {
                found = i; break;
            }
        }
        if (found < 0) { alert(`未找到线 ${pair}`); return; }
        if (seen.has(found)) { alert('不能重复使用同一条线'); return; }
        seen.add(found);
        indices.push(found);
    }
    state.surfs.push({ line_labels: parts });
    renderTernary();
}

function removeLastSurface() {
    AppState.ternary.surfs.pop();
    renderTernary();
}

function addIso() {
    const state = AppState.ternary;
    const temp = parseFloat(document.getElementById('isoTemp').value) || 600;
    state.isoTemp = temp;
    if (!state.isoHistory.includes(temp)) state.isoHistory.push(temp);
    renderTernaryToolbar();
    renderTernaryCharts();
}

function clearIso() {
    AppState.ternary.isoTemp = null;
    AppState.ternary.isoHistory = [];
    renderTernaryToolbar();
    renderTernaryCharts();
}

function clearTernary() {
    AppState.ternary.points = [];
    AppState.ternary.lines = [];
    AppState.ternary.surfs = [];
    AppState.ternary.isoTemp = null;
    AppState.ternary.isoHistory = [];
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
                state.isoHistory = [];
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
            const r = xubenTernTo3d(p.a, p.b, p.c, p.temp);
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
        const curve = xubenTernBuildBezier(spJSON, epJSON, ln.curve_x, ln.curve_y, ln.curve_z);
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
            let result;
            if (indices.length === 3) {
                result = xubenTernBuildCoons3Edge(ptsJSON, lnsJSON, idxJSON);
            } else {
                result = xubenTernBuildCoons4Edge(ptsJSON, lnsJSON, idxJSON);
            }
            if (result && result.verts) {
                const verts = result.verts;
                const tris = result.tris;
                const color = SURFACE_COLORS[si % SURFACE_COLORS.length];
                traces.push({
                    x: verts.map(v => v[0]),
                    y: verts.map(v => v[1]),
                    z: verts.map(v => v[2]),
                    i: tris.map(t => t[0]),
                    j: tris.map(t => t[1]),
                    k: tris.map(t => t[2]),
                    type: 'mesh3d',
                    color: color,
                    opacity: 0.6,
                    name: `曲面#${si + 1}`,
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
        camera: { eye: { x: 1.5, y: 1.5, z: 1.0 } },
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
        height: 560,
        margin: { l: 0, r: 0, t: 30, b: 0 },
        legend: { orientation: 'h', yanchor: 'top', y: -0.12, xanchor: 'center', x: 0.5, font: { size: 9 } },
        hovermode: ternShowCoords ? 'closest' : false,
    };

    Plotly.newPlot('ternaryChart3d', traces, layout, { responsive: true });

    if (ternShowCoords) {
        document.getElementById('ternaryChart3d').on('plotly_hover', (eventData) => {
            const pts = eventData.points;
            if (!pts || pts.length === 0) return;
            const p = pts[0];
            const infoEl = document.getElementById('ternHoverInfo');
            if (!infoEl) return;

            if (p.data && p.data.name === '坐标面') {
                const r = xubenTernFrom3d(p.x, p.y);
                infoEl.innerHTML = `<span style="color:#333;"><b>📍 坐标:</b> A=${r.a}% B=${r.b}% C=${r.c}% | x=${p.x.toFixed(4)} y=${p.y.toFixed(4)} z=${p.z.toFixed(1)}°C</span>`;
            } else if (p.data && p.data.name === '数据点') {
                infoEl.innerHTML = `<span style="color:#333;">${p.hovertext || p.text}</span>`;
            } else if (p.data && p.data.type === 'mesh3d' && p.data.name && p.data.name.startsWith('曲面')) {
                const r = xubenTernFrom3d(p.x, p.y);
                infoEl.innerHTML = `<span style="color:#333;"><b>${p.data.name}</b> A=${r.a}% B=${r.b}% C=${r.c}% | T=${p.z.toFixed(1)}°C</span>`;
            } else {
                const r = xubenTernFrom3d(p.x, p.y);
                infoEl.innerHTML = `<span style="color:#888;">A=${r.a}% B=${r.b}% C=${r.c}% | (${p.x.toFixed(4)}, ${p.y.toFixed(4)}, ${p.z.toFixed(1)})</span>`;
            }
        });
        document.getElementById('ternaryChart3d').on('plotly_unhover', () => {
            const infoEl = document.getElementById('ternHoverInfo');
            if (infoEl) infoEl.innerHTML = '';
        });
    } else {
        const infoEl = document.getElementById('ternHoverInfo');
        if (infoEl) infoEl.innerHTML = '';
    }
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
            let result;
            if (sfIndices.length === 3) {
                result = xubenTernBuildCoons3Edge(ptsJSON, lnsJSON, idxJSON);
            } else {
                result = xubenTernBuildCoons4Edge(ptsJSON, lnsJSON, idxJSON);
            }
            if (!result || !result.verts) return;

            const verts = result.verts;
            const tris = result.tris;
            const baseColor = SURFACE_COLORS[si % SURFACE_COLORS.length];

            const abovePolys = [];
            const belowPolys = [];
            const sfContour = [];

            const lerp = (a, b, za, zb) => {
                const t = (isoTemp - za) / (zb - za);
                return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
            };
            const poly2d = (x1, y1, x2, y2, x3, y3) => [x1, y1, x2, y2, x3, y3, x1, y1, null, null];

            tris.forEach(tri => {
                const v0 = verts[tri[0]], v1 = verts[tri[1]], v2 = verts[tri[2]];
                const z0 = v0[2], z1 = v1[2], z2 = v2[2];
                const flags = [+(z0 > isoTemp), +(z1 > isoTemp), +(z2 > isoTemp)];
                const above = flags[0] + flags[1] + flags[2];

                if (above === 3) {
                    abovePolys.push(poly2d(v0[0], v0[1], v1[0], v1[1], v2[0], v2[1]));
                } else if (above === 0) {
                    belowPolys.push(poly2d(v0[0], v0[1], v1[0], v1[1], v2[0], v2[1]));
                } else {
                    const up = [], dn = [];
                    [v0, v1, v2].forEach((v, i) => { (flags[i] ? up : dn).push(v); });
                    const ips = [];
                    for (let e = 0; e < 3; e++) {
                        const a = [v0, v1, v2][e], b = [v0, v1, v2][(e + 1) % 3];
                        if ((a[2] - isoTemp) * (b[2] - isoTemp) < 0) ips.push(lerp(a, b, a[2], b[2]));
                    }
                    if (ips.length === 2) sfContour.push([ips[0], ips[1]]);

                    if (above === 1) {
                        const A = up[0];
                        abovePolys.push(poly2d(A[0], A[1], ips[0][0], ips[0][1], ips[1][0], ips[1][1]));
                        belowPolys.push(poly2d(dn[0][0], dn[0][1], ips[0][0], ips[0][1], ips[1][0], ips[1][1]));
                        belowPolys.push(poly2d(dn[0][0], dn[0][1], ips[1][0], ips[1][1], dn[1][0], dn[1][1]));
                    } else {
                        const B = dn[0];
                        abovePolys.push(poly2d(up[0][0], up[0][1], ips[0][0], ips[0][1], ips[1][0], ips[1][1]));
                        abovePolys.push(poly2d(up[0][0], up[0][1], ips[1][0], ips[1][1], up[1][0], up[1][1]));
                        belowPolys.push(poly2d(B[0], B[1], ips[0][0], ips[0][1], ips[1][0], ips[1][1]));
                    }
                }
            });

            // Above-plane fill
            if (abovePolys.length > 0) {
                const ax = [], ay = [];
                abovePolys.forEach(p => { ax.push(...p.filter((_, i) => i % 2 === 0)); ay.push(...p.filter((_, i) => i % 2 === 1)); });
                traces.push({
                    x: ax, y: ay,
                    mode: 'lines', line: { color: baseColor, width: 1.5 },
                    type: 'scatter', fill: 'toself',
                    fillcolor: baseColor + '55',
                    name: `面#${si + 1} 上方`, showlegend: true, hoverinfo: 'skip',
                });
            }

            // Below-plane fill (faint)
            if (belowPolys.length > 0) {
                const bx = [], by = [];
                belowPolys.forEach(p => { bx.push(...p.filter((_, i) => i % 2 === 0)); by.push(...p.filter((_, i) => i % 2 === 1)); });
                traces.push({
                    x: bx, y: by,
                    mode: 'lines', line: { color: '#ccc', width: 0.5 },
                    type: 'scatter', fill: 'toself',
                    fillcolor: baseColor + '14',
                    name: `面#${si + 1} 下方`, showlegend: true, hoverinfo: 'skip',
                });
            }

            // Surface intersection contour
            if (sfContour.length > 0) {
                const cx = [], cy = [];
                sfContour.forEach(seg => { cx.push(seg[0][0], seg[1][0], null); cy.push(seg[0][1], seg[1][1], null); });
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
        const curve = xubenTernBuildBezier(spJSON, epJSON, ln.curve_x, ln.curve_y, ln.curve_z);
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
            const r = xubenTernTo3d(p.a, p.b, p.c, p.temp);
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
        height: 440,
        margin: { l: 10, r: 10, t: 30, b: 10 },
        plot_bgcolor: 'white',
        showlegend: true,
        legend: { orientation: 'h', yanchor: 'bottom', y: 1.02, xanchor: 'center', x: 0.5, font: { size: 9 } },
    };

    Plotly.react('ternaryChart2d', traces, layout, { responsive: true });
}

