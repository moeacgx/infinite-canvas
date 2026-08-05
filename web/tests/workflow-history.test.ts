import assert from "node:assert/strict";
import test from "node:test";

import { serializeWorkflowStoredImage, storeWorkflowGeneratedImages } from "../src/components/workflows/workflow-history.ts";

test("工作流图片先持久化再写入可恢复的历史记录", async () => {
    const calls: string[] = [];
    const [stored] = await storeWorkflowGeneratedImages(
        [{ id: "result-1", dataUrl: "data:image/png;base64,AAAA" }],
        1250,
        async (input) => {
            calls.push(String(input));
            return {
                url: "blob:stored-result",
                storageKey: "image:workflow-result",
                width: 1024,
                height: 1024,
                bytes: 4096,
                mimeType: "image/png",
            };
        },
    );

    assert.deepEqual(calls, ["data:image/png;base64,AAAA"]);
    assert.equal(stored.storageKey, "image:workflow-result");
    assert.equal(stored.durationMs, 1250);

    const serialized = serializeWorkflowStoredImage(stored);
    assert.equal(serialized.dataUrl, "");
    assert.equal(serialized.storageKey, "image:workflow-result");
});
