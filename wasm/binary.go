package main

import (
	"math"
)

func bezierPt(p0, p1, p2, t float64) float64 {
	return (1-t)*(1-t)*p0 + 2*t*(1-t)*p1 + t*t*p2
}

func getBezierCurve(p0Comp, p0Temp, p2Comp, p2Temp, curveAmount float64, nPoints int) ([]float64, []float64) {
	p0 := [2]float64{p0Comp, p0Temp}
	p2 := [2]float64{p2Comp, p2Temp}
	mid := [2]float64{(p0[0] + p2[0]) / 2, (p0[1] + p2[1]) / 2}
	p1 := [2]float64{mid[0], mid[1] + curveAmount}

	xs := make([]float64, nPoints)
	ys := make([]float64, nPoints)
	for i := 0; i < nPoints; i++ {
		t := float64(i) / float64(nPoints-1)
		xs[i] = bezierPt(p0[0], p1[0], p2[0], t)
		ys[i] = bezierPt(p0[1], p1[1], p2[1], t)
	}
	return xs, ys
}

type intersecVal struct {
	val  float64
	line LineDef
}

func findIntersections(points []CompPoint, lines []LineDef, constVal float64, axis string) []intersecVal {
	var coordIdx int
	var bezierIdx int
	if axis == "x" {
		coordIdx = 0
		bezierIdx = 1
	} else {
		coordIdx = 1
		bezierIdx = 0
	}

	ptMap := make(map[string]CompPoint)
	for _, p := range points {
		ptMap[p.Label] = p
	}

	var intersections []intersecVal
	for _, line := range lines {
		sp, ok1 := ptMap[line.Start]
		ep, ok2 := ptMap[line.End]
		if !ok1 || !ok2 {
			continue
		}
		p0 := [2]float64{sp.Comp, sp.Temp}
		p2 := [2]float64{ep.Comp, ep.Temp}
		mid := [2]float64{(p0[0] + p2[0]) / 2, (p0[1] + p2[1]) / 2}
		p1 := [2]float64{mid[0], mid[1] + line.Curve}

		lo := math.Min(p0[coordIdx], p2[coordIdx])
		hi := math.Max(p0[coordIdx], p2[coordIdx])
		if constVal < lo-0.001 || constVal > hi+0.001 {
			continue
		}

		A := p0[coordIdx] - 2*p1[coordIdx] + p2[coordIdx]
		B := 2 * (p1[coordIdx] - p0[coordIdx])
		C := p0[coordIdx] - constVal

		var roots []float64
		if math.Abs(A) < 1e-12 {
			if math.Abs(B) > 1e-12 {
				t := -C / B
				if t >= 0 && t <= 1 {
					roots = append(roots, t)
				}
			}
		} else {
			disc := B*B - 4*A*C
			if disc >= 0 {
				sd := math.Sqrt(disc)
				t1 := (-B + sd) / (2 * A)
				t2 := (-B - sd) / (2 * A)
				if t1 >= 0 && t1 <= 1 {
					roots = append(roots, t1)
				}
				if t2 >= 0 && t2 <= 1 {
					roots = append(roots, t2)
				}
			}
		}

		for _, t := range roots {
			val := bezierPt(p0[bezierIdx], p1[bezierIdx], p2[bezierIdx], t)
			intersections = append(intersections, intersecVal{val, line})
		}
	}

	if axis == "x" {
		for i := 0; i < len(intersections); i++ {
			for j := i + 1; j < len(intersections); j++ {
				if intersections[i].val < intersections[j].val {
					intersections[i], intersections[j] = intersections[j], intersections[i]
				}
			}
		}
	} else {
		for i := 0; i < len(intersections); i++ {
			for j := i + 1; j < len(intersections); j++ {
				if intersections[i].val > intersections[j].val {
					intersections[i], intersections[j] = intersections[j], intersections[i]
				}
			}
		}
	}
	return intersections
}

func performLeverRule(points []CompPoint, lines []LineDef, comp, temp float64) LeverResult {
	hInt := findIntersections(points, lines, temp, "y")
	var phaseHInt []intersecVal
	for _, iv := range hInt {
		t := iv.line.Type
		if t == "liquidus" || t == "solidus" || t == "solvus" || t == "eutectic" || t == "peritectic" || t == "eutectoid" {
			phaseHInt = append(phaseHInt, iv)
		}
	}

	ptMap := make(map[string]CompPoint)
	for _, p := range points {
		ptMap[p.Label] = p
	}
	for _, ln := range lines {
		t := ln.Type
		if t == "eutectic" || t == "peritectic" || t == "eutectoid" {
			sp, ok1 := ptMap[ln.Start]
			ep, ok2 := ptMap[ln.End]
			if ok1 && ok2 {
				if math.Abs(temp-sp.Temp) < 2.0 && comp >= math.Min(sp.Comp, ep.Comp) && comp <= math.Max(sp.Comp, ep.Comp) {
					return LeverResult{Type: "three_phase", Desc: "三相共存线 (" + ln.Type + ")"}
				}
			}
		}
	}

	for i := 0; i < len(phaseHInt); i++ {
		for j := i + 1; j < len(phaseHInt); j++ {
			if phaseHInt[i].val > phaseHInt[j].val {
				phaseHInt[i], phaseHInt[j] = phaseHInt[j], phaseHInt[i]
			}
		}
	}

	crossingsBefore := 0
	for _, iv := range phaseHInt {
		if iv.val <= comp+1e-9 {
			crossingsBefore++
		}
	}

	if crossingsBefore%2 == 1 {
		var left, right *float64
		for _, iv := range phaseHInt {
			c := iv.val
			if c <= comp+1e-9 {
				left = &c
			}
			if c >= comp-1e-9 && right == nil {
				right = &c
			}
		}
		if left != nil && right != nil && math.Abs(*right-*left) > 1e-9 {
			wR := (comp - *left) / (*right - *left)
			wL := 1 - wR
			return LeverResult{
				Type:   "two_phase",
				Left:   left,
				Right:  right,
				WLeft:  &wL,
				WRight: &wR,
			}
		}
	}

	return LeverResult{Type: "single_phase"}
}

func pointInPolygon(point [2]float64, vertices [][2]float64) bool {
	x, y := point[0], point[1]
	inside := false
	n := len(vertices)
	j := n - 1
	for i := 0; i < n; i++ {
		xi, yi := vertices[i][0], vertices[i][1]
		xj, yj := vertices[j][0], vertices[j][1]
		if ((yi > y) != (yj > y)) && (x < (xj-xi)*(y-yi)/(yj-yi)+xi) {
			inside = !inside
		}
		j = i
	}
	return inside
}

func getRegionAt(points []CompPoint, templateName string, comp, temp float64) string {
	tmpl, ok := Templates[templateName]
	if !ok || tmpl == nil {
		return ""
	}

	ptMap := make(map[string][2]float64)
	for _, p := range points {
		ptMap[p.Label] = [2]float64{p.Comp, p.Temp}
	}

	ptMap["T_LEFT"] = [2]float64{0, 4000}
	ptMap["T_RIGHT"] = [2]float64{100, 4000}
	ptMap["B_LEFT"] = [2]float64{0, -500}
	ptMap["B_RIGHT"] = [2]float64{100, -500}

	for _, rDef := range tmpl.Topology.Regions {
		var vertices [][2]float64
		for _, lbl := range rDef.Points {
			if v, ok := ptMap[lbl]; ok {
				vertices = append(vertices, v)
			}
		}
		if len(vertices) >= 3 {
			if pointInPolygon([2]float64{comp, temp}, vertices) {
				return rDef.Label
			}
		}
	}
	return ""
}
