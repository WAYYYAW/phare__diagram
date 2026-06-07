package main

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

func main() {
	webDir := "web"
	outPath := "web/bundle.html"
	plotlyPath := "/tmp/plotly.min.js"

	for i := 1; i < len(os.Args); i++ {
		switch os.Args[i] {
		case "-o":
			if i+1 < len(os.Args) {
				outPath = os.Args[i+1]
				i++
			}
		case "--plotly":
			if i+1 < len(os.Args) {
				plotlyPath = os.Args[i+1]
				i++
			}
		}
	}

	// Read source files
	css, err := os.ReadFile(filepath.Join(webDir, "css", "style.css"))
	if err != nil {
		panic(err)
	}

	jsFiles := []string{"wasm_exec.js", "app.js", "binary.js", "ternary.js", "triangle.js"}
	var jsParts [][]byte
	for _, f := range jsFiles {
		b, err := os.ReadFile(filepath.Join(webDir, "js", f))
		if err != nil {
			panic(err)
		}
		jsParts = append(jsParts, b)
	}

	wasm, err := os.ReadFile(filepath.Join(webDir, "main.wasm"))
	if err != nil {
		panic(err)
	}

	plotly, err := os.ReadFile(plotlyPath)
	if err != nil {
		panic(fmt.Errorf("读取 Plotly.js 失败 (%s): %w\n请先下载: curl -sL 'https://cdn.plot.ly/plotly-2.32.0.min.js' -o /tmp/plotly.min.js", plotlyPath, err))
	}

	wasmBase64 := base64.StdEncoding.EncodeToString(wasm)

	// Read index.html
	idxHTML, err := os.ReadFile(filepath.Join(webDir, "index.html"))
	if err != nil {
		panic(err)
	}
	src := string(idxHTML)

	// 1. Inline CSS (replace <link> with <style>)
	src = strings.Replace(src,
		`<link rel="stylesheet" href="css/style.css">`,
		fmt.Sprintf(`<style>%s</style>`, string(css)), 1)

	// 2. Replace Plotly CDN script with inline
	src = strings.Replace(src,
		`<script src="https://cdn.plot.ly/plotly-2.32.0.min.js"></script>`,
		fmt.Sprintf(`<script>%s</script>`, string(plotly)), 1)

	// 3. Remove all external script tags
	for _, tag := range []string{
		`<script src="js/app.js"></script>`,
		`<script src="js/binary.js"></script>`,
		`<script src="js/ternary.js"></script>`,
		`<script src="js/wasm_exec.js"></script>`,
	} {
		src = strings.Replace(src, tag, "", 1)
	}

	// 4. Remove the old WASM loader (between the last two script blocks)
	oldLoaderStart := "<script>\n        const go = new Go();"
	oldLoaderEnd := "</script>"
	startIdx := strings.Index(src, oldLoaderStart)
	if startIdx < 0 {
		panic("old WASM loader not found")
	}
	endIdx := strings.Index(src[startIdx:], oldLoaderEnd) + startIdx + len(oldLoaderEnd)
	before := src[:startIdx]
	after := src[endIdx:]

	// 5. Build new content:
	//    - Combined JS (wasm_exec.js defines Go class, then app/binary/ternary)
	//    - WASM loader (uses new Go(), so must come AFTER wasm_exec.js)
	var combined bytes.Buffer
	combined.WriteString("<script>\n")
	for _, part := range jsParts {
		combined.Write(part)
		combined.WriteString("\n")
	}
	combined.WriteString("\n")
	// WASM init immediately follows
	combined.WriteString(fmt.Sprintf(`const go = new Go();
const wasmBase64 = "%s";
(async () => {
  try {
    const binary = Uint8Array.from(atob(wasmBase64), c => c.charCodeAt(0));
    const { instance } = await WebAssembly.instantiate(binary, go.importObject);
    go.run(instance);
  } catch (err) {
    document.getElementById('wasmStatus').textContent = 'WASM 加载失败';
    console.error('WASM load error:', err);
  }
})();
</script>`, wasmBase64))

	src = before + combined.String() + after

	if err := os.WriteFile(outPath, []byte(src), 0644); err != nil {
		panic(err)
	}

	fmt.Printf("已生成: %s (%.1f KB)\n  JS/CSS: %.1f KB\n  Plotly: %.1f KB\n  WASM:   %.1f KB (base64 inline)\n",
		outPath,
		float64(len(src))/1024,
		float64(len(src)-len(wasm)*4/3-int(len(plotly)))/1024,
		float64(len(plotly))/1024,
		float64(len(wasm))/1024,
	)
}
