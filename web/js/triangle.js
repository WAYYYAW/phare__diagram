const TriState = {
    mode: 'point',
    points: [],
    locked: false,
    clickPt: null,
    arrows: [],
    vertexLines: [],
    phase2R: null,
    phase3R: null,
    phase3Aux: [],
};

function renderTriangle() {
    const container = document.getElementById('triangleContainer');
    container.innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;gap:8px;">
            <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center;">
                <button class="btn tri-mode-btn active" data-mode="point" onclick="triSetMode('point')">成分点显示</button>
                <button class="btn tri-mode-btn" data-mode="vertex" onclick="triSetMode('vertex')">顶点连线</button>
                <button class="btn tri-mode-btn" data-mode="phase2" onclick="triSetMode('phase2')">两相平衡</button>
                <button class="btn tri-mode-btn" data-mode="phase3" onclick="triSetMode('phase3')">三相平衡</button>
                <button class="btn btn-danger" onclick="triClear()">清空</button>
            </div>
            <canvas id="triCanvas" width="700" height="600" style="border:1px solid #ddd;border-radius:6px;cursor:crosshair;background:white;"></canvas>
            <div id="triResult" style="width:100%;max-width:700px;min-height:48px;padding:10px 14px;background:#f5f7fa;border-radius:6px;font-size:14px;line-height:1.7;font-family:monospace;">点击三角形内部查看结果</div>
        </div>
    `;

    const W = 700, H = 600;
    const A = [150, 480], B = [350, 100], C = [570, 480];

    const canvas = document.getElementById('triCanvas');
    canvas._tri = { A, B, C, W, H };
    canvas.addEventListener('click', triOnClick);

    triDraw();
}

function triDraw() {
    const canvas = document.getElementById('triCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const { A, B, C, W, H } = canvas._tri;
    ctx.clearRect(0, 0, W, H);

    const [xa, ya] = A, [xb, yb] = B, [xc, yc] = C;
    const st = TriState;

    // ---- Base triangle ----
    ctx.beginPath();
    ctx.moveTo(xa, ya); ctx.lineTo(xb, yb); ctx.lineTo(xc, yc); ctx.closePath();
    ctx.strokeStyle = 'black'; ctx.lineWidth = 3; ctx.stroke();

    ctx.font = 'bold 20px Arial'; ctx.fillStyle = 'black'; ctx.textAlign = 'center';
    ctx.fillText('A', xa - 25, ya + 30);
    ctx.fillText('B', xb, yb - 18);
    ctx.fillText('C', xc + 25, yc + 30);

    ctx.font = 'bold 16px Arial';
    ctx.fillText('A%', (xa + xc) / 2, ya + 30);
    ctx.save(); ctx.translate(xa - 22, (ya + yb) / 2); ctx.rotate(60 * Math.PI / 180); ctx.fillText('B%', 0, 0); ctx.restore();
    ctx.save(); ctx.translate(xc + 22, (yb + yc) / 2); ctx.rotate(-60 * Math.PI / 180); ctx.fillText('C%', 0, 0); ctx.restore();

    // Scales
    ctx.font = '10px Arial'; ctx.strokeStyle = '#888'; ctx.lineWidth = 2;
    for (let i = 0; i <= 100; i += 10) {
        let x = xc - (xc - xa) * i / 100;
        ctx.beginPath(); ctx.moveTo(x, ya); ctx.lineTo(x, ya - 6); ctx.stroke();
        if (i % 20 === 0) ctx.fillText(String(i), x, ya + 16);
        x = xa + (xb - xa) * i / 100; let y = ya + (yb - ya) * i / 100;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 5, y + 5); ctx.stroke();
        if (i % 20 === 0) { ctx.textAlign = 'right'; ctx.fillText(String(i), x - 8, y + 6); ctx.textAlign = 'center'; }
        x = xb + (xc - xb) * i / 100; y = yb + (yc - yb) * i / 100;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 5, y + 5); ctx.stroke();
        if (i % 20 === 0) { ctx.textAlign = 'left'; ctx.fillText(String(i), x + 8, y + 6); ctx.textAlign = 'center'; }
    }

    // Grid
    ctx.strokeStyle = '#ccc'; ctx.lineWidth = 0.8; ctx.setLineDash([4, 3]);
    for (let i = 10; i < 100; i += 10) {
        const t = i / 100;
        let x1 = xa + (xb - xa) * t, y1 = ya + (yb - ya) * t;
        let x2 = xc + (xb - xc) * t, y2 = yc + (yb - yc) * t;
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        x1 = xa + (xc - xa) * t; y1 = ya;
        x2 = xb + (xc - xb) * t; y2 = yb + (yc - yb) * t;
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        x1 = xb + (xa - xb) * t; y1 = yb + (ya - yb) * t;
        x2 = xc + (xa - xc) * t; y2 = yc;
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    }
    ctx.setLineDash([]);

    // ---- Phase points (phase2/phase3 selection) ----
    const phaseColors = ['red', 'blue', 'green'];
    const phaseNames = ['α相', 'β相', 'γ相'];
    st.points.forEach((p, i) => {
        ctx.beginPath(); ctx.arc(p[0], p[1], 7, 0, 2 * Math.PI);
        ctx.fillStyle = phaseColors[i % phaseColors.length]; ctx.fill();
        ctx.font = 'bold 14px Arial'; ctx.fillStyle = 'black'; ctx.textAlign = 'left';
        ctx.fillText(phaseNames[i] || '', p[0] + 15, p[1] - 12);
    });

    // Phase2 line
    if (st.mode === 'phase2' && st.locked && st.points.length === 2) {
        ctx.beginPath(); ctx.moveTo(st.points[0][0], st.points[0][1]); ctx.lineTo(st.points[1][0], st.points[1][1]);
        ctx.strokeStyle = 'green'; ctx.lineWidth = 3; ctx.stroke();
    }

    // Phase3 triangle
    if (st.mode === 'phase3' && st.locked && st.points.length === 3) {
        ctx.beginPath(); ctx.moveTo(st.points[0][0], st.points[0][1]); ctx.lineTo(st.points[1][0], st.points[1][1]); ctx.lineTo(st.points[2][0], st.points[2][1]); ctx.closePath();
        ctx.strokeStyle = 'orange'; ctx.lineWidth = 3; ctx.stroke();
    }

    // ---- Point mode: click point + arrows ----
    if (st.clickPt && (st.mode === 'point' || st.mode === 'vertex')) {
        ctx.beginPath(); ctx.arc(st.clickPt[0], st.clickPt[1], 7, 0, 2 * Math.PI);
        ctx.fillStyle = 'black'; ctx.fill();
    }
    // Point mode arrows
    st.arrows.forEach(a => {
        triDrawArrow(ctx, a.x1, a.y1, a.x2, a.y2, a.color);
    });

    // ---- Vertex mode: vertex lines ----
    st.vertexLines.forEach(l => {
        ctx.beginPath(); ctx.moveTo(l.x1, l.y1); ctx.lineTo(l.x2, l.y2);
        ctx.strokeStyle = 'purple'; ctx.lineWidth = 2; ctx.stroke();
    });

    // ---- Phase2: R point + projection line ----
    if (st.phase2R) {
        ctx.beginPath(); ctx.arc(st.phase2R.rx, st.phase2R.ry, 7, 0, 2 * Math.PI);
        ctx.fillStyle = 'black'; ctx.fill();
        ctx.font = 'bold 14px Arial'; ctx.fillStyle = 'black'; ctx.textAlign = 'left';
        ctx.fillText('R', st.phase2R.rx + 15, st.phase2R.ry - 12);

        if (st.phase2R.proj) {
            ctx.setLineDash([4, 3]);
            ctx.beginPath(); ctx.moveTo(st.phase2R.proj.px, st.phase2R.proj.py); ctx.lineTo(st.phase2R.rx, st.phase2R.ry);
            ctx.strokeStyle = '#888'; ctx.lineWidth = 1.5; ctx.stroke();
            ctx.setLineDash([]);
        }
    }

    // ---- Phase3: R point + auxiliary lines ----
    if (st.phase3R) {
        ctx.beginPath(); ctx.arc(st.phase3R.px, st.phase3R.py, 7, 0, 2 * Math.PI);
        ctx.fillStyle = 'black'; ctx.fill();
        ctx.font = 'bold 14px Arial'; ctx.fillStyle = 'black'; ctx.textAlign = 'left';
        ctx.fillText('R', st.phase3R.px + 15, st.phase3R.py - 12);
    }
    st.phase3Aux.forEach(a => {
        ctx.setLineDash([4, 2]);
        ctx.beginPath(); ctx.moveTo(a.x1, a.y1); ctx.lineTo(a.x2, a.y2);
        ctx.strokeStyle = a.color; ctx.lineWidth = 2; ctx.stroke();
        ctx.setLineDash([]);
        ctx.font = 'bold 14px Arial'; ctx.fillStyle = a.color; ctx.textAlign = 'left';
        if (a.label) ctx.fillText(a.label, a.lx || (a.x2 + 15), a.ly || (a.y2 - 12));
    });
}

function triDrawArrow(ctx, x1, y1, x2, y2, color) {
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
    ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.stroke();
    const angle = Math.atan2(y2 - y1, x2 - x1);
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - 10 * Math.cos(angle - 0.4), y2 - 10 * Math.sin(angle - 0.4));
    ctx.lineTo(x2 - 10 * Math.cos(angle + 0.4), y2 - 10 * Math.sin(angle + 0.4));
    ctx.closePath();
    ctx.fillStyle = color; ctx.fill();
}

function triClearState() {
    TriState.clickPt = null;
    TriState.arrows = [];
    TriState.vertexLines = [];
    TriState.phase2R = null;
    TriState.phase3R = null;
    TriState.phase3Aux = [];
}

function triSetMode(mode) {
    TriState.mode = mode;
    TriState.points = [];
    TriState.locked = false;
    triClearState();
    document.getElementById('triResult').textContent = '';
    triDraw();
    document.querySelectorAll('.tri-mode-btn').forEach(el => el.classList.remove('active'));
    document.querySelector(`.tri-mode-btn[data-mode="${mode}"]`)?.classList.add('active');
}

function triClear() {
    TriState.points = [];
    TriState.locked = false;
    triClearState();
    document.getElementById('triResult').textContent = '';
    triDraw();
}

function triOnClick(event) {
    const canvas = document.getElementById('triCanvas');
    const rect = canvas.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;
    const { A, B, C } = canvas._tri;

    const hit = xubenTriPointInTriangle(px, py, A[0], A[1], B[0], B[1], C[0], C[1]);
    if (!hit.ok) {
        document.getElementById('triResult').textContent = '❌ 请在三角形内部点击';
        return;
    }

    const a = hit.a, b = hit.b, c = hit.c;
    const resultEl = document.getElementById('triResult');

    switch (TriState.mode) {
        case 'point':
            triModePoint(px, py, a, b, c, resultEl, A, B, C);
            break;
        case 'vertex':
            triModeVertex(px, py, a, b, c, resultEl, A, B, C);
            break;
        case 'phase2':
            triModePhase2(px, py, resultEl);
            break;
        case 'phase3':
            triModePhase3(px, py, resultEl);
            break;
    }
    triDraw();
}

// ---- Mode: Point ----
function triModePoint(px, py, a, b, c, resultEl, A, B, C) {
    triClearState();
    TriState.clickPt = [px, py];

    const arrows = [];
    const dx_ac = A[0] - C[0], dy_ac = A[1] - C[1];
    const ac = xubenTriLineIntersection(px, py, px + dx_ac * 20, py + dy_ac * 20, A[0], A[1], B[0], B[1]);
    if (ac) arrows.push({ x1: px, y1: py, x2: ac.x, y2: ac.y, color: 'red' });

    const dx_ab = B[0] - A[0], dy_ab = B[1] - A[1];
    const ab = xubenTriLineIntersection(px, py, px + dx_ab * 20, py + dy_ab * 20, B[0], B[1], C[0], C[1]);
    if (ab) arrows.push({ x1: px, y1: py, x2: ab.x, y2: ab.y, color: 'blue' });

    const dx_bc = C[0] - B[0], dy_bc = C[1] - B[1];
    const bc = xubenTriLineIntersection(px, py, px + dx_bc * 20, py + dy_bc * 20, A[0], A[1], C[0], C[1]);
    if (bc) arrows.push({ x1: px, y1: py, x2: bc.x, y2: bc.y, color: 'green' });

    TriState.arrows = arrows;
    resultEl.textContent = `✅ 成分点：A = ${a}%    B = ${b}%    C = ${c}%`;
}

// ---- Mode: Vertex Lines ----
function triModeVertex(px, py, a, b, c, resultEl, A, B, C) {
    triClearState();
    TriState.clickPt = [px, py];
    TriState.vertexLines = [
        { x1: px, y1: py, x2: A[0], y2: A[1] },
        { x1: px, y1: py, x2: B[0], y2: B[1] },
        { x1: px, y1: py, x2: C[0], y2: C[1] },
    ];
    const res = `📌 顶点连线模式\n当前成分：A=${a}% B=${b}% C=${c}%\n过A：B/C=${b}:${c}=定值\n过B：A/C=${a}:${c}=定值\n过C：A/B=${a}:${b}=定值`;
    resultEl.textContent = res;
}

// ---- Mode: Two-Phase ----
function triModePhase2(px, py, resultEl) {
    if (!TriState.locked && TriState.points.length < 2) {
        triClearState();
        TriState.points.push([px, py]);
        resultEl.textContent = `已选择：${['α相', 'β相'][TriState.points.length - 1]}`;
        if (TriState.points.length === 2) {
            TriState.locked = true;
            resultEl.textContent = '✅ 两相已确定！靠近直线点击即可';
        }
        return;
    }

    if (TriState.locked && TriState.points.length === 2) {
        triClearState();
        const [p1, p2] = TriState.points;
        const proj = xubenTriProjectPointOnLine(px, py, p1[0], p1[1], p2[0], p2[1]);
        const rx = proj.x, ry = proj.y;

        TriState.phase2R = {
            rx, ry,
            proj: { px, py }
        };

        const d1 = xubenTriDist(p1[0], p1[1], rx, ry);
        const d2 = xubenTriDist(p2[0], p2[1], rx, ry);
        const total = d1 + d2;
        const wa = Math.round(d2 / total * 10000) / 100;
        const wb = Math.round(d1 / total * 10000) / 100;

        resultEl.textContent =
`⚖️ 两相杠杆定律
α到R: L1=${d1.toFixed(1)}  β到R: L2=${d2.toFixed(1)}
α% = L2/(L1+L2) = ${wa}%
β% = L1/(L1+L2) = ${wb}%`;
    }
}

// ---- Mode: Three-Phase ----
function triModePhase3(px, py, resultEl) {
    if (!TriState.locked && TriState.points.length < 3) {
        triClearState();
        TriState.points.push([px, py]);
        resultEl.textContent = `已选择：${['α相', 'β相', 'γ相'][TriState.points.length - 1]}`;
        if (TriState.points.length === 3) {
            TriState.locked = true;
            resultEl.textContent = '✅ 三相已确定！在三角形内点R';
        }
        return;
    }

    if (TriState.locked && TriState.points.length === 3) {
        triClearState();
        const [alpha, beta, gamma] = TriState.points;

        const inside = xubenTriPointInTriangle3(px, py,
            alpha[0], alpha[1], beta[0], beta[1], gamma[0], gamma[1]);
        if (!inside) {
            resultEl.textContent = '❌ 只能在三相三角形内部点击！';
            return;
        }

        TriState.phase3R = { px, py };

        const d = xubenTriLineIntersection(
            alpha[0], alpha[1], px, py,
            beta[0], beta[1], gamma[0], gamma[1]);
        const e = xubenTriLineIntersection(
            beta[0], beta[1], px, py,
            alpha[0], alpha[1], gamma[0], gamma[1]);
        const f = xubenTriLineIntersection(
            gamma[0], gamma[1], px, py,
            alpha[0], alpha[1], beta[0], beta[1]);

        const aux = [];
        if (d) aux.push({ x1: alpha[0], y1: alpha[1], x2: d.x, y2: d.y, color: 'red', label: 'd', lx: d.x + 15, ly: d.y - 12 });
        if (e) aux.push({ x1: beta[0], y1: beta[1], x2: e.x, y2: e.y, color: 'blue', label: 'e', lx: e.x + 15, ly: e.y - 12 });
        if (f) aux.push({ x1: gamma[0], y1: gamma[1], x2: f.x, y2: f.y, color: 'green', label: 'f', lx: f.x + 15, ly: f.y - 12 });
        TriState.phase3Aux = aux;

        const dx = d ? xubenTriDist(alpha[0], alpha[1], d.x, d.y) : 1;
        const dr = d ? xubenTriDist(px, py, d.x, d.y) : 0;
        const ex = e ? xubenTriDist(beta[0], beta[1], e.x, e.y) : 1;
        const er = e ? xubenTriDist(px, py, e.x, e.y) : 0;
        const fx = f ? xubenTriDist(gamma[0], gamma[1], f.x, f.y) : 1;
        const fr = f ? xubenTriDist(px, py, f.x, f.y) : 0;

        const wAlpha = Math.round(dr / dx * 10000) / 100;
        const wBeta = Math.round(er / ex * 10000) / 100;
        const wGamma = Math.round(fr / fx * 10000) / 100;

        resultEl.textContent =
`🔺 三相杠杆定律（线段法）
α% = Rd/αd = ${dr.toFixed(1)}/${dx.toFixed(1)} = ${wAlpha}%
β% = Re/βe = ${er.toFixed(1)}/${ex.toFixed(1)} = ${wBeta}%
γ% = Rf/γf = ${fr.toFixed(1)}/${fx.toFixed(1)} = ${wGamma}%`;
    }
}
