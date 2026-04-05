package notify

import (
	"fmt"
	"os"
	"path/filepath"
	"time"
)

// EmailService handles sending emails. In this mock version, it logs to a file.
type EmailService struct {
	LogPath string
}

func NewEmailService() *EmailService {
	// Create logs directory if it doesn't exist
	logDir := "logs"
	if _, err := os.Stat(logDir); os.IsNotExist(err) {
		os.Mkdir(logDir, 0755)
	}

	return &EmailService{
		LogPath: filepath.Join(logDir, "email_previews.log"),
	}
}

func (s *EmailService) SendWelcomeEmail(toEmail string, name string) error {
	timestamp := time.Now().Format(time.RFC3339)
	accessCode := "888-999" // In production, this would be a random TOTP
	
	content := fmt.Sprintf(`
[SENDING EMAIL]
Timestamp: %s
To: %s
Subject: Welcome to HVAC DesignPro — Secure Access Code Inside
Body:
Hello %s,

Welcome to HVAC DesignPro. Your professional engineering workspace is ready.

Your temporary Secure Access Code is: %s

Please use this code and your email (%s) to sign in to the Command Center.

Stay cool,
The DesignPro Team
-----------------------------------------------------------
`, timestamp, toEmail, name, accessCode, toEmail)

	// Log to console
	fmt.Printf("EMITTING EMAIL: %s\n", toEmail)

	// Append to log file
	f, err := os.OpenFile(s.LogPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		return err
	}
	defer f.Close()

	if _, err := f.WriteString(content); err != nil {
		return err
	}

	return nil
}
