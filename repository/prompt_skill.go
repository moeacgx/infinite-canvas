package repository

import (
	"github.com/basketikun/infinite-canvas/model"
)

// ListPromptSkills 返回所有技能预设。
func ListPromptSkills() ([]model.PromptSkill, error) {
	db, err := DB()
	if err != nil {
		return nil, err
	}
	var items []model.PromptSkill
	if err := db.Order("created_at desc").Find(&items).Error; err != nil {
		return nil, err
	}
	return items, nil
}

// SavePromptSkill 保存技能预设。
func SavePromptSkill(item model.PromptSkill) (model.PromptSkill, error) {
	db, err := DB()
	if err != nil {
		return item, err
	}
	return item, db.Save(&item).Error
}

// DeletePromptSkill 删除指定技能预设。
func DeletePromptSkill(id string) error {
	db, err := DB()
	if err != nil {
		return err
	}
	return db.Delete(&model.PromptSkill{}, "id = ?", id).Error
}
