package service

import (
	"fmt"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/basketikun/infinite-canvas/model"
)

func TestCollectGptImage2CasesSupportsTigerPromptLabels(t *testing.T) {
	labels := []string{"**Prompt:**", "**Prompt**:", "**提示词:**", "**提示词：**", "**Prompt 1:**", "**Prompt 1 (Beach cafe):**"}
	for index, label := range labels {
		t.Run(label, func(t *testing.T) {
			imageDir := fmt.Sprintf("images/poster_case%d", index+1)
			sourceURL := fmt.Sprintf("https://x.com/example/status/%d", index+1)
			markdown := fmt.Sprintf("### Case %d: 示例\n\n**Source**: [%s](%s)\n\n<img src=\"https://example.com/decoy.jpg\">\n\n%s\n\n```text\n提示词 %d\n```\n\n<img src=\"../%s/output1.webp\" width=\"500\">\n", index+1, sourceURL, sourceURL, label, index+1, imageDir)
			cases := map[string]gptImage2Case{}

			collectGptImage2Cases(cases, markdown)

			item := cases[imageDir]
			if item.title != "示例" {
				t.Fatalf("title = %q", item.title)
			}
			if item.prompt != fmt.Sprintf("提示词 %d", index+1) {
				t.Fatalf("prompt = %q", item.prompt)
			}
			wantImage := gptImage2RawBase + "/" + imageDir + "/output1.webp"
			if item.image != wantImage {
				t.Fatalf("image = %q, want %q", item.image, wantImage)
			}
			if cases[sourceURL] != item {
				t.Fatalf("source URL fallback was not indexed")
			}
		})
	}
}

func TestGptImage2CaseTitleRemovesMarkdownSourceAndByline(t *testing.T) {
	block := "### Case 12: [电影感海报](https://x.com/example/status/12) (by [@example](https://x.com/example))\n"
	title := gptImage2CaseTitle(block)
	if title != "电影感海报" {
		t.Fatalf("case title = %q", title)
	}
	if got := gptImage2PromptTitle("", title, 12); got != "电影感海报" {
		t.Fatalf("prompt title = %q", got)
	}
	if got := gptImage2PromptTitle(" JSON 标题 ", "Markdown 标题", 12); got != "JSON 标题" {
		t.Fatalf("record title should win, got %q", got)
	}
	if got := gptImage2PromptTitle("", "", 12); got != "GPT Image 2 Prompt 012" {
		t.Fatalf("fallback title = %q", got)
	}
}

func TestPromptCategorySyncLockSerializesSameCategoryAndCleansUp(t *testing.T) {
	const category = "sync-lock-same-category"
	firstUnlock := lockPromptCategorySync(category)
	firstReleased := false
	defer func() {
		if !firstReleased {
			firstUnlock()
		}
	}()

	secondAcquired := make(chan struct{})
	secondDone := make(chan struct{})
	go func() {
		unlock := lockPromptCategorySync(category)
		close(secondAcquired)
		unlock()
		close(secondDone)
	}()
	waitForPromptCategorySyncLockUsers(t, category, 2)
	select {
	case <-secondAcquired:
		t.Fatal("same-category sync acquired the lock concurrently")
	default:
	}

	firstUnlock()
	firstReleased = true
	select {
	case <-secondAcquired:
	case <-time.After(time.Second):
		t.Fatal("same-category sync did not acquire the released lock")
	}
	select {
	case <-secondDone:
	case <-time.After(time.Second):
		t.Fatal("same-category sync did not finish")
	}
	waitForPromptCategorySyncLockUsers(t, category, 0)
}

func TestPromptCategorySyncLockAllowsDifferentCategories(t *testing.T) {
	const firstCategory = "sync-lock-first-category"
	const secondCategory = "sync-lock-second-category"
	firstUnlock := lockPromptCategorySync(firstCategory)
	firstReleased := false
	defer func() {
		if !firstReleased {
			firstUnlock()
		}
	}()

	secondAcquired := make(chan struct{})
	secondDone := make(chan struct{})
	go func() {
		unlock := lockPromptCategorySync(secondCategory)
		close(secondAcquired)
		unlock()
		close(secondDone)
	}()
	select {
	case <-secondAcquired:
	case <-time.After(time.Second):
		t.Fatal("different-category sync was blocked")
	}
	<-secondDone
	firstUnlock()
	firstReleased = true
	waitForPromptCategorySyncLockUsers(t, firstCategory, 0)
	waitForPromptCategorySyncLockUsers(t, secondCategory, 0)
}

