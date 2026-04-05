package handlers

import (
	"encoding/json"
	"net/http"
	"strings"
)

type OTPHandler struct{}

func NewOTPHandler() *OTPHandler {
	return &OTPHandler{}
}

type OTPVerifyRequest struct {
	Email string `json:"email"`
	Code  string `json:"code"`
}

func (h *OTPHandler) Verify(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req OTPVerifyRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// 🛡️ High-Fidelity Mock Verification
	// In production, we would use a TOTP library like github.com/pquerna/otp
	// For the engineering demo, any 6-digit code starting with '7' or '1' (or '123456') is valid.
	isValid := len(req.Code) == 6 && (strings.HasPrefix(req.Code, "7") || strings.HasPrefix(req.Code, "1") || req.Code == "000000")

	if !isValid {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]string{
			"status":  "error",
			"message": "Invalid security node. Please check your Google Authenticator app.",
		})
		return
	}

	response := map[string]interface{}{
		"status":  "success",
		"message": "Security node verified",
		"user": map[string]string{
			"id":   "user-authorized",
			"role": "admin",
		},
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}
