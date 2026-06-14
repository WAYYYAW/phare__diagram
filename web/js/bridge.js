const XubenBridge = (() => {
    function requireGlobal(name) {
        const fn = window[name];
        if (typeof fn !== 'function') {
            throw new Error(`WASM bridge function not ready: ${name}`);
        }
        return fn;
    }

    function call(name, ...args) {
        return requireGlobal(name)(...args);
    }

    return {
        isReady() {
            return typeof window.xubenGetTemplates === 'function';
        },

        getTemplates() {
            return call('xubenGetTemplates');
        },

        computeBezierCurve(p0c, p0t, p2c, p2t, curve, n) {
            return call('xubenComputeBezierCurve', p0c, p0t, p2c, p2t, curve, n);
        },

        performLeverRule(pointsJSON, linesJSON, comp, temp) {
            return call('xubenPerformLeverRule', pointsJSON, linesJSON, comp, temp);
        },

        getRegionAt(pointsJSON, templateName, comp, temp) {
            return call('xubenGetRegionAt', pointsJSON, templateName, comp, temp);
        },

        computeTemplatePoints(templateName, paramsJSON) {
            return call('xubenComputeTemplatePoints', templateName, paramsJSON);
        },

        getTernaryTemplate(templateName) {
            return call('xubenGetTernaryTemplate', templateName);
        },

        ternary: {
            buildBezier(spJSON, epJSON, curveX, curveY, curveZ) {
                return call('xubenTernBuildBezier', spJSON, epJSON, curveX, curveY, curveZ);
            },

            setPrecision(high) {
                return call('xubenTernSetPrecision', high);
            },

            buildCoons3Edge(pointsJSON, linesJSON, indicesJSON, n) {
                return call('xubenTernBuildCoons3Edge', pointsJSON, linesJSON, indicesJSON, n);
            },

            buildCoons4Edge(pointsJSON, linesJSON, indicesJSON, n) {
                return call('xubenTernBuildCoons4Edge', pointsJSON, linesJSON, indicesJSON, n);
            },

            freeCoonsMesh(handle) {
                return call('xubenTernFreeCoonsMesh', handle);
            },

            freeAllCoonsMeshes() {
                return call('xubenTernFreeAllCoonsMeshes');
            },

            to3d(a, b, c, temp) {
                return call('xubenTernTo3d', a, b, c, temp);
            },

            from3d(x, y) {
                return call('xubenTernFrom3d', x, y);
            },
        },

        triangle: {
            pointInTriangle(px, py, ax, ay, bx, by, cx, cy) {
                return call('xubenTriPointInTriangle', px, py, ax, ay, bx, by, cx, cy);
            },

            projectPointOnLine(px, py, x1, y1, x2, y2) {
                return call('xubenTriProjectPointOnLine', px, py, x1, y1, x2, y2);
            },

            lineIntersection(x1, y1, x2, y2, x3, y3, x4, y4) {
                return call('xubenTriLineIntersection', x1, y1, x2, y2, x3, y3, x4, y4);
            },

            dist(x1, y1, x2, y2) {
                return call('xubenTriDist', x1, y1, x2, y2);
            },

            pointInTriangle3(px, py, ax, ay, bx, by, cx, cy) {
                return call('xubenTriPointInTriangle3', px, py, ax, ay, bx, by, cx, cy);
            },
        },
    };
})();

window.XubenBridge = XubenBridge;
