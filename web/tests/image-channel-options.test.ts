import assert from "node:assert/strict";
import test from "node:test";

import { createModelChannel, defaultConfig, encodeChannelModel, resolveImageChannelOptions, withLocalChannels } from "../src/stores/use-config-store.ts";

test("旧本地渠道继续使用 Images API 和 Base64 非流式返回", () => {
    const channel = createModelChannel({ id: "legacy", models: ["image-model"] });
    const config = withLocalChannels({ ...defaultConfig, channelMode: "local" }, [channel]);
    assert.deepEqual(resolveImageChannelOptions(config, encodeChannelModel("legacy", "image-model")), {
        apiMode: "images",
        responsesModel: "",
        stream: false,
        partialImages: 1,
        responseFormatB64Json: true,
    });
});

test("图片协议设置按本地渠道隔离并归一化中间图数量", () => {
    const channels = [
        createModelChannel({ id: "responses", models: ["same-model", "gpt-5.6"], imageApiMode: "responses", responsesImageModel: "gpt-5.6", streamImages: true, streamPartialImages: 9, responseFormatB64Json: false }),
        createModelChannel({ id: "images", models: ["same-model"], imageApiMode: "images" }),
    ];
    const config = withLocalChannels({ ...defaultConfig, channelMode: "local" }, channels);
    assert.deepEqual(resolveImageChannelOptions(config, encodeChannelModel("responses", "same-model")), {
        apiMode: "responses",
        responsesModel: "gpt-5.6",
        stream: true,
        partialImages: 3,
        responseFormatB64Json: false,
    });
    assert.equal(resolveImageChannelOptions(config, encodeChannelModel("images", "same-model")).apiMode, "images");
});

test("Responses 主模型不会混入生图模型分类", () => {
    const channel = createModelChannel({
        id: "responses",
        models: ["gpt-image-2", "gpt-5.6"],
        imageApiMode: "responses",
        responsesImageModel: "gpt-5.6",
    });
    const imageModel = encodeChannelModel("responses", "gpt-image-2");
    const textModel = encodeChannelModel("responses", "gpt-5.6");
    const config = withLocalChannels(
        {
            ...defaultConfig,
            channelMode: "local",
            imageModels: [imageModel, textModel],
        },
        [channel],
    );

    assert.deepEqual(config.imageModels, [imageModel]);
    assert.equal(resolveImageChannelOptions(config, imageModel).responsesModel, "gpt-5.6");
});

test("New API 和后端渠道不会读取本地图片协议设置", () => {
    assert.deepEqual(resolveImageChannelOptions({ ...defaultConfig, channelMode: "newapi" }, "image-model"), {
        apiMode: "images",
        responsesModel: "",
        stream: false,
        partialImages: 1,
        responseFormatB64Json: true,
    });
});
