package main

import (
	"fmt"
	"net/http"
)

func main() {
	http.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		fmt.Fprintf(w, "API Gateway is running")
	})

	fmt.Println("Starting API Gateway on :8080")
	http.ListenAndServe(":8080", nil)
}
