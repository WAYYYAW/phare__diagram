package main

type CompPoint struct {
	Label string  `json:"label"`
	Comp  float64 `json:"comp"`
	Temp  float64 `json:"temp"`
}

type TernaryLine struct {
	Start  string  `json:"start"`
	End    string  `json:"end"`
	CurveX float64 `json:"curve_x"`
	CurveY float64 `json:"curve_y"`
	CurveZ float64 `json:"curve_z"`
}

type TernarySurface struct {
	LineLabels []string `json:"line_labels"`
}

type TernaryPoint struct {
	Label string  `json:"label"`
	A     float64 `json:"a"`
	B     float64 `json:"b"`
	C     float64 `json:"c"`
	Temp  float64 `json:"temp"`
}

type ParamDef struct {
	Label   string  `json:"label"`
	Key     string  `json:"key"`
	Default float64 `json:"default"`
}

type PointDef struct {
	Label string `json:"label"`
	Comp  string `json:"comp"`
	Temp  string `json:"temp"`
}

type LineDef struct {
	Start string  `json:"start"`
	End   string  `json:"end"`
	Type  string  `json:"type"`
	Curve float64 `json:"curve"`
}

type RegionDef struct {
	Label  string   `json:"label"`
	Points []string `json:"points"`
}

type Topology struct {
	Points  []PointDef  `json:"points"`
	Lines   []LineDef   `json:"lines"`
	Regions []RegionDef `json:"regions"`
}

type Template struct {
	Params   []ParamDef `json:"params"`
	Topology Topology   `json:"topology"`
}

type TernaryTemplate struct {
	Points   []TernaryPoint   `json:"points"`
	Lines    []TernaryLine    `json:"lines"`
	Surfaces []TernarySurface `json:"surfaces"`
	IsoTemp  *float64         `json:"isoTemp,omitempty"`
}

type LeverResult struct {
	Type   string   `json:"type"`
	Desc   string   `json:"desc,omitempty"`
	Left   *float64 `json:"left,omitempty"`
	Right  *float64 `json:"right,omitempty"`
	WLeft  *float64 `json:"w_left,omitempty"`
	WRight *float64 `json:"w_right,omitempty"`
}

type CurveResult struct {
	Xs []float64 `json:"xs"`
	Ys []float64 `json:"ys"`
}
