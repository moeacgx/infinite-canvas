package service

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strings"
	"time"
)

const (
	safeProxyRequestTimeout = 30 * time.Second
	safeProxyMaxRedirects   = 5
	safeProxyMaxURLLength   = 8 << 10
)

var (
	safeProxyHTTPClient = newSafeProxyHTTPClient()
	blockedProxyRanges  = []netip.Prefix{
		// IPv4 特殊用途、内网、链路本地、文档和保留地址。
		netip.MustParsePrefix("0.0.0.0/8"),
		netip.MustParsePrefix("10.0.0.0/8"),
		netip.MustParsePrefix("100.64.0.0/10"),
		netip.MustParsePrefix("127.0.0.0/8"),
		netip.MustParsePrefix("169.254.0.0/16"),
		netip.MustParsePrefix("172.16.0.0/12"),
		netip.MustParsePrefix("192.0.0.0/24"),
		netip.MustParsePrefix("192.0.2.0/24"),
		netip.MustParsePrefix("192.88.99.0/24"),
		netip.MustParsePrefix("192.168.0.0/16"),
		netip.MustParsePrefix("198.18.0.0/15"),
		netip.MustParsePrefix("198.51.100.0/24"),
		netip.MustParsePrefix("203.0.113.0/24"),
		netip.MustParsePrefix("224.0.0.0/4"),
		netip.MustParsePrefix("240.0.0.0/4"),
		// IPv6 特殊用途、NAT64、隧道、内网、链路本地和文档地址。
		netip.MustParsePrefix("::/96"),
		netip.MustParsePrefix("64:ff9b::/96"),
		netip.MustParsePrefix("64:ff9b:1::/48"),
		netip.MustParsePrefix("100::/64"),
		netip.MustParsePrefix("2001::/23"),
		netip.MustParsePrefix("2001:db8::/32"),
		netip.MustParsePrefix("2002::/16"),
		netip.MustParsePrefix("fc00::/7"),
		netip.MustParsePrefix("fec0::/10"),
		netip.MustParsePrefix("fe80::/10"),
		netip.MustParsePrefix("ff00::/8"),
	}
)

// SafeProxyHTTPClient 返回仅允许连接公网地址的 HTTP 客户端。
// 传输层不会读取 HTTP_PROXY 等环境变量，每次 DNS 解析和重定向都会重新校验目标。
func SafeProxyHTTPClient() *http.Client {
	return safeProxyHTTPClient
}

// ValidateProxyURL 校验代理目标的 URL 结构。域名对应的 IP 会在实际拨号时校验，
// 从而避免校验与连接之间发生 DNS 重绑定。
func ValidateProxyURL(rawURL string) (*url.URL, error) {
	rawURL = strings.TrimSpace(rawURL)
	if rawURL == "" {
		return nil, errors.New("代理地址不能为空")
	}
	if len(rawURL) > safeProxyMaxURLLength {
		return nil, errors.New("代理地址过长")
	}

	target, err := url.Parse(rawURL)
	if err != nil || target.Opaque != "" || target.Host == "" {
		return nil, errors.New("代理地址格式无效")
	}
	target.Scheme = strings.ToLower(target.Scheme)
	if target.Scheme != "http" && target.Scheme != "https" {
		return nil, errors.New("代理地址仅支持 http 或 https")
	}
	if target.User != nil {
		return nil, errors.New("代理地址不能包含用户凭据")
	}
	hostname := strings.TrimSuffix(strings.ToLower(target.Hostname()), ".")
	if hostname == "" || hostname == "localhost" || strings.HasSuffix(hostname, ".localhost") {
		return nil, errors.New("禁止访问本地地址")
	}
	if strings.Contains(hostname, "%") {
		return nil, errors.New("代理地址不能包含网络区域标识")
	}
	if ip := net.ParseIP(hostname); ip != nil && isBlockedProxyIP(ip) {
		return nil, errors.New("禁止访问本地、内网或保留地址")
	}

	// URL 片段不会发送给上游，提前移除可避免它进入后续日志或重定向处理。
	target.Fragment = ""
	return target, nil
}

