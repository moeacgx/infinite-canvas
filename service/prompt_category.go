package service

import (
	"errors"
	"fmt"
	"log"
	"time"

	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/repository"
)

// EnsureDefaultPromptCategories 幂等地将内置分类写入数据库。
func EnsureDefaultPromptCategories() error {
	for _, item := range repository.DefaultPromptCategories() {
		_, found, err := repository.GetPromptCategoryByCode(item.Category)
		if err != nil {
			return err
		}
		if found {
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
