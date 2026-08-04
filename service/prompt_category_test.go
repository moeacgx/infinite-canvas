package service

import (
	"testing"

	"github.com/basketikun/infinite-canvas/model"
)

func TestMigrateDefaultPromptCategorySource(t *testing.T) {
	current := model.PromptCategory{
		Category:    "gpt-image-2-prompts",
		Description: "TigerOWO 的 GPT Image 2 案例提示词分类",
		GithubURL:   "https://github.com/tigerowo/awesome-gpt-image-2-prompts",
		Remote:      true,
	}
	existing := model.PromptCategory{
		Category:    current.Category,
		Description: legacyGptImage2PromptDescription,
		GithubURL:   legacyGptImage2PromptRepo,
		Remote:      true,
	}

	if !migrateDefaultPromptCategorySource(&existing, current) {
		t.Fatal("legacy built-in source was not migrated")
	}
	if existing.GithubURL != current.GithubURL || existing.Description != current.Description {
		t.Fatalf("migrated category = %#v", existing)
	}
}

func TestMigrateDefaultPromptCategorySourcePreservesAdminChanges(t *testing.T) {
	current := model.PromptCategory{Category: "gpt-image-2-prompts", Description: "新描述", GithubURL: "https://github.com/tigerowo/awesome-gpt-image-2-prompts", Remote: true}
	tests := []model.PromptCategory{
		{Category: current.Category, Description: "管理员描述", GithubURL: "https://example.com/custom", Remote: true},
		{Category: current.Category, Description: "本地分类", GithubURL: legacyGptImage2PromptRepo, Remote: false},
		{Category: "custom", Description: "自定义分类", GithubURL: legacyGptImage2PromptRepo, Remote: true},
	}
	for _, original := range tests {
		existing := original
		if migrateDefaultPromptCategorySource(&existing, current) {
			t.Fatalf("admin category should not migrate: %#v", original)
		}
		if existing != original {
			t.Fatalf("admin category changed: got %#v, want %#v", existing, original)
		}
	}

	customDescription := model.PromptCategory{Category: current.Category, Description: "管理员描述", GithubURL: legacyGptImage2PromptRepo, Remote: true}
	if !migrateDefaultPromptCategorySource(&customDescription, current) {
		t.Fatal("legacy URL with custom description should migrate")
	}
	if customDescription.Description != "管理员描述" {
		t.Fatalf("custom description was overwritten: %q", customDescription.Description)
	}
}