func newSafeProxyHTTPClient() *http.Client {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = nil
	transport.DialContext = safeProxyDialContext
	transport.ResponseHeaderTimeout = 10 * time.Second
	transport.TLSHandshakeTimeout = 10 * time.Second
	transport.ExpectContinueTimeout = time.Second
	transport.IdleConnTimeout = 30 * time.Second
	transport.MaxIdleConns = 20
	transport.MaxIdleConnsPerHost = 2

	return &http.Client{
		Transport: transport,
		Timeout:   safeProxyRequestTimeout,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= safeProxyMaxRedirects {
				return errors.New("重定向次数过多")
			}
			if _, err := ValidateProxyURL(req.URL.String()); err != nil {
				return err
			}
			// 不允许 URL 凭据、Cookie 或来源地址随重定向泄露给其他站点。
			for _, header := range []string{
				"Authorization",
				"Proxy-Authorization",
				"Cookie",
				"Cookie2",
				"Referer",
			} {
				req.Header.Del(header)
			}
			return nil
		},
	}
}

func safeProxyDialContext(ctx context.Context, network, address string) (net.Conn, error) {
	dialer := &net.Dialer{
		Timeout:   10 * time.Second,
		KeepAlive: 30 * time.Second,
	}
	return safeProxyDialContextWith(
		ctx,
		network,
		address,
		net.DefaultResolver.LookupIPAddr,
		dialer.DialContext,
	)
}

type proxyLookupIPAddrFunc func(context.Context, string) ([]net.IPAddr, error)
type proxyDialContextFunc func(context.Context, string, string) (net.Conn, error)

func safeProxyDialContextWith(
	ctx context.Context,
	network string,
	address string,
	lookup proxyLookupIPAddrFunc,
	dial proxyDialContextFunc,
) (net.Conn, error) {
	host, port, err := net.SplitHostPort(address)
	if err != nil || strings.TrimSpace(host) == "" || strings.TrimSpace(port) == "" {
		return nil, errors.New("代理目标地址无效")
	}
	host = strings.TrimSuffix(host, ".")
	if strings.Contains(host, "%") {
		return nil, errors.New("禁止访问带网络区域标识的地址")
	}

	var resolved []net.IPAddr
	if literal := net.ParseIP(host); literal != nil {
		resolved = []net.IPAddr{{IP: literal}}
	} else {
		resolved, err = lookup(ctx, host)
		if err != nil || len(resolved) == 0 {
			return nil, errors.New("无法解析代理目标地址")
		}
	}

	// 只要域名返回一个非公网地址，就拒绝整个请求。这样不会因 DNS 返回顺序变化
	// 或连接回退而意外访问到内网地址。
	for _, item := range resolved {
		if item.Zone != "" || isBlockedProxyIP(item.IP) {
			return nil, errors.New("禁止访问本地、内网或保留地址")
		}
	}

	var lastErr error
	for _, item := range resolved {
		connection, dialErr := dial(ctx, network, net.JoinHostPort(item.IP.String(), port))
		if dialErr == nil {
			return connection, nil
		}
		lastErr = dialErr
	}
	if lastErr == nil {
		lastErr = errors.New("目标没有可用公网地址")
	}
	return nil, fmt.Errorf("无法连接代理目标: %w", lastErr)
}

func isBlockedProxyIP(ip net.IP) bool {
	address, ok := netip.AddrFromSlice(ip)
	if !ok {
		return true
	}
	address = address.Unmap()
	if !address.IsGlobalUnicast() ||
		address.IsPrivate() ||
		address.IsLoopback() ||
		address.IsLinkLocalUnicast() ||
		address.IsLinkLocalMulticast() ||
		address.IsInterfaceLocalMulticast() ||
		address.IsMulticast() ||
		address.IsUnspecified() {
		return true
	}
	for _, prefix := range blockedProxyRanges {
		if prefix.Contains(address) {
			return true
		}
	}
	return false
}
