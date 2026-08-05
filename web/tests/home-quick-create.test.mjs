import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const homeSource = readFileSync(new URL("../src/app/(user)/page.tsx", import.meta.url), "utf8");
const carouselSource = readFileSync(new URL("../src/app/(user)/home-banner-carousel.tsx", import.meta.url), "utf8");
const composerSource = readFileSync(new URL("../src/app/(user)/canvas/components/canvas-assistant-composer.tsx", import.meta.url), "utf8");
const assistantPanelSource = readFileSync(new URL("../src/app/(user)/canvas/components/canvas-assistant-panel.tsx", import.meta.url), "utf8");
const agentRuntimeSource = readFileSync(new URL("../src/app/(user)/canvas/agent/canvas-agent-runtime.ts", import.meta.url), "utf8");
const canvasClientSource = readFileSync(new URL("../src/app/(user)/canvas/[id]/canvas-client-page.tsx", import.meta.url), "utf8");
const configStoreSource = readFileSync(new URL("../src/stores/use-config-store.ts", import.meta.url), "utf8");

test("首页展示三联媒体轮播并保留移动端滑动布局", () => {
    assert.match(homeSource, /<HomeBannerCarousel banners=\{HOME_BANNERS\}/);
    assert.match(homeSource, /agent\.webm/);
    assert.match(homeSource, /panorama\.webp/);
    assert.match(homeSource, /3ddirector\.webp/);
    assert.match(carouselSource, /data-banner-offset/);
    assert.match(carouselSource, /@media \(max-width: 639px\)/);
    assert.match(carouselSource, /<video[\s\S]*controls[\s\S]*autoPlay/);
});

