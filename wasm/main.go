package main

import (
	"encoding/json"
	"syscall/js"
	"unsafe"
)

// coonsMeshPool pins active Coons meshes against GC while JS holds TypedArray
// views into WASM linear memory.
var (
	coonsMeshPool          = map[uint32]*CoonsMesh{}
	nextCoonsHandle uint32 = 1
)

func jsJSON(data interface{}) interface{} {
	b, err := json.Marshal(data)
	if err != nil {
		return js.ValueOf(nil)
	}
	return js.Global().Get("JSON").Call("parse", string(b))
}

func parseJSONCompPoints(s string) []CompPoint {
	var pts []CompPoint
	if err := json.Unmarshal([]byte(s), &pts); err != nil {
		return nil
	}
	return pts
}

func parseJSONLines(s string) []LineDef {
	var lns []LineDef
	if err := json.Unmarshal([]byte(s), &lns); err != nil {
		return nil
	}
	return lns
}

func parseJSONTernaryPoints(s string) []TernaryPoint {
	var pts []TernaryPoint
	if err := json.Unmarshal([]byte(s), &pts); err != nil {
		return nil
	}
	return pts
}

func parseJSONTernaryLines(s string) []TernaryLine {
	var lns []TernaryLine
	if err := json.Unmarshal([]byte(s), &lns); err != nil {
		return nil
	}
	return lns
}

func parseJSONIntSlice(s string) []int {
	var idx []int
	if err := json.Unmarshal([]byte(s), &idx); err != nil {
		return nil
	}
	return idx
}

// ---- Template Computation Helpers ----

func parseFloat(s string, params map[string]float64) float64 {
	if v, ok := params[s]; ok {
		return v
	}
	var f float64
	if err := json.Unmarshal([]byte(s), &f); err == nil {
		return f
	}
	return 0
}

// ---- JS Exports ----

func getTemplatesJS(this js.Value, args []js.Value) interface{} {
	type templateExport struct {
		Params   []ParamDef `json:"params"`
		Topology Topology   `json:"topology"`
	}
	export := make(map[string]*templateExport)
	for name, tmpl := range Templates {
		if tmpl == nil {
			export[name] = nil
		} else {
			export[name] = &templateExport{
				Params:   tmpl.Params,
				Topology: tmpl.Topology,
			}
		}
	}
	res := map[string]interface{}{
		"templates": export,
		"lineStyles": map[string]interface{}{
			"liquidus":   map[string]interface{}{"color": "#1565C0", "ls": "-", "lw": 2.5, "label": "液相线"},
			"solidus":    map[string]interface{}{"color": "#E53935", "ls": "-", "lw": 2.5, "label": "固相线"},
			"eutectic":   map[string]interface{}{"color": "#6A1B9A", "ls": "--", "lw": 2.0, "label": "三相线"},
			"peritectic": map[string]interface{}{"color": "#FF8F00", "ls": "-.", "lw": 2.0, "label": "包晶线"},
			"solvus":     map[string]interface{}{"color": "#2E7D32", "ls": ":", "lw": 1.8, "label": "溶线"},
			"eutectoid":  map[string]interface{}{"color": "#00ACC1", "ls": "--", "lw": 2.0, "label": "共析线"},
			"other":      map[string]interface{}{"color": "#757575", "ls": ":", "lw": 1.5, "label": "其他"},
		},
		"regionColors": []string{
			"rgba(255, 235, 150, 0.30)", "rgba(200, 230, 255, 0.30)", "rgba(255, 200, 200, 0.30)",
			"rgba(200, 255, 200, 0.30)", "rgba(230, 200, 255, 0.30)", "rgba(255, 210, 180, 0.30)",
			"rgba(180, 255, 255, 0.30)", "rgba(255, 220, 240, 0.30)", "rgba(220, 240, 200, 0.30)",
			"rgba(210, 210, 255, 0.30)", "rgba(255, 245, 200, 0.30)", "rgba(220, 220, 220, 0.30)",
		},
	}
	return jsJSON(res)
}

func computeBezierCurveJS(this js.Value, args []js.Value) interface{} {
	if len(args) < 6 {
		return js.Undefined()
	}
	p0c := args[0].Float()
	p0t := args[1].Float()
	p2c := args[2].Float()
	p2t := args[3].Float()
	curve := args[4].Float()
	n := args[5].Int()
	if n < 2 {
		n = 40
	}
	xs, ys := getBezierCurve(p0c, p0t, p2c, p2t, curve, n)
	return jsJSON(CurveResult{Xs: xs, Ys: ys})
}

func performLeverRuleJS(this js.Value, args []js.Value) interface{} {
	if len(args) < 4 {
		return js.Undefined()
	}
	pts := parseJSONCompPoints(args[0].String())
	lns := parseJSONLines(args[1].String())
	comp := args[2].Float()
	temp := args[3].Float()
	res := performLeverRule(pts, lns, comp, temp)
	return jsJSON(res)
}

