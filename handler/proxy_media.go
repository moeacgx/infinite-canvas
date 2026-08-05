package handler

import (
	"bytes"
	"errors"
	"io"
	"mime"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/basketikun/infinite-canvas/service"
)

const proxyMediaMaxBytes int64 = 256 << 20
const proxyMediaWriteTimeout = 2 * time.Minute

var (
	errProxyMediaTooLarge   = errors.New("代理媒体超过大小限制")
	errProxyMediaNotAllowed = errors.New("代理内容不是支持的媒体格式")
	proxyMediaSlots         = make(chan struct{}, 4)
)

// ProxyMedia 代理公网视频和音频，并保留播放器所需的 Range 语义。
func ProxyMedia(w http.ResponseWriter, r *http.Request) {
	if !acquireProxySlot(proxyMediaSlots) {
		FailWithStatus(w, http.StatusTooManyRequests, "媒体代理请求过多，请稍后重试")
		return
	}
	defer releaseProxySlot(proxyMediaSlots)
	_ = http.NewResponseController(w).SetWriteDeadline(time.Now().Add(proxyMediaWriteTimeout))
	proxyMediaWithClient(w, r, service.SafeProxyHTTPClient(), proxyMediaMaxBytes)
}

func proxyMediaWithClient(w http.ResponseWriter, r *http.Request, client *http.Client, maxBytes int64) {
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Referrer-Policy", "no-referrer")

	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		FailWithStatus(w, http.StatusMethodNotAllowed, "媒体代理仅支持 GET 和 HEAD")
		return
	}
	target, err := service.ValidateProxyURL(r.URL.Query().Get("url"))
	if err != nil {
		FailWithStatus(w, http.StatusBadRequest, "媒体地址无效或不允许访问")
		return
	}
	rangeHeader := strings.TrimSpace(r.Header.Get("Range"))
	if rangeHeader != "" && !isSafeMediaRange(rangeHeader) {
		FailWithStatus(w, http.StatusRequestedRangeNotSatisfiable, "Range 请求无效")
		return
	}

	request, err := http.NewRequestWithContext(r.Context(), r.Method, target.String(), nil)
	if err != nil {
		FailWithStatus(w, http.StatusBadRequest, "媒体地址无效")
		return
	}
	request.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36")
	request.Header.Set("Accept", "video/*,audio/*;q=0.9,application/ogg;q=0.8")
	if rangeHeader != "" {
		request.Header.Set("Range", rangeHeader)
	}

	upstream, err := client.Do(request)
	if err != nil {
		FailWithStatus(w, http.StatusBadGateway, "代理媒体请求失败")
		return
	}
	defer upstream.Body.Close()
	if upstream.StatusCode != http.StatusOK && upstream.StatusCode != http.StatusPartialContent {
		FailWithStatus(w, http.StatusBadGateway, "上游媒体请求失败")
		return
	}
	if upstream.ContentLength > maxBytes || proxyMediaTotalBytes(upstream.Header.Get("Content-Range")) > maxBytes {
		FailWithStatus(w, http.StatusRequestEntityTooLarge, "媒体超过 256MB 限制")
		return
	}

	upstreamType := normalizeProxyMediaHeaderType(upstream.Header.Get("Content-Type"))
	if r.Method == http.MethodHead {
		if upstreamType == "" || upstream.ContentLength < 0 {
			FailWithStatus(w, http.StatusUnsupportedMediaType, "上游内容不是支持的媒体格式")
			return
		}
		writeProxyMediaHeaders(w, upstream, upstreamType, upstream.ContentLength)
		w.WriteHeader(upstream.StatusCode)
		return
	}

	allowHeaderOnly := upstream.StatusCode == http.StatusPartialContent && !mediaRangeStartsAtZero(rangeHeader)
	temporary, size, contentType, err := spoolSafeProxyMedia(upstream.Body, maxBytes, upstreamType, allowHeaderOnly)
	if err != nil {
		switch {
		case errors.Is(err, errProxyMediaTooLarge):
			FailWithStatus(w, http.StatusRequestEntityTooLarge, "媒体超过 256MB 限制")
		case errors.Is(err, errProxyMediaNotAllowed):
			FailWithStatus(w, http.StatusUnsupportedMediaType, "上游内容不是支持的媒体格式")
		default:
			FailWithStatus(w, http.StatusBadGateway, "读取上游媒体失败")
		}
		return
	}
	defer func() {
		_ = temporary.Close()
		_ = os.Remove(temporary.Name())
	}()

	writeProxyMediaHeaders(w, upstream, contentType, size)
	w.WriteHeader(upstream.StatusCode)
	_, _ = io.Copy(w, temporary)
}

