package main

import (
	"log"
	"net/http"
)

func main() {
	fs := http.FileServer(http.Dir("web"))
	http.Handle("/", fs)

	log.Println("启动服务器: http://localhost:8080")
	log.Fatal(http.ListenAndServe(":8080", nil))
}
