package service

import (
	"context"
	"errors"
	"net"
	"net/http"
	"testing"
	"time"
)

func TestBlockedProxyIP(t *testing.T) {
	tests := []struct {
		name    string
		address string
		blocked bool
	}{
		{name: "公网 IPv4", address: "8.8.8.8", blocked: false},
		{name: "公网 IPv6", address: "2606:4700:4700::1111", blocked: false},
		{name: "回环", address: "127.0.0.1", blocked: true},
		{name: "私网", address: "192.168.1.1", blocked: true},
		{name: "云平台元数据", address: "169.254.169.254", blocked: true},
		{name: "运营商共享地址", address: "100.64.0.1", blocked: true},
		{name: "基准测试地址", address: "198.18.0.1", blocked: true},
		{name: "文档地址", address: "203.0.113.8", blocked: true},
		{name: "保留地址", address: "240.0.0.1", blocked: true},
		{name: "IPv4 映射回环", address: "::ffff:127.0.0.1", blocked: true},
		{name: "IPv6 回环", address: "::1", blocked: true},
		{name: "IPv6 私网", address: "fd00::1", blocked: true},
		{name: "IPv6 旧站点本地", address: "fec0::1", blocked: true},
		{name: "IPv6 链路本地", address: "fe80::1", blocked: true},
		{name: "IPv6 文档地址", address: "2001:db8::1", blocked: true},
		{name: "IPv6 NAT64", address: "64:ff9b::7f00:1", blocked: true},
		{name: "IPv6 6to4", address: "2002:7f00:1::", blocked: true},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got := isBlockedProxyIP(net.ParseIP(test.address))
			if got != test.blocked {
				t.Fatalf("isBlockedProxyIP(%q) = %v, want %v", test.address, got, test.blocked)
			}
		})
	}
}

func TestValidateProxyURL(t *testing.T) {
	tests := []struct {
		name    string
		rawURL  string
		wantErr bool
	}{
		{name: "公网 HTTPS", rawURL: "https://example.com/image.png#fragment", wantErr: false},
		{name: "空地址", rawURL: "", wantErr: true},
		{name: "相对地址", rawURL: "/image.png", wantErr: true},
		{name: "非 HTTP 协议", rawURL: "file:///etc/passwd", wantErr: true},
		{name: "URL 用户凭据", rawURL: "https://user:secret@example.com/image.png", wantErr: true},
		{name: "localhost", rawURL: "http://localhost/image.png", wantErr: true},
		{name: "回环地址", rawURL: "http://127.0.0.1/image.png", wantErr: true},
		{name: "内网 IPv6", rawURL: "http://[fd00::1]/image.png", wantErr: true},
		{name: "旧站点本地 IPv6", rawURL: "http://[fec0::1]/image.png", wantErr: true},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			target, err := ValidateProxyURL(test.rawURL)
			if (err != nil) != test.wantErr {
				t.Fatalf("ValidateProxyURL(%q) error = %v, wantErr %v", test.rawURL, err, test.wantErr)
			}
			if !test.wantErr && target.Fragment != "" {
				t.Fatalf("fragment = %q, want empty", target.Fragment)
			}
		})
	}
}

func TestSafeProxyDialRejectsMixedPublicAndPrivateDNSResults(t *testing.T) {
	dialCalled := false
	_, err := safeProxyDialContextWith(
		context.Background(),
		"tcp",
		"images.example:443",
		func(context.Context, string) ([]net.IPAddr, error) {
			return []net.IPAddr{
				{IP: net.ParseIP("93.184.216.34")},
				{IP: net.ParseIP("10.0.0.8")},
			}, nil
		},
		func(context.Context, string, string) (net.Conn, error) {
			dialCalled = true
			return nil, errors.New("不应拨号")
		},
	)
	if err == nil {
		t.Fatal("mixed DNS result should be rejected")
	}
	if dialCalled {
		t.Fatal("dial was called after a private DNS result was found")
	}
}

func TestSafeProxyDialRejectsSiteLocalIPv6DNSResult(t *testing.T) {
	dialCalled := false
	_, err := safeProxyDialContextWith(
		context.Background(),
		"tcp",
		"images.example:443",
		func(context.Context, string) ([]net.IPAddr, error) {
			return []net.IPAddr{{IP: net.ParseIP("fec0::1")}}, nil
		},
		func(context.Context, string, string) (net.Conn, error) {
			dialCalled = true
			return nil, errors.New("不应拨号")
		},
	)
	if err == nil {
		t.Fatal("site-local IPv6 DNS result should be rejected")
	}
	if dialCalled {
		t.Fatal("dial was called after a site-local IPv6 DNS result was found")
	}
}

func TestSafeProxyDialPinsValidatedIPAddress(t *testing.T) {
	var dialedAddress string
	connection, err := safeProxyDialContextWith(
		context.Background(),
		"tcp",
		"images.example:443",
		func(context.Context, string) ([]net.IPAddr, error) {
			return []net.IPAddr{{IP: net.ParseIP("93.184.216.34")}}, nil
		},
		func(_ context.Context, _ string, address string) (net.Conn, error) {
			dialedAddress = address
			client, server := net.Pipe()
			_ = server.Close()
			return client, nil
		},
	)
	if err != nil {
		t.Fatalf("safeProxyDialContextWith() error = %v", err)
	}
	defer connection.Close()
	if dialedAddress != "93.184.216.34:443" {
		t.Fatalf("dialed address = %q, want validated IP", dialedAddress)
	}
}

func TestSafeProxyClientRedirectValidationAndCredentialStripping(t *testing.T) {
	client := newSafeProxyHTTPClient()
	if client.Timeout != 30*time.Second {
		t.Fatalf("client timeout = %v", client.Timeout)
	}
	transport, ok := client.Transport.(*http.Transport)
	if !ok || transport.Proxy != nil {
		t.Fatal("safe proxy client must disable environment proxies")
	}

	previous, _ := http.NewRequest(http.MethodGet, "https://93.184.216.34/start", nil)
	privateRedirect, _ := http.NewRequest(http.MethodGet, "http://169.254.169.254/latest/meta-data", nil)
	if err := client.CheckRedirect(privateRedirect, []*http.Request{previous}); err == nil {
		t.Fatal("redirect to metadata address should be rejected")
	}

	publicRedirect, _ := http.NewRequest(http.MethodGet, "https://93.184.216.34/image.png", nil)
	publicRedirect.Header.Set("Authorization", "Bearer upstream-secret")
	publicRedirect.Header.Set("Proxy-Authorization", "Basic proxy-secret")
	publicRedirect.Header.Set("Cookie", "session=secret")
	publicRedirect.Header.Set("Referer", "https://origin.example/signed?token=secret")
	if err := client.CheckRedirect(publicRedirect, []*http.Request{previous}); err != nil {
		t.Fatalf("public redirect rejected: %v", err)
	}
	for _, header := range []string{"Authorization", "Proxy-Authorization", "Cookie", "Referer"} {
		if got := publicRedirect.Header.Get(header); got != "" {
			t.Fatalf("redirect header %s was not stripped", header)
		}
	}
}
