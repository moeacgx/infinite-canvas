import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { prepareCodexTurnInput } from "../src/app/(user)/canvas/agent/codex-turn-input.ts";

const signal = () => new AbortController().signal;
const image = (url: string) => ({ type: "image_url" as const, image_url: { url } });
function browserGlobal(t: TestContext, name: string, value: unknown) {
    const original = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    t.after(() => {
        if (original) Object.defineProperty(globalThis, name, original);
        else Reflect.deleteProperty(globalThis, name);
    });
}

test("文本、小图和远程图片保留内容及顺序", async () => {
    assert.deepEqual(await prepareCodexTurnInput("你好", signal()), [{ type: "text", text: "你好" }]);
    assert.deepEqual(await prepareCodexTurnInput([
        image("data:image/png;base64,abc"), { type: "text", text: "附件标识" }, image("https://example.com/image.png"),
    ], signal()), [
        { type: "image", url: "data:image/png;base64,abc" }, { type: "text", text: "附件标识" }, { type: "image", url: "https://example.com/image.png" },
    ]);
});

test("大图使用等比例发送副本，保留原图并释放位图", async (t) => {
    const source = image("data:image/png;base64," + "A".repeat(22 * 1024 * 1024));
    const dimensions: number[][] = [];
    let closed = false;
    const canvas = {
        width: 0, height: 0,
        getContext: () => ({ drawImage: (_bitmap: unknown, _x: number, _y: number, width: number, height: number) => dimensions.push([width, height]) }),
        toDataURL: () => "data:image/webp;base64,small",
    };
    t.mock.method(globalThis, "fetch", async () => new Response(new Blob(["图片"])));
    browserGlobal(t, "createImageBitmap", async () => ({ width: 8192, height: 4096, close: () => { closed = true; } }));
    browserGlobal(t, "document", { createElement: () => canvas });
    const result = await prepareCodexTurnInput([source], signal());
    assert.deepEqual(result, [{ type: "image", url: "data:image/webp;base64,small" }]);
    assert.deepEqual(dimensions, [[2048, 1024]]);
    assert.ok(source.image_url.url.length > 20 * 1024 * 1024);
    assert.equal(closed, true);
});

test("多图按总预算继续缩小，避免单张均合规但总和超限", async (t) => {
    let renders = 0;
    const canvas = {
        width: 0, height: 0,
        getContext: () => ({ drawImage: () => {} }),
        toDataURL: () => {
            renders += 1;
            return "data:image/webp;base64," + "A".repeat(canvas.width > 1024 ? 2 * 1024 * 1024 : 512 * 1024);
        },
    };
    t.mock.method(globalThis, "fetch", async () => new Response(new Blob(["图片"])));
    browserGlobal(t, "createImageBitmap", async () => ({ width: 4096, height: 2048, close: () => {} }));
    browserGlobal(t, "document", { createElement: () => canvas });
    const content = Array.from({ length: 12 }, () => image("data:image/png;base64," + "A".repeat(2 * 1024 * 1024)));
    const result = await prepareCodexTurnInput(content, signal());
    assert.equal(result.length, 12);
    assert.equal(renders, 24);
    assert.ok(new Blob([JSON.stringify(result)]).size < 16 * 1024 * 1024);
});

test("解码期间取消时释放位图，不返回可发送的输入", async (t) => {
    const controller = new AbortController();
    let closed = false;
    t.mock.method(globalThis, "fetch", async () => new Response(new Blob(["图片"])));
    browserGlobal(t, "createImageBitmap", async () => {
        controller.abort();
        return { close: () => { closed = true; } };
    });
    await assert.rejects(prepareCodexTurnInput([image("data:image/png;base64," + "A".repeat(3 * 1024 * 1024))], controller.signal), { name: "AbortError" });
    assert.equal(closed, true);
});
