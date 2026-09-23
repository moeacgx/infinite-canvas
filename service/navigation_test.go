package service

import (
	"strings"
	"testing"

	"github.com/basketikun/infinite-canvas/model"
)

func TestNavigationDefaultsAndExplicitEmpty(t *testing.T) {
	if got := normalizeNavigationItems(nil); len(got) != 6 || got[0].ID != "canvas" || got[5].Href != "/assets" {
		t.Fatalf("unexpected defaults: %#v", got)
	}
	if got := normalizeNavigationItems([]model.NavigationItem{}); got == nil || len(got) != 0 {
		t.Fatalf("explicit empty menu should remain empty: %#v", got)
	}
}

func TestNavigationValidation(t *testing.T) {
	valid := []model.NavigationItem{{ID: "docs", Label: " 文档 ", Href: "https://example.com/docs?a=1", Enabled: true}}
	if err := validateNavigationItems(valid); err != nil {
		t.Fatalf("valid menu rejected: %v", err)
	}
	if valid[0].Label != "文档" {
		t.Fatal("label should be normalized")
	}
	for _, href := range []string{"//example.com", "javascript:alert(1)", "https://u:p@example.com", "/bad path", "https:///missing-host"} {
		if err := validateNavigationItems([]model.NavigationItem{{ID: "x", Label: "X", Href: href}}); err == nil {
			t.Fatalf("unsafe href accepted: %q", href)
		}
	}
}

func TestNavigationValidationLimitsAndIDs(t *testing.T) {
	tooMany := make([]model.NavigationItem, 21)
	for i := range tooMany {
		tooMany[i] = model.NavigationItem{ID: string(rune('a' + i)), Label: "菜单", Href: "/menu"}
	}
	if err := validateNavigationItems(tooMany); err == nil {
		t.Fatal("more than 20 menu items accepted")
	}
	if err := validateNavigationItems([]model.NavigationItem{{ID: strings.Repeat("a", 81), Label: "菜单", Href: "/menu"}}); err == nil {
		t.Fatal("long menu id accepted")
	}
	if err := validateNavigationItems([]model.NavigationItem{{ID: "x", Label: "菜单", Href: "/menu"}, {ID: "x", Label: "另一个", Href: "/other"}}); err == nil {
		t.Fatal("duplicate menu id accepted")
	}
}

func TestNavigationHrefSafety(t *testing.T) {
	for _, href := range []string{"/", "/docs?q=1#section", "https://example.com", "HTTPS://example.com", "http://localhost:3000"} {
		if !isSafeNavigationHref(href) {
			t.Fatalf("valid href rejected: %q", href)
		}
	}
	for _, href := range []string{"", "//example.com", "https://u@example.com", "/bad\tpath", "/bad\npath", "/bad\\path", "https://example.com/a b", " https://example.com", "https://", "https://example.com:bad", "/" + strings.Repeat("x", 2048)} {
		if isSafeNavigationHref(href) {
			t.Fatalf("unsafe href accepted: %q", href)
		}
	}
}
