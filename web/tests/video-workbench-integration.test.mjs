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
    assert.match(pageSource, /metadata:\s*\{\s*source:\s*"video-page",\s*prompt:\s*sourcePrompt\s*\}/);
    assert.match(pageSource, /onSaveAsset\(video, result\.prompt\)/);
    assert.match(pageSource, /onSaveAsset\(video, log\.prompt\)/);
    assert.match(pageSource, /videoElementList:\s*await resolveStoredKlingElementList\(normalizedConfig\.videoElementList\)/);
    assert.match(pageSource, /reference\.kind === "image"[\s\S]{0,180}safeResolveImageUrl/);
    assert.match(pageSource, /safeResolveMediaUrl\(reference\.storageKey/);
    assert.match(pageSource, /function isCloudVideo[\s\S]{0,100}storageKey\.startsWith\("server:"\)/);
    assert.match(pageSource, /cloud \? "云端存储" : video\.storageKey \? "本地缓存" : "AI 临时URL"/);
    assert.match(pageSource, /setLogs\(\(value\) => value\.map\(\(item\) => \(item\.id === log\.id \? nextLog : item\)\)\)/);
    assert.match(pageSource, /max-h-\[calc\(100dvh-2\.5rem\)\][^"\n]*overflow-y-auto/);
    assert.match(pageSource, /const seedance = isSeedanceVideoConfig\(\{ \.\.\.configValue, model: modelValue \}\);[\s\S]{0,1800}if \(seedance\) \{/);
    assert.match(pageSource, /filterCurrentModelAudioReferences[\s\S]{0,180}isSeedanceVideoConfig/);
    assert.match(pageSource, /const encodedChannelId = decodeChannelModel\(model\)\?\.channelId/);
    assert.match(pageSource, /for \(const id of \[encodedChannelId, \.\.\.preferredIds\]\)/);
    assert.match(pageSource, /channel\.models\.some\(\(item\) => modelOptionName\(item\) === modelName\)/);
    assert.match(pageSource, /const deletedLogIdsRef = useRef\(new Set<string>\(\)\)/);
    assert.match(pageSource, /const storedLogs = \(await readStoredLogs\(\)\)\.filter\(\(log\) => !deletedLogIdsRef\.current\.has\(log\.id\)\)/);
    assert.match(pageSource, /deletedLogIdsRef\.current\.add\(log\.id\)[\s\S]{0,420}taskControllersRef\.current\.get\(key\)\?\.abort\(\)/);
    assert.match(pageSource, /if \(deletedLogIdsRef\.current\.has\(log\.id\)\) \{[\s\S]{0,160}logStore\.removeItem\(log\.id\)/);
    assert.match(pageSource, /if \(terminal \|\| deletedLogIdsRef\.current\.has\(log\.id\)\)[\s\S]{0,320}taskControllersRef\.current\.delete\(key\)/);
    assert.match(pageSource, /let createdTaskId = "";[\s\S]{0,1800}createdTaskId = created\.task\.id/);
    assert.match(
        pageSource,
        /const cleanupCreatedTask = async \(\) => \{[\s\S]{0,420}taskControllersRef\.current\.delete\(pendingLog\.id\)[\s\S]{0,240}taskControllersRef\.current\.delete\(createdTaskId\)[\s\S]{0,160}workbenchTaskSignals\.delete\(createdTaskId\)[\s\S]{0,180}deleteVideoGenerationTask/,
    );
    assert.match(pageSource, /createdTask = created\.task;[\s\S]{0,160}taskControllersRef\.current\.set\(created\.task\.id, controller\)/);
    assert.match(pageSource, /await saveGenerationLog\(nextLog\);[\s\S]{0,180}deletedLogIdsRef\.current\.has\(pendingLog\.id\)[\s\S]{0,120}await cleanupCreatedTask\(\)[\s\S]{0,120}taskControllersRef\.current\.delete\(pendingLog\.id\)/);
    assert.match(pageSource, /catch \(error\) \{[\s\S]{0,100}await cleanupCreatedTask\(\)[\s\S]{0,120}deletedLogIdsRef\.current\.has\(pendingLog\.id\)/);
});
