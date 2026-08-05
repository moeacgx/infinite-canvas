package handler

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

type proxyImageRoundTripFunc func(*http.Request) (*http.Response, error)

func (function proxyImageRoundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return function(request)
}

func TestProxyImageReturnsSniffedImageWithoutForwardingCredentials(t *testing.T) {
	png := []byte{0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d}
	client := &http.Client{Transport: proxyImageRoundTripFunc(func(request *http.Request) (*http.Response, error) {
		if request.Method != http.MethodGet || request.URL.String() != "https://example.com/panorama.png" {
			t.Fatalf("unexpected upstream request: %s %s", request.Method, request.URL)
		}
		for _, header := range []string{"Authorization", "Cookie", "Referer"} {
			if got := request.Header.Get(header); got != "" {
				t.Fatalf("upstream received %s", header)
			}
		}
		if request.Header.Get("Accept") == "" || request.Header.Get("User-Agent") == "" {
			t.Fatal("safe image request headers were not set")
		}
		return &http.Response{
			StatusCode:    http.StatusOK,
			Header:        http.Header{"Content-Type": []string{"text/html"}},
			Body:          io.NopCloser(bytes.NewReader(png)),
			ContentLength: int64(len(png)),
			Request:       request,
		}, nil
	})}

	request := httptest.NewRequest(
		http.MethodGet,
		"/api/proxy-image?url="+url.QueryEscape("https://example.com/panorama.png"),
		nil,
	)
	request.Header.Set("Authorization", "Bearer user-secret")
	request.Header.Set("Cookie", "session=user-secret")
	request.Header.Set("Referer", "https://canvas.example/private")
	recorder := httptest.NewRecorder()

	proxyImageWithClient(recorder, request, client, proxyImageMaxBytes)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	if got := recorder.Header().Get("Content-Type"); got != "image/png" {
		t.Fatalf("content type = %q, want image/png", got)
	}
	if got := recorder.Header().Get("X-Content-Type-Options"); got != "nosniff" {
		t.Fatalf("X-Content-Type-Options = %q", got)
	}
	if got := recorder.Header().Get("Cache-Control"); !strings.HasPrefix(got, "private") {
		t.Fatalf("Cache-Control = %q, want private cache", got)
	}
	if !bytes.Equal(recorder.Body.Bytes(), png) {
		t.Fatal("proxied image body changed")
	}
}

func TestProxyImageRejectsPrivateTargetBeforeRequest(t *testing.T) {
	client := &http.Client{Transport: proxyImageRoundTripFunc(func(*http.Request) (*http.Response, error) {
		t.Fatal("private target reached HTTP transport")
		return nil, nil
	})}
	request := httptest.NewRequest(
		http.MethodGet,
		"/api/proxy-image?url="+url.QueryEscape("http://127.0.0.1/private.png"),
		nil,
	)
	recorder := httptest.NewRecorder()

	proxyImageWithClient(recorder, request, client, proxyImageMaxBytes)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusBadRequest)
	}
	if recorder.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatal("error response is missing nosniff")
	}
}

func TestProxyImageRejectsActiveOrOversizedContent(t *testing.T) {
	t.Run("SVG 不能伪装为图片", func(t *testing.T) {
		client := proxyImageTestClient(http.StatusOK, "image/svg+xml", []byte(`<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`), -1)
		request := httptest.NewRequest(http.MethodGet, "/api/proxy-image?url=https%3A%2F%2Fexample.com%2Fattack.svg", nil)
		recorder := httptest.NewRecorder()

		proxyImageWithClient(recorder, request, client, proxyImageMaxBytes)

		if recorder.Code != http.StatusUnsupportedMediaType {
			t.Fatalf("status = %d, want %d", recorder.Code, http.StatusUnsupportedMediaType)
		}
		var payload response
		if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
			t.Fatalf("decode response: %v", err)
		}
		if strings.Contains(payload.Msg, "example.com") {
			t.Fatal("error response leaked upstream URL")
		}
	})

	t.Run("Content-Length 超限时不读取响应体", func(t *testing.T) {
		client := proxyImageTestClient(http.StatusOK, "image/png", nil, proxyImageMaxBytes+1)
		request := httptest.NewRequest(http.MethodGet, "/api/proxy-image?url=https%3A%2F%2Fexample.com%2Fhuge.png", nil)
		recorder := httptest.NewRecorder()

		proxyImageWithClient(recorder, request, client, proxyImageMaxBytes)

		if recorder.Code != http.StatusRequestEntityTooLarge {
			t.Fatalf("status = %d, want %d", recorder.Code, http.StatusRequestEntityTooLarge)
		}
	})
}

func TestReadSafeProxyImageEnforcesStreamLimit(t *testing.T) {
	_, _, err := readSafeProxyImage(strings.NewReader("12345"), 4)
	if err != errProxyImageTooLarge {
		t.Fatalf("error = %v, want errProxyImageTooLarge", err)
	}
}

func TestProxyConcurrencySlotRejectsExcessRequests(t *testing.T) {
	slots := make(chan struct{}, 1)
	if !acquireProxySlot(slots) {
		t.Fatal("first proxy slot should be available")
	}
	if acquireProxySlot(slots) {
		t.Fatal("full proxy slot pool should reject another request")
	}
	releaseProxySlot(slots)
	if !acquireProxySlot(slots) {
		t.Fatal("released proxy slot should be reusable")
	}
	releaseProxySlot(slots)
}

func TestDetectSafeProxyImageType(t *testing.T) {
	tests := []struct {
		name string
		data []byte
		want string
	}{
		{name: "PNG", data: []byte{0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a}, want: "image/png"},
		{name: "TIFF", data: []byte{'I', 'I', 0x2a, 0x00, 0x08, 0x00}, want: "image/tiff"},
		{name: "AVIF", data: []byte{0, 0, 0, 20, 'f', 't', 'y', 'p', 'a', 'v', 'i', 'f', 0, 0, 0, 0, 'm', 'i', 'f', '1'}, want: "image/avif"},
		{name: "HTML", data: []byte("<!doctype html><html></html>"), want: ""},
		{name: "SVG", data: []byte(`<svg xmlns="http://www.w3.org/2000/svg"></svg>`), want: ""},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := detectSafeProxyImageType(test.data); got != test.want {
				t.Fatalf("detected type = %q, want %q", got, test.want)
			}
		})
	}
}

func proxyImageTestClient(status int, contentType string, body []byte, contentLength int64) *http.Client {
	return &http.Client{Transport: proxyImageRoundTripFunc(func(request *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode:    status,
			Header:        http.Header{"Content-Type": []string{contentType}},
			Body:          io.NopCloser(bytes.NewReader(body)),
			ContentLength: contentLength,
			Request:       request,
		}, nil
	})}
}
