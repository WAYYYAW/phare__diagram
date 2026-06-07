function initBinary() {
    renderBinary();
}

function renderBinary() {
    renderBinarySidebar();
    renderBinaryChart();
    renderBinaryResult();
}

function renderBinarySidebar() {
    const sidebar = document.getElementById('binarySidebar');
    const state = AppState.binary;
    const templateNames = Object.keys(AppState.templates);

    let html = `
        <div class="card">
            <div class="card-title">模板选择</div>
            <div class="form-group">
                <select id="tplSelect" onchange="onTemplateChange()">
                    ${templateNames.map(n => `<option value="${n}" ${n === state.activeTemplate ? 'selected' : ''}>${n}</option>`).join('')}
                </select>
            </div>
        </div>

        <div class="card">
            <div class="card-title">数据管理</div>
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
                    相区自动上色
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
            <td><button class="btn btn-danger" onclick="removePoint(${i})" style="padding:2px 6px;font-size:11px;">✕</button></td>
        </tr>`;
    });

    return `
        <div class="form-row" style="margin-bottom:8px;">
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
        <button class="btn btn-primary btn-full" onclick="addPoint()" style="margin-bottom:8px;">➕ 添加点</button>
        <table class="data-table">
            <thead><tr><th>标签</th><th>成分 B%</th><th>温度 °C</th><th></th></tr></thead>
            <tbody>${rows || '<tr><td colspan="4" class="empty-state">暂无数据</td></tr>'}</tbody>
        </table>
    `;
}

