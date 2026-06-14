let binaryCollapsed = { pt: false };
let binaryModelVersion = 0;
let binaryBaseTraceCache = { key: null, traces: null };
let binaryPayloadCache = { version: -1, pointsJSON: '', linesJSON: '' };

function getBinaryTemplateNames() {
    return listTemplateNames(AppState.templates).filter(name => name !== '手动模式');
}

function markBinaryCustomTemplate() {
    AppState.binary.activeTemplate = BINARY_TEMPLATE_CUSTOM;
}

function resetBinaryCalcState() {
    AppState.binary.calcPos = null;
    AppState.binary.calcRes = null;
}

function applyBinaryTemplateData(name, result) {
    const state = AppState.binary;
    state.points = result.points || [];
    state.lines = result.lines || [];
    state.activeTemplate = name;

    const temps = state.points.filter(p => p.temp != null).map(p => p.temp);
    const comps = state.points.filter(p => p.comp != null).map(p => p.comp);
    const maxTemp = temps.length ? Math.max(...temps) : 1500;
    const maxComp = comps.length ? Math.max(...comps) : 100;

    state.axisRange.ymin = 0;
    state.axisRange.ymax = maxTemp + 250;
    state.axisRange.xmax = maxComp < 80 ? maxComp * 1.05 : 100;
    state.axisRange.xmin = 0;
    resetBinaryCalcState();
}

function bumpBinaryModelVersion() {
    binaryModelVersion += 1;
    binaryBaseTraceCache.key = null;
    binaryBaseTraceCache.traces = null;
}

function getBinaryPayloads() {
    if (binaryPayloadCache.version === binaryModelVersion) {
        return binaryPayloadCache;
    }

    const state = AppState.binary;
    binaryPayloadCache = {
        version: binaryModelVersion,
        pointsJSON: JSON.stringify(state.points.map(p => ({
            label: p.label,
            comp: p.comp,
            temp: p.temp,
        }))),
        linesJSON: JSON.stringify(state.lines),
    };
    return binaryPayloadCache;
}

function toggleBinaryCollapse(sectionEl, key) {
    sectionEl.classList.toggle('collapsed');
    binaryCollapsed[key] = sectionEl.classList.contains('collapsed');
}

function binaryCollapsibleWrap(label, count, content, key, extraClass = '') {
    var collapsed = binaryCollapsed[key] ? ' collapsed' : '';
    var icon = binaryCollapsed[key] ? '▶' : '▼';
    return '<div class="collapsible-section' + extraClass + collapsed + '" data-key="' + key + '">' +
        '<div class="collapsible-header" onclick="toggleBinaryCollapse(this.parentElement,\'' + key + '\')">' +
            '<span class="collapsible-icon">' + icon + '</span>' +
            '<span>' + label + '</span>' +
            '<span class="collapsible-badge">' + count + '</span>' +
        '</div>' +
        '<div class="collapsible-body">' + content + '</div>' +
    '</div>';
}

function initBinary() {
    renderBinary();
}

function renderBinary() {
    renderBinarySidebar();
    renderBinaryChart(false);
    renderBinaryResult();
}

function getBinaryCalcPositionFromEvent(evt) {
    const chart = document.getElementById('binaryChart');
    if (!chart || !chart._fullLayout || !chart._fullLayout._size) return null;

    const fullLayout = chart._fullLayout;
    const size = fullLayout._size;
    const rect = chart.getBoundingClientRect();
    const plotX = evt.clientX - rect.left - size.l;
    const plotY = evt.clientY - rect.top - size.t;

    if (plotX < 0 || plotY < 0 || plotX > size.w || plotY > size.h) {
        return null;
    }

    const xRange = fullLayout.xaxis && fullLayout.xaxis.range;
    const yRange = fullLayout.yaxis && fullLayout.yaxis.range;
    if (!xRange || !yRange) return null;

    const comp = xRange[0] + (plotX / size.w) * (xRange[1] - xRange[0]);
    const temp = yRange[1] - (plotY / size.h) * (yRange[1] - yRange[0]);
    return [comp, temp];
}

function syncBinaryCalcInputs() {
    const state = AppState.binary;
    if (!state.calcPos) return;

    const compInput = document.getElementById('calcComp');
    const tempInput = document.getElementById('calcTemp');
    if (compInput) compInput.value = state.calcPos[0].toFixed(2);
    if (tempInput) tempInput.value = state.calcPos[1].toFixed(1);
}

