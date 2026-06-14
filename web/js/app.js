// App state
const AppState = {
    templates: null,
    lineStyles: null,
    regionColors: null,
    wasmReady: false,
    currentPage: 'binary',

    // Binary state
    binary: {
        points: [],
        lines: [],
        activeTemplate: '手动模式',
        axisRange: { xmin: 0, xmax: 100, ymin: 0, ymax: 1500 },
        calcMode: false,
        calcPos: null,
        calcRes: null,
        showRegionFill: false,
    },

    // Ternary state
    ternary: {
        points: [
            { label: 'A', a: 100, b: 0, c: 0, temp: 1000 },
            { label: 'B', a: 0, b: 100, c: 0, temp: 1050 },
            { label: 'C', a: 0, b: 0, c: 100, temp: 1100 },
            { label: 'D', a: 45, b: 55, c: 0, temp: 900 },
            { label: 'E', a: 0, b: 45, c: 55, temp: 850 },
            { label: 'F', a: 45, b: 0, c: 55, temp: 800 },
            { label: 'G', a: 32, b: 37, c: 31, temp: 700 },
        ],
        lines: [
            { start: 'A', end: 'F', curve_x: 0, curve_y: 0, curve_z: 25 },
            { start: 'F', end: 'C', curve_x: 0, curve_y: 0, curve_z: 30 },
            { start: 'C', end: 'E', curve_x: 0, curve_y: 0, curve_z: 30 },
            { start: 'B', end: 'E', curve_x: 0, curve_y: 0, curve_z: 30 },
            { start: 'A', end: 'D', curve_x: 0, curve_y: 0, curve_z: 30 },
            { start: 'B', end: 'D', curve_x: 0, curve_y: 0, curve_z: 30 },
            { start: 'D', end: 'G', curve_x: 0, curve_y: 10, curve_z: 10 },
            { start: 'E', end: 'G', curve_x: 0, curve_y: 10, curve_z: -10 },
            { start: 'F', end: 'G', curve_x: 10, curve_y: 0, curve_z: 10 },
        ],
        surfs: [
            { line_labels: ['AD', 'DG', 'GF', 'FA'] },
            { line_labels: ['BD', 'DG', 'GE', 'EB'] },
            { line_labels: ['CF', 'FG', 'GE', 'EC'] },
        ],
        isoTemp: null,
    }
};

function switchPage(name) {
    AppState.currentPage = name;
    document.querySelectorAll('.page').forEach(el => el.classList.remove('active'));
    document.getElementById('page-' + name).classList.add('active');
    document.querySelectorAll('.nav-btn').forEach(el => el.classList.remove('active'));
    document.querySelector(`.nav-btn[data-page="${name}"]`).classList.add('active');
    if (name === 'binary') renderBinary();
    else if (name === 'ternary') renderTernary();
    else if (name === 'triangle') renderTriangle();
    // Resize Plotly charts after page switch (container may have been display:none)
    setTimeout(() => resizeAllPlotlyCharts(), 100);
}

function resizeAllPlotlyCharts() {
    document.querySelectorAll('.js-plotly-plot').forEach(el => {
        if (el._fullLayout && el._fullLayout._size) {
            Plotly.Plots.resize(el);
        }
    });
}

window.addEventListener('resize', resizeAllPlotlyCharts);

function nextAutoLabel(existing) {
    const set = new Set(existing);
    let n = 0;
    while (true) {
        let label = '';
        let x = n;
        while (true) {
            label = String.fromCharCode(65 + (x % 26)) + label;
            x = Math.floor(x / 26) - 1;
            if (x < 0) break;
        }
        if (!set.has(label)) return label;
        n++;
    }
}

// Called from wasm_exec.js / Go after init
document.addEventListener('DOMContentLoaded', () => {
    // Poll for WASM readiness
    const checkWasm = setInterval(() => {
        if (window.XubenBridge && XubenBridge.isReady()) {
            clearInterval(checkWasm);
            try {
                const data = XubenBridge.getTemplates();
                AppState.templates = data.templates;
                AppState.lineStyles = data.lineStyles;
                AppState.regionColors = data.regionColors;
                AppState.wasmReady = true;
                document.getElementById('wasmStatus').textContent = 'WASM 已加载';
                document.getElementById('wasmStatus').classList.add('loaded');
                initBinary();
            } catch(e) {
                console.error('Init error:', e);
            }
        }
    }, 100);
});
