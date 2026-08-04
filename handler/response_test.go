package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestFailWithStatusPreservesErrorEnvelope(t *testing.T) {
	recorder := httptest.NewRecorder()
	FailWithStatus(recorder, http.StatusForbidden, "权限不足")

	if recorder.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusForbidden)
	}
	if contentType := recorder.Header().Get("Content-Type"); contentType != "application/json" {
		t.Fatalf("content type = %q", contentType)
	}
	var got response
	if err := json.Unmarshal(recorder.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if got.Code != 1 || got.Data != nil || got.Msg != "权限不足" {
		t.Fatalf("response = %#v", got)
	}
}
