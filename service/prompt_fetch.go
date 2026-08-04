package service

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/repository"
)

const (
	gptImage2RawBase             = "https://raw.githubusercontent.com/tigerowo/awesome-gpt-image-2-prompts/main"
	awesomeGptImageRawBase       = "https://raw.githubusercontent.com/ZeroLu/awesome-gpt-image/main"
	awesomeGpt4oImagePromptsBase = "https://raw.githubusercontent.com/ImgEdify/Awesome-GPT4o-Image-Prompts/main"
	youMindGptImage2RawBase      = "https://raw.githubusercontent.com/YouMind-OpenLab/awesome-gpt-image-2/main"
	youMindNanoBananaProRawBase  = "https://raw.githubusercontent.com/YouMind-OpenLab/awesome-nano-banana-pro-prompts/main"
	davidWuGptImage2RawBase      = "https://raw.githubusercontent.com/davidwuw0811-boop/awesome-gpt-image2-prompts/main"
	maxPromptSourceBytes         = 16 << 20
)

var gptImage2CaseFiles = []string{"README.md", "cases/ad-creative.md", "cases/character.md", "cases/comparison.md", "cases/ecommerce.md", "cases/portrait.md", "cases/poster.md", "cases/ui.md"}

type gptImage2Data struct {
	Records []struct {
		Title    string `json:"title"`
		TweetURL string `json:"tweet_url"`
		ImageDir string `json:"image_dir"`
		Category string `json:"category"`
		AddedAt  string `json:"added_at"`
	} `json:"records"`
}

type gptImage2Case struct {
	prompt string
	image  string
}

var (
	gptImage2CaseHeadingPattern = regexp.MustCompile(`(?m)^### Case\s+\d+:`)
	gptImage2PromptPattern      = regexp.MustCompile(`(?is)\*\*\s*(?:Prompt|提示词)(?:\s*\d+)?(?:\s*\([^\r\n)]*\))?\s*(?::|：)?\s*\*\*\s*(?::|：)?\s*` + "```" + `[^\r\n]*\r?\n(.*?)\r?\n` + "```")
	gptImage2ImageDirPattern    = regexp.MustCompile(`images/[-\w]+_case\d+`)
	gptImage2SourceURLPattern   = regexp.MustCompile(`https://(?:x\.com|twitter\.com)/[A-Za-z0-9_]+/status/\d+`)
)

type davidWuGptImage2Prompt struct {
	ID         int    `json:"id"`
	TitleEN    string `json:"title_en"`
	TitleCN    string `json:"title_cn"`
	Category   string `json:"category"`
	CategoryCN string `json:"category_cn"`
	Prompt     string `json:"prompt"`
	Note       string `json:"note"`
	Author     string `json:"author"`
	Source     string `json:"source"`
	NeedsRef   bool   `json:"needs_ref"`
	Image      string `json:"image"`
}

func SyncPromptCategory(category string) ([]model.PromptCategory, error) {
	item, found, err := repository.GetPromptCategoryByCode(category)
	if err != nil {
		return nil, err
	}
	if !found {
		return nil, errors.New("未知提示词分类")
	}
	if !item.Remote {
		return nil, errors.New("该分类不支持远程同步")
	}
	items, err := buildPromptCategory(item.Category)
	if err != nil {
		return nil, err
	}
	if err := validatePromptSyncItems(items); err != nil {
		return nil, err
	}
	if err := repository.ReplacePromptCategory(item, items); err != nil {
		return nil, err
	}
	return repository.ListPromptCategories()
}

func buildPromptCategory(category string) ([]model.Prompt, error) {
	switch category {
	case "gpt-image-2-prompts":
		return buildGptImage2Prompts()
	case "awesome-gpt-image":
		return buildAwesomeGptImagePrompts()
	case "awesome-gpt4o-image-prompts":
		return buildAwesomeGpt4oImagePrompts()
	case "youmind-gpt-image-2":
		return buildYouMindGptImage2Prompts()
	case "youmind-nano-banana-pro":
		return buildYouMindNanoBananaProPrompts()
	case "davidwu-gpt-image2-prompts":
		return buildDavidWuGptImage2Prompts()
	}
	return nil, errors.New("未知提示词分类")
}

