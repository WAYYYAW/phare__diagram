package main

import (
	"math"
)

var YTop = math.Sqrt(3) / 2

const (
	TernMin     = 0.0
	TernMax     = 1300.0
	TernBezierN = 30
)

var TernCoonsN = 30
var TernHighPrecision = false

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

// triIdx returns the array index for vertex (i,j) in a triangular grid with n divisions.
// Formula: index = i*(2n+3-i)/2 + j
func triIdx(n, i, j int) int {
	return i*(2*n+3-i)/2 + j
}

// CoonsMesh holds flat slices suitable for zero-copy transfer to JS.
// Plotly mesh3d expects: x, y, z as flat float arrays, and i, j, k as flat int arrays.
// Float64 is 8-byte aligned; int32 is 4-byte aligned in WASM linear memory.
type CoonsMesh struct {
	X, Y, Z  []float64
	I, J, K  []int32
	NumVerts int
	NumTris  int
}

func normalizeCoonsN(n int) int {
	if n < 2 {
		return 2
	}
	return n
}

func ternBuildCoons3edge(pts []TernaryPoint, lns []TernaryLine, lineIndices []int, n int) *CoonsMesh {
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
		return nil
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
		return nil
	}

	ptMap := make(map[string]TernaryPoint)
	for _, p := range pts {
		ptMap[p.Label] = p
	}

	getPt := func(label string) TernaryPoint { return ptMap[label] }

	ept := func(idx int, startLbl, endLbl string, t float64) (float64, float64, float64) {
		ln := lns[idx]
		sp := getPt(ln.Start)
		ep := getPt(ln.End)
		if sp.Label == startLbl && ep.Label == endLbl {
			x, y, z := ternCurvePt(sp, ep, ln.CurveX, ln.CurveY, ln.CurveZ, t)
			return x, y, z
		}
		x, y, z := ternCurvePt(sp, ep, ln.CurveX, ln.CurveY, ln.CurveZ, 1-t)
		return x, y, z
	}

	n = normalizeCoonsN(n)
	totalVerts := (n + 1) * (n + 2) / 2

	// Flat slices instead of [][3]float64
	xs := make([]float64, totalVerts)
	ys := make([]float64, totalVerts)
	zs := make([]float64, totalVerts)

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

			idx := triIdx(n, i, j)

			if denom < 1e-10 {
				var px, py, pz float64
				if alpha > 0.5 {
					px, py, pz = ept(i2, v0, v1, 0)
				} else if beta > 0.5 {
					px, py, pz = ept(i0, v1, v2, 0)
				} else {
					px, py, pz = ept(i1, v2, v0, 0)
				}
				xs[idx], ys[idx], zs[idx] = px, py, pz
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
				pe0x, pe0y, pe0z := ept(i0, v1, v2, t0)
				pe1x, pe1y, pe1z := ept(i1, v2, v0, t1)
				pe2x, pe2y, pe2z := ept(i2, v0, v1, t2)

				xs[idx] = (beta*gamma*pe0x + gamma*alpha*pe1x + alpha*beta*pe2x) / denom
				ys[idx] = (beta*gamma*pe0y + gamma*alpha*pe1y + alpha*beta*pe2y) / denom
				zs[idx] = (beta*gamma*pe0z + gamma*alpha*pe1z + alpha*beta*pe2z) / denom
			}
		}
	}

	// Pre-count triangles for allocation
	numTris := 0
	for i := 0; i < n; i++ {
		for j := 0; j < n-i; j++ {
			if n-i-j <= 0 {
				continue
			}
			numTris++
			if n-i-j > 1 {
				numTris++
			}
		}
	}

	iTris := make([]int32, numTris)
	jTris := make([]int32, numTris)
	kTris := make([]int32, numTris)
	ti := 0
	for i := 0; i < n; i++ {
		for j := 0; j < n-i; j++ {
			if n-i-j <= 0 {
				continue
			}
			iTris[ti] = int32(triIdx(n, i, j))
			jTris[ti] = int32(triIdx(n, i+1, j))
			kTris[ti] = int32(triIdx(n, i, j+1))
			ti++
			if n-i-j > 1 {
				iTris[ti] = int32(triIdx(n, i+1, j))
				jTris[ti] = int32(triIdx(n, i+1, j+1))
				kTris[ti] = int32(triIdx(n, i, j+1))
				ti++
			}
		}
	}

	return &CoonsMesh{
		X: xs, Y: ys, Z: zs,
		I: iTris, J: jTris, K: kTris,
		NumVerts: totalVerts, NumTris: numTris,
	}
}