function renderLinesEditor() {
    const state = AppState.binary;
    const lineTypes = Object.keys(AppState.lineStyles);
    let rows = '';
    state.lines.forEach((l, i) => {
        rows += `<tr>
            <td><input type="text" value="${l.start || ''}" onchange="onLineEdit(${i}, 'start', this.value)"></td>
            <td><input type="text" value="${l.end || ''}" onchange="onLineEdit(${i}, 'end', this.value)"></td>
            <td><select onchange="onLineEdit(${i}, 'type', this.value)">
                ${lineTypes.map(t => `<option value="${t}" ${l.type === t ? 'selected' : ''}>${AppState.lineStyles[t].label}</option>`).join('')}
            </select></td>
            <td><input type="number" value="${l.curve || 0}" step="50" onchange="onLineEdit(${i}, 'curve', parseFloat(this.value) || 0)"></td>
            <td><button class="btn btn-danger" onclick="removeLine(${i})" style="padding:2px 6px;font-size:11px;">✕</button></td>
        </tr>`;
    });

    return `
        <div class="form-row" style="margin-bottom:8px;">
            <div class="form-group"><input type="text" id="newLnStart" placeholder="起点标签"></div>
            <div class="form-group"><input type="text" id="newLnEnd" placeholder="终点标签"></div>
        </div>
        <div class="form-row" style="margin-bottom:8px;">
            <div class="form-group">
                <select id="newLnType">
                    ${lineTypes.map(t => `<option value="${t}">${AppState.lineStyles[t].label}</option>`).join('')}
                </select>
            </div>
            <div class="form-group">
                <input type="number" id="newLnCurve" value="0" step="50" placeholder="曲率">
            </div>
        </div>
        <button class="btn btn-primary btn-full" onclick="addLine()" style="margin-bottom:8px;">➕ 添加线</button>
        <table class="data-table">
            <thead><tr><th>起点</th><th>终点</th><th>类型</th><th>曲率</th><th></th></tr></thead>
            <tbody>${rows || '<tr><td colspan="5" class="empty-state">暂无数据</td></tr>'}</tbody>
        </table>
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
    state.activeTemplate = name;

    if (name === '手动模式') {
        state.points = [];
        state.lines = [];
        renderBinary();
        return;
    }

    const tmpl = AppState.templates[name];
    if (!tmpl) return;

    const params = {};
    tmpl.params.forEach(p => { params[p.key] = p.default; });

    const result = xubenComputeTemplatePoints(name, JSON.stringify(params));
    if (result && !result.error) {
        state.points = result.points;
        state.lines = result.lines;

        const maxTemp = Math.max(...state.points.filter(p => p.temp != null).map(p => p.temp));
        const maxComp = Math.max(...state.points.filter(p => p.comp != null).map(p => p.comp));
        state.axisRange.ymin = 0;
        state.axisRange.ymax = maxTemp + 250;
        state.axisRange.xmax = maxComp < 80 ? maxComp * 1.05 : 100;
        state.axisRange.xmin = 0;
    }
    renderBinary();
}

function onPointEdit(idx, field, value) {
    AppState.binary.points[idx][field] = value;
    renderBinaryChart();
}

function onLineEdit(idx, field, value) {
    AppState.binary.lines[idx][field] = value;
    renderBinaryChart();
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
    renderBinary();
}

function removePoint(idx) {
    const state = AppState.binary;
    const label = state.points[idx].label;
    state.points.splice(idx, 1);
    state.lines = state.lines.filter(l => l.start !== label && l.end !== label);
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
    renderBinary();
}

function removeLine(idx) {
    AppState.binary.lines.splice(idx, 1);
    renderBinary();
}

function onToggleCalcMode(val) {
    AppState.binary.calcMode = val;
    renderBinarySidebar();
    renderBinaryChart();
}

function onToggleRegionFill(val) {
    AppState.binary.showRegionFill = val;
    renderBinaryChart();
}

function onAxisChange() {
    const state = AppState.binary;
    state.axisRange.xmin = parseFloat(document.getElementById('axXmin').value) || 0;
    state.axisRange.xmax = parseFloat(document.getElementById('axXmax').value) || 100;
    state.axisRange.ymin = parseFloat(document.getElementById('axYmin').value) || 0;
    state.axisRange.ymax = parseFloat(document.getElementById('axYmax').value) || 1500;
    renderBinaryChart();
}

function onCalcLever() {
    const state = AppState.binary;
    const comp = parseFloat(document.getElementById('calcComp').value) || 0;
    const temp = parseFloat(document.getElementById('calcTemp').value) || 0;
    state.calcPos = [comp, temp];

    const ptsJSON = JSON.stringify(state.points.map(p => ({
        label: p.label, comp: p.comp, temp: p.temp
    })));
    const lnsJSON = JSON.stringify(state.lines);
    state.calcRes = xubenPerformLeverRule(ptsJSON, lnsJSON, comp, temp);
    renderBinaryChart();
    renderBinaryResult();
}

function renderBinaryChart() {
    const state = AppState.binary;
    const traces = [];
    const xRange = [state.axisRange.xmin, state.axisRange.xmax];
    const yRange = [state.axisRange.ymin, state.axisRange.ymax];
    const tplName = state.activeTemplate;

    // Region fills
    if (state.showRegionFill && tplName !== '手动模式') {
        const tmpl = AppState.templates[tplName];
        if (tmpl && tmpl.topology && tmpl.topology.regions) {
            const ptMap = {};
            state.points.forEach(p => {
                if (p.comp != null && p.temp != null) ptMap[p.label] = [p.comp, p.temp];
            });
            ptMap['T_LEFT'] = [0, yRange[1] * 2];
            ptMap['T_RIGHT'] = [100, yRange[1] * 2];
            ptMap['B_LEFT'] = [0, yRange[0] - 500];
            ptMap['B_RIGHT'] = [100, yRange[0] - 500];

            tmpl.topology.regions.forEach((rDef, i) => {
                const verts = rDef.points.map(lbl => ptMap[lbl]).filter(v => v);
                if (verts.length >= 3) {
                    const xs = verts.map(v => v[0]);
                    const ys = verts.map(v => v[1]);
                    xs.push(xs[0]);
                    ys.push(ys[0]);
                    const color = AppState.regionColors[i % AppState.regionColors.length];
                    traces.push({
                        x: xs, y: ys,
                        fill: 'toself',
                        fillcolor: color,
                        line: { width: 0 },
                        mode: 'none',
                        name: rDef.label,
                        legendgroup: 'region',
                        showlegend: true,
                        hoverinfo: 'skip',
                        type: 'scatter'
                    });
                }
            });
        }
    }

    // Click grid for calc mode
    if (state.calcMode) {
        const gridN = 60;
        const gx = [];
        const gy = [];
        for (let i = 0; i < gridN; i++) {
            for (let j = 0; j < gridN; j++) {
                gx.push(xRange[0] + (xRange[1] - xRange[0]) * i / (gridN - 1));
                gy.push(yRange[0] + (yRange[1] - yRange[0]) * j / (gridN - 1));
            }
        }
        traces.push({
            x: gx, y: gy,
            mode: 'markers',
            marker: { size: 5, color: 'rgba(0,0,0,0)', opacity: 0 },
            customdata: gx.map((v, i) => [v, gy[i]]),
            hovertemplate: '<b>点击计算</b><br>B%: %{customdata[0]:.2f}<br>T: %{customdata[1]:.1f}°C<extra></extra>',
            showlegend: false,
            name: 'click_grid',
            type: 'scatter'
        });
    }

    // Lines
    const shownTypes = new Set();
    state.lines.forEach(ln => {
        const p1 = state.points.find(p => p.label === ln.start);
        const p2 = state.points.find(p => p.label === ln.end);
        if (!p1 || !p2 || p1.comp == null || p2.comp == null) return;

        const curve = xubenComputeBezierCurve(p1.comp, p1.temp, p2.comp, p2.temp, ln.curve, 40);
        const style = AppState.lineStyles[ln.type] || AppState.lineStyles['other'];
        const dashMap = { '-': 'solid', '--': 'dash', '-.': 'dashdot', ':': 'dot' };
        const isFirst = !shownTypes.has(ln.type);
        shownTypes.add(ln.type);

        traces.push({
            x: curve.xs, y: curve.ys,
            mode: 'lines',
            line: { color: style.color, width: style.lw, dash: dashMap[style.ls] || 'solid' },
            name: style.label,
            legendgroup: style.label,
            showlegend: isFirst,
            hoverinfo: 'skip',
            type: 'scatter'
        });
    });

    // Points
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
            type: 'scatter'
        });
    }

    // Calc visuals
    if (state.calcRes && state.calcPos) {
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
                type: 'scatter'
            });
            traces.push({
                x: [cp], y: [tp],
                mode: 'markers',
                marker: { color: '#FFEB3B', size: 13, line: { width: 2, color: 'black' } },
                name: '计算选点',
                type: 'scatter'
            });
        }
    }

    const layout = {
        xaxis: { title: '成分 (wt% B)', range: xRange, gridcolor: '#EEEEEE' },
        yaxis: { title: '温度 (°C)', range: yRange, gridcolor: '#EEEEEE' },
        autosize: true,
        height: 520,
        margin: { l: 50, r: 20, t: 30, b: 40 },
        clickmode: 'event+select',
        dragmode: 'pan',
        plot_bgcolor: 'white',
        legend: {
            orientation: 'v',
            yanchor: 'top', y: 0.98,
            xanchor: 'left', x: 0.01,
            bgcolor: 'rgba(255,255,255,0.65)',
            bordercolor: '#CCCCCC',
            borderwidth: 1,
            font: { size: 9 },
            groupclick: 'toggleitem',
        }
    };

    Plotly.newPlot('binaryChart', traces, layout, { responsive: true })
        .then(() => {
            if (state.calcMode) {
                document.getElementById('binaryChart').on('plotly_click', (data) => {
                    const pt = data.points[0];
                    if (pt) {
                        let cx = pt.x;
                        let cy = pt.y;
                        if (cx >= 0 && cx <= 100) {
                            state.calcPos = [cx, cy];
                            const ptsJSON = JSON.stringify(state.points.map(p => ({
                                label: p.label, comp: p.comp, temp: p.temp
                            })));
                            const lnsJSON = JSON.stringify(state.lines);
                            state.calcRes = xubenPerformLeverRule(ptsJSON, lnsJSON, cx, cy);
                            renderBinaryChart();
                            renderBinaryResult();
                        }
                    }
                });
            }
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
    const ptsJSON = JSON.stringify(state.points.map(p => ({
        label: p.label, comp: p.comp, temp: p.temp
    })));
    const regionName = xubenGetRegionAt(ptsJSON, tplName, cp, tp);

    let html = `<div style="margin-top:12px;padding:12px;background:white;border-radius:8px;box-shadow:0 1px 4px rgba(0,0,0,0.08);">`;
    html += `<h3 style="margin-bottom:8px;">选定位置: B% = <strong>${cp.toFixed(2)}%</strong>, T = <strong>${tp.toFixed(2)}°C</strong></h3>`;
    if (regionName) {
        html += `<div style="padding:6px 12px;background:#e3f2fd;border-radius:5px;margin-bottom:8px;font-size:13px;">探测相区: <strong>[${regionName}]</strong></div>`;
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
            html += `<div style="padding:12px;background:#e8f5e9;border:1px solid #a5d6a7;border-radius:5px;font-size:13px;">
                <strong>杠杆定律计算结果</strong>
                <table style="width:100%;border-collapse:collapse;margin-top:8px;">
                    <tr><td style="padding:3px 8px;border-bottom:1px solid rgba(0,0,0,0.05);font-weight:500;">${leftPhase} 相分数</td><td style="padding:3px 8px;border-bottom:1px solid rgba(0,0,0,0.05);"><strong>${(res.w_left * 100).toFixed(2)}%</strong></td></tr>
                    <tr><td style="padding:3px 8px;border-bottom:1px solid rgba(0,0,0,0.05);font-weight:500;">${rightPhase} 相分数</td><td style="padding:3px 8px;border-bottom:1px solid rgba(0,0,0,0.05);"><strong>${(res.w_right * 100).toFixed(2)}%</strong></td></tr>
                    <tr><td style="padding:3px 8px;border-bottom:1px solid rgba(0,0,0,0.05);font-weight:500;">${leftPhase} 边界成分</td><td style="padding:3px 8px;border-bottom:1px solid rgba(0,0,0,0.05);">${res.left.toFixed(2)}% B</td></tr>
                    <tr><td style="padding:3px 8px;border-bottom:1px solid rgba(0,0,0,0.05);font-weight:500;">${rightPhase} 边界成分</td><td style="padding:3px 8px;border-bottom:1px solid rgba(0,0,0,0.05);">${res.right.toFixed(2)}% B</td></tr>
                    <tr><td style="padding:3px 8px;font-weight:500;">杠杆臂长</td><td style="padding:3px 8px;">${(res.right - res.left).toFixed(2)}% B</td></tr>
                </table>
            </div>`;
        } else if (res.type === 'three_phase') {
            html += `<div style="padding:12px;background:#fff3e0;border:1px solid #ffcc80;border-radius:5px;font-size:13px;">
                <strong>三相共存状态</strong>: ${res.desc}<br><br>此线上杠杆定律不直接适用，需结合具体相图分析。
            </div>`;
        } else {
            html += `<div style="padding:12px;background:#e3f2fd;border:1px solid #90caf9;border-radius:5px;font-size:13px;">
                <strong>单相区 (${regionName || '未知'})</strong>: 不适用杠杆定律计算，成分即为该相成分。
            </div>`;
        }
    }
    html += '</div>';
    container.innerHTML = html;
}
