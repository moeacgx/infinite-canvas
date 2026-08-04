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

func TestValidatePromptSyncItemsRejectsEmptyResult(t *testing.T) {
	if err := validatePromptSyncItems(nil); err == nil || !strings.Contains(err.Error(), "已保留现有数据") {
		t.Fatalf("empty sync result error = %v", err)
	}
	if err := validatePromptSyncItems([]model.Prompt{{ID: "one"}}); err != nil {
		t.Fatalf("non-empty sync result error = %v", err)
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
