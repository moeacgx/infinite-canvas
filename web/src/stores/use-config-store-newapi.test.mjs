import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(root, "use-config-store.ts"), "utf8");
const initSource = readFileSync(resolve(root, "../components/layout/client-root-init.tsx"), "utf8");
const imageSource = readFileSync(resolve(root, "../services/api/image.ts"), "utf8");

test("New API effective config is resolved from fetched models instead of returning raw persisted config", () => {
    assert.match(source, /export function applyFetchedModelsToConfig/);
    assert.match(source, /channelMode === "newapi"[\s\S]*applyFetchedModelsToConfig\([\s\S]*config\.models\)/);
    assert.doesNotMatch(source, /channelMode === "local" \|\| channelMode === "newapi" \|\| !modelChannel\)[\s\S]{0,80}return \{ \.\.\.config, channelMode \}/);
});

test("New API launch params fetch models and apply default models automatically", () => {
    assert.match(initSource, /fetchImageModels/);
    assert.match(initSource, /applyFetchedModelsToConfig/);
    assert.match(initSource, /updateConfig\(key,\s*nextConfig\[key\]\)/);
    assert.match(initSource, /mode === "newapi"[\s\S]*fetchImageModels/);
});

test("image and chat requests reject empty models before calling New API", () => {
    assert.match(imageSource, /function assertImageModel/);
    assert.match(imageSource, /if \(!model\.trim\(\)\) throw new Error\("请先选择模型"\)/);
    assert.match(imageSource, /requestGeneration[\s\S]*assertImageModel\(config\.model\)/);
    assert.match(imageSource, /requestEdit[\s\S]*assertImageModel\(config\.model\)/);
    assert.match(imageSource, /requestImageQuestion[\s\S]*assertImageModel\(config\.model\)/);
});