func fetchText(baseURL, file string) (string, error) {
	request, _ := http.NewRequest(http.MethodGet, baseURL+"/"+file, nil)
	client := http.Client{Timeout: 30 * time.Second}
	response, err := client.Do(request)
	if err != nil {
		return "", err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return "", errors.New(file + " 拉取失败")
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, maxPromptSourceBytes+1))
	if err != nil {
		return "", err
	}
	if len(data) > maxPromptSourceBytes {
		return "", errors.New(file + " 超过远程提示词源大小限制")
	}
	return string(data), nil
}

func validatePromptSyncItems(items []model.Prompt) error {
	if len(items) == 0 {
		return errors.New("远程提示词源解析结果为空，已保留现有数据")
	}
	return nil
}

func buildGptImage2Prompts() ([]model.Prompt, error) {
	cases := map[string]gptImage2Case{}
	raw, err := fetchText(gptImage2RawBase, "data/ingested_tweets.json")
	if err != nil {
		return nil, err
	}
	data := gptImage2Data{}
	if err := json.Unmarshal([]byte(raw), &data); err != nil {
		return nil, err
	}
	for _, file := range gptImage2CaseFiles {
		markdown, err := fetchText(gptImage2RawBase, file)
		if err != nil {
			return nil, err
		}
		collectGptImage2Cases(cases, markdown)
	}
	items := []model.Prompt{}
	for _, item := range data.Records {
		entry := resolveGptImage2Case(cases, item.ImageDir, item.TweetURL)
		if entry.prompt == "" {
			continue
		}
		date := normalizePromptTime(item.AddedAt)
		items = append(items, model.Prompt{ID: "gpt-image-2-prompts-" + leftPad(len(items)+1), Title: item.Title, CoverURL: entry.image, Prompt: entry.prompt, Tags: tagsFromCategory(item.Category), CreatedAt: date, UpdatedAt: date, Preview: markdownPreview([]string{entry.image})})
	}
	return items, nil
}

func resolveGptImage2Case(cases map[string]gptImage2Case, imageDir, sourceURL string) gptImage2Case {
	if item := cases[imageDir]; item.prompt != "" {
		return item
	}
	return cases[sourceURL]
}

func collectGptImage2Cases(cases map[string]gptImage2Case, markdown string) {
	for _, block := range splitGptImage2CaseBlocks(markdown) {
		promptMatch := gptImage2PromptPattern.FindStringSubmatchIndex(block)
		if len(promptMatch) < 4 {
			continue
		}
		prompt := strings.TrimSpace(block[promptMatch[2]:promptMatch[3]])
		metadata := block[:promptMatch[0]]
		images := extractMarkdownImages(gptImage2RawBase, block)
		if prompt == "" || len(images) == 0 {
			continue
		}
		imageDir := gptImage2ImageDirPattern.FindString(block)
		image := images[0]
		for _, candidate := range images {
			if imageDir != "" && strings.Contains(candidate, "/"+imageDir+"/") {
				image = candidate
				break
			}
		}
		entry := gptImage2Case{prompt: prompt, image: image}
		if imageDir != "" {
			cases[imageDir] = entry
		}
		for _, sourceURL := range gptImage2SourceURLPattern.FindAllString(metadata, -1) {
			storeUniqueGptImage2Case(cases, sourceURL, entry)
		}
	}
}

func splitGptImage2CaseBlocks(markdown string) []string {
	headings := gptImage2CaseHeadingPattern.FindAllStringIndex(markdown, -1)
	blocks := make([]string, 0, len(headings))
	for index, heading := range headings {
		end := len(markdown)
		if index+1 < len(headings) {
			end = headings[index+1][0]
		}
		blocks = append(blocks, markdown[heading[0]:end])
	}
	return blocks
}

func storeUniqueGptImage2Case(cases map[string]gptImage2Case, key string, item gptImage2Case) {
	existing, found := cases[key]
	if !found {
		cases[key] = item
		return
	}
	if existing.prompt != item.prompt || existing.image != item.image {
		// 同一推文可能包含多个案例，URL 回退在这种情况下必须失效。
		cases[key] = gptImage2Case{}
	}
}

