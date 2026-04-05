package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

type Project struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Type      string    `json:"type"`
	Address   string    `json:"address"`
	City      string    `json:"city"`
	Status    string    `json:"status"`
	CreatedAt time.Time `json:"date"`
}

var mockProjects = []Project{
	{ID: "proj-1", Name: "The Walker Residence", Address: "123 Fake Street, IL", CreatedAt: time.Now(), Status: "In Progress", Type: "Residential"},
}

func (h *AuthHandler) GetProjects(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(mockProjects)
}

func (h *AuthHandler) CreateProject(w http.ResponseWriter, r *http.Request) {
	var p Project
	if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	p.ID = fmt.Sprintf("proj-%d", len(mockProjects)+1)
	p.CreatedAt = time.Now()
	p.Status = "In Progress"
	
	mockProjects = append(mockProjects, p)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(p)
}
