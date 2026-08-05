package router

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestProxyImageRouteIsRegistered(t *testing.T) {
	for _, route := range New().Routes() {
		if route.Method == http.MethodGet && route.Path == "/api/proxy-image" {
			return
		}
	}
	t.Fatal("GET /api/proxy-image route is not registered")
}

func TestProxyImageRouteDoesNotLogSignedUpstreamURL(t *testing.T) {
	oldWriter := gin.DefaultWriter
	var logs bytes.Buffer
	gin.DefaultWriter = &logs
	t.Cleanup(func() {
		gin.DefaultWriter = oldWriter
	})

	engine := New()
	target := "http://127.0.0.1/image.png?token=UPSTREAM_SECRET"
	request := httptest.NewRequest(
		http.MethodGet,
		"/api/proxy-image?url="+url.QueryEscape(target),
		nil,
	)
	recorder := httptest.NewRecorder()
	engine.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusUnauthorized)
	}
	if strings.Contains(logs.String(), "UPSTREAM_SECRET") {
		t.Fatal("proxy image access log leaked the signed upstream URL")
	}
}
