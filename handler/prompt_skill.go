package handler

import (
	"encoding/json"
	"net/http"

	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/service"
)

// PromptSkills 公开接口，返回所有技能预设供前端使用。
func PromptSkills(w http.ResponseWriter, r *http.Request) {
	items, err := service.ListPromptSkills()
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, items)
}

// AdminPromptSkills 管理员接口，返回所有技能预设。
func AdminPromptSkills(w http.ResponseWriter, r *http.Request) {
	items, err := service.ListPromptSkills()
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, items)
}

// AdminSavePromptSkill 保存技能预设。
func AdminSavePromptSkill(w http.ResponseWriter, r *http.Request) {
	var item model.PromptSkill
	_ = json.NewDecoder(r.Body).Decode(&item)
	result, err := service.SavePromptSkill(item)
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, result)
}

// AdminDeletePromptSkill 删除技能预设。
func AdminDeletePromptSkill(w http.ResponseWriter, r *http.Request, id string) {
	if err := service.DeletePromptSkill(id); err != nil {
		FailError(w, err)
		return
	}
	OK(w, true)
}

// AdminSyncOpenDesignSkills 从 OpenDesign 仓库同步技能预设。
func AdminSyncOpenDesignSkills(w http.ResponseWriter, r *http.Request) {
	count, err := service.SyncOpenDesignSkills()
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, map[string]int{"synced": count})
}
