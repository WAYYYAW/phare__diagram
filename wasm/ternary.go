package main

import (
	"math"
)

var YTop = math.Sqrt(3) / 2

const (
	TernMin     = 0.0
	TernMax     = 1300.0
	TernBezierN = 30
	TernCoonsN  = 20
)

func ternFrom3d(x, y float64) (float64, float64, float64) {
	cRatio := y / YTop
	if cRatio < 0 {
		cRatio = 0
	}
	if cRatio > 1 {
		cRatio = 1
	}

	bRatio := x - 0.5*cRatio
	aRatio := 1 - bRatio - cRatio

	if aRatio < 0 {
		aRatio = 0
		bRatio = 1 - cRatio
		if bRatio < 0 {
			bRatio = 0
		}
		if bRatio > 1 {
			bRatio = 1
		}
	}
	if bRatio < 0 {
		bRatio = 0
		aRatio = 1 - cRatio
		if aRatio < 0 {
			aRatio = 0
		}
		if aRatio > 1 {
			aRatio = 1
		}
	}
	if aRatio > 1 {
		aRatio = 1
		bRatio = 0
		cRatio = 0
	}

	a := math.Round(aRatio*10000) / 100
	b := math.Round(bRatio*10000) / 100
	c := math.Round(cRatio*10000) / 100
	return a, b, c
}

func ternTo3d(a, b, c, temp float64) (float64, float64, float64) {
	total := a + b + c
	if total == 0 {
		return 0.5, YTop / 3, temp
	}
	return (b + 0.5*c) / total, YTop * c / total, temp
}

func ternBezierPt(p0, p1, p2, t float64) float64 {
	return (1-t)*(1-t)*p0 + 2*t*(1-t)*p1 + t*t*p2
}

func ternBuildBezier(sp, ep TernaryPoint, cx, cy, cz float64) ([]float64, []float64, []float64) {
	p0x, p0y, p0z := ternTo3d(sp.A, sp.B, sp.C, sp.Temp)
	p2x, p2y, p2z := ternTo3d(ep.A, ep.B, ep.C, ep.Temp)

	midX := (p0x + p2x) / 2
	midY := (p0y + p2y) / 2
	midZ := (p0z + p2z) / 2

	p1x := midX + cx*0.01
	p1y := midY + cy*0.01
	p1z := midZ + cz

	n := TernBezierN
	xs := make([]float64, n)
	ys := make([]float64, n)
	zs := make([]float64, n)
	for i := 0; i < n; i++ {
		t := float64(i) / float64(n-1)
		xs[i] = ternBezierPt(p0x, p1x, p2x, t)
		ys[i] = ternBezierPt(p0y, p1y, p2y, t)
		zs[i] = ternBezierPt(p0z, p1z, p2z, t)
	}
	return xs, ys, zs
}

func ternCurvePt(sp, ep TernaryPoint, cx, cy, cz, t float64) (float64, float64, float64) {
	p0x, p0y, p0z := ternTo3d(sp.A, sp.B, sp.C, sp.Temp)
	p2x, p2y, p2z := ternTo3d(ep.A, ep.B, ep.C, ep.Temp)

	midX := (p0x + p2x) / 2
	midY := (p0y + p2y) / 2
	midZ := (p0z + p2z) / 2

	p1x := midX + cx*0.01
	p1y := midY + cy*0.01
	p1z := midZ + cz

	tClamped := math.Max(0.0, math.Min(1.0, t))
	return ternBezierPt(p0x, p1x, p2x, tClamped),
		ternBezierPt(p0y, p1y, p2y, tClamped),
		ternBezierPt(p0z, p1z, p2z, tClamped)
}

