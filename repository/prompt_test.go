package repository

import (
	"testing"

	"github.com/basketikun/infinite-canvas/model"
	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

func TestIsSyncedPromptID(t *testing.T) {
	tests := []struct {
		name     string
		category string
		id       string
		want     bool
	}{
		{name: "远程数字 ID", category: "gpt-image-2-prompts", id: "gpt-image-2-prompts-001", want: true},
		{name: "四位远程数字 ID", category: "gpt-image-2-prompts", id: "gpt-image-2-prompts-1000", want: true},
		{name: "本地 UUID", category: "gpt-image-2-prompts", id: "gpt-image-2-prompts-550e8400-e29b-41d4-a716-446655440000", want: false},
		{name: "其他分类", category: "gpt-image-2-prompts", id: "awesome-gpt-image-001", want: false},
		{name: "空后缀", category: "gpt-image-2-prompts", id: "gpt-image-2-prompts-", want: false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := isSyncedPromptID(test.category, test.id); got != test.want {
				t.Fatalf("isSyncedPromptID(%q, %q) = %v, want %v", test.category, test.id, got, test.want)
			}
		})
	}
}

func TestReplacePromptCategoryPreservesLocalPrompts(t *testing.T) {
	database, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	if err := database.AutoMigrate(&model.Prompt{}); err != nil {
		t.Fatalf("migrate database: %v", err)
	}
	category := model.PromptCategory{Category: "gpt-image-2-prompts"}
	seed := []model.Prompt{
		{ID: "gpt-image-2-prompts-001", Category: category.Category, Title: "旧远程提示词"},
		{ID: "gpt-image-2-prompts-550e8400-e29b-41d4-a716-446655440000", Category: category.Category, Title: "本地提示词"},
		{ID: "awesome-gpt-image-001", Category: "awesome-gpt-image", Title: "其他分类"},
	}
	if err := database.Create(&seed).Error; err != nil {
		t.Fatalf("seed prompts: %v", err)
	}
	remote := []model.Prompt{{ID: "gpt-image-2-prompts-002", Title: "新远程提示词"}}
	if err := replacePromptCategory(database, category, remote); err != nil {
		t.Fatalf("replace prompt category: %v", err)
	}

	var items []model.Prompt
	if err := database.Order("id asc").Find(&items).Error; err != nil {
		t.Fatalf("list prompts: %v", err)
	}
	wantIDs := []string{
		"awesome-gpt-image-001",
		"gpt-image-2-prompts-002",
		"gpt-image-2-prompts-550e8400-e29b-41d4-a716-446655440000",
	}
	if len(items) != len(wantIDs) {
		t.Fatalf("prompt count = %d, want %d: %#v", len(items), len(wantIDs), items)
	}
	for index, want := range wantIDs {
		if items[index].ID != want {
			t.Fatalf("prompt[%d].ID = %q, want %q", index, items[index].ID, want)
		}
	}
}

func TestUpdatePromptCategorySourceIsConditional(t *testing.T) {
	database, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	if err := database.AutoMigrate(&model.PromptCategory{}); err != nil {
		t.Fatalf("migrate database: %v", err)
	}
	const (
		oldURL         = "https://example.com/old"
		newURL         = "https://example.com/new"
		oldDescription = "旧内置描述"
		newDescription = "新内置描述"
	)
	seed := []model.PromptCategory{
		{Category: "default", Description: oldDescription, GithubURL: oldURL, Remote: true},
		{Category: "custom-description", Description: "管理员描述", GithubURL: oldURL, Remote: true},
		{Category: "custom-url", Description: "管理员描述", GithubURL: "https://example.com/custom", Remote: true},
		{Category: "local", Description: oldDescription, GithubURL: oldURL, Remote: false},
	}
	if err := database.Create(&seed).Error; err != nil {
		t.Fatalf("seed categories: %v", err)
	}

	for _, category := range []string{"default", "custom-description", "custom-url", "local"} {
		updated, err := updatePromptCategorySource(database, category, oldURL, newURL, oldDescription, newDescription, "2026-08-04T00:00:00Z")
		if err != nil {
			t.Fatalf("update %s: %v", category, err)
		}
		wantUpdated := category == "default" || category == "custom-description"
		if updated != wantUpdated {
			t.Fatalf("updated %s = %v, want %v", category, updated, wantUpdated)
		}
	}

	var categories []model.PromptCategory
	if err := database.Order("category asc").Find(&categories).Error; err != nil {
		t.Fatalf("list categories: %v", err)
	}
	byID := map[string]model.PromptCategory{}
	for _, category := range categories {
		byID[category.Category] = category
	}
	if got := byID["default"]; got.GithubURL != newURL || got.Description != newDescription {
		t.Fatalf("default category = %#v", got)
	}
	if got := byID["custom-description"]; got.GithubURL != newURL || got.Description != "管理员描述" {
		t.Fatalf("custom description category = %#v", got)
	}
	if got := byID["custom-url"]; got.GithubURL != "https://example.com/custom" {
		t.Fatalf("custom URL category = %#v", got)
	}
	if got := byID["local"]; got.GithubURL != oldURL || got.Remote {
		t.Fatalf("local category = %#v", got)
	}
}

func TestPromptCategoryNeedsRepairScopesManagedItems(t *testing.T) {
	database, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	if err := database.AutoMigrate(&model.Prompt{}); err != nil {
		t.Fatalf("migrate database: %v", err)
	}
	const oldRemote = "https://raw.githubusercontent.com/EvoLinkAI/awesome-gpt-image-2-API-and-Prompts/main"
	seed := []model.Prompt{
		{ID: "cover-001", Category: "cover", CoverURL: oldRemote + "/images/cover/output.jpg"},
		{ID: "preview-001", Category: "preview", Preview: "![](" + oldRemote + "/images/preview/output.jpg)"},
		{ID: "local-only-550e8400-e29b-41d4-a716-446655440000", Category: "local-only", CoverURL: oldRemote + "/images/local/output.jpg"},
		{ID: "other-001", Category: "other", CoverURL: oldRemote + "/images/other/output.jpg"},
		{ID: "clean-001", Category: "clean", CoverURL: "https://raw.githubusercontent.com/tigerowo/awesome-gpt-image-2-prompts/main/images/clean/output.jpg"},
	}
	if err := database.Create(&seed).Error; err != nil {
		t.Fatalf("seed prompts: %v", err)
	}

	tests := []struct {
		category string
		want     bool
	}{
		{category: "cover", want: true},
		{category: "preview", want: true},
		{category: "local-only", want: true},
		{category: "clean", want: false},
		{category: "missing", want: true},
	}
	for _, test := range tests {
		t.Run(test.category, func(t *testing.T) {
			got, err := promptCategoryNeedsRepair(database, test.category, oldRemote)
			if err != nil {
				t.Fatalf("check repair state: %v", err)
			}
			if got != test.want {
				t.Fatalf("promptCategoryNeedsRepair(%q) = %v, want %v", test.category, got, test.want)
			}
		})
	}
}
