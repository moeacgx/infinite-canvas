import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const imageSource = readFileSync(new URL("../src/app/(user)/image/page.tsx", import.meta.url), "utf8");
const videoSource = readFileSync(new URL("../src/app/(user)/video/page.tsx", import.meta.url), "utf8");
const navigationSource = readFileSync(new URL("../src/constant/navigation-tools.ts", import.meta.url), "utf8");
const agentSiteToolsSource = readFileSync(new URL("../src/lib/agent/agent-site-tools.ts", import.meta.url), "utf8");

test("生图和视频工作台默认使用底部布局并持久化用户选择", () => {
    for (const [source, key, title] of [
        [imageSource, "infinite-canvas:image-workbench-layout", "生图工作台"],
        [videoSource, "infinite-canvas:video-workbench-layout", "视频创作台"],
    ]) {
        assert.match(source, /useState<WorkbenchLayout>\("bottom"\)/);
        assert.match(source, new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
        assert.match(source, /window\.localStorage\.getItem\(WORKBENCH_LAYOUT_KEY\)/);
        assert.match(source, /window\.localStorage\.setItem\(WORKBENCH_LAYOUT_KEY, layout\)/);
        assert.match(source, /workbenchLayout === "bottom" \? "h-full overflow-y-auto pb-56 sm:pb-52"/);
        assert.match(source, /nativeEvent\.isComposing/);
        assert.match(source, /切换到侧边工作台/);
        assert.match(source, new RegExp(title));
    }
});

test("独立 AI 对话与 Prompt Skill 入口已移除，画布助手能力不受影响", () => {
    assert.doesNotMatch(navigationSource, /slug:\s*"chat"/);
    assert.doesNotMatch(navigationSource, /AI 对话/);
    assert.doesNotMatch(agentSiteToolsSource, /\|chat\)/);
    assert.equal(existsSync(new URL("../src/app/(user)/chat/page.tsx", import.meta.url)), false);
    assert.equal(existsSync(new URL("../src/app/(admin)/admin/prompt-skills/page.tsx", import.meta.url)), false);
    assert.equal(existsSync(new URL("../src/components/agent/agent-panel.tsx", import.meta.url)), true);
    assert.equal(existsSync(new URL("../src/app/(user)/canvas/components/canvas-assistant-panel.tsx", import.meta.url)), true);
});