test("首页快速创作进入画布 Agent，由 Agent 自动选择图片、视频或画布操作", () => {
    assert.match(homeSource, /<CanvasAssistantComposer/);
    assert.match(homeSource, /createProject\(title,\s*\{[\s\S]*agentConfig,[\s\S]*pendingAgentRequest:\s*\{\s*prompt:\s*text,\s*assets:\s*pendingAssets\s*\}/);
    assert.match(homeSource, /router\.push\(`\/canvas\/\$\{projectId\}`\)/);

    assert.doesNotMatch(homeSource, /quickMode|QuickCreateMode/);
    assert.doesNotMatch(homeSource, /dispatchImage|dispatchVideo/);
    assert.doesNotMatch(homeSource, /router\.push\("\/(?:image|video)"\)/);
    assert.doesNotMatch(homeSource, />生成图片<|>生成视频</);
    assert.doesNotMatch(homeSource, /将在工作台中继续确认参数|不会直接开始生成/);
});

test("首页 Agent 输入框同时提供素材、图片参数、视频参数和可见发送箭头", () => {
    assert.match(homeSource, /references=\{pendingAssets\.map/);
    assert.match(homeSource, /onOpenUpload=\{\(\) => uploadInputRef\.current\?\.click\(\)\}/);
    assert.match(homeSource, /<AssetPickerModal/);
    assert.match(homeSource, /accept="image\/\*,video\/\*,audio\/\*"/);

    assert.match(composerSource, /label:\s*"上传文件"/);
    assert.match(composerSource, /label:\s*"我的素材"/);
    assert.match(composerSource, /<ImageSettingsPanel/);
    assert.match(composerSource, /<VideoSettingsPanel/);
    assert.match(composerSource, /<ModelPicker/);
    assert.match(composerSource, /接口模式/);
    assert.match(composerSource, /<Button\s+[^>]*type="primary"[^>]*shape="circle"/);
    assert.match(composerSource, /aria-label=\{isRunning \? "停止" : "发送"\}/);
    assert.match(composerSource, /<ArrowUp className="size-4"/);
    assert.match(composerSource, /event\.nativeEvent\.isComposing/);
});

test("首页请求由真实画布 Agent 单次消费且不覆盖现有扩展能力", () => {
    assert.match(canvasClientSource, /buildCanvasAgentContext\(/);
    assert.match(canvasClientSource, /const executeCanvasAgentAction = useCallback/);
    assert.match(canvasClientSource, /pendingAgentRequest/);
    assert.match(canvasClientSource, /updateProject\(projectId, \{ pendingAgentRequest: undefined \}\)/);
    assert.match(canvasClientSource, /getAgentContext=\{getCanvasAgentContext\}/);
    assert.match(canvasClientSource, /onExecuteAction=\{executeCanvasAgentAction\}/);
    assert.match(canvasClientSource, /initialRequest=\{initialAgentRequest\}/);

    assert.match(canvasClientSource, /useCanvasAgentStore/);
    assert.match(canvasClientSource, /applyCanvasAgentOps/);
    assert.match(canvasClientSource, /<CanvasPluginManagerModal/);
});

test("首页素材会先全部解析且按稳定节点 ID 幂等插入", () => {
    assert.match(homeSource, /uploadingCountRef\.current/);
    assert.match(homeSource, /submitDisabled=\{submitting \|\| uploadingCount > 0\}/);
    assert.match(homeSource, /素材仍在上传，请稍后发送/);
    assert.match(canvasClientSource, /const resolvedAssets = await Promise\.all\(/);
    assert.match(canvasClientSource, /for \(const \[index, \{ asset, payload \}\] of resolvedAssets\.entries\(\)\)/);
    assert.match(canvasClientSource, /if \(nodeId && nodesRef\.current\.some\(\(node\) => node\.id === nodeId\)\) return/);
    assert.match(canvasClientSource, /updateProject\(projectId, \{ pendingAgentRequest: undefined \}\)/);
});

test("创作 Agent 保持单飞重试并让未知视觉模型先尝试接收图片", () => {
    assert.match(assistantPanelSource, /const runningRef = useRef\(false\)/);
    assert.match(assistantPanelSource, /if \(!text\.trim\(\) \|\| runningRef\.current\) return/);
    assert.match(assistantPanelSource, /if \(abortRef\.current === controller\) \{[\s\S]*runningRef\.current = false;[\s\S]*setIsRunning\(false\)/);
    assert.match(assistantPanelSource, /<AssistantMessages messages=\{messages\} isRunning=\{isRunning\}/);
    assert.match(assistantPanelSource, /disabled=\{isRunning\}[\s\S]*onClick=\{\(\) => onRetry\(message\)\}/);
    assert.match(assistantPanelSource, /findProtocolTurnStart\(protocolMessages, user\.text\)/);

    assert.match(agentRuntimeSource, /const images = references\.flatMap/);
    assert.doesNotMatch(agentRuntimeSource, /supportsCanvasAgentImageInput/);
});

test("停止创作 Agent 会把取消信号传给当前媒体生成", () => {
    assert.match(assistantPanelSource, /onExecuteAction\(action, messageReferenceNodeIds, controller\.signal\)/);
    assert.match(assistantPanelSource, /imageToDataUrl\(reference, controller\.signal\)/);
    assert.match(canvasClientSource, /handleGenerateNode\(node\.id, mode, prompt, signal\)/);
    assert.match(canvasClientSource, /hydrateNodeGenerationContext\([\s\S]*runController\.signal/);
    assert.match(agentRuntimeSource, /const result = await executeAction\(action\);\s*throwIfAborted\(signal\)/);
    assert.match(agentRuntimeSource, /const results = actions\.length[\s\S]*throwIfAborted\(input\.signal\)/);
    assert.match(canvasClientSource, /status === NODE_STATUS_IDLE\)[\s\S]*code: "generation_canceled"/);
});

test("创作 Agent 不用静态白名单拦截自定义视频模型的声音参数", () => {
    assert.doesNotMatch(canvasClientSource, /supportsVideoAudioGeneration|videoSupportsAudio/);
    assert.match(canvasClientSource, /const generateAudio = typeof args\.generateAudio === "boolean"/);
    assert.match(canvasClientSource, /metadata\.generateAudio = String\(generateAudio\)/);
});

test("Agent 与视频工作台共享独立视频尺寸且不会覆盖图片尺寸", () => {
    assert.match(configStoreSource, /videoSize:\s*string/);
    assert.match(configStoreSource, /videoSize:\s*"1280x720"/);
    assert.match(canvasClientSource, /size:\s*resolvedAgentConfig\.imageSize,[\s\S]*videoSize:\s*resolvedAgentConfig\.videoSize/);
    assert.match(canvasClientSource, /mode === "video" \? \{ \.\.\.agentEffectiveConfig, size: agentEffectiveConfig\.videoSize \}/);
    assert.match(canvasClientSource, /mode === "video" \? config\.videoSize \|\| defaultConfig\.videoSize : config\.size \|\| defaultConfig\.size/);
});
