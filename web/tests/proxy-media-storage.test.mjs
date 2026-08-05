import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { downloadRemoteImage } from "../src/services/image-storage.ts";
import { useUserStore } from "../src/stores/use-user-store.ts";

const source = await readFile(new URL("../src/services/file-storage.ts", import.meta.url), "utf8");
const panoramaSource = await readFile(new URL("../src/app/(user)/canvas/components/canvas-panorama-viewer.tsx", import.meta.url), "utf8");

test("远程视频和音频使用独立安全媒体代理", () => {
    assert.match(source, /fetch\(getMediaProxyUrl\(url\),\s*\{/);
    assert.match(source, /Authorization: `Bearer \$\{token\}`/);
    assert.match(source, /\/api\/proxy-media\?url=/);
    assert.doesNotMatch(source, /fetch\(getProxyUrl\(url\)\)/);
});

test("远程图片下载使用图片代理且拒绝非图片响应", async (t) => {
    const requests = [];
    const originalFetch = globalThis.fetch;
    const originalToken = useUserStore.getState().token;
    t.after(() => {
        globalThis.fetch = originalFetch;
        useUserStore.setState({ token: originalToken });
    });
    useUserStore.setState({ token: "proxy-test-token" });
    globalThis.fetch = async (input, init) => {
        requests.push({ url: String(input), authorization: new Headers(init?.headers).get("Authorization") });
        return new Response(new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: "image/png" }), {
            status: 200,
            headers: { "Content-Type": "image/png" },
        });
    };

    const blob = await downloadRemoteImage("https://example.com/source.png");
    assert.equal(blob.type, "image/png");
    assert.deepEqual(requests, [{ url: "/api/proxy-image?url=https%3A%2F%2Fexample.com%2Fsource.png", authorization: "Bearer proxy-test-token" }]);

    globalThis.fetch = async () => new Response("plain text", { status: 200, headers: { "Content-Type": "text/plain" } });
    await assert.rejects(() => downloadRemoteImage("https://example.com/not-an-image"), /不是图片/);
});

test("全景查看器先授权下载代理图片再创建临时地址", () => {
    assert.match(panoramaSource, /downloadRemoteImage\(src\)/);
    assert.match(panoramaSource, /URL\.createObjectURL\(blob\)/);
    assert.match(panoramaSource, /URL\.revokeObjectURL\(objectUrl\)/);
    assert.doesNotMatch(panoramaSource, /getProxyUrl\(src\)/);
});
