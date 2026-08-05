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

func TestProxyMediaRoutesAreRegistered(t *testing.T) {
	routes := New().Routes()
	for _, method := range []string{http.MethodGet, http.MethodHead} {
		found := false
		for _, route := range routes {
			if route.Method == method && route.Path == "/api/proxy-media" {
				found = true
				break
			}
		}
		if !found {
			t.Fatalf("%s /api/proxy-media route is not registered", method)
		}
	}
}

func TestProxyMediaRouteDoesNotLogSignedURL(t *testing.T) {
	oldWriter := gin.DefaultWriter
	var logs bytes.Buffer
	gin.DefaultWriter = &logs
	t.Cleanup(func() { gin.DefaultWriter = oldWriter })
	engine := New()
	request := httptest.NewRequest(http.MethodGet, "/api/proxy-media?url="+url.QueryEscape("http://127.0.0.1/video.mp4?token=MEDIA_SECRET"), nil)
	recorder := httptest.NewRecorder()
	engine.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusUnauthorized)
	}
	if strings.Contains(logs.String(), "MEDIA_SECRET") {
		t.Fatal("proxy media access log leaked signed URL")
	}
}
