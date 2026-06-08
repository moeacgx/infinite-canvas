package service

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/repository"
)

const (
	openDesignContentsURL = "https://api.github.com/repos/nexu-io/open-design/contents/skills"
	openDesignRawBase     = "https://raw.githubusercontent.com/nexu-io/open-design/main/skills"
)

type githubContent struct {
	Name string `json:"name"`
	Type string `json:"type"`
}

// SyncOpenDesignSkills 从 OpenDesign GitHub 仓库同步所有技能预设。
func SyncOpenDesignSkills() (int, error) {
	dirs, err := fetchSkillDirectories()
	if err != nil {
		return 0, fmt.Errorf("获取技能目录失败: %w", err)
	}
	log.Printf("open-design sync: found %d skill directories", len(dirs))

	synced := 0
	for _, dir := range dirs {
		skill, err := fetchAndParseSkill(dir)
		if err != nil {
			log.Printf("open-design sync: skip %s: %v", dir, err)
			continue
		}
		if err := repository.SavePromptSkill(skill); err != nil {
			log.Printf("open-design sync: save %s failed: %v", dir, err)
			continue
		}
		synced++
	}
	log.Printf("open-design sync: done, synced %d skills", synced)
	return synced, nil
}

func fetchSkillDirectories() ([]string, error) {
	client := http.Client{Timeout: 30 * time.Second}
	req, _ := http.NewRequest(http.MethodGet, openDesignContentsURL, nil)
	req.Header.Set("Accept", "application/vnd.github.v3+json")
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("GitHub API 返回 %d", resp.StatusCode)
	}
	var contents []githubContent
	if err := json.NewDecoder(resp.Body).Decode(&contents); err != nil {
		return nil, err
	}
	dirs := []string{}
	for _, c := range contents {
		if c.Type == "dir" {
			dirs = append(dirs, c.Name)
		}
	}
	return dirs, nil
}

func fetchAndParseSkill(dirName string) (model.PromptSkill, error) {
	url := openDesignRawBase + "/" + dirName + "/SKILL.md"
	client := http.Client{Timeout: 15 * time.Second}
	resp, err := client.Get(url)
	if err != nil {
		return model.PromptSkill{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return model.PromptSkill{}, fmt.Errorf("SKILL.md 返回 %d", resp.StatusCode)
	}
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return model.PromptSkill{}, err
	}
	return parseSkillMD(dirName, string(data))
}

func parseSkillMD(dirName, content string) (model.PromptSkill, error) {
	// Split frontmatter and body
	parts := strings.SplitN(content, "---", 3)
	frontmatter := ""
	body := content
	if len(parts) >= 3 {
		frontmatter = parts[1]
		body = strings.TrimSpace(parts[2])
	}

	// Parse simple YAML fields from frontmatter
	name := yamlValue(frontmatter, "name")
	if name == "" {
		name = dirName
	}
	description := yamlValue(frontmatter, "description")
	if description == "" {
		// Try multi-line description (common in YAML)
		description = yamlMultilineValue(frontmatter, "description")
	}
	mode := yamlNestedValue(frontmatter, "od", "mode")
	category := yamlNestedValue(frontmatter, "od", "category")
	if category == "" {
		category = mode
	}

	// Icon based on mode
	icon := skillModeIcon(mode)

	now := time.Now().Format(time.RFC3339)

	return model.PromptSkill{
		ID:           "od-" + dirName,
		Name:         name,
		Description:  strings.TrimSpace(description),
		SystemPrompt: body,
		Icon:         icon,
		Category:     category,
		Author:       "OpenDesign",
		CreatedAt:    now,
		UpdatedAt:    now,
	}, nil
}

func yamlValue(yaml, key string) string {
	for _, line := range strings.Split(yaml, "\n") {
		line = strings.TrimSpace(line)
		prefix := key + ":"
		if strings.HasPrefix(line, prefix) {
			val := strings.TrimSpace(strings.TrimPrefix(line, prefix))
			val = strings.Trim(val, "\"'")
			if val != "" && val != "|" && val != ">" {
				return val
			}
		}
	}
	return ""
}

func yamlMultilineValue(yaml, key string) string {
	lines := strings.Split(yaml, "\n")
	collecting := false
	result := []string{}
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, key+":") {
			collecting = true
			continue
		}
		if collecting {
			if len(line) > 0 && line[0] != ' ' && line[0] != '\t' {
				break
			}
			result = append(result, strings.TrimSpace(line))
		}
	}
	return strings.Join(result, " ")
}

func yamlNestedValue(yaml, parent, key string) string {
	lines := strings.Split(yaml, "\n")
	inParent := false
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, parent+":") {
			inParent = true
			continue
		}
		if inParent {
			if len(line) > 0 && line[0] != ' ' && line[0] != '\t' {
				break
			}
			if strings.HasPrefix(trimmed, key+":") {
				val := strings.TrimSpace(strings.TrimPrefix(trimmed, key+":"))
				return strings.Trim(val, "\"'")
			}
		}
	}
	return ""
}

func skillModeIcon(mode string) string {
	switch mode {
	case "image":
		return "🎨"
	case "video":
		return "🎬"
	case "audio":
		return "🔊"
	case "prototype":
		return "📱"
	case "deck":
		return "📊"
	case "design-system":
		return "🎯"
	case "utility":
		return "🔧"
	case "template":
		return "📄"
	default:
		return "✨"
	}
}
