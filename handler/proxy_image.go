package handler

import (
	"bytes"
	"encoding/binary"
	"errors"
	"io"
	"mime"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/basketikun/infinite-canvas/service"
)

const proxyImageMaxBytes int64 = 32 << 20
const proxyImageWriteTimeout = 45 * time.Second

var (
	errProxyImageTooLarge   = errors.New("代理图片超过大小限制")
	errProxyImageNotAllowed = errors.New("代理内容不是支持的图片格式")
	proxyImageSlots         = make(chan struct{}, 8)
)

// ProxyImage 代理公网图片，用于需要同源像素读取的全景和导演台场景。
func ProxyImage(w http.ResponseWriter, r *http.Request) {
	if !acquireProxySlot(proxyImageSlots) {
		FailWithStatus(w, http.StatusTooManyRequests, "图片代理请求过多，请稍后重试")
		return
	}
	defer releaseProxySlot(proxyImageSlots)
	_ = http.NewResponseController(w).SetWriteDeadline(time.Now().Add(proxyImageWriteTimeout))
	proxyImageWithClient(w, r, service.SafeProxyHTTPClient(), proxyImageMaxBytes)
}

func acquireProxySlot(slots chan struct{}) bool {
	select {
	case slots <- struct{}{}:
		return true
	default:
		return false
	}
}

func releaseProxySlot(slots chan struct{}) {
	<-slots
}

func proxyImageWithClient(w http.ResponseWriter, r *http.Request, client *http.Client, maxBytes int64) {
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Referrer-Policy", "no-referrer")

	target, err := service.ValidateProxyURL(r.URL.Query().Get("url"))
	if err != nil {
		FailWithStatus(w, http.StatusBadRequest, "图片地址无效或不允许访问")
		return
	}

	request, err := http.NewRequestWithContext(r.Context(), http.MethodGet, target.String(), nil)
	if err != nil {
		FailWithStatus(w, http.StatusBadRequest, "图片地址无效")
		return
	}
	// 不复制用户请求中的 Cookie、Authorization、Referer 等任何凭据。
	request.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
	request.Header.Set("Accept", "image/avif,image/webp,image/png,image/jpeg,image/gif,image/bmp,image/tiff,image/heic,image/heif;q=0.9")

	upstream, err := client.Do(request)
	if err != nil {
		FailWithStatus(w, http.StatusBadGateway, "代理图片请求失败")
		return
	}
	defer upstream.Body.Close()

	if upstream.StatusCode < http.StatusOK || upstream.StatusCode >= http.StatusMultipleChoices {
		FailWithStatus(w, http.StatusBadGateway, "上游图片请求失败")
		return
	}
	if upstream.ContentLength > maxBytes {
		FailWithStatus(w, http.StatusRequestEntityTooLarge, "图片超过 32MB 限制")
		return
	}

	data, contentType, err := readSafeProxyImage(upstream.Body, maxBytes)
	if err != nil {
		switch {
		case errors.Is(err, errProxyImageTooLarge):
			FailWithStatus(w, http.StatusRequestEntityTooLarge, "图片超过 32MB 限制")
		case errors.Is(err, errProxyImageNotAllowed):
			FailWithStatus(w, http.StatusUnsupportedMediaType, "上游内容不是支持的图片格式")
		default:
			FailWithStatus(w, http.StatusBadGateway, "读取上游图片失败")
		}
		return
	}

	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Content-Length", strconv.FormatInt(int64(len(data)), 10))
	// 私有缓存避免带签名参数的上游 URL 被共享缓存保存。
	w.Header().Set("Cache-Control", "private, max-age=3600")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}

func readSafeProxyImage(reader io.Reader, maxBytes int64) ([]byte, string, error) {
	if maxBytes <= 0 {
		return nil, "", errProxyImageTooLarge
	}
	data, err := io.ReadAll(io.LimitReader(reader, maxBytes+1))
	if err != nil {
		return nil, "", err
	}
	if int64(len(data)) > maxBytes {
		return nil, "", errProxyImageTooLarge
	}
	contentType := detectSafeProxyImageType(data)
	if contentType == "" {
		return nil, "", errProxyImageNotAllowed
	}
	return data, contentType, nil
}

func detectSafeProxyImageType(data []byte) string {
	if len(data) == 0 {
		return ""
	}
	detected, _, err := mime.ParseMediaType(http.DetectContentType(data))
	if err == nil {
		switch strings.ToLower(detected) {
		case "image/jpeg", "image/png", "image/gif", "image/webp", "image/bmp", "image/x-icon", "image/vnd.microsoft.icon":
			return strings.ToLower(detected)
		}
	}
	if len(data) >= 4 {
		if bytes.Equal(data[:4], []byte{'I', 'I', 0x2a, 0x00}) ||
			bytes.Equal(data[:4], []byte{'M', 'M', 0x00, 0x2a}) {
			return "image/tiff"
		}
	}
	return detectISOBaseMediaImageType(data)
}

func detectISOBaseMediaImageType(data []byte) string {
	if len(data) < 16 || !bytes.Equal(data[4:8], []byte("ftyp")) {
		return ""
	}
	boxSize := int(binary.BigEndian.Uint32(data[:4]))
	// ftyp 正常只有几十字节。拒绝异常大小，避免扫描整张图片并误判随机内容。
	if boxSize < 16 || boxSize > len(data) || boxSize > 4<<10 {
		return ""
	}
	for offset := 8; offset+4 <= boxSize; offset += 4 {
		switch string(data[offset : offset+4]) {
		case "avif", "avis":
			return "image/avif"
		case "heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1":
			return "image/heic"
		}
	}
	return ""
}
