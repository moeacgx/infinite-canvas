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
