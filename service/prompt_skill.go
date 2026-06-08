package service

import (
	"errors"
	"time"

	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/repository"
)

// ListPromptSkills 返回所有技能预设。
func ListPromptSkills() ([]model.PromptSkill, error) {
	return repository.ListPromptSkills()
}

// SavePromptSkill 保存技能预设。
func SavePromptSkill(item model.PromptSkill) (model.PromptSkill, error) {
	if item.Name == "" {
		return item, errors.New("技能名称不能为空")
	}
	if item.SystemPrompt == "" {
		return item, errors.New("系统提示词不能为空")
	}
	now := time.Now().Format(time.RFC3339)
	if item.ID == "" {
		item.ID = newID("skill")
		item.CreatedAt = now
	}
	item.UpdatedAt = now
	return repository.SavePromptSkill(item)
}

// DeletePromptSkill 删除技能预设。
func DeletePromptSkill(id string) error {
	if id == "" {
		return errors.New("技能 ID 不能为空")
	}
	return repository.DeletePromptSkill(id)
}