function applyBinaryCalcAt(comp, temp) {
    const state = AppState.binary;
    const safeComp = Math.max(0, Math.min(100, comp));
    state.calcPos = [safeComp, temp];

    const payloads = getBinaryPayloads();
    state.calcRes = XubenBridge.performLeverRule(payloads.pointsJSON, payloads.linesJSON, safeComp, temp);
    renderBinaryChart();
    renderBinaryResult();
    syncBinaryCalcInputs();
}

function onBinaryCalcOverlayClick(evt) {
    if (!AppState.binary.calcMode) return;
    const pos = getBinaryCalcPositionFromEvent(evt);
    if (!pos) return;
    applyBinaryCalcAt(pos[0], pos[1]);
}

function ensureBinaryCalcOverlay() {
    const overlay = document.getElementById('binaryCalcOverlay');
    if (!overlay) return;

    if (!overlay.dataset.bound) {
        overlay.addEventListener('click', onBinaryCalcOverlayClick);
        overlay.dataset.bound = '1';
    }

    overlay.classList.toggle('active', AppState.binary.calcMode);
}

function getBinaryBaseTraces(xRange, yRange, tplName) {
    const state = AppState.binary;
    const cacheKey = JSON.stringify({
        version: binaryModelVersion,
        xRange,
        yRange,
        tplName,
        showRegionFill: state.showRegionFill,
    });
    if (binaryBaseTraceCache.key === cacheKey && binaryBaseTraceCache.traces) {
        return binaryBaseTraceCache.traces.slice();
    }

    const traces = [];

    if (state.showRegionFill && tplName !== BINARY_TEMPLATE_CUSTOM) {
        const tmpl = AppState.templates[tplName];
        if (tmpl && tmpl.topology && tmpl.topology.regions) {
            const ptMap = {};
            state.points.forEach(p => {
                if (p.comp != null && p.temp != null) ptMap[p.label] = [p.comp, p.temp];
            });
            ptMap.T_LEFT = [0, yRange[1] * 2];
            ptMap.T_RIGHT = [100, yRange[1] * 2];
            ptMap.B_LEFT = [0, yRange[0] - 500];
            ptMap.B_RIGHT = [100, yRange[0] - 500];

            tmpl.topology.regions.forEach((rDef, i) => {
                const verts = rDef.points.map(lbl => ptMap[lbl]).filter(v => v);
                if (verts.length < 3) return;
                const xs = verts.map(v => v[0]);
                const ys = verts.map(v => v[1]);
                xs.push(xs[0]);
                ys.push(ys[0]);
                traces.push({
                    x: xs,
                    y: ys,
                    fill: 'toself',
                    fillcolor: AppState.regionColors[i % AppState.regionColors.length],
                    line: { width: 0 },
                    mode: 'none',
                    name: rDef.label,
                    showlegend: true,
                    hoverinfo: 'skip',
                    type: 'scatter',
                });
            });
        }
    }

    const shownTypes = new Set();
    state.lines.forEach(ln => {
        const p1 = state.points.find(p => p.label === ln.start);
        const p2 = state.points.find(p => p.label === ln.end);
        if (!p1 || !p2 || p1.comp == null || p2.comp == null) return;

        const curve = XubenBridge.computeBezierCurve(p1.comp, p1.temp, p2.comp, p2.temp, ln.curve, 40);
        const style = AppState.lineStyles[ln.type] || AppState.lineStyles.other;
        const dashMap = { '-': 'solid', '--': 'dash', '-.': 'dashdot', ':': 'dot' };
        const isFirst = !shownTypes.has(ln.type);
        shownTypes.add(ln.type);

        traces.push({
            x: curve.xs,
            y: curve.ys,
            mode: 'lines',
            line: { color: style.color, width: style.lw, dash: dashMap[style.ls] || 'solid' },
            name: style.label,
            legendgroup: style.label,
            showlegend: isFirst,
            hoverinfo: 'skip',
            type: 'scatter',
        });
    });

    const validPts = state.points.filter(p => p.comp != null && p.temp != null);
    if (validPts.length > 0) {
        traces.push({
            x: validPts.map(p => p.comp),
            y: validPts.map(p => p.temp),
            mode: 'markers+text',
            marker: { color: '#E53935', size: 10, line: { width: 1, color: 'white' } },
            text: validPts.map(p => p.label),
            textposition: 'top right',
            name: '特征点',
            type: 'scatter',
        });
    }

    binaryBaseTraceCache = { key: cacheKey, traces };
    return traces.slice();
}

