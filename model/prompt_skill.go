package model

// PromptSkill 提示词技能预设。
type PromptSkill struct {
	ID             string `json:"id" gorm:"primaryKey"`
	Name           string `json:"name"`
	Description    string `json:"description"`
	SystemPrompt   string `json:"systemPrompt"`
	Icon           string `json:"icon"`
	Category       string `json:"category"`
	DefaultModel   string `json:"defaultModel"`
	DefaultQuality string `json:"defaultQuality"`
	DefaultSize    string `json:"defaultSize"`
	Author         string `json:"author"`
	CreatedAt      string `json:"createdAt"`
	UpdatedAt      string `json:"updatedAt"`
}
