package model

// Skill 技能定义。
type Skill struct {
	Name        string           `json:"name"`
	Description string           `json:"description"`
	Parameters  []SkillParameter `json:"parameters"`
}

// SkillParameter 技能参数。
type SkillParameter struct {
	Name        string   `json:"name"`
	Type        string   `json:"type"`
	Description string   `json:"description"`
	Enum        []string `json:"enum,omitempty"`
	Required    bool     `json:"required"`
}

// SkillsResponse 技能发现接口的响应。
type SkillsResponse struct {
	Skills      []Skill  `json:"skills"`
	ImageModels []string `json:"imageModels"`
	VideoModels []string `json:"videoModels"`
	AudioModels []string `json:"audioModels"`
	TextModels  []string `json:"textModels"`
}