function getBinaryCalcTraces() {
    const state = AppState.binary;
    const traces = [];
    if (!state.calcRes || !state.calcPos) return traces;

    const res = state.calcRes;
    const [cp, tp] = state.calcPos;
    if (res.type === 'two_phase') {
        traces.push({
            x: [res.left, res.right],
            y: [tp, tp],
            mode: 'lines+markers',
            line: { color: '#2E7D32', width: 3 },
            marker: { symbol: 'diamond', size: 11, color: '#2E7D32' },
            name: '杠杆臂',
            type: 'scatter',
        });
    }

    traces.push({
        x: [cp],
        y: [tp],
        mode: 'markers',
        marker: { color: '#FFEB3B', size: 13, line: { width: 2, color: 'black' } },
        name: '计算选点',
        type: 'scatter',
    });
    return traces;
}

function getBinaryLegendItems() {
    const state = AppState.binary;
    const items = [];
    const tplName = state.activeTemplate;

    if (state.showRegionFill && tplName !== BINARY_TEMPLATE_CUSTOM) {
        const tmpl = AppState.templates[tplName];
        if (tmpl && tmpl.topology && tmpl.topology.regions) {
            tmpl.topology.regions.forEach((region, i) => {
                items.push({
                    kind: 'region',
                    label: region.label,
                    color: AppState.regionColors[i % AppState.regionColors.length],
                });
            });
        }
    }

    const shownTypes = new Set();
    state.lines.forEach(ln => {
        const style = AppState.lineStyles[ln.type] || AppState.lineStyles.other;
        if (!style || shownTypes.has(style.label)) return;
        shownTypes.add(style.label);
        items.push({
            kind: 'line',
            label: style.label,
            color: style.color,
            dash: style.ls,
        });
    });

    const hasPoint = state.points.some(p => p.comp != null && p.temp != null);
    if (hasPoint) {
        items.push({
            kind: 'point',
            label: '特征点',
            color: '#E53935',
        });
    }

    if (state.calcRes && state.calcPos && state.calcRes.type === 'two_phase') {
        items.push({
            kind: 'line',
            label: '杠杆臂',
            color: '#2E7D32',
            dash: '-',
        });
        items.push({
            kind: 'point',
            label: '计算选点',
            color: '#FFEB3B',
            ring: true,
        });
    }

    return items;
}

function renderBinaryLegend() {
    const container = document.getElementById('binaryLegend');
    if (!container) return;

    const items = getBinaryLegendItems();
    if (items.length === 0) {
        container.innerHTML = '';
        container.classList.add('is-empty');
        return;
    }

    container.classList.remove('is-empty');
    container.innerHTML = items.map(item => {
        if (item.kind === 'region') {
            return `<span class="binary-legend-item">
                <span class="binary-legend-swatch region" style="--legend-color:${item.color};"></span>
                <span class="binary-legend-label">${item.label}</span>
            </span>`;
        }
        if (item.kind === 'point') {
            return `<span class="binary-legend-item">
                <span class="binary-legend-swatch point${item.ring ? ' ring' : ''}" style="--legend-color:${item.color};"></span>
                <span class="binary-legend-label">${item.label}</span>
            </span>`;
        }
        const dashClass = item.dash === '--'
            ? 'dash'
            : item.dash === '-.'
                ? 'dashdot'
                : item.dash === ':'
                    ? 'dot'
                    : 'solid';
        return `<span class="binary-legend-item">
            <span class="binary-legend-line ${dashClass}" style="--legend-color:${item.color};"></span>
            <span class="binary-legend-label">${item.label}</span>
        </span>`;
    }).join('');
}

