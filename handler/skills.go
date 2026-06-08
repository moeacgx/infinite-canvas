package handler

import (
	"net/http"
	"strings"

	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/service"
)

func Skills(w http.ResponseWriter, r *http.Request) {
	settings, err := service.PublicSettings()
	if err != nil {
		FailError(w, err)
		return
	}
	available := settings.ModelChannel.AvailableModels
	var imageModels, videoModels, audioModels, textModels []string
	for _, m := range available {
		name := strings.ToLower(strings.TrimSpace(m))
		switch {
		case strings.Contains(name, "seedance") || strings.Contains(name, "video"):
			videoModels = append(videoModels, m)
		case strings.Contains(name, "seedream") || strings.Contains(name, "gpt-image") || strings.Contains(name, "image"):
			imageModels = append(imageModels, m)
		case strings.Contains(name, "tts") || strings.Contains(name, "audio") || strings.Contains(name, "speech"):
			audioModels = append(audioModels, m)
		default:
			textModels = append(textModels, m)
		}
	}
	if imageModels == nil {
		imageModels = []string{}
	}
	if videoModels == nil {
		videoModels = []string{}
	}
	if audioModels == nil {
		audioModels = []string{}
	}
	if textModels == nil {
		textModels = []string{}
	}

	skills := []model.Skill{}
	if len(imageModels) > 0 {
		skills = append(skills, model.Skill{
			Name:        "generate_image",
			Description: "根据文字描述生成图片。当用户想要创建、绘制、设计图片时调用此技能。",
			Parameters: []model.SkillParameter{
				{Name: "prompt", Type: "string", Description: "详细的图片描述提示词，英文效果更佳", Required: true},
				{Name: "model", Type: "string", Description: "图片生成模型", Enum: imageModels, Required: false},
				{Name: "size", Type: "string", Description: "图片尺寸", Enum: []string{"1024x1024", "1536x1024", "1024x1536", "auto"}, Required: false},
				{Name: "quality", Type: "string", Description: "图片质量", Enum: []string{"low", "medium", "high"}, Required: false},
				{Name: "count", Type: "integer", Description: "生成数量，1-4张", Required: false},
			},
		})
	}
	if len(videoModels) > 0 {
		skills = append(skills, model.Skill{
			Name:        "generate_video",
			Description: "根据文字描述生成视频。当用户想要创建视频、动画时调用此技能。",
			Parameters: []model.SkillParameter{
				{Name: "prompt", Type: "string", Description: "详细的视频描述提示词", Required: true},
				{Name: "model", Type: "string", Description: "视频生成模型", Enum: videoModels, Required: false},
			},
		})
	}
	if len(audioModels) > 0 {
		skills = append(skills, model.Skill{
			Name:        "generate_audio",
			Description: "根据文字内容生成语音朗读。当用户想要文字转语音时调用此技能。",
			Parameters: []model.SkillParameter{
				{Name: "text", Type: "string", Description: "需要朗读的文字内容", Required: true},
				{Name: "model", Type: "string", Description: "语音模型", Enum: audioModels, Required: false},
				{Name: "voice", Type: "string", Description: "语音角色", Enum: []string{"alloy", "ash", "ballad", "coral", "echo", "fable", "onyx", "nova", "sage", "shimmer"}, Required: false},
			},
		})
	}

	OK(w, model.SkillsResponse{
		Skills:      skills,
		ImageModels: imageModels,
		VideoModels: videoModels,
		AudioModels: audioModels,
		TextModels:  textModels,
	})
}
