const TEMPLATE_CUSTOM = '自定义';
const BINARY_TEMPLATE_CUSTOM = TEMPLATE_CUSTOM;
const TERNARY_TEMPLATE_CUSTOM = TEMPLATE_CUSTOM;

function cloneTemplateValue(data) {
    return JSON.parse(JSON.stringify(data));
}

function listTemplateNames(templates) {
    return Object.keys(templates || {}).filter(name => !!templates[name]);
}

// App state
const AppState = {
    templates: null,
    ternaryTemplates: null,
    lineStyles: null,
    regionColors: null,
    wasmReady: false,
    currentPage: 'binary',

    // Binary state
    binary: {
        points: [],
        lines: [],
        activeTemplate: BINARY_TEMPLATE_CUSTOM,
        axisRange: { xmin: 0, xmax: 100, ymin: 0, ymax: 1500 },
        calcMode: false,
        calcPos: null,
        calcRes: null,
        showRegionFill: false,
    },

    // Ternary state
    ternary: {
        points: [],
        lines: [],
        surfs: [],
        isoTemp: null,
        activeTemplate: TERNARY_TEMPLATE_CUSTOM,
        demo: {
            label: '',
            a: 30,
            b: 60,
            startTemp: 1100,
            routes: [],
        },
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
                AppState.ternaryTemplates = data.ternaryTemplates || {};
                AppState.lineStyles = data.lineStyles;
                AppState.regionColors = data.regionColors;
                AppState.wasmReady = true;
                document.getElementById('wasmStatus').textContent = 'WASM 已加载';
                document.getElementById('wasmStatus').classList.add('loaded');
                initBinary();
                loadInitialTernaryTemplate();
            } catch(e) {
                console.error('Init error:', e);
            }
        }
    }, 100);
});
