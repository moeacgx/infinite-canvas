import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pageSource = readFileSync(new URL("../src/app/(user)/video/page.tsx", import.meta.url), "utf8");

test("视频工作台保留请求语义和原有键盘布局回归保护", () => {
    assert.match(pageSource, /createBaseVideoGenerationTask\(config, prompt, normalized, \{ signal: options\.signal \}\)/);
    assert.match(pageSource, /window\.localStorage\.getItem\(WORKBENCH_LAYOUT_KEY\)/);
    assert.match(pageSource, /event\.nativeEvent\.isComposing/);
    assert.match(pageSource, /event\.preventDefault\(\)/);
    assert.match(pageSource, /workbenchLayout === "bottom" \? "h-full overflow-y-auto pb-56 sm:pb-52 lg:pb-52"/);
    assert.match(pageSource, /max=\{maxSeconds\}/);
    assert.match(pageSource, /size: effectiveConfig\.videoSize/);
    assert.match(pageSource, /updateConfig\("videoSize", String\(value\)\)/);
    assert.match(pageSource, /taskControllersRef\.current\.clear\(\);[\s\S]{0,120}workbenchTaskSignals\.clear\(\)/);
    assert.doesNotMatch(pageSource, /Kling v2\.6 音频生成需要 pro 模式/);
});