func spoolSafeProxyMedia(reader io.Reader, maxBytes int64, headerType string, allowHeaderOnly bool) (*os.File, int64, string, error) {
	if maxBytes <= 0 {
		return nil, 0, "", errProxyMediaTooLarge
	}
	temporary, err := os.CreateTemp("", "infinite-canvas-proxy-media-*")
	if err != nil {
		return nil, 0, "", err
	}
	cleanup := func() {
		_ = temporary.Close()
		_ = os.Remove(temporary.Name())
	}

	size, err := io.Copy(temporary, io.LimitReader(reader, maxBytes+1))
	if err != nil {
		cleanup()
		return nil, 0, "", err
	}
	if size == 0 {
		cleanup()
		return nil, 0, "", errProxyMediaNotAllowed
	}
	if size > maxBytes {
		cleanup()
		return nil, 0, "", errProxyMediaTooLarge
	}
	if _, err = temporary.Seek(0, io.SeekStart); err != nil {
		cleanup()
		return nil, 0, "", err
	}
	prefix := make([]byte, 512)
	prefixSize, readErr := temporary.Read(prefix)
	if readErr != nil && readErr != io.EOF {
		cleanup()
		return nil, 0, "", readErr
	}
	contentType := detectSafeProxyMediaType(prefix[:prefixSize], headerType)
	if contentType == "" && allowHeaderOnly {
		contentType = headerType
	}
	if contentType == "" {
		cleanup()
		return nil, 0, "", errProxyMediaNotAllowed
	}
	if _, err = temporary.Seek(0, io.SeekStart); err != nil {
		cleanup()
		return nil, 0, "", err
	}
	return temporary, size, contentType, nil
}

func writeProxyMediaHeaders(w http.ResponseWriter, upstream *http.Response, contentType string, size int64) {
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Content-Length", strconv.FormatInt(size, 10))
	w.Header().Set("Content-Disposition", "inline")
	w.Header().Set("Cache-Control", "private, max-age=3600")
	for _, header := range []string{"Accept-Ranges", "Content-Range", "ETag", "Last-Modified"} {
		if value := upstream.Header.Get(header); value != "" {
			w.Header().Set(header, value)
		}
	}
}

func normalizeProxyMediaHeaderType(value string) string {
	parsed, _, err := mime.ParseMediaType(value)
	if err != nil {
		return ""
	}
	parsed = strings.ToLower(parsed)
	switch parsed {
	case "video/mp4", "video/webm", "video/quicktime", "video/x-matroska", "video/mpeg", "audio/mpeg", "audio/wav", "audio/x-wav", "audio/ogg", "audio/webm", "application/ogg", "audio/mp4", "audio/aac", "audio/flac":
		return parsed
	default:
		return ""
	}
}

func detectSafeProxyMediaType(data []byte, headerType string) string {
	if len(data) == 0 {
		return ""
	}
	detected, _, _ := mime.ParseMediaType(http.DetectContentType(data))
	if safe := normalizeProxyMediaHeaderType(detected); safe != "" {
		return safe
	}
	if len(data) >= 12 && bytes.Equal(data[4:8], []byte("ftyp")) {
		if headerType == "audio/mp4" {
			return "audio/mp4"
		}
		if string(data[8:12]) == "qt  " {
			return "video/quicktime"
		}
		return "video/mp4"
	}
	if len(data) >= 12 && bytes.Equal(data[:4], []byte("RIFF")) && bytes.Equal(data[8:12], []byte("WAVE")) {
		return "audio/wav"
	}
	if len(data) >= 4 && bytes.Equal(data[:4], []byte("OggS")) {
		return "audio/ogg"
	}
	if len(data) >= 4 && bytes.Equal(data[:4], []byte("fLaC")) {
		return "audio/flac"
	}
	if len(data) >= 4 && bytes.Equal(data[:4], []byte{0x1a, 0x45, 0xdf, 0xa3}) {
		if headerType == "audio/webm" {
			return "audio/webm"
		}
		return "video/webm"
	}
	if len(data) >= 3 && bytes.Equal(data[:3], []byte("ID3")) || len(data) >= 2 && data[0] == 0xff && data[1]&0xe0 == 0xe0 {
		if headerType == "audio/aac" {
			return "audio/aac"
		}
		return "audio/mpeg"
	}
	return ""
}

func isSafeMediaRange(value string) bool {
	if !strings.HasPrefix(value, "bytes=") || strings.Contains(value, ",") {
		return false
	}
	parts := strings.Split(strings.TrimPrefix(value, "bytes="), "-")
	if len(parts) != 2 || parts[0] == "" && parts[1] == "" {
		return false
	}
	parsed := [2]*uint64{}
	for index, part := range parts {
		if part == "" {
			continue
		}
		value, err := strconv.ParseUint(part, 10, 64)
		if err != nil {
			return false
		}
		parsed[index] = &value
	}
	if parsed[0] != nil && parsed[1] != nil && *parsed[0] > *parsed[1] {
		return false
	}
	return true
}

func mediaRangeStartsAtZero(value string) bool {
	return value == "" || strings.HasPrefix(value, "bytes=0-")
}

func proxyMediaTotalBytes(contentRange string) int64 {
	_, total, ok := strings.Cut(contentRange, "/")
	if !ok || total == "" || total == "*" {
		return 0
	}
	value, _ := strconv.ParseInt(total, 10, 64)
	return value
}