function renderBinarySidebar() {
    const sidebar = document.getElementById('binarySidebar');
    const state = AppState.binary;
    const templateNames = getBinaryTemplateNames();

    let html = `
        <div class="card">
            <div class="card-title">模板选择</div>
            <div class="form-group">
                <select id="tplSelect" onchange="onTemplateChange()">
                    ${templateNames.map(n => `<option value="${n}" ${n === state.activeTemplate ? 'selected' : ''}>${n}</option>`).join('')}
                    <option value="${BINARY_TEMPLATE_CUSTOM}" ${state.activeTemplate === BINARY_TEMPLATE_CUSTOM ? 'selected' : ''}>${BINARY_TEMPLATE_CUSTOM}</option>
                </select>
            </div>
        </div>

        <div class="card">
            <div class="card-title">数据管理面板</div>
            <div class="tabs">
                <button class="tab-btn active" data-tab="ptTab" onclick="switchBinaryTab('ptTab')">特征点</button>
                <button class="tab-btn" data-tab="lnTab" onclick="switchBinaryTab('lnTab')">边界线</button>
            </div>
            <div id="ptTab" class="tab-panel active">
                ${renderPointsEditor()}
            </div>
            <div id="lnTab" class="tab-panel">
                ${renderLinesEditor()}
            </div>
        </div>

        <div class="card">
            <div class="card-title">交互与显示</div>
            <div class="form-group">
                <label class="toggle-label">
                    <input type="checkbox" ${state.calcMode ? 'checked' : ''} onchange="onToggleCalcMode(this.checked)">
                    开启杠杆计算模式
                </label>
            </div>
            <div class="form-group">
                <label class="toggle-label">
                    <input type="checkbox" ${state.showRegionFill ? 'checked' : ''} onchange="onToggleRegionFill(this.checked)">
                    相区自动上色（实验性）
                </label>
            </div>
            ${state.calcMode ? `
                <div class="form-row">
                    <div class="form-group">
                        <label>成分 (wt% B)</label>
                        <input type="number" id="calcComp" value="${state.calcPos ? state.calcPos[0].toFixed(2) : '50.00'}" min="0" max="100" step="0.5">
                    </div>
                    <div class="form-group">
                        <label>温度 (°C)</label>
                        <input type="number" id="calcTemp" value="${state.calcPos ? state.calcPos[1].toFixed(1) : '800.0'}" step="10">
                    </div>
                </div>
                <button class="btn btn-primary btn-full" onclick="onCalcLever()">执行杠杆计算</button>
            ` : ''}
        </div>

        <div class="card">
            <div class="card-title">坐标轴控制</div>
            <div class="form-row">
                <div class="form-group">
                    <label>X Min</label>
                    <input type="number" id="axXmin" value="${state.axisRange.xmin}" step="5" onchange="onAxisChange()">
                </div>
                <div class="form-group">
                    <label>X Max</label>
                    <input type="number" id="axXmax" value="${state.axisRange.xmax}" step="5" onchange="onAxisChange()">
                </div>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>Y Min</label>
                    <input type="number" id="axYmin" value="${state.axisRange.ymin}" step="50" onchange="onAxisChange()">
                </div>
                <div class="form-group">
                    <label>Y Max</label>
                    <input type="number" id="axYmax" value="${state.axisRange.ymax}" step="50" onchange="onAxisChange()">
                </div>
            </div>
        </div>
    `;
    sidebar.innerHTML = html;
}

function renderPointsEditor() {
    const state = AppState.binary;
    let rows = '';
    state.points.forEach((p, i) => {
        rows += `<tr>
            <td><input type="text" value="${p.label || ''}" data-pt-idx="${i}" data-field="label" onchange="onPointEdit(${i}, 'label', this.value)"></td>
            <td><input type="number" value="${p.comp != null ? p.comp : ''}" step="0.5" data-pt-idx="${i}" data-field="comp" onchange="onPointEdit(${i}, 'comp', parseFloat(this.value) || 0)"></td>
            <td><input type="number" value="${p.temp != null ? p.temp : ''}" step="10" data-pt-idx="${i}" data-field="temp" onchange="onPointEdit(${i}, 'temp', parseFloat(this.value) || 0)"></td>
            <td><button class="btn btn-danger binary-action-btn" onclick="removePoint(${i})">✕</button></td>
        </tr>`;
    });

    const tableHTML = rows
        ? `<div class="data-table-wrapper">
            <table class="data-table">
                <thead><tr><th>标签</th><th>成分 B%</th><th>温度 °C</th><th></th></tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </div>`
        : '<div class="empty-state">暂无数据</div>';

    let body = `
        <div class="form-row binary-editor-row">
            <div class="form-group">
                <input type="text" id="newPtLabel" placeholder="标签（留空自动）">
            </div>
            <div class="form-group">
                <input type="number" id="newPtComp" value="50" step="0.5" min="0" max="100">
            </div>
            <div class="form-group">
                <input type="number" id="newPtTemp" value="500" step="10">
            </div>
        </div>
        <button class="btn btn-primary btn-full binary-editor-add" onclick="addPoint()">➕ 添加点</button>`;

    if (rows) {
        body += binaryCollapsibleWrap('特征点列表', state.points.length + '个', tableHTML, 'pt', ' binary-point-list');
    } else {
        body += tableHTML;
    }

    return body;
}