func waitForPromptCategorySyncLockUsers(t *testing.T, category string, want int) {
	t.Helper()
	deadline := time.Now().Add(time.Second)
	for {
		promptCategorySyncLocks.Lock()
		entry := promptCategorySyncLocks.entries[category]
		got := 0
		if entry != nil {
			got = entry.users
		}
		promptCategorySyncLocks.Unlock()
		if got == want {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("sync lock users for %q = %d, want %d", category, got, want)
		}
		time.Sleep(time.Millisecond)
	}
}

func TestResolveGptImage2CasePrefersImageDir(t *testing.T) {
	byImageDir := gptImage2Case{prompt: "正确案例", image: "https://example.com/correct.webp"}
	bySourceURL := gptImage2Case{prompt: "同一推文中的其他案例", image: "https://example.com/wrong.jpg"}
	cases := map[string]gptImage2Case{
		"images/portrait_case336":                   byImageDir,
		"https://x.com/example/status/207978669021": bySourceURL,
	}

	got := resolveGptImage2Case(cases, "images/portrait_case336", "https://x.com/example/status/207978669021")
	if got != byImageDir {
		t.Fatalf("resolved case = %#v, want image_dir match %#v", got, byImageDir)
	}
}

func TestStoreUniqueGptImage2CaseDisablesAmbiguousURLFallback(t *testing.T) {
	cases := map[string]gptImage2Case{}
	url := "https://x.com/example/status/1"
	storeUniqueGptImage2Case(cases, url, gptImage2Case{prompt: "案例一", image: "https://example.com/one.jpg"})
	storeUniqueGptImage2Case(cases, url, gptImage2Case{prompt: "案例二", image: "https://example.com/two.jpg"})

	if got := cases[url]; got.prompt != "" || got.image != "" {
		t.Fatalf("ambiguous URL fallback should be disabled, got %#v", got)
	}
}

func TestValidatePromptSyncItemsRejectsUnsafeResult(t *testing.T) {
	if err := validatePromptSyncItems("awesome-gpt-image", nil); err == nil || !strings.Contains(err.Error(), "已保留现有数据") {
		t.Fatalf("empty sync result error = %v", err)
	}
	if err := validatePromptSyncItems("awesome-gpt-image", []model.Prompt{{ID: "one"}}); err != nil {
		t.Fatalf("non-empty sync result error = %v", err)
	}
	tooFew := make([]model.Prompt, minGptImage2PromptItems-1)
	if err := validatePromptSyncItems("gpt-image-2-prompts", tooFew); err == nil || !strings.Contains(err.Error(), "安全下限") {
		t.Fatalf("small Tiger sync result error = %v", err)
	}
	minimum := make([]model.Prompt, minGptImage2PromptItems)
	if err := validatePromptSyncItems("gpt-image-2-prompts", minimum); err != nil {
		t.Fatalf("minimum Tiger sync result error = %v", err)
	}
}

func TestTigerPromptSourceLive(t *testing.T) {
	if os.Getenv("PROMPT_SYNC_LIVE") != "1" {
		t.Skip("set PROMPT_SYNC_LIVE=1 to verify the remote prompt source")
	}
	items, err := buildGptImage2Prompts()
	if err != nil {
		t.Fatalf("buildGptImage2Prompts returned error: %v", err)
	}
	if len(items) < 850 {
		t.Fatalf("parsed %d prompts, want at least 850", len(items))
	}
	t.Logf("parsed %d prompts from the live Tiger source", len(items))
	var webpURL string
	for _, item := range items {
		if strings.TrimSpace(item.Title) == "" {
			t.Fatalf("prompt %q has an empty title", item.ID)
		}
		if item.CoverURL == "" || !strings.Contains(item.Preview, item.CoverURL) {
			t.Fatalf("prompt %q has invalid preview: cover=%q preview=%q", item.ID, item.CoverURL, item.Preview)
		}
		if strings.HasSuffix(item.CoverURL, "/images/portrait_case336/output1.webp") {
			webpURL = item.CoverURL
		}
	}
	if webpURL == "" {
		t.Fatal("current Tiger data did not include portrait_case336/output1.webp")
	}
	assertRemotePromptImage(t, items[0].CoverURL)
	assertRemotePromptImage(t, webpURL)
}

func assertRemotePromptImage(t *testing.T, imageURL string) {
	t.Helper()
	request, err := http.NewRequest(http.MethodHead, imageURL, nil)
	if err != nil {
		t.Fatalf("build image request: %v", err)
	}
	client := http.Client{Timeout: 15 * time.Second}
	response, err := client.Do(request)
	if err != nil {
		t.Fatalf("request image %s: %v", imageURL, err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		t.Fatalf("image %s returned %s", imageURL, response.Status)
	}
	if contentType := response.Header.Get("Content-Type"); !strings.HasPrefix(contentType, "image/") {
		t.Fatalf("image %s returned content type %q", imageURL, contentType)
	}
}