func buildAwesomeGptImagePrompts() ([]model.Prompt, error) {
	markdown, err := fetchText(awesomeGptImageRawBase, "README.zh-CN.md")
	if err != nil {
		return nil, err
	}
	items := []model.Prompt{}
	for _, section := range splitBeforeHeading(markdown, "## ") {
		tags := tagsFromHeading(firstMatch(section, `(?m)^##\s+(.+)$`))
		for _, block := range splitBeforeHeading(section, "### ") {
			title := strings.TrimSpace(regexp.MustCompile(`\[([^\]]+)]\([^)]+\)`).ReplaceAllString(firstMatch(block, `(?m)^###\s+(.+)$`), "$1"))
			prompt := strings.TrimSpace(firstMatch(block, "(?s)\\*\\*提示词:\\*\\*\\s*\\r?\\n\\s*```[\\w-]*\\r?\\n(.*?)\\r?\\n```"))
			if title == "" || prompt == "" {
				continue
			}
			images := extractMarkdownImages(awesomeGptImageRawBase, block)
			cover := ""
			if len(images) > 0 {
				cover = images[0]
			}
			items = append(items, model.Prompt{ID: "awesome-gpt-image-" + leftPad(len(items)+1), Title: title, CoverURL: cover, Prompt: prompt, Tags: tags, Preview: markdownPreview(images)})
		}
	}
	return items, nil
}

func buildAwesomeGpt4oImagePrompts() ([]model.Prompt, error) {
	markdown, err := fetchText(awesomeGpt4oImagePromptsBase, "README.zh-CN.md")
	if err != nil {
		return nil, err
	}
	items := []model.Prompt{}
	for _, block := range splitBeforeHeading(markdown, "### ") {
		title := strings.TrimSpace(firstMatch(block, `(?m)^###\s+(.+)$`))
		prompt := strings.TrimSpace(firstMatch(block, "(?s)- \\*\\*提示词文本：\\*\\*\\s*`(.*?)`"))
		if title == "" || prompt == "" {
			continue
		}
		images := extractMarkdownImages(awesomeGpt4oImagePromptsBase, block)
		cover := ""
		if len(images) > 0 {
			cover = images[0]
		}
		items = append(items, model.Prompt{ID: "awesome-gpt4o-image-prompts-" + leftPad(len(items)+1), Title: title, CoverURL: cover, Prompt: prompt, Tags: []string{"gpt4o"}, Preview: markdownPreview(images)})
	}
	return items, nil
}

func normalizePromptTime(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	for _, layout := range []string{time.RFC3339Nano, time.RFC3339, time.RFC1123, time.RFC1123Z, "2006-01-02"} {
		if parsed, err := time.Parse(layout, value); err == nil {
			return parsed.Format(time.RFC3339)
		}
	}
	return value
}

func buildYouMindGptImage2Prompts() ([]model.Prompt, error) {
	return buildYouMindPrompts(youMindGptImage2RawBase, "youmind-gpt-image-2", "gpt-image-2")
}

func buildYouMindNanoBananaProPrompts() ([]model.Prompt, error) {
	return buildYouMindPrompts(youMindNanoBananaProRawBase, "youmind-nano-banana-pro", "nano-banana-pro")
}

func buildDavidWuGptImage2Prompts() ([]model.Prompt, error) {
	raw, err := fetchText(davidWuGptImage2RawBase, "prompts.json")
	if err != nil {
		return nil, err
	}
	data := []davidWuGptImage2Prompt{}
	if err := json.Unmarshal([]byte(raw), &data); err != nil {
		return nil, err
	}
	items := []model.Prompt{}
	for _, item := range data {
		title := strings.TrimSpace(item.TitleCN)
		if title == "" {
			title = strings.TrimSpace(item.TitleEN)
		}
		prompt := strings.TrimSpace(item.Prompt)
		if title == "" || prompt == "" {
			continue
		}
		image := absoluteImage(davidWuGptImage2RawBase, item.Image)
		items = append(items, model.Prompt{ID: "davidwu-gpt-image2-prompts-" + leftPad(item.ID), Title: title, CoverURL: image, Prompt: prompt, Tags: davidWuGptImage2Tags(item), Preview: davidWuGptImage2Preview(item, image)})
	}
	return items, nil
}