func getRegionAtJS(this js.Value, args []js.Value) interface{} {
	if len(args) < 4 {
		return js.Undefined()
	}
	pts := parseJSONCompPoints(args[0].String())
	tplName := args[1].String()
	comp := args[2].Float()
	temp := args[3].Float()
	region := getRegionAt(pts, tplName, comp, temp)
	return js.ValueOf(region)
}

func computeTemplatePointsJS(this js.Value, args []js.Value) interface{} {
	if len(args) < 2 {
		return js.Undefined()
	}
	tplName := args[0].String()
	paramsJSON := args[1].String()

	tmpl, ok := Templates[tplName]
	if !ok || tmpl == nil {
		return jsJSON(map[string]interface{}{"error": "template not found"})
	}

	var params map[string]float64
	if err := json.Unmarshal([]byte(paramsJSON), &params); err != nil {
		return jsJSON(map[string]interface{}{"error": "invalid params"})
	}

	var pts []map[string]interface{}
	for _, pd := range tmpl.Topology.Points {
		c := parseFloat(pd.Comp, params)
		t := parseFloat(pd.Temp, params)
		pts = append(pts, map[string]interface{}{
			"label": pd.Label,
			"comp":  c,
			"temp":  t,
		})
	}

	var lns []map[string]interface{}
	for _, ld := range tmpl.Topology.Lines {
		lns = append(lns, map[string]interface{}{
			"start": ld.Start,
			"end":   ld.End,
			"type":  ld.Type,
			"curve": ld.Curve,
		})
	}

	return jsJSON(map[string]interface{}{
		"points": pts,
		"lines":  lns,
	})
}

func ternBuildBezierJS(this js.Value, args []js.Value) interface{} {
	if len(args) < 2 {
		return js.Undefined()
	}
	var sp, ep TernaryPoint
	if err := json.Unmarshal([]byte(args[0].String()), &sp); err != nil {
		return js.Undefined()
	}
	if err := json.Unmarshal([]byte(args[1].String()), &ep); err != nil {
		return js.Undefined()
	}
	cx, cy, cz := 0.0, 0.0, 0.0
	if len(args) > 2 {
		cx = args[2].Float()
	}
	if len(args) > 3 {
		cy = args[3].Float()
	}
	if len(args) > 4 {
		cz = args[4].Float()
	}
	xs, ys, zs := ternBuildBezier(sp, ep, cx, cy, cz)
	return jsJSON(map[string]interface{}{"xs": xs, "ys": ys, "zs": zs})
}

func ternSetPrecisionJS(this js.Value, args []js.Value) interface{} {
	if len(args) < 1 {
		return js.Undefined()
	}
	high := args[0].Bool()
	TernHighPrecision = high
	if high {
		TernCoonsN = 60
	} else {
		TernCoonsN = 30
	}
	return js.ValueOf(true)
}

// ---- Zero-copy Coons mesh exports ----
//
// These functions compute the Coons patch and store the flat slices in
// coonsMeshCache (package-level, pinned against GC).  They return a small
// metadata object { ptrX, ptrY, ptrZ, ptrI, ptrJ, ptrK, numVerts, numTris }.
//
// JS side: use the numeric pointers as byte offsets into
//   wasmInstance.exports.memory.buffer
// to construct TypedArray views:
//
//   const mem = wasmInst.exports.memory.buffer;
//   const xs = new Float64Array(mem, meta.ptrX, meta.numVerts);  // 8-byte aligned
//   const is = new Int32Array(  mem, meta.ptrI, meta.numTris);   // 4-byte aligned
//
// IMPORTANT: Float64 requires 8-byte alignment; Int32 requires 4-byte alignment.
// Go's memory allocator guarantees this for []float64 and []int32 backing arrays.
//
// The old JSON-based functions (ternBuildCoons3edgeJS / ternBuildCoons4edgeJS)
// are replaced by these zero-copy versions.

func coonsMetaJSON(handle uint32, m *CoonsMesh) interface{} {
	if m == nil || m.X == nil {
		return js.ValueOf(nil)
	}
	// unsafe.SliceData returns a pointer to the backing array.
	// uintptr(unsafe.Pointer(...)) gives the offset in WASM linear memory.
	meta := map[string]interface{}{
		"handle":   handle,
		"ptrX":     uintptr(unsafe.Pointer(unsafe.SliceData(m.X))),
		"ptrY":     uintptr(unsafe.Pointer(unsafe.SliceData(m.Y))),
		"ptrZ":     uintptr(unsafe.Pointer(unsafe.SliceData(m.Z))),
		"ptrI":     uintptr(unsafe.Pointer(unsafe.SliceData(m.I))),
		"ptrJ":     uintptr(unsafe.Pointer(unsafe.SliceData(m.J))),
		"ptrK":     uintptr(unsafe.Pointer(unsafe.SliceData(m.K))),
		"numVerts": m.NumVerts,
		"numTris":  m.NumTris,
	}
	return jsJSON(meta)
}

