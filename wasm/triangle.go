package main

import (
	"math"
	"syscall/js"
)

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
