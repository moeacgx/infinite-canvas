import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createModelChannel, defaultConfig, encodeChannelModel, resolveCapabilityModel, resolveImageChannelOptions, withLocalChannels } from "../src/stores/use-config-store.ts";
import { buildWorkflowRunConfig, resolveWorkflowRuntime } from "../src/components/workflows/workflow-runtime.ts";

const imagePageSource = readFileSync(new URL("../src/app/(user)/image/page.tsx", import.meta.url), "utf8");
const workflowSource = readFileSync(new URL("../src/components/workflows/creative-workflow-workspace.tsx", import.meta.url), "utf8");

test("生图工作台按编码模型选择正确渠道并隔离 Images 与 Responses 配置", () => {
    const channels = [createModelChannel({ id: "images", models: ["gpt-image-1"], imageApiMode: "images" }), createModelChannel({ id: "responses", models: ["gpt-image-1", "gpt-5.6"], imageApiMode: "responses", responsesImageModel: "gpt-5.6" })];
    const selectedModel = encodeChannelModel("responses", "gpt-image-1");
    const config = {
        ...withLocalChannels({ ...defaultConfig, channelMode: "local" }, channels),
        imageModel: selectedModel,
        imageChannelId: "responses",
    };

    assert.equal(resolveCapabilityModel(config, "image"), selectedModel);
    assert.equal(resolveImageChannelOptions(config, selectedModel).apiMode, "responses");
    assert.equal(resolveImageChannelOptions(config, encodeChannelModel("images", "gpt-image-1")).apiMode, "images");
});

test("工作流兼容旧的裸模型名，并把模板 API 参数应用到对应本地渠道", () => {
    const channels = [createModelChannel({ id: "images", models: ["gpt-image-1"], imageApiMode: "images" }), createModelChannel({ id: "responses", models: ["gpt-image-1", "gpt-5.6"], imageApiMode: "images", responsesImageModel: "gpt-5.6" })];
    const config = withLocalChannels({ ...defaultConfig, channelMode: "local" }, channels);
    const workflowConfig = {
        model: "gpt-image-1",
        imageModel: "gpt-image-1",
        imageChannelId: "responses",
        quality: "high",
        size: "16:9",
        count: "2",
        background: "transparent",
        apiMode: "responses",
        timeout: "600",
        streamImages: "1",
        streamPartialImages: "3",
        responseFormatB64Json: "",
        codexCli: "",
        systemPrompt: "",
        promptTemplate: "生成 {{subject}}",
        negativePrompt: "",
    };

    const runtime = resolveWorkflowRuntime({ config: workflowConfig }, config);
    assert.equal(runtime.model, encodeChannelModel("responses", "gpt-image-1"));
    assert.equal(runtime.channelId, "responses");
    assert.equal(runtime.apiMode, "responses");

    const runConfig = buildWorkflowRunConfig(config, workflowConfig, runtime);
    assert.equal(runConfig.background, "transparent");
    assert.equal(resolveImageChannelOptions(runConfig, runtime.model).apiMode, "responses");
    assert.equal(resolveImageChannelOptions(runConfig, runtime.model).stream, true);
    assert.equal(resolveImageChannelOptions(runConfig, runtime.model).partialImages, 3);
    assert.equal(resolveImageChannelOptions(runConfig, runtime.model).responseFormatB64Json, false);
    assert.equal(resolveImageChannelOptions(runConfig, encodeChannelModel("images", "gpt-image-1")).apiMode, "images");
});

test("New API 工作流不会误绑定残留的本地渠道", () => {
    const workflowConfig = {
        model: "gpt-image-1",
        imageModel: "gpt-image-1",
        imageChannelId: "legacy-local-channel",
        quality: "auto",
        size: "1:1",
        count: "1",
        background: "",
        apiMode: "images",
        timeout: "600",
        streamImages: "",
        streamPartialImages: "1",
        responseFormatB64Json: "1",
        codexCli: "",
        systemPrompt: "",
        promptTemplate: "生成 {{subject}}",
        negativePrompt: "",
    };
    const config = { ...defaultConfig, channelMode: "newapi", imageModels: ["gpt-image-1"], imageModel: "gpt-image-1" };

    const runtime = resolveWorkflowRuntime({ config: workflowConfig }, config);
    assert.equal(runtime.model, "gpt-image-1");
    assert.equal(runtime.channelId, "");
});

test("生图页保留模型渠道切换、工作流入口与可取消的即时请求链路", () => {
    assert.match(imagePageSource, /useState<WorkbenchLayout>\("bottom"\)/);
    assert.match(imagePageSource, /window\.localStorage\.getItem\(WORKBENCH_LAYOUT_KEY\)/);
    assert.match(imagePageSource, /window\.localStorage\.setItem\(WORKBENCH_LAYOUT_KEY, layout\)/);
    assert.match(imagePageSource, /<ModelPicker[\s\S]*capability="image"[\s\S]*channelId=\{config\.imageChannelId\}/);
    assert.match(imagePageSource, /updateWorkbenchConfig[\s\S]*imageApiMode:\s*apiMode/);
    assert.match(imagePageSource, /decodeChannelModel\(selectedModel\)\?\.channelId/);
    assert.match(imagePageSource, /<Drawer title="创作工作流"[\s\S]*<CreativeWorkflowWorkspace[\s\S]*onWorkflowTaskStarted=\{handleWorkflowTaskStarted\}/);
    assert.match(imagePageSource, /requestEdit\(snapshot\.requestConfig,[\s\S]*\{ signal \}\)/);
    assert.match(imagePageSource, /requestGeneration\(snapshot\.requestConfig,[\s\S]*\{ signal \}\)/);
    assert.match(imagePageSource, /previewGenerationLog[\s\S]*updateConfig\("background", log\.config\.background \|\| ""\)/);
    assert.match(workflowSource, /buildWorkflowRunConfig\(effectiveConfig, workflow\.config, runtime\)/);
});

test("生图结果操作栏在窄屏分行并允许操作按钮换行", () => {
    assert.match(imagePageSource, /mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between/);
    assert.match(imagePageSource, /flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto sm:shrink-0 sm:justify-end/);
});
