import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

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
    assert.match(imageSource, /aiRequestConfig\(config,\s*"application\/json",\s*undefined,\s*"image"\)/);
    assert.match(imageSource, /aiRequestConfig\(config,\s*"application\/json",\s*undefined,\s*"text"\)/);
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
    assert.doesNotMatch(source, /available\.has\(model\) && modelMatchesCapability\(model,\s*capability\)/);
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
    assert.match(imageSource, /requestGeneration[\s\S]*assertImageModel\(config\.model\)/);
    assert.match(imageSource, /requestEdit[\s\S]*assertImageModel\(config\.model\)/);
    assert.match(imageSource, /requestImageQuestion[\s\S]*assertImageModel\(config\.model\)/);
});

test("New API image generation submits async task and polls result", () => {
    assert.match(imageSource, /type ImageTaskResponse/);
    assert.match(imageSource, /requestNewApiImageTask/);
    assert.match(imageSource, /aiApiUrl\(config,\s*"\/images\/tasks"\)/);
    assert.match(imageSource, /requestGeneration[\s\S]*isNewApiConfig\(config\)[\s\S]*requestNewApiImageTask\(config,\s*payload\)/);
    assert.match(imageSource, /waitForNewApiImageTask/);
    assert.match(imageSource, /\/images\/tasks\/\$\{encodeURIComponent\(taskId\)\}/);
    assert.match(imageSource, /task\.status === "succeeded"/);
    assert.match(imageSource, /parseImagePayload\(task\.result\)/);
});

test("New API image edits submit async task and polls result", () => {
    assert.match(imageSource, /requestNewApiImageTask/);
    assert.match(imageSource, /requestEdit[\s\S]*isNewApiConfig\(config\)[\s\S]*requestNewApiImageTask\(config,\s*formData,\s*\{ action:\s*"edits" \}\)/);
});

test("Admin public UI switches hide login entry and credit balance displays", () => {
    assert.match(adminSettingsSource, /showLoginEntry/);
    assert.match(adminSettingsSource, /显示前台登录入口/);
    assert.match(adminSettingsSource, /showCreditBalance/);
    assert.match(adminSettingsSource, /显示算力点余额/);
    assert.match(userStatusSource, /showLoginEntry/);
    assert.match(userStatusSource, /!user && showLoginEntry/);
    assert.match(userStatusSource, /showCreditBalance/);
    assert.match(assistantPanelSource, /showCreditBalance/);
    assert.match(nodePromptPanelSource, /showCreditBalance/);
    assert.match(configNodePanelSource, /showCreditBalance/);
});
