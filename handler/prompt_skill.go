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

// AdminSyncSkillRepo 从自定义 GitHub 仓库同步技能预设。
func AdminSyncSkillRepo(w http.ResponseWriter, r *http.Request) {
	var request struct {
		RepoURL    string `json:"repoUrl"`
		Branch     string `json:"branch"`
		SkillsPath string `json:"skillsPath"`
	}
	_ = json.NewDecoder(r.Body).Decode(&request)
	if request.RepoURL == "" {
		Fail(w, "请输入 GitHub 仓库 URL")
		return
	}
	count, err := service.SyncSkillRepo(request.RepoURL, request.Branch, request.SkillsPath)
	if err != nil {
		FailError(w, err)
		return
	}
	OK(w, map[string]int{"synced": count})
}