func ternBuildCoons3edge(pts []TernaryPoint, lns []TernaryLine, lineIndices []int) ([][3]float64, [][3]int) {
	curveEnds := make([][2]string, len(lineIndices))
	for idx, li := range lineIndices {
		curveEnds[idx] = [2]string{lns[li].Start, lns[li].End}
	}

	adj := make(map[string][]int)
	for ci, ends := range curveEnds {
		adj[ends[0]] = append(adj[ends[0]], ci)
		adj[ends[1]] = append(adj[ends[1]], ci)
	}

	var vertLabels []string
	for l, c := range adj {
		if len(c) == 2 {
			vertLabels = append(vertLabels, l)
		}
	}
	if len(vertLabels) != 3 {
		return nil, nil
	}

	v0 := vertLabels[0]
	conns := adj[v0]
	ci1 := conns[0]
	ci2 := conns[1]
	ends1 := curveEnds[ci1]
	ends2 := curveEnds[ci2]
	var v1, v2 string
	if ends1[0] == v0 {
		v1 = ends1[1]
	} else {
		v1 = ends1[0]
	}
	if ends2[0] == v0 {
		v2 = ends2[1]
	} else {
		v2 = ends2[0]
	}

	find := func(a, b string) int {
		for i, ends := range curveEnds {
			if (ends[0] == a && ends[1] == b) || (ends[0] == b && ends[1] == a) {
				return lineIndices[i]
			}
		}
		return -1
	}

	i0 := find(v1, v2)
	i1 := find(v2, v0)
	i2 := find(v0, v1)
	if i0 < 0 || i1 < 0 || i2 < 0 {
		return nil, nil
	}

	ptMap := make(map[string]TernaryPoint)
	for _, p := range pts {
		ptMap[p.Label] = p
	}

	getPt := func(label string) TernaryPoint { return ptMap[label] }

	ept := func(idx int, startLbl, endLbl string, t float64) [3]float64 {
		ln := lns[idx]
		sp := getPt(ln.Start)
		ep := getPt(ln.End)
		if sp.Label == startLbl && ep.Label == endLbl {
			x, y, z := ternCurvePt(sp, ep, ln.CurveX, ln.CurveY, ln.CurveZ, t)
			return [3]float64{x, y, z}
		}
		x, y, z := ternCurvePt(sp, ep, ln.CurveX, ln.CurveY, ln.CurveZ, 1-t)
		return [3]float64{x, y, z}
	}

	n := TernCoonsN
	var pts3d [][3]float64
	idxMap := make(map[[2]int]int)

	for i := 0; i <= n; i++ {
		for j := 0; j <= n-i; j++ {
			kVal := n - i - j
			if kVal < 0 {
				continue
			}
			alpha := float64(i) / float64(n)
			beta := float64(j) / float64(n)
			gamma := float64(kVal) / float64(n)
			denom := beta*gamma + gamma*alpha + alpha*beta

			var pt [3]float64
			if denom < 1e-10 {
				if alpha > 0.5 {
					pt = ept(i2, v0, v1, 0)
				} else if beta > 0.5 {
					pt = ept(i0, v1, v2, 0)
				} else {
					pt = ept(i1, v2, v0, 0)
				}
			} else {
				t0 := gamma / (beta + gamma)
				if beta+gamma <= 1e-10 {
					t0 = 0.0
				}
				t1 := alpha / (gamma + alpha)
				if gamma+alpha <= 1e-10 {
					t1 = 0.0
				}
				t2 := beta / (alpha + beta)
				if alpha+beta <= 1e-10 {
					t2 = 0.0
				}
				pe0 := ept(i0, v1, v2, t0)
				pe1 := ept(i1, v2, v0, t1)
				pe2 := ept(i2, v0, v1, t2)

				for k := 0; k < 3; k++ {
					pt[k] = (beta*gamma*pe0[k] + gamma*alpha*pe1[k] + alpha*beta*pe2[k]) / denom
				}
			}

			idxMap[[2]int{i, j}] = len(pts3d)
			pts3d = append(pts3d, pt)
		}
	}

	var tris [][3]int
	for i := 0; i < n; i++ {
		for j := 0; j < n-i; j++ {
			if n-i-j <= 0 {
				continue
			}
			tris = append(tris, [3]int{idxMap[[2]int{i, j}], idxMap[[2]int{i + 1, j}], idxMap[[2]int{i, j + 1}]})
			if n-i-j > 1 {
				tris = append(tris, [3]int{idxMap[[2]int{i + 1, j}], idxMap[[2]int{i + 1, j + 1}], idxMap[[2]int{i, j + 1}]})
			}
		}
	}
	return pts3d, tris
}