func buildYouMindPrompts(baseURL, idPrefix, modelTag string) ([]model.Prompt, error) {
	markdown, err := fetchText(baseURL, "README_zh.md")
	if err != nil {
		return nil, err
	}
	items := []model.Prompt{}
	for _, block := range splitBeforeHeading(markdown, "### ") {
		title := strings.TrimSpace(firstMatch(block, `(?m)^###\s+No\.\s*\d+:\s*(.+)$`))
		prompt := strings.TrimSpace(firstMatch(block, "(?s)#### .*?提示词\\s*\\r?\\n\\s*```[\\w-]*\\r?\\n(.*?)\\r?\\n```"))
		if title == "" || prompt == "" {
			continue
		}
		images := extractMarkdownImages(baseURL, block)
		cover := ""
		if len(images) > 0 {
			cover = images[0]
		}
		items = append(items, model.Prompt{ID: idPrefix + "-" + leftPad(len(items)+1), Title: title, CoverURL: cover, Prompt: prompt, Tags: youMindTags(title, modelTag), Preview: markdownPreview(images)})
	}
	return items, nil
}

func splitBeforeHeading(markdown string, prefix string) []string {
	blocks := []string{}
	lines := strings.Split(markdown, "\n")
	current := []string{}
	for _, line := range lines {
		if strings.HasPrefix(line, prefix) && len(current) > 0 {
			blocks = append(blocks, strings.Join(current, "\n"))
			current = []string{}
		}
		current = append(current, line)
	}
	return append(blocks, strings.Join(current, "\n"))
}

func firstMatch(value string, pattern string) string {
	match := regexp.MustCompile(pattern).FindStringSubmatch(value)
	if len(match) > 1 {
		return match[1]
	}
	return ""
}

func tagsFromCategory(category string) []string {
	return splitTags(regexp.MustCompile(`(?i)\s+Cases$`).ReplaceAllString(category, ""), `\s*(&|and)\s*`)
}

func tagsFromHeading(heading string) []string {
	return splitTags(regexp.MustCompile(`[^\p{L}\p{N}/&、与 ]`).ReplaceAllString(heading, ""), `\s*(/|&|、|与)\s*`)
}

func youMindTags(title, modelTag string) []string {
	tags := []string{modelTag}
	parts := strings.SplitN(title, " - ", 2)
	if len(parts) > 1 {
		tags = append(tags, tagsFromHeading(parts[0])...)
	}
	return tags
}

func davidWuGptImage2Tags(item davidWuGptImage2Prompt) []string {
	tags := splitTags(strings.Join([]string{item.CategoryCN, item.Category, item.Author, item.Source}, "/"), `/`)
	if item.NeedsRef {
		tags = append(tags, "需要参考图")
	}
	return tags
}

func davidWuGptImage2Preview(item davidWuGptImage2Prompt, image string) string {
	lines := []string{}
	if item.TitleEN != "" {
		lines = append(lines, item.TitleEN)
	}
	if item.Note != "" {
		lines = append(lines, item.Note)
	}
	if image != "" {
		lines = append(lines, "![]("+image+")")
	}
	return strings.Join(lines, "\n\n")
}

func splitTags(value string, pattern string) []string {
	tags := []string{}
	for _, tag := range regexp.MustCompile(pattern).Split(value, -1) {
		if tag = strings.ToLower(strings.TrimSpace(tag)); tag != "" {
			tags = append(tags, tag)
		}
	}
	return tags
}

func markdownPreview(images []string) string {
	lines := []string{}
	for _, image := range images {
		if image != "" {
			lines = append(lines, "![]("+image+")")
		}
	}
	return strings.Join(lines, "\n\n")
}

func extractMarkdownImages(baseURL string, block string) []string {
	seen := map[string]bool{}
	images := []string{}
	for _, pattern := range []string{`<img[^>]+src="([^"]+)"`, `!\[[^\]]*]\(([^)]+)\)`} {
		for _, match := range regexp.MustCompile(pattern).FindAllStringSubmatch(block, -1) {
			image := absoluteImage(baseURL, match[1])
			if image != "" && !seen[image] {
				seen[image] = true
				images = append(images, image)
			}
		}
	}
	return images
}

func absoluteImage(baseURL, image string) string {
	image = strings.TrimSpace(image)
	if image == "" || strings.HasPrefix(image, "http://") || strings.HasPrefix(image, "https://") {
		return image
	}
	// 远程案例文件位于 cases/，其中的 ../images 实际仍相对仓库根目录。
	for strings.HasPrefix(image, "../") {
		image = strings.TrimPrefix(image, "../")
	}
	image = strings.TrimPrefix(image, "./")
	return strings.TrimRight(baseURL, "/") + "/" + strings.TrimLeft(image, "/")
}

func leftPad(value int) string {
	if value >= 1000 {
		return strconv.Itoa(value)
	}
	text := "000" + strconv.Itoa(value)
	return text[len(text)-3:]
}
