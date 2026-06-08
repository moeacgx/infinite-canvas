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

type githubContent struct {
	Name string `json:"name"`
	Type string `json:"type"`
}

// SyncSkillRepo 从任意 GitHub 仓库的 skills 目录同步技能预设。
// repoURL 格式: https://github.com/owner/repo
// branch: 分支名，默认 "main"
// skillsPath: skills 目录路径，默认 "skills"
func SyncSkillRepo(repoURL, branch, skillsPath string) (int, error) {
	repoURL = strings.TrimRight(strings.TrimSpace(repoURL), "/")
	if branch == "" {
		branch = "main"
	}
	if skillsPath == "" {
		skillsPath = "skills"
	}
	// 从 URL 提取 owner/repo
	ownerRepo := extractOwnerRepo(repoURL)
	if ownerRepo == "" {
		return 0, fmt.Errorf("无效的 GitHub 仓库 URL: %s", repoURL)
	}
	// 生成唯一前缀，用于 skill ID
	prefix := repoSlug(ownerRepo)

	contentsURL := fmt.Sprintf("https://api.github.com/repos/%s/contents/%s?ref=%s", ownerRepo, skillsPath, branch)
	rawBase := fmt.Sprintf("https://raw.githubusercontent.com/%s/%s/%s", ownerRepo, branch, skillsPath)

	dirs, err := fetchGithubDirectories(contentsURL)
	if err != nil {
		return 0, fmt.Errorf("获取技能目录失败: %w", err)
	}
	log.Printf("skill-sync [%s]: found %d skill directories", ownerRepo, len(dirs))

	synced := 0
	for _, dir := range dirs {
		skill, err := fetchAndParseSkillMD(rawBase, dir, prefix, ownerRepo)
		if err != nil {
			log.Printf("skill-sync [%s]: skip %s: %v", ownerRepo, dir, err)
			continue
		}
		if _, err := repository.SavePromptSkill(skill); err != nil {
			log.Printf("skill-sync [%s]: save %s failed: %v", ownerRepo, dir, err)
			continue
		}
		synced++
	}
	log.Printf("skill-sync [%s]: done, synced %d skills", ownerRepo, synced)
	return synced, nil
}

func extractOwnerRepo(repoURL string) string {
	// 支持 https://github.com/owner/repo 和 https://github.com/owner/repo.git
	repoURL = strings.TrimSuffix(repoURL, ".git")
	for _, prefix := range []string{"https://github.com/", "http://github.com/"} {
		if strings.HasPrefix(repoURL, prefix) {
			return strings.TrimPrefix(repoURL, prefix)
		}
	}
	// 也支持直接传 owner/repo
	parts := strings.Split(repoURL, "/")
	if len(parts) == 2 {
		return repoURL
	}
	return ""
}

func repoSlug(ownerRepo string) string {
	return strings.ReplaceAll(strings.ToLower(ownerRepo), "/", "-")
}

func fetchGithubDirectories(contentsURL string) ([]string, error) {
	client := http.Client{Timeout: 30 * time.Second}
	req, _ := http.NewRequest(http.MethodGet, contentsURL, nil)
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

func fetchAndParseSkillMD(rawBase, dirName, prefix, ownerRepo string) (model.PromptSkill, error) {
	url := rawBase + "/" + dirName + "/SKILL.md"
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
	return parseSkillMD(dirName, string(data), prefix, ownerRepo)
}

func parseSkillMD(dirName, content, prefix, ownerRepo string) (model.PromptSkill, error) {
	parts := strings.SplitN(content, "---", 3)
	frontmatter := ""
	body := content
	if len(parts) >= 3 {
		frontmatter = parts[1]
		body = strings.TrimSpace(parts[2])
	}

	name := yamlValue(frontmatter, "name")
	if name == "" {
		name = dirName
	}
	description := yamlValue(frontmatter, "description")
	if description == "" {
		description = yamlMultilineValue(frontmatter, "description")
	}
	mode := yamlNestedValue(frontmatter, "od", "mode")
	category := yamlNestedValue(frontmatter, "od", "category")
	if category == "" {
		category = mode
	}
	icon := skillModeIcon(mode)

	// 作者显示仓库名
	author := ownerRepo

	now := time.Now().Format(time.RFC3339)

	return model.PromptSkill{
		ID:           prefix + "-" + dirName,
		Name:         name,
		Description:  strings.TrimSpace(description),
		SystemPrompt: body,
		Icon:         icon,
		Category:     category,
		Author:       author,
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
