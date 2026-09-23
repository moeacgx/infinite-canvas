package service

import (
	"net/url"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/basketikun/infinite-canvas/model"
)

var defaultNavigationItems = []model.NavigationItem{
	{ID: "canvas", Label: "我的画布", Href: "/canvas", Enabled: true},
	{ID: "image", Label: "生图工作台", Href: "/image", Enabled: true},
	{ID: "video", Label: "视频创作台", Href: "/video", Enabled: true},
	{ID: "workflows", Label: "创意工作流", Href: "/workflows", Enabled: true},
	{ID: "prompts", Label: "提示词库", Href: "/prompts", Enabled: true},
	{ID: "assets", Label: "我的素材", Href: "/assets", Enabled: true},
}

func normalizeNavigationItems(items []model.NavigationItem) []model.NavigationItem {
	if items != nil {
		return items
	}
	return append([]model.NavigationItem(nil), defaultNavigationItems...)
}

func validateNavigationItems(items []model.NavigationItem) error {
	if len(items) > 20 {
		return safeMessageError{message: "菜单项不能超过 20 个"}
	}
	seen := make(map[string]struct{}, len(items))
	for i := range items {
		item := &items[i]
		item.ID = strings.TrimSpace(item.ID)
		item.Label = strings.TrimSpace(item.Label)
		if item.ID == "" || utf8.RuneCountInString(item.ID) > 80 {
			return safeMessageError{message: "菜单 ID 不能为空且不能超过 80 个字符"}
		}
		if _, ok := seen[item.ID]; ok {
			return safeMessageError{message: "菜单 ID 不能重复"}
		}
		seen[item.ID] = struct{}{}
		if item.Label == "" || utf8.RuneCountInString(item.Label) > 40 {
			return safeMessageError{message: "菜单名称不能为空且不能超过 40 个字符"}
		}
		if !isSafeNavigationHref(item.Href) {
			return safeMessageError{message: "菜单链接必须是安全的站内路径或 http/https 地址"}
		}
	}
	return nil
}

func isSafeNavigationHref(href string) bool {
	if href == "" || len(href) > 2048 || strings.ContainsRune(href, '\\') {
		return false
	}
	for _, r := range href {
		if unicode.IsSpace(r) || unicode.IsControl(r) {
			return false
		}
	}
	internal := strings.HasPrefix(href, "/") && !strings.HasPrefix(href, "//")
	lower := strings.ToLower(href)
	if !internal && !strings.HasPrefix(lower, "http://") && !strings.HasPrefix(lower, "https://") {
		return false
	}
	u, err := url.Parse(href)
	if err != nil {
		return false
	}
	if internal {
		return u.Path != "" && u.Scheme == "" && u.Host == ""
	}
	return (u.Scheme == "http" || u.Scheme == "https") && u.Hostname() != "" && u.User == nil
}
