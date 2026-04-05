package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
)

// EmailService interface for dependency injection
type EmailService interface {
	SendWelcomeEmail(toEmail string, name string) error
}

type AuthHandler struct {
	EmailSvc EmailService
}

type OnboardRequest struct {
	FullName string `json:"fullName"`
	Email    string `json:"email"`
	OrgName  string `json:"orgName"`
	Region   string `json:"region"`
}

func (h *AuthHandler) Onboard(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req OnboardRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// In a real app, we would save to the database here.
	// For now, we simulate success and trigger the email.
	fmt.Printf("ONBOARDING: User %s for Org %s (Region: %s)\n", req.FullName, req.OrgName, req.Region)

	if err := h.EmailSvc.SendWelcomeEmail(req.Email, req.FullName); err != nil {
		fmt.Printf("Email error: %v\n", err)
		// We still return success for the demo/onboarding flow
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{
		"status": "success",
		"message": "Onboarding complete. Welcome email emitted.",
	})
}
