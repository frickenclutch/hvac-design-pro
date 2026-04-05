package handlers

import (
	"encoding/json"
	"net/http"
)

type PasskeyHandler struct{}

func NewPasskeyHandler() *PasskeyHandler {
	return &PasskeyHandler{}
}

type PasskeyChallengeResponse struct {
	Challenge string `json:"challenge"`
	RPID      string `json:"rpId"`
}

func (h *PasskeyHandler) GetChallenge(w http.ResponseWriter, r *http.Request) {
	// 🛡️ Mock WebAuthn Challenge
	challenge := PasskeyChallengeResponse{
		Challenge: "mock-challenge-string",
		RPID:      "localhost",
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(challenge)
}

func (h *PasskeyHandler) Verify(w http.ResponseWriter, r *http.Request) {
	// 🛡️ Mock WebAuthn Verification
	// In production, we would use a library like go-webauthn to verify the credential
	response := map[string]string{"status": "success", "message": "Biometric verification complete"}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}