func ternBuildCoons4edge(pts []TernaryPoint, lns []TernaryLine, lineIndices []int) ([][3]float64, [][3]int) {
	curveEnds := make([][2]string, len(lineIndices))
	for idx, li := range lineIndices {
		curveEnds[idx] = [2]string{lns[li].Start, lns[li].End}
	}

	adj := make(map[string][]int)
	for ci, ends := range curveEnds {
		adj[ends[0]] = append(adj[ends[0]], ci)
		adj[ends[1]] = append(adj[ends[1]], ci)
	}

	var vertLabels []string
	for l, c := range adj {
		if len(c) >= 2 {
			vertLabels = append(vertLabels, l)
		}
	}
	if len(vertLabels) < 4 {
		return nil, nil
	}

	v0 := vertLabels[0]
	v0c := adj[v0]
	ciA := v0c[0]
	ciB := v0c[1]
	endsA := curveEnds[ciA]
	endsB := curveEnds[ciB]
	var v1, v3 string
	if endsA[0] == v0 {
		v1 = endsA[1]
	} else {
		v1 = endsA[0]
	}
	if endsB[0] == v0 {
		v3 = endsB[1]
	} else {
		v3 = endsB[0]
	}

	var v2 string
	v1c := adj[v1]
	var ciV1 int
	for _, c := range v1c {
		if c != ciA {
			ciV1 = c
			break
		}
	}
	endsV1 := curveEnds[ciV1]
	if endsV1[0] == v1 {
		v2 = endsV1[1]
	} else {
		v2 = endsV1[0]
	}

	find := func(a, b string) int {
		for i, ends := range curveEnds {
			if (ends[0] == a && ends[1] == b) || (ends[0] == b && ends[1] == a) {
				return lineIndices[i]
			}
		}
		return -1
	}

	iu0 := find(v0, v1)
	iu1 := find(v3, v2)
	iv0 := find(v0, v3)
	iv1 := find(v1, v2)
	if iu0 < 0 || iu1 < 0 || iv0 < 0 || iv1 < 0 {
		return nil, nil
	}

	ptMap := make(map[string]TernaryPoint)
	for _, p := range pts {
		ptMap[p.Label] = p
	}

	getPt := func(label string) TernaryPoint { return ptMap[label] }

	ept := func(idx int, slbl, elbl string, t float64) [3]float64 {
		ln := lns[idx]
		sp := getPt(ln.Start)
		ep := getPt(ln.End)
		if sp.Label == slbl && ep.Label == elbl {
			x, y, z := ternCurvePt(sp, ep, ln.CurveX, ln.CurveY, ln.CurveZ, t)
			return [3]float64{x, y, z}
		}
		x, y, z := ternCurvePt(sp, ep, ln.CurveX, ln.CurveY, ln.CurveZ, 1-t)
		return [3]float64{x, y, z}
	}

	n := TernCoonsN
	P := make([][][3]float64, n)
	for i := 0; i < n; i++ {
		P[i] = make([][3]float64, n)
	}

	C00 := ept(iu0, v0, v1, 0.0)
	C10 := ept(iu0, v0, v1, 1.0)
	C01 := ept(iu1, v3, v2, 0.0)
	C11 := ept(iu1, v3, v2, 1.0)

	for i := 0; i < n; i++ {
		u := float64(i) / float64(n-1)
		Pu0 := ept(iu0, v0, v1, u)
		Pu1 := ept(iu1, v3, v2, u)
		for j := 0; j < n; j++ {
			v := float64(j) / float64(n-1)
			P0v := ept(iv0, v0, v3, v)
			P1v := ept(iv1, v1, v2, v)
			for k := 0; k < 3; k++ {
				P[i][j][k] = (1-v)*Pu0[k] + v*Pu1[k] + (1-u)*P0v[k] + u*P1v[k] -
					((1-u)*(1-v)*C00[k] + u*(1-v)*C10[k] + (1-u)*v*C01[k] + u*v*C11[k])
			}
		}
	}

	var verts [][3]float64
	for i := 0; i < n; i++ {
		for j := 0; j < n; j++ {
			verts = append(verts, P[i][j])
		}
	}

	var tris [][3]int
	for i := 0; i < n-1; i++ {
		for j := 0; j < n-1; j++ {
			idx := i*n + j
			tris = append(tris, [3]int{idx, idx + n, idx + 1})
			tris = append(tris, [3]int{idx + 1, idx + n, idx + n + 1})
		}
	}
	return verts, tris
}