func allocCoonsHandle(mesh *CoonsMesh) uint32 {
	handle := nextCoonsHandle
	nextCoonsHandle++
	coonsMeshPool[handle] = mesh
	return handle
}

func ternBuildCoons3edgeJS(this js.Value, args []js.Value) interface{} {
	if len(args) < 4 {
		return js.Undefined()
	}
	pts := parseJSONTernaryPoints(args[0].String())
	lns := parseJSONTernaryLines(args[1].String())
	indices := parseJSONIntSlice(args[2].String())
	n := args[3].Int()
	if pts == nil || lns == nil || indices == nil {
		return js.Undefined()
	}
	mesh := ternBuildCoons3edge(pts, lns, indices, n)
	if mesh == nil {
		return js.ValueOf(nil)
	}
	handle := allocCoonsHandle(mesh)
	return coonsMetaJSON(handle, mesh)
}

func ternBuildCoons4edgeJS(this js.Value, args []js.Value) interface{} {
	if len(args) < 4 {
		return js.Undefined()
	}
	pts := parseJSONTernaryPoints(args[0].String())
	lns := parseJSONTernaryLines(args[1].String())
	indices := parseJSONIntSlice(args[2].String())
	n := args[3].Int()
	if pts == nil || lns == nil || indices == nil {
		return js.Undefined()
	}
	mesh := ternBuildCoons4edge(pts, lns, indices, n)
	if mesh == nil {
		return js.ValueOf(nil)
	}
	handle := allocCoonsHandle(mesh)
	return coonsMetaJSON(handle, mesh)
}

func ternFreeCoonsMeshJS(this js.Value, args []js.Value) interface{} {
	if len(args) < 1 {
		return js.ValueOf(false)
	}
	handle := uint32(args[0].Int())
	if _, ok := coonsMeshPool[handle]; !ok {
		return js.ValueOf(false)
	}
	delete(coonsMeshPool, handle)
	return js.ValueOf(true)
}

func ternFreeAllCoonsMeshesJS(this js.Value, args []js.Value) interface{} {
	coonsMeshPool = map[uint32]*CoonsMesh{}
	return js.ValueOf(true)
}

func ternTo3dJS(this js.Value, args []js.Value) interface{} {
	if len(args) < 4 {
		return js.Undefined()
	}
	a := args[0].Float()
	b := args[1].Float()
	c := args[2].Float()
	temp := args[3].Float()
	x, y, z := ternTo3d(a, b, c, temp)
	return jsJSON(map[string]float64{"x": x, "y": y, "z": z})
}

func ternFrom3dJS(this js.Value, args []js.Value) interface{} {
	if len(args) < 2 {
		return js.Undefined()
	}
	x := args[0].Float()
	y := args[1].Float()
	a, b, c := ternFrom3d(x, y)
	return jsJSON(map[string]float64{"a": a, "b": b, "c": c})
}

func main() {
	c := make(chan struct{}, 0)

	js.Global().Set("xubenGetTemplates", js.FuncOf(getTemplatesJS))
	js.Global().Set("xubenComputeBezierCurve", js.FuncOf(computeBezierCurveJS))
	js.Global().Set("xubenPerformLeverRule", js.FuncOf(performLeverRuleJS))
	js.Global().Set("xubenGetRegionAt", js.FuncOf(getRegionAtJS))
	js.Global().Set("xubenComputeTemplatePoints", js.FuncOf(computeTemplatePointsJS))
	js.Global().Set("xubenTernBuildBezier", js.FuncOf(ternBuildBezierJS))
	js.Global().Set("xubenTernSetPrecision", js.FuncOf(ternSetPrecisionJS))
	js.Global().Set("xubenTernBuildCoons3Edge", js.FuncOf(ternBuildCoons3edgeJS))
	js.Global().Set("xubenTernBuildCoons4Edge", js.FuncOf(ternBuildCoons4edgeJS))
	js.Global().Set("xubenTernFreeCoonsMesh", js.FuncOf(ternFreeCoonsMeshJS))
	js.Global().Set("xubenTernFreeAllCoonsMeshes", js.FuncOf(ternFreeAllCoonsMeshesJS))
	js.Global().Set("xubenTernTo3d", js.FuncOf(ternTo3dJS))
	js.Global().Set("xubenTernFrom3d", js.FuncOf(ternFrom3dJS))
	js.Global().Set("xubenTriPointInTriangle", js.FuncOf(triPointInTriangleJS))
	js.Global().Set("xubenTriProjectPointOnLine", js.FuncOf(triProjectPointOnLineJS))
	js.Global().Set("xubenTriLineIntersection", js.FuncOf(triLineIntersectionJS))
	js.Global().Set("xubenTriDist", js.FuncOf(triDistJS))
	js.Global().Set("xubenTriPointInTriangle3", js.FuncOf(triPointInTriangle3JS))
	js.Global().Get("console").Call("log", "xuben WASM loaded successfully")

	<-c
}
