package main

import (
	"encoding/json"
	"math"
	"syscall/js"
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

func computeLinesForExportJS(this js.Value, args []js.Value) interface{} {
	if len(args) < 3 {
		return js.Undefined()
	}
	pts := parseJSONCompPoints(args[0].String())
	lns := parseJSONLines(args[1].String())
	exportLines := args[2].Bool()

	shown := make(map[string]bool)
	var lines []LineExportItem
	for _, ln := range lns {
		p1 := findPoint(pts, ln.Start)
		p2 := findPoint(pts, ln.End)
		if p1 == nil || p2 == nil {
			continue
		}
		xs, ys := getBezierCurve(p1.Comp, p1.Temp, p2.Comp, p2.Temp, ln.Curve, 40)

		style := getLineStyle(ln.Type)
		label := style["label"].(string)
		isFirst := !shown[ln.Type]
		shown[ln.Type] = true

		if isFirst {
			lines = append(lines, LineExportItem{
				Type:  ln.Type,
				Label: label,
				Color: style["color"].(string),
				Dash:  style["ls"].(string),
				Width: style["lw"].(float64),
				Xs:    xs,
				Ys:    ys,
			})
		} else {
			lines = append(lines, LineExportItem{
				Type:  ln.Type,
				Label: label,
				Color: style["color"].(string),
				Dash:  style["ls"].(string),
				Width: style["lw"].(float64),
				Xs:    xs,
				Ys:    ys,
			})
		}
	}
	if !exportLines {
		return jsJSON(lines)
	}
	return jsJSON(LinesExport{Lines: lines})
}

func findPoint(pts []CompPoint, label string) *CompPoint {
	for i, p := range pts {
		if p.Label == label {
			return &pts[i]
		}
	}
	return nil
}

func getLineStyle(t string) map[string]interface{} {
	styles := map[string]map[string]interface{}{
		"liquidus":   {"color": "#1565C0", "ls": "-", "lw": 2.5, "label": "液相线"},
		"solidus":    {"color": "#E53935", "ls": "-", "lw": 2.5, "label": "固相线"},
		"eutectic":   {"color": "#6A1B9A", "ls": "--", "lw": 2.0, "label": "三相线"},
		"peritectic": {"color": "#FF8F00", "ls": "-.", "lw": 2.0, "label": "包晶线"},
		"solvus":     {"color": "#2E7D32", "ls": ":", "lw": 1.8, "label": "溶线"},
		"eutectoid":  {"color": "#00ACC1", "ls": "--", "lw": 2.0, "label": "共析线"},
		"other":      {"color": "#757575", "ls": ":", "lw": 1.5, "label": "其他"},
	}
	if s, ok := styles[t]; ok {
		return s
	}
	return styles["other"]
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

func ternBuildCoons3edgeJS(this js.Value, args []js.Value) interface{} {
	if len(args) < 3 {
		return js.Undefined()
	}
	pts := parseJSONTernaryPoints(args[0].String())
	lns := parseJSONTernaryLines(args[1].String())
	indices := parseJSONIntSlice(args[2].String())
	if pts == nil || lns == nil || indices == nil {
		return js.Undefined()
	}
	verts, tris := ternBuildCoons3edge(pts, lns, indices)
	if verts == nil {
		return jsJSON(nil)
	}
	return jsJSON(map[string]interface{}{"verts": verts, "tris": tris})
}

func ternBuildCoons4edgeJS(this js.Value, args []js.Value) interface{} {
	if len(args) < 3 {
		return js.Undefined()
	}
	pts := parseJSONTernaryPoints(args[0].String())
	lns := parseJSONTernaryLines(args[1].String())
	indices := parseJSONIntSlice(args[2].String())
	if pts == nil || lns == nil || indices == nil {
		return js.Undefined()
	}
	verts, tris := ternBuildCoons4edge(pts, lns, indices)
	if verts == nil {
		return jsJSON(nil)
	}
	return jsJSON(map[string]interface{}{"verts": verts, "tris": tris})
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

// ---- Concentration Triangle (SY.py) Computations ----

func triPointInTriangleJS(this js.Value, args []js.Value) interface{} {
	if len(args) < 8 {
		return js.Undefined()
	}
	px, py := args[0].Float(), args[1].Float()
	ax, ay := args[2].Float(), args[3].Float()
	bx, by := args[4].Float(), args[5].Float()
	cx, cy := args[6].Float(), args[7].Float()

	v0x, v0y := cx-ax, cy-ay
	v1x, v1y := bx-ax, by-ay
	v2x, v2y := px-ax, py-ay
	dot00 := v0x*v0x + v0y*v0y
	dot01 := v0x*v1x + v0y*v1y
	dot02 := v0x*v2x + v0y*v2y
	dot11 := v1x*v1x + v1y*v1y
	denom := dot00*dot11 - dot01*dot01

	ok := false
	a, b, c := 0.0, 0.0, 0.0
	if denom < -1e-12 || denom > 1e-12 {
		u := (dot11*dot02 - dot01*(v1x*v2x+v1y*v2y)) / denom
		v := (dot00*(v1x*v2x+v1y*v2y) - dot01*dot02) / denom
		if u >= -1e-10 && v >= -1e-10 && u+v <= 1+1e-10 {
			ok = true
			ua, ub := math.Round(u*100), math.Round(v*100)
			a, b, c = ua, ub, 100-ua-ub
		}
	}
	return jsJSON(map[string]interface{}{"ok": ok, "a": a, "b": b, "c": c})
}

func triProjectPointOnLineJS(this js.Value, args []js.Value) interface{} {
	if len(args) < 6 {
		return js.Undefined()
	}
	px, py := args[0].Float(), args[1].Float()
	x1, y1 := args[2].Float(), args[3].Float()
	x2, y2 := args[4].Float(), args[5].Float()

	dx, dy := x2-x1, y2-y1
	if dx == 0 && dy == 0 {
		return jsJSON(map[string]float64{"x": x1, "y": y1})
	}
	t := ((px-x1)*dx + (py-y1)*dy) / (dx*dx + dy*dy)
	if t < 0 {
		t = 0
	} else if t > 1 {
		t = 1
	}
	return jsJSON(map[string]float64{"x": x1 + t*dx, "y": y1 + t*dy})
}

func triLineIntersectionJS(this js.Value, args []js.Value) interface{} {
	if len(args) < 8 {
		return js.Undefined()
	}
	x1, y1 := args[0].Float(), args[1].Float()
	x2, y2 := args[2].Float(), args[3].Float()
	x3, y3 := args[4].Float(), args[5].Float()
	x4, y4 := args[6].Float(), args[7].Float()

	den := (x1-x2)*(y3-y4) - (y1-y2)*(x3-x4)
	if den < 1e-12 && den > -1e-12 {
		return js.ValueOf(nil)
	}
	t := ((x1-x3)*(y3-y4) - (y1-y3)*(x3-x4)) / den
	return jsJSON(map[string]float64{"x": x1 + t*(x2-x1), "y": y1 + t*(y2-y1)})
}

func triDistJS(this js.Value, args []js.Value) interface{} {
	if len(args) < 4 {
		return js.Undefined()
	}
	x1, y1 := args[0].Float(), args[1].Float()
	x2, y2 := args[2].Float(), args[3].Float()
	d := math.Hypot(x1-x2, y1-y2)
	return js.ValueOf(d)
}

func triPointInTriangle3JS(this js.Value, args []js.Value) interface{} {
	if len(args) < 8 {
		return js.Undefined()
	}
	px, py := args[0].Float(), args[1].Float()
	x1, y1 := args[2].Float(), args[3].Float()
	x2, y2 := args[4].Float(), args[5].Float()
	x3, y3 := args[6].Float(), args[7].Float()

	sign := func(ax, ay, bx, by, cx, cy float64) float64 {
		return (ax-cx)*(by-cy) - (bx-cx)*(ay-cy)
	}
	d1 := sign(px, py, x1, y1, x2, y2)
	d2 := sign(px, py, x2, y2, x3, y3)
	d3 := sign(px, py, x3, y3, x1, y1)

	hasNeg := d1 < 0 || d2 < 0 || d3 < 0
	hasPos := d1 > 0 || d2 > 0 || d3 > 0
	return js.ValueOf(!(hasNeg && hasPos))
}

func main() {
	c := make(chan struct{}, 0)

	js.Global().Set("xubenGetTemplates", js.FuncOf(getTemplatesJS))
	js.Global().Set("xubenComputeBezierCurve", js.FuncOf(computeBezierCurveJS))
	js.Global().Set("xubenPerformLeverRule", js.FuncOf(performLeverRuleJS))
	js.Global().Set("xubenGetRegionAt", js.FuncOf(getRegionAtJS))
	js.Global().Set("xubenComputeTemplatePoints", js.FuncOf(computeTemplatePointsJS))
	js.Global().Set("xubenComputeLinesForExport", js.FuncOf(computeLinesForExportJS))
	js.Global().Set("xubenTernBuildBezier", js.FuncOf(ternBuildBezierJS))
	js.Global().Set("xubenTernBuildCoons3Edge", js.FuncOf(ternBuildCoons3edgeJS))
	js.Global().Set("xubenTernBuildCoons4Edge", js.FuncOf(ternBuildCoons4edgeJS))
	js.Global().Set("xubenTernTo3d", js.FuncOf(ternTo3dJS))
	js.Global().Set("xubenTriPointInTriangle", js.FuncOf(triPointInTriangleJS))
	js.Global().Set("xubenTriProjectPointOnLine", js.FuncOf(triProjectPointOnLineJS))
	js.Global().Set("xubenTriLineIntersection", js.FuncOf(triLineIntersectionJS))
	js.Global().Set("xubenTriDist", js.FuncOf(triDistJS))
	js.Global().Set("xubenTriPointInTriangle3", js.FuncOf(triPointInTriangle3JS))
	js.Global().Get("console").Call("log", "xuben WASM loaded successfully")

	<-c
}