function renderLinesEditor() {
    const state = AppState.binary;
    const lineTypes = Object.keys(AppState.lineStyles);
    let rows = '';
    state.lines.forEach((l, i) => {
        rows += `<tr>
            <td class="col-start"><input type="text" value="${l.start || ''}" onchange="onLineEdit(${i}, 'start', this.value)"></td>
            <td class="col-end"><input type="text" value="${l.end || ''}" onchange="onLineEdit(${i}, 'end', this.value)"></td>
            <td class="col-type"><select onchange="onLineEdit(${i}, 'type', this.value)">
                ${lineTypes.map(t => `<option value="${t}" ${l.type === t ? 'selected' : ''}>${AppState.lineStyles[t].label}</option>`).join('')}
            </select></td>
            <td class="col-curve"><input type="number" value="${l.curve || 0}" step="50" onchange="onLineEdit(${i}, 'curve', parseFloat(this.value) || 0)"></td>
            <td class="col-actions"><button class="btn btn-danger binary-action-btn" onclick="removeLine(${i})">✕</button></td>
        </tr>`;
    });

    return `
        <div class="form-row binary-editor-row">
            <div class="form-group"><input type="text" id="newLnStart" placeholder="起点标签"></div>
            <div class="form-group"><input type="text" id="newLnEnd" placeholder="终点标签"></div>
        </div>
        <div class="form-row binary-editor-row">
            <div class="form-group">
                <select id="newLnType">
                    ${lineTypes.map(t => `<option value="${t}">${AppState.lineStyles[t].label}</option>`).join('')}
                </select>
            </div>
            <div class="form-group">
                <input type="number" id="newLnCurve" value="0" step="50" placeholder="曲率">
            </div>
        </div>
        <button class="btn btn-primary btn-full binary-editor-add" onclick="addLine()">➕ 添加线</button>
        <div class="data-table-wrapper">
        <table class="data-table">
            <thead><tr><th class="col-start">起点</th><th class="col-end">终点</th><th class="col-type">类型</th><th class="col-curve">曲率</th><th class="col-actions"></th></tr></thead>
            <tbody>${rows || '<tr><td colspan="5" class="empty-state">暂无数据</td></tr>'}</tbody>
        </table>
        </div>
    `;
}

function switchBinaryTab(tabId) {
    document.querySelectorAll('#binarySidebar .tab-panel').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('#binarySidebar .tab-btn').forEach(el => el.classList.remove('active'));
    document.getElementById(tabId).classList.add('active');
    document.querySelector(`#binarySidebar .tab-btn[data-tab="${tabId}"]`).classList.add('active');
}

function onTemplateChange() {
    const name = document.getElementById('tplSelect').value;
    const state = AppState.binary;

    if (name === BINARY_TEMPLATE_CUSTOM) {
        state.activeTemplate = BINARY_TEMPLATE_CUSTOM;
        state.points = [];
        state.lines = [];
        resetBinaryCalcState();
        bumpBinaryModelVersion();
        renderBinary();
        return;
    }

    const tmpl = AppState.templates[name];
    if (!tmpl) return;

    const params = {};
    tmpl.params.forEach(p => { params[p.key] = p.default; });

    const result = XubenBridge.computeTemplatePoints(name, JSON.stringify(params));
    if (result && !result.error) {
        applyBinaryTemplateData(name, result);
    }
    bumpBinaryModelVersion();
    renderBinarySidebar();
    renderBinaryChart(false);
    renderBinaryResult();
}

function onPointEdit(idx, field, value) {
    AppState.binary.points[idx][field] = value;
    markBinaryCustomTemplate();
    bumpBinaryModelVersion();
    renderBinarySidebar();
    renderBinaryChart();
    renderBinaryResult();
}

function onLineEdit(idx, field, value) {
    AppState.binary.lines[idx][field] = value;
    markBinaryCustomTemplate();
    bumpBinaryModelVersion();
    renderBinarySidebar();
    renderBinaryChart();
    renderBinaryResult();
}

