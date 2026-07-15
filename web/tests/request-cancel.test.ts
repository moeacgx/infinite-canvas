import assert from "node:assert/strict";
import test from "node:test";

import axios from "axios";

import { isRequestCanceled } from "@/services/api/ai-utils";

test("识别 AbortSignal 主动取消", () => {
    const controller = new AbortController();
    controller.abort();
    assert.equal(isRequestCanceled(new Error("网络失败"), controller.signal), true);
});

test("识别 Axios 与 DOM 取消错误", () => {
    assert.equal(isRequestCanceled(new axios.CanceledError("已取消")), true);
    assert.equal(isRequestCanceled(new DOMException("已取消", "AbortError")), true);
});

test("普通下载错误不会被误判为取消", () => {
    assert.equal(isRequestCanceled(new Error("下载失败")), false);
});
