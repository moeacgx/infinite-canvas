import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { defaultConfig, resolveCapabilityModel } from "./use-config-store.ts";

const root = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(root, "use-config-store.ts"), "utf8");
const initSource = readFileSync(resolve(root, "../components/layout/client-root-init.tsx"), "utf8");
const adminSettingsSource = readFileSync(resolve(root, "../app/(admin)/admin/settings/page.tsx"), "utf8");
const configModalSource = readFileSync(resolve(root, "../components/layout/app-config-modal.tsx"), "utf8");
const imageSource = readFileSync(resolve(root, "../services/api/image.ts"), "utf8");
const videoSource = readFileSync(resolve(root, "../services/api/video.ts"), "utf8");
const audioSource = readFileSync(resolve(root, "../services/api/audio.ts"), "utf8");
const userStatusSource = readFileSync(resolve(root, "../components/layout/user-status-actions.tsx"), "utf8");
const assistantPanelSource = readFileSync(resolve(root, "../app/(user)/canvas/components/canvas-assistant-panel.tsx"), "utf8");
const nodePromptPanelSource = readFileSync(resolve(root, "../app/(user)/canvas/components/canvas-node-prompt-panel.tsx"), "utf8");
const configNodePanelSource = readFileSync(resolve(root, "../app/(user)/canvas/components/canvas-config-node-panel.tsx"), "utf8");

function sourceSection(value, start, end) {
    const startIndex = value.indexOf(start);
    const endIndex = value.indexOf(end, startIndex + start.length);
    assert.notEqual(startIndex, -1, `缺少源码片段：${start}`);
    assert.notEqual(endIndex, -1, `缺少源码片段：${end}`);
    return value.slice(startIndex, endIndex);
}

test("New API effective config is resolved from fetched models instead of returning raw persisted config", () => {
    assert.match(source, /export function applyFetchedModelsToConfig/);
    assert.match(source, /channelMode === "newapi"[\s\S]*applyFetchedModelsToConfig/);
    assert.match(source, /models:\s*config\.models/);
    assert.match(source, /imageModels:\s*config\.imageModels/);
    assert.match(source, /textModels:\s*config\.textModels/);
    assert.doesNotMatch(source, /channelMode === "local" \|\| channelMode === "newapi" \|\| !modelChannel\)[\s\S]{0,80}return \{ \.\.\.config, channelMode \}/);
});

test("New API launch params fetch models and apply default models automatically", () => {
    assert.match(initSource, /fetchImageModels/);
    assert.match(initSource, /applyFetchedModelsToConfig/);
    assert.match(initSource, /updateConfig\(key,\s*nextConfig\[key\]\)/);
    assert.match(initSource, /mode === "newapi"[\s\S]*fetchImageModels/);
});

test("Admin settings exposes separate channel mode switches", () => {
    assert.match(adminSettingsSource, /allowLocalChannel/);
    assert.match(adminSettingsSource, /允许本地直连/);
    assert.match(adminSettingsSource, /allowNewApiChannel/);
    assert.match(adminSettingsSource, /允许 New API 免 Key/);
    assert.match(adminSettingsSource, /allowRemoteChannel/);
    assert.match(adminSettingsSource, /允许后端渠道/);
});

test("Config modal filters channel modes from admin switches", () => {
    assert.match(configModalSource, /channelModeOptions/);
    assert.match(configModalSource, /channelModeAllowed/);
    assert.match(source, /allowLocalChannel/);
    assert.match(configModalSource, /value:\s*"local"/);
    assert.match(source, /allowNewApiChannel/);
    assert.match(configModalSource, /value:\s*"newapi"/);
    assert.match(source, /allowRemoteChannel/);
    assert.match(configModalSource, /value:\s*"remote"/);
    assert.match(configModalSource, /管理员未开放可用渠道/);
});

test("New API connection state is persisted independently from local channels", () => {
    assert.match(source, /type NewApiConnectionState/);
    assert.match(source, /newApiConnectionState:\s*savedNewApiConnection/);
    assert.match(source, /config:\s*\{ \.\.\.state\.config, \.\.\.savedNewApiConnection, \.\.\.newApiModelState, channelMode: "newapi" \}/);
    assert.match(configModalSource, /setChannelMode\(effectiveMode\)/);
    assert.doesNotMatch(configModalSource, /updateConfig\("channelMode",\s*effectiveMode\)/);
});

