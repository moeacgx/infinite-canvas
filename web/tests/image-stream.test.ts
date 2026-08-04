import assert from "node:assert/strict";
import test from "node:test";

import { parseImagesApiStream, parseResponsesApiStream, parseResponsesImageData } from "../src/services/api/image-stream.ts";

function eventStream(events: unknown[], lineEnding = "\n") {
    const body = events.map((event) => `data: ${JSON.stringify(event)}${lineEnding}${lineEnding}`).join("") + `data: [DONE]${lineEnding}${lineEnding}`;
    return new Response(body, { headers: { "content-type": "text/event-stream; charset=utf-8" } });
}

function chunkedEventStream(chunks: string[]) {
    return new Response(
        new ReadableStream({
            start(controller) {
                const encoder = new TextEncoder();
                chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
                controller.close();
            },
        }),
        { headers: { "content-type": "text/event-stream" } },
    );
}

test("Images API 流按 image_index 保留每张图的最终事件", async () => {
    const parsed = await parseImagesApiStream(
        eventStream(
            [
                { type: "image_generation.partial_image", image_index: 0, b64_json: "PARTIAL-0" },
                { type: "image_generation.partial_image", image_index: 1, b64_json: "PARTIAL-1" },
                { type: "image_generation.completed", image_index: 0, b64_json: "FINAL-0" },
                { type: "image_generation.completed", image_index: 1, b64_json: "FINAL-1" },
            ],
            "\r\n",
        ),
    );

    assert.equal(parsed.resultPayload, null);
    assert.deepEqual(
        parsed.imageItems.map((item) => item.b64_json),
        ["FINAL-0", "FINAL-1"],
    );
});

test("Images API 流优先返回最终 result payload", async () => {
    const result = { object: "image.generation.result", data: [{ b64_json: "FINAL" }] };
    const parsed = await parseImagesApiStream(eventStream([{ image_index: 0, b64_json: "PARTIAL" }, result]));
    assert.deepEqual(parsed.resultPayload, result);
});

test("Images API 标准流事件只返回 completed 最终图", async () => {
    const parsed = await parseImagesApiStream(
        eventStream([
            { type: "image_generation.partial_image", partial_image_index: 0, b64_json: "PARTIAL-0" },
            { type: "image_generation.partial_image", partial_image_index: 1, b64_json: "PARTIAL-1" },
            { type: "image_generation.completed", b64_json: "FINAL" },
        ]),
    );

    assert.deepEqual(
        parsed.imageItems.map((item) => item.b64_json),
        ["FINAL"],
    );
});

test("SSE 分隔符跨网络分片时仍能解析", async () => {
    const parsed = await parseImagesApiStream(chunkedEventStream(['data: {"type":"image_generation.completed",', '"b64_json":"FINAL"}\r\n\r', "\ndata: [DONE]\r\n\r\n"]));

    assert.equal(parsed.imageItems[0]?.b64_json, "FINAL");
});

test("Responses API 解析完整 image_generation_call", () => {
    const images = parseResponsesImageData({
        output: [
            { type: "message", content: [{ type: "output_text", text: "ignore" }] },
            { type: "image_generation_call", result: "AAA=" },
            { type: "image_generation_call", result: { data: "BBB=" } },
            { type: "image_generation_call", result: { url: "https://cdn.example.com/image.png" } },
        ],
    });
    assert.deepEqual(images, ["data:image/png;base64,AAA=", "data:image/png;base64,BBB=", "https://cdn.example.com/image.png"]);
});

test("Responses API 保留中转站返回的相对图片 URL", () => {
    const images = parseResponsesImageData({ output: [{ type: "image_generation_call", result: { url: "/generated/image.png" } }] });
    assert.deepEqual(images, ["/generated/image.png"]);
});

test("Responses API 流优先完整输出并可回退到最后中间图", async () => {
    const completed = await parseResponsesApiStream(
        eventStream([
            { type: "response.image_generation_call.partial_image", output_index: 0, partial_image_b64: "PARTIAL" },
            { type: "response.completed", response: { output: [{ type: "image_generation_call", result: "FINAL" }] } },
        ]),
    );
    assert.deepEqual(completed, ["data:image/png;base64,FINAL"]);

    const partial = await parseResponsesApiStream(
        eventStream([
            { type: "response.image_generation_call.partial_image", output_index: 0, partial_image_b64: "OLD" },
            { type: "response.image_generation_call.partial_image", output_index: 0, partial_image_b64: "LATEST" },
        ]),
    );
    assert.deepEqual(partial, ["data:image/png;base64,LATEST"]);
});

test("流式错误事件返回上游原因", async () => {
    await assert.rejects(() => parseImagesApiStream(eventStream([{ error: { message: "upstream rejected" } }])), /upstream rejected/);
});

test("流式解析失败时主动取消底层 reader", async () => {
    let canceled = false;
    const response = new Response(
        new ReadableStream({
            start(controller) {
                controller.enqueue(new TextEncoder().encode('data: {"error":{"message":"stop"}}\n\n'));
            },
            cancel() {
                canceled = true;
            },
        }),
        { headers: { "content-type": "text/event-stream" } },
    );

    await assert.rejects(() => parseImagesApiStream(response), /stop/);
    assert.equal(canceled, true);
});
