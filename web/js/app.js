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
        points: [],
        lines: [],
        surfs: [],
        isoTemp: null,
        isoHistory: [],
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
}

function debounce(fn, ms) {
    let timer;
    return function(...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), ms);
    };
}

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

function waitForWasm() {
    return new Promise(resolve => {
        if (AppState.wasmReady) return resolve();
        const check = () => {
            if (AppState.wasmReady) resolve();
            else setTimeout(check, 50);
        };
        check();
    });
}

// Called from wasm_exec.js / Go after init
document.addEventListener('DOMContentLoaded', () => {
    // Poll for WASM readiness
    const checkWasm = setInterval(() => {
        if (typeof xubenGetTemplates !== 'undefined') {
            clearInterval(checkWasm);
            try {
                const data = xubenGetTemplates();
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