test("New API launch params accept optional capability groups", () => {
    assert.match(source, /newApiTextGroup/);
    assert.match(source, /newApiImageGroup/);
    assert.match(source, /newApiAudioGroup/);
    assert.match(source, /newApiVideoGroup/);
    assert.match(initSource, /searchParams\.get\("textGroup"\)/);
    assert.match(initSource, /updateConfig\("newApiTextGroup"/);
    assert.match(initSource, /updateConfig\("newApiImageGroup"/);
    assert.match(initSource, /updateConfig\("newApiAudioGroup"/);
    assert.match(initSource, /updateConfig\("newApiVideoGroup"/);
});

test("New API requests route to capability specific groups", () => {
    assert.match(source, /export function resolveNewApiGroup/);
    assert.match(imageSource, /resolveNewApiGroup/);
    assert.match(imageSource, /aiRequestConfig\((?:config|requestConfig),\s*"application\/json",\s*undefined,\s*"image"\)/);
    assert.match(imageSource, /aiRequestConfig\((?:config|requestConfig),\s*"application\/json",\s*undefined,\s*"text"\)/);
    assert.match(videoSource, /aiRequestConfig\(config,[\s\S]*"video"/);
    assert.match(audioSource, /resolveNewApiGroup\(config,\s*"audio"\)/);
});

test("New API model refresh keeps capability model lists tied to capability groups", () => {
    assert.match(source, /type FetchedModelLists/);
    assert.match(source, /suggestedTextModels/);
    assert.match(source, /suggestedImageModels/);
    assert.match(source, /suggestedVideoModels/);
    assert.match(source, /suggestedAudioModels/);
    assert.match(source, /channelMode === "newapi"[\s\S]*imageModels:\s*config\.imageModels[\s\S]*videoModels:\s*config\.videoModels[\s\S]*textModels:\s*config\.textModels[\s\S]*audioModels:\s*config\.audioModels/);
    assert.match(source, /Array\.isArray\(models\)\s*\?\s*normalizeModelList\(models\)\s*:\s*filterModelsByCapability\(allModels,\s*capability\)/);
    const newApiCapabilityMerge = source.match(/function resolveNextCapabilityModels[\s\S]*?\n}/)?.[0] || "";
    assert.doesNotMatch(newApiCapabilityMerge, /modelMatchesCapability\(model,\s*capability\)/);
    assert.match(imageSource, /textModels,\s*imageModels,\s*videoModels,\s*audioModels/);
    assert.match(imageSource, /async function fetchNewApiGroupModels/);
    assert.match(imageSource, /resolveNewApiGroup\(config,\s*"text"\)/);
    assert.match(imageSource, /resolveNewApiGroup\(config,\s*"image"\)/);
    assert.match(imageSource, /groupModels\.get\(resolveNewApiGroup\(config,\s*"text"\)\)/);
    assert.match(imageSource, /groupModels\.get\(resolveNewApiGroup\(config,\s*"image"\)\)/);
    assert.match(imageSource, /Promise\.all/);
});

test("image and chat requests reject empty models before calling New API", () => {
    assert.match(imageSource, /function assertImageModel/);
    assert.match(imageSource, /if \(!model\.trim\(\)\) throw new Error\("请先选择模型"\)/);
    assert.match(imageSource, /requestGeneration[\s\S]*assertImageModel\(requestConfig\.model\)/);
    assert.match(imageSource, /requestEdit[\s\S]*assertImageModel\(requestConfig\.model\)/);
    assert.match(imageSource, /requestImageQuestion[\s\S]*assertImageModel\(requestConfig\.model\)/);
});

test("image generation and edits use the selected image model instead of stale generic model", () => {
    const config = {
        ...defaultConfig,
        model: "stale-text-model",
        imageModel: "selected-image-model",
        imageModels: ["selected-image-model", "fallback-image-model"],
    };
    assert.equal(resolveCapabilityModel(config, "image"), "selected-image-model");
    assert.equal(resolveCapabilityModel(config, "image", "fallback-image-model"), "fallback-image-model");
    assert.equal(resolveCapabilityModel({ ...config, imageModel: "removed-image-model" }, "image"), "selected-image-model");

    const generationSource = sourceSection(imageSource, "export async function requestGeneration", "async function requestNewApiImageTask");
    const editSource = sourceSection(imageSource, "export async function requestEdit", "export async function requestImageQuestion");
    for (const requestSource of [generationSource, editSource]) {
        assert.match(requestSource, /channelModel\s*=\s*resolveCapabilityModel\(config,\s*"image"\)/);
        assert.match(requestSource, /requestConfig\s*=\s*resolveModelRequestConfig\(config,\s*channelModel\)/);
        assert.doesNotMatch(requestSource, /resolveCapabilityModel\(config,\s*"image",\s*config\.model\)/);
    }
    assert.match(generationSource, /model:\s*requestConfig\.model/);
    assert.doesNotMatch(generationSource, /model:\s*config\.model/);
    assert.match(editSource, /formData\.set\("model",\s*requestConfig\.model\)/);
    assert.doesNotMatch(editSource, /formData\.set\("model",\s*config\.model\)/);
});

test("image workbench snapshots persist the selected image model explicitly", () => {
    const imagePageSource = readFileSync(resolve(root, "../app/(user)/image/page.tsx"), "utf8");
    const snapshotSource = sourceSection(imagePageSource, "const buildRequestSnapshot", "const runGenerationTask");
    assert.match(imagePageSource, /resolveCapabilityModel\(effectiveConfig,\s*"image"\)/);
    assert.match(snapshotSource, /requestModel\s*=\s*resolveCapabilityModel\(baseConfig,\s*"image",/);
    assert.match(snapshotSource, /requestConfig\s*=\s*\{[^}]*model:\s*requestModel,\s*imageModel:\s*requestModel,[^}]*count:\s*"1"/s);
    assert.match(snapshotSource, /displayConfig:\s*buildGenerationLogConfig\(\{\s*\.\.\.requestConfig,\s*count:\s*String\(taskCount\)\s*\}\)/);
    assert.match(imagePageSource, /background:\s*config\.background/);
});

test("canvas creative agent resolves the text model before delegating media tools", () => {
    assert.match(assistantPanelSource, /resolveCapabilityModel/);
    assert.match(assistantPanelSource, /const textModel = resolveCapabilityModel\(effectiveConfig,\s*"text",\s*effectiveConfig\.textModel \|\| effectiveConfig\.model\)/);
    assert.match(assistantPanelSource, /requestConfig[\s\S]*model:\s*textModel,[\s\S]*textModel/);
    assert.match(assistantPanelSource, /runCanvasAgent[\s\S]*onExecuteAction/);
});

test("canvas image nodes ignore stale unavailable saved models", () => {
    const canvasClientSource = readFileSync(resolve(root, "../app/(user)/canvas/[id]/canvas-client-page.tsx"), "utf8");
    assert.match(canvasClientSource, /resolveCapabilityModel/);
    assert.match(canvasClientSource, /function preferredNodeModel/);
    assert.match(canvasClientSource, /node\.metadata\.modelOverride \|\| node\.type === CanvasNodeType\.Config/);
    assert.match(canvasClientSource, /mode !== "image" && !isCanvasImageNodeType\(node\.type\)/);
    assert.match(canvasClientSource, /buildGenerationConfig[\s\S]*resolveCapabilityModel\(config,\s*mode,\s*preferredModel\)/);
    assert.match(canvasClientSource, /function buildSavedImageGenerationConfig/);
    assert.match(canvasClientSource, /buildSavedImageGenerationConfig[\s\S]*resolveCapabilityModel\(config,\s*"image",\s*metadata\.model\)[\s\S]*imageModel:\s*model/);
    assert.doesNotMatch(canvasClientSource, /model:\s*savedImageMetadata\.model \|\| effectiveConfig\.imageModel/);
    assert.match(nodePromptPanelSource, /resolveCapabilityModel/);
    assert.match(nodePromptPanelSource, /modelOverride/);
    assert.match(nodePromptPanelSource, /buildNodeConfig[\s\S]*resolveCapabilityModel\(globalConfig,\s*mode,\s*preferredModel\)/);
    assert.match(configNodePanelSource, /resolveCapabilityModel/);
    assert.match(configNodePanelSource, /modelOverride/);
    assert.match(configNodePanelSource, /buildNodeConfig[\s\S]*resolveCapabilityModel\(globalConfig,\s*mode,\s*node\.metadata\?\.modelOverride \? node\.metadata\?\.model : undefined\)/);
});

test("New API image generation submits async task and polls result", () => {
    assert.match(imageSource, /type ImageTaskResponse/);
    assert.match(imageSource, /requestNewApiImageTask/);
    assert.match(imageSource, /aiApiUrl\(config,\s*"\/images\/tasks"\)/);
    assert.match(imageSource, /requestGeneration[\s\S]*isNewApiConfig\(requestConfig\)[\s\S]*requestNewApiImageTask\(requestConfig,\s*payload(?:,|\))/);
    assert.match(imageSource, /waitForNewApiImageTask/);
    assert.match(imageSource, /\/images\/tasks\/\$\{encodeURIComponent\(taskId\)\}/);
    assert.match(imageSource, /task\.status === "succeeded"/);
    assert.match(imageSource, /parseImagePayload\(task\.result,\s*config(?:,\s*options\?\.signal)?\)/);
    assert.match(imageSource, /resolveImageDataUrl\(item,\s*config(?:,\s*signal)?\)/);
    assert.match(imageSource, /downloadNewApiImageContent/);
    assert.match(imageSource, /newApiCanvasUrl\(config\.baseUrl,\s*path\)/);
    assert.match(imageSource, /responseType:\s*"blob"/);
});

test("New API image edits submit async task and polls result", () => {
    assert.match(imageSource, /requestNewApiImageTask/);
    assert.match(imageSource, /requestEdit[\s\S]*isNewApiConfig\(requestConfig\)[\s\S]*requestNewApiImageTask\(requestConfig,\s*formData,\s*\{ action:\s*"edits" \}(?:,|\))/);
});

test("Admin public UI switches hide login entry and credit balance displays", () => {
    assert.match(adminSettingsSource, /showLoginEntry/);
    assert.match(adminSettingsSource, /显示前台登录入口/);
    assert.match(adminSettingsSource, /showCreditBalance/);
    assert.match(adminSettingsSource, /显示算力点余额/);
    assert.match(userStatusSource, /showLoginEntry/);
    assert.match(userStatusSource, /!user && showLoginEntry/);
    assert.match(userStatusSource, /showCreditBalance/);
    assert.match(nodePromptPanelSource, /showCreditBalance/);
    assert.match(configNodePanelSource, /showCreditBalance/);
});
