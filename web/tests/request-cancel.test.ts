import assert from "node:assert/strict";
import test from "node:test";

import axios from "axios";

import { isRequestCanceled, readApiErrorMessage, readAxiosError } from "@/services/api/ai-utils";

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

test("读取 New API 任务接口的顶层错误消息", () => {
    assert.equal(readApiErrorMessage({ code: "invalid_api_platform", message: "invalid api platform: 48" }), "invalid api platform: 48");
    assert.equal(readApiErrorMessage({ error: { message: "渠道余额不足" } }), "渠道余额不足");
    assert.equal(readApiErrorMessage('{"msg":"分组不可用"}'), "分组不可用");
});

test("Axios 任务错误优先展示服务端真实消息", () => {
    const error = new axios.AxiosError("Request failed", "ERR_BAD_REQUEST", undefined, undefined, {
        data: { code: "invalid_api_platform", message: "invalid api platform: 48" },
        status: 400,
        statusText: "Bad Request",
        headers: {},
        config: { headers: new axios.AxiosHeaders() },
    });
    assert.equal(readAxiosError(error, "视频任务创建失败"), "invalid api platform: 48");
});
