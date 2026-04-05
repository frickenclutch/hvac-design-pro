package main

import (
	"fmt"
	"net/http"
	"os"
	
	"api-gateway/internal/handlers"
	"api-gateway/internal/services/notify"
)

func main() {
	// Initialize services
	emailSvc := notify.NewEmailService()
	
	// Initialize handlers
	authHandler := &handlers.AuthHandler{EmailSvc: emailSvc}
	otpHandler := &handlers.OTPHandler{}

	// Routing with simple CORS middleware
	mux := http.NewServeMux()
	
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		fmt.Fprintf(w, "API Gateway is running")
	})

	mux.HandleFunc("/api/auth/onboard", corsHandler(authHandler.Onboard))
	mux.HandleFunc("/api/auth/otp/verify", corsHandler(otpHandler.Verify))
	
	mux.HandleFunc("/api/projects", corsHandler(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			authHandler.GetProjects(w, r)
		} else if r.Method == http.MethodPost {
			authHandler.CreateProject(w, r)
		} else {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		}
	}))

	port := os.Getenv("PORT")
	if port == "" {
		port = "8081"
	}

	fmt.Printf("Starting API Gateway on :%s\n", port)
	if err := http.ListenAndServe(":"+port, mux); err != nil {
		fmt.Printf("Server failed: %v\n", err)
	}
}

// corsHandler is a basic middleware to allow frontend Vite port (5173/5174)
func corsHandler(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*") // For development, allow all
		w.Header().Set("Access-Control-Allow-Methods", "POST, GET, OPTIONS, PUT, DELETE")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		
		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}
		
		h(w, r)
	}
}