function addPoint() {
    const state = AppState.binary;
    const label = document.getElementById('newPtLabel').value.trim();
    const comp = parseFloat(document.getElementById('newPtComp').value) || 0;
    const temp = parseFloat(document.getElementById('newPtTemp').value) || 0;
    const finalLabel = label || nextAutoLabel(state.points.map(p => p.label));
    if (state.points.some(p => p.label === finalLabel)) {
        alert(`标签 '${finalLabel}' 已存在`);
        return;
    }
    state.points.push({ label: finalLabel, comp, temp });
    markBinaryCustomTemplate();
    bumpBinaryModelVersion();
    renderBinary();
}

function removePoint(idx) {
    const state = AppState.binary;
    const label = state.points[idx].label;
    state.points.splice(idx, 1);
    state.lines = state.lines.filter(l => l.start !== label && l.end !== label);
    markBinaryCustomTemplate();
    bumpBinaryModelVersion();
    renderBinary();
}

function addLine() {
    const state = AppState.binary;
    const start = document.getElementById('newLnStart').value.trim();
    const end = document.getElementById('newLnEnd').value.trim();
    const type = document.getElementById('newLnType').value;
    const curve = parseFloat(document.getElementById('newLnCurve').value) || 0;

    const labels = new Set(state.points.map(p => p.label));
    if (!start || !end) { alert('起点和终点不能为空'); return; }
    if (start === end) { alert('不能自环'); return; }
    if (!labels.has(start)) { alert(`起点 '${start}' 不存在`); return; }
    if (!labels.has(end)) { alert(`终点 '${end}' 不存在`); return; }

    const pair = [start, end].sort().join('|');
    if (state.lines.some(l => [l.start, l.end].sort().join('|') === pair)) {
        alert('两点间已存在连线');
        return;
    }
    state.lines.push({ start, end, type, curve });
    markBinaryCustomTemplate();
    bumpBinaryModelVersion();
    renderBinary();
}

function removeLine(idx) {
    AppState.binary.lines.splice(idx, 1);
    markBinaryCustomTemplate();
    bumpBinaryModelVersion();
    renderBinary();
}

function onToggleCalcMode(val) {
    AppState.binary.calcMode = val;
    renderBinarySidebar();
    renderBinaryChart();
}

function onToggleRegionFill(val) {
    AppState.binary.showRegionFill = val;
    binaryBaseTraceCache.key = null;
    binaryBaseTraceCache.traces = null;
    renderBinaryChart();
}

function onAxisChange() {
    const state = AppState.binary;
    state.axisRange.xmin = parseFloat(document.getElementById('axXmin').value) || 0;
    state.axisRange.xmax = parseFloat(document.getElementById('axXmax').value) || 100;
    state.axisRange.ymin = parseFloat(document.getElementById('axYmin').value) || 0;
    state.axisRange.ymax = parseFloat(document.getElementById('axYmax').value) || 1500;
    renderBinaryChart(false);
}

function onCalcLever() {
    const comp = parseFloat(document.getElementById('calcComp').value) || 0;
    const temp = parseFloat(document.getElementById('calcTemp').value) || 0;
    applyBinaryCalcAt(comp, temp);
}

function readBinaryChartRanges() {
    try {
        const chart = document.getElementById('binaryChart');
        if (!chart || !chart._fullLayout) return null;
        const xr = chart._fullLayout.xaxis && chart._fullLayout.xaxis.range;
        const yr = chart._fullLayout.yaxis && chart._fullLayout.yaxis.range;
        if (!xr || !yr || xr.length !== 2 || yr.length !== 2) return null;
        return {
            xRange: [xr[0], xr[1]],
            yRange: [yr[0], yr[1]],
        };
    } catch (e) {
        return null;
    }
}

function isBinaryNarrowScreen() {
    return window.innerWidth <= 768;
}

