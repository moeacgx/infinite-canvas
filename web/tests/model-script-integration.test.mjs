import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const editor = read("../src/components/layout/model-script-editor.tsx");
const configModal = read("../src/components/layout/app-config-modal.tsx");
const image = read("../src/services/api/image.ts");
const video = read("../src/services/api/video.ts");
const audio = read("../src/services/api/audio.ts");

test("本地渠道提供按模型和能力配置脚本的安全编辑器", () => {
    assert.match(configModal, /<ModelScriptEditor/);
    assert.match(configModal, /saveModelScript/);
    assert.match(editor, /PLUGIN_TEMPLATES/);
    assert.match(editor, /CSP Worker/);
    assert.match(editor, /我理解脚本会使用当前渠道 API Key/);
    assert.match(editor, /MAX_SCRIPT_LENGTH = 100_000/);
});

test("图片、视频和音频入口都接入自定义脚本", () => {
    for (const source of [image, video, audio]) {
        assert.match(source, /resolveModelScript/);
        assert.match(source, /runModelPlugin/);
    }
    assert.match(video, /pluginVideoResults\.delete/);
    assert.match(image, /downloadLocalImageContent/);
    assert.match(image, /requestGeneration[\s\S]*signal:\s*options\?\.signal/);
    assert.match(image, /requestEdit[\s\S]*signal:\s*options\?\.signal/);
    assert.match(audio, /pcm16ToWav/);
    assert.match(audio, /channelAxiosRequest<Blob>/);
});