func ternBuildCoons4edge(pts []TernaryPoint, lns []TernaryLine, lineIndices []int, n int) *CoonsMesh {
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
		return nil
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
		return nil
	}

	ptMap := make(map[string]TernaryPoint)
	for _, p := range pts {
		ptMap[p.Label] = p
	}

	getPt := func(label string) TernaryPoint { return ptMap[label] }

	ept := func(idx int, slbl, elbl string, t float64) (float64, float64, float64) {
		ln := lns[idx]
		sp := getPt(ln.Start)
		ep := getPt(ln.End)
		if sp.Label == slbl && ep.Label == elbl {
			x, y, z := ternCurvePt(sp, ep, ln.CurveX, ln.CurveY, ln.CurveZ, t)
			return x, y, z
		}
		x, y, z := ternCurvePt(sp, ep, ln.CurveX, ln.CurveY, ln.CurveZ, 1-t)
		return x, y, z
	}

	n = normalizeCoonsN(n)
	numVerts := n * n

	// Flat slices
	xs := make([]float64, numVerts)
	ys := make([]float64, numVerts)
	zs := make([]float64, numVerts)

	C00x, C00y, C00z := ept(iu0, v0, v1, 0.0)
	C10x, C10y, C10z := ept(iu0, v0, v1, 1.0)
	C01x, C01y, C01z := ept(iu1, v3, v2, 0.0)
	C11x, C11y, C11z := ept(iu1, v3, v2, 1.0)

	for i := 0; i < n; i++ {
		u := float64(i) / float64(n-1)
		Pu0x, Pu0y, Pu0z := ept(iu0, v0, v1, u)
		Pu1x, Pu1y, Pu1z := ept(iu1, v3, v2, u)
		for j := 0; j < n; j++ {
			v := float64(j) / float64(n-1)
			P0vx, P0vy, P0vz := ept(iv0, v0, v3, v)
			P1vx, P1vy, P1vz := ept(iv1, v1, v2, v)
			idx := i*n + j
			xs[idx] = (1-v)*Pu0x + v*Pu1x + (1-u)*P0vx + u*P1vx -
				((1-u)*(1-v)*C00x + u*(1-v)*C10x + (1-u)*v*C01x + u*v*C11x)
			ys[idx] = (1-v)*Pu0y + v*Pu1y + (1-u)*P0vy + u*P1vy -
				((1-u)*(1-v)*C00y + u*(1-v)*C10y + (1-u)*v*C01y + u*v*C11y)
			zs[idx] = (1-v)*Pu0z + v*Pu1z + (1-u)*P0vz + u*P1vz -
				((1-u)*(1-v)*C00z + u*(1-v)*C10z + (1-u)*v*C01z + u*v*C11z)
		}
	}

	numTris := 2 * (n - 1) * (n - 1)
	iTris := make([]int32, numTris)
	jTris := make([]int32, numTris)
	kTris := make([]int32, numTris)
	ti := 0
	for i := 0; i < n-1; i++ {
		for j := 0; j < n-1; j++ {
			idx := i*n + j
			// First triangle: idx, idx+n, idx+1
			iTris[ti] = int32(idx)
			jTris[ti] = int32(idx + n)
			kTris[ti] = int32(idx + 1)
			ti++
			// Second triangle: idx+1, idx+n, idx+n+1
			iTris[ti] = int32(idx + 1)
			jTris[ti] = int32(idx + n)
			kTris[ti] = int32(idx + n + 1)
			ti++
		}
	}

	return &CoonsMesh{
		X: xs, Y: ys, Z: zs,
		I: iTris, J: jTris, K: kTris,
		NumVerts: numVerts, NumTris: numTris,
	}
}
