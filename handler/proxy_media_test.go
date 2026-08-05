package handler

import (
	"bytes"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

func TestProxyMediaPreservesRangeAndStripsCredentials(t *testing.T) {
	mp4 := append([]byte{0, 0, 0, 20, 'f', 't', 'y', 'p', 'i', 's', 'o', 'm'}, bytes.Repeat([]byte{0}, 24)...)
	client := &http.Client{Transport: proxyImageRoundTripFunc(func(request *http.Request) (*http.Response, error) {
		if request.Header.Get("Range") != "bytes=0-35" {
			t.Fatalf("Range = %q", request.Header.Get("Range"))
		}
		for _, header := range []string{"Authorization", "Cookie", "Referer"} {
			if request.Header.Get(header) != "" {
				t.Fatalf("upstream received %s", header)
			}
		}
		return &http.Response{
			StatusCode:    http.StatusPartialContent,
			Header:        http.Header{"Content-Type": []string{"application/octet-stream"}, "Content-Range": []string{"bytes 0-35/36"}, "Accept-Ranges": []string{"bytes"}},
			Body:          io.NopCloser(bytes.NewReader(mp4)),
			ContentLength: int64(len(mp4)),
			Request:       request,
		}, nil
	})}
	request := httptest.NewRequest(http.MethodGet, "/api/proxy-media?url="+url.QueryEscape("https://example.com/video.mp4"), nil)
	request.Header.Set("Range", "bytes=0-35")
	request.Header.Set("Authorization", "Bearer secret")
	request.Header.Set("Cookie", "secret=1")
	recorder := httptest.NewRecorder()

	proxyMediaWithClient(recorder, request, client, proxyMediaMaxBytes)

	if recorder.Code != http.StatusPartialContent {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	if recorder.Header().Get("Content-Type") != "video/mp4" || recorder.Header().Get("Content-Range") != "bytes 0-35/36" {
		t.Fatalf("unexpected media headers: %#v", recorder.Header())
	}
	if !bytes.Equal(recorder.Body.Bytes(), mp4) {
		t.Fatal("proxied media body changed")
	}
}

func TestProxyMediaRejectsHTMLAndOversizedRanges(t *testing.T) {
	t.Run("HTML 不能伪装为视频", func(t *testing.T) {
		client := proxyImageTestClient(http.StatusOK, "video/mp4", []byte("<!doctype html><html></html>"), 28)
		request := httptest.NewRequest(http.MethodGet, "/api/proxy-media?url=https%3A%2F%2Fexample.com%2Fattack.mp4", nil)
		recorder := httptest.NewRecorder()
		proxyMediaWithClient(recorder, request, client, proxyMediaMaxBytes)
		if recorder.Code != http.StatusUnsupportedMediaType {
			t.Fatalf("status = %d, want %d", recorder.Code, http.StatusUnsupportedMediaType)
		}
	})

	t.Run("Content-Range 总大小超限", func(t *testing.T) {
		client := &http.Client{Transport: proxyImageRoundTripFunc(func(request *http.Request) (*http.Response, error) {
			return &http.Response{StatusCode: http.StatusPartialContent, Header: http.Header{"Content-Type": []string{"video/mp4"}, "Content-Range": []string{"bytes 0-3/999"}}, Body: io.NopCloser(strings.NewReader("test")), ContentLength: 4, Request: request}, nil
		})}
		request := httptest.NewRequest(http.MethodGet, "/api/proxy-media?url=https%3A%2F%2Fexample.com%2Fhuge.mp4", nil)
		request.Header.Set("Range", "bytes=0-3")
		recorder := httptest.NewRecorder()
		proxyMediaWithClient(recorder, request, client, 100)
		if recorder.Code != http.StatusRequestEntityTooLarge {
			t.Fatalf("status = %d, want %d", recorder.Code, http.StatusRequestEntityTooLarge)
		}
	})
}

func TestProxyMediaRejectsUnsafeRange(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/api/proxy-media?url=https%3A%2F%2Fexample.com%2Fvideo.mp4", nil)
	request.Header.Set("Range", "bytes=0-1,4-5")
	recorder := httptest.NewRecorder()
	proxyMediaWithClient(recorder, request, &http.Client{}, proxyMediaMaxBytes)
	if recorder.Code != http.StatusRequestedRangeNotSatisfiable {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusRequestedRangeNotSatisfiable)
	}
}
