import assert from "node:assert/strict";
import test from "node:test";

import { useUserStore } from "../src/stores/use-user-store.ts";

const fireflyUrl =
    "https://pre-signed-firefly-prod.s3-accelerate.amazonaws.com/images/0658db8e-f998-4cee-a739-717743b77164?x-resource-length=2809640&X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIARDA3TX66IYNWUJ27%2F20260910%2Fus-west-2%2Fs3%2Faws4_request&X-Amz-Date=20260910T144325Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host&X-Amz-Signature=bf6a0c89af68d2c2f2f6104f715cadfb91b4c1a020478a8cbb80dbab18d6a068";

class FakeImage {
    naturalWidth = 1400;
    naturalHeight = 1050;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(_value: string) {
        queueMicrotask(() => this.onload?.());
    }
}

(globalThis as { Image?: unknown }).Image = FakeImage;

const { uploadImage } = await import("../src/services/image-storage.ts");

test("GPT Firefly 预签名 URL 在代理 401 时仍可作为画布图片保留", async (t) => {
    const originalFetch = globalThis.fetch;
    const originalToken = useUserStore.getState().token;
    t.after(() => {
        globalThis.fetch = originalFetch;
        useUserStore.setState({ token: originalToken });
    });
    useUserStore.setState({ token: "canvas-token" });
    const requested: string[] = [];
    globalThis.fetch = (async (input) => {
        requested.push(String(input));
        return new Response(JSON.stringify({ code: 1, msg: "未登录" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
        });
    }) as typeof fetch;

    const image = await uploadImage(fireflyUrl);

    assert.equal(image.url, fireflyUrl);
    assert.equal(image.storageKey, "");
    assert.ok(image.width > 0);
    assert.ok(image.height > 0);
    assert.ok(requested.some((url) => url.startsWith("/api/proxy-image?url=")));
});

test("未登录时不打需要鉴权的图片代理，直接保留可显示的远程图片地址", async (t) => {
    const originalFetch = globalThis.fetch;
    const originalToken = useUserStore.getState().token;
    t.after(() => {
        globalThis.fetch = originalFetch;
        useUserStore.setState({ token: originalToken });
    });
    useUserStore.setState({ token: "" });
    globalThis.fetch = (async () => {
        throw new Error("未登录时不应请求 /api/proxy-image");
    }) as typeof fetch;

    const image = await uploadImage(fireflyUrl);

    assert.equal(image.url, fireflyUrl);
    assert.equal(image.storageKey, "");
});