function renderBinaryChart(preserveView = true) {
    const state = AppState.binary;
    const currentRanges = preserveView ? readBinaryChartRanges() : null;
    const xRange = currentRanges ? currentRanges.xRange : [state.axisRange.xmin, state.axisRange.xmax];
    const yRange = currentRanges ? currentRanges.yRange : [state.axisRange.ymin, state.axisRange.ymax];
    const tplName = state.activeTemplate;
    const isNarrow = isBinaryNarrowScreen();
    const traces = getBinaryBaseTraces(xRange, yRange, tplName).concat(getBinaryCalcTraces());

    const layout = {
        xaxis: {
            title: isNarrow ? '' : '成分 (wt% B)',
            range: xRange,
            gridcolor: '#EEEEEE',
            tickfont: { size: isNarrow ? 10 : 12 },
            automargin: true,
        },
        yaxis: {
            title: isNarrow ? '' : '温度 (°C)',
            range: yRange,
            gridcolor: '#EEEEEE',
            tickfont: { size: isNarrow ? 10 : 12 },
            automargin: true,
        },
        autosize: true,
        margin: isNarrow
            ? { l: 38, r: 10, t: 12, b: 22 }
            : { l: 50, r: 20, t: 30, b: 72 },
        clickmode: 'event+select',
        dragmode: 'pan',
        plot_bgcolor: 'white',
        uirevision: 'binary-chart',
        legend: {
            orientation: 'h',
            traceorder: 'normal',
            yanchor: 'top', y: isNarrow ? -0.08 : -0.14,
            xanchor: 'left', x: 0,
            entrywidthmode: 'pixels',
            entrywidth: isNarrow ? 56 : 72,
            bgcolor: 'rgba(255,255,255,0.65)',
            bordercolor: '#CCCCCC',
            borderwidth: 1,
            font: { size: isNarrow ? 8 : 9 },
            groupclick: 'toggleitem',
        }
    };

    if (isNarrow) {
        layout.showlegend = false;
    }

    Plotly.react('binaryChart', traces, layout, { responsive: true })
        .then(() => {
            renderBinaryLegend();
            ensureBinaryCalcOverlay();
        });
}

function renderBinaryResult() {
    const state = AppState.binary;
    const container = document.getElementById('binaryResult');
    if (!state.calcPos) {
        container.innerHTML = '';
        return;
    }
    const [cp, tp] = state.calcPos;
    const tplName = state.activeTemplate;
    const payloads = getBinaryPayloads();
    const regionName = tplName === BINARY_TEMPLATE_CUSTOM
        ? ''
        : XubenBridge.getRegionAt(payloads.pointsJSON, tplName, cp, tp);

    let html = '<div class="binary-result-card">';
    html += `<h3 class="binary-result-title">选定位置: B% = <strong>${cp.toFixed(2)}%</strong>, T = <strong>${tp.toFixed(2)}°C</strong></h3>`;
    if (regionName) {
        html += `<div class="binary-result-region">探测相区: <strong>[${regionName}]</strong></div>`;
    }

    const res = state.calcRes;
    if (res) {
        if (res.type === 'two_phase') {
            let leftPhase = '左相', rightPhase = '右相';
            if (regionName && regionName.includes('+')) {
                const parts = regionName.split('+');
                leftPhase = parts[0].trim();
                rightPhase = parts[1].trim();
            }
            html += `<div class="binary-result-panel two-phase">
                <strong>杠杆定律计算结果</strong>
                <table class="binary-result-table">
                    <tr><td class="binary-result-label">${leftPhase} 相分数</td><td><strong>${(res.w_left * 100).toFixed(2)}%</strong></td></tr>
                    <tr><td class="binary-result-label">${rightPhase} 相分数</td><td><strong>${(res.w_right * 100).toFixed(2)}%</strong></td></tr>
                    <tr><td class="binary-result-label">${leftPhase} 边界成分</td><td>${res.left.toFixed(2)}% B</td></tr>
                    <tr><td class="binary-result-label">${rightPhase} 边界成分</td><td>${res.right.toFixed(2)}% B</td></tr>
                    <tr><td class="binary-result-label">杠杆臂长</td><td>${(res.right - res.left).toFixed(2)}% B</td></tr>
                </table>
            </div>`;
        } else if (res.type === 'three_phase') {
            html += `<div class="binary-result-panel three-phase">
                <strong>三相共存状态</strong>: ${res.desc}<br><br>此线上杠杆定律不直接适用，需结合具体相图分析。
            </div>`;
        } else {
            html += `<div class="binary-result-panel single-phase">
                <strong>单相区 (${regionName || '未知'})</strong>: 不适用杠杆定律计算，成分即为该相成分。
            </div>`;
        }
    }
    html += '</div>';
    container.innerHTML = html;
}
