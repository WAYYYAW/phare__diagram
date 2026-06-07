.PHONY: build wasm server bundle clean

build: wasm server

wasm:
	CGO_ENABLED=0 GOOS=js GOARCH=wasm go build -ldflags="-s -w" -o web/main.wasm ./wasm/

server:
	CGO_ENABLED=0 go build -o xuben-server ./server.go

bundle: wasm /tmp/plotly.min.js
	go run ./cmd/bundle/

/tmp/plotly.min.js:
	curl -sL 'https://cdn.plot.ly/plotly-2.32.0.min.js' -o /tmp/plotly.min.js

clean:
	rm -f web/main.wasm web/bundle.html xuben-server

run: wasm server
	./xuben-server
