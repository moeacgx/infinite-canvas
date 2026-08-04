package service

import (
	"errors"
	"fmt"
	"log"
	"time"

	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/repository"
)

const legacyGptImage2PromptRepo = "https://github.com/EvoLinkAI/awesome-gpt-image-2-API-and-Prompts"

const legacyGptImage2PromptDescription = "EvoLinkAI 的 GPT Image 2 案例提示词分类"

// EnsureDefaultPromptCategories 幂等地将内置分类写入数据库。
func EnsureDefaultPromptCategories() error {
	for _, item := range repository.DefaultPromptCategories() {
		existing, found, err := repository.GetPromptCategoryByCode(item.Category)
		if err != nil {
			return err
		}
		if found {
			if migrateDefaultPromptCategorySource(&existing, item) {
				existing.UpdatedAt = time.Now().Format(time.RFC3339)
				if err := repository.SavePromptCategory(existing); err != nil {
					return err
				}
				log.Printf("migrated prompt category source: %s", item.Category)
			}
			continue
		}
		item.UpdatedAt = time.Now().Format(time.RFC3339)
		if err := repository.SavePromptCategory(item); err != nil {
			return err
		}
		log.Printf("seeded prompt category: %s", item.Category)
	}
	return nil
}

// migrateDefaultPromptCategorySource 只迁移仍指向已下线内置源的记录，避免覆盖管理员自定义分类。
func migrateDefaultPromptCategorySource(existing *model.PromptCategory, current model.PromptCategory) bool {
	if existing == nil || existing.Category != current.Category || !existing.Remote {
		return false
	}
	if existing.Category != "gpt-image-2-prompts" || existing.GithubURL != legacyGptImage2PromptRepo {
		return false
	}
	existing.GithubURL = current.GithubURL
	if existing.Description == legacyGptImage2PromptDescription {
		existing.Description = current.Description
	}
	return true
}

// SavePromptCategory 保存提示词分类。新建分类强制 remote=false。
func SavePromptCategory(item model.PromptCategory) (model.PromptCategory, error) {
	if item.Category == "" {
		return item, errors.New("分类 ID 不能为空")
	}
	if item.Name == "" {
		return item, errors.New("分类名称不能为空")
	}
	existing, found, err := repository.GetPromptCategoryByCode(item.Category)
	if err != nil {
		return item, err
	}
	if found {
		// 编辑已有分类：保留 remote 和 githubUrl 不可修改
		item.Remote = existing.Remote
		item.GithubURL = existing.GithubURL
	} else {
		// 新建分类：强制本地
		item.Remote = false
		item.GithubURL = ""
	}
	item.UpdatedAt = time.Now().Format(time.RFC3339)
	return item, repository.SavePromptCategory(item)
}

// DeletePromptCategory 删除提示词分类（有关联提示词时拒绝删除）。
func DeletePromptCategory(category string) error {
	if category == "" {
		return errors.New("分类 ID 不能为空")
	}
	count, err := repository.CountPromptsByCategory(category)
	if err != nil {
		return err
	}
	if count > 0 {
		return fmt.Errorf("该分类下还有 %d 条提示词，请先删除或移动后再删除分类", count)
	}
	return repository.DeletePromptCategory(category)
}
