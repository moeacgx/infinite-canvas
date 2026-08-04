import assert from "node:assert/strict";
import test from "node:test";

import axios, { AxiosError } from "axios";

import { isTransientVideoPollError, reachedVideoPollFailureLimit, VIDEO_POLL_TRANSIENT_FAILURE_LIMIT } from "../src/lib/video-polling.ts";

function statusError(status: number) {
    return new AxiosError("Request failed", "ERR_BAD_RESPONSE", {}, undefined, { data: {}, status, statusText: String(status), headers: {}, config: {} as never });
}

test("视频轮询将网络错误和瞬时 HTTP 状态视为可恢复", () => {
    assert.equal(isTransientVideoPollError(new AxiosError("Network Error", "ERR_NETWORK")), true);
    assert.equal(isTransientVideoPollError(statusError(500)), true);
    assert.equal(isTransientVideoPollError(statusError(502)), true);
    assert.equal(isTransientVideoPollError(statusError(503)), true);
    assert.equal(isTransientVideoPollError(statusError(504)), true);
    assert.equal(isTransientVideoPollError(statusError(429)), true);
    assert.equal(isTransientVideoPollError(new Error("无法连接本机 Canvas Agent：Network Error")), true);
});

test("鉴权、参数错误和主动取消不会被轮询容错吞掉", () => {
    assert.equal(isTransientVideoPollError(statusError(400)), false);
    assert.equal(isTransientVideoPollError(statusError(401)), false);
    assert.equal(isTransientVideoPollError(new Error("模型不支持该参数")), false);
    assert.equal(isTransientVideoPollError(new axios.CanceledError("请求已取消")), false);
    const controller = new AbortController();
    controller.abort();
    assert.equal(isTransientVideoPollError(new AxiosError("Network Error", "ERR_NETWORK"), controller.signal), false);
});

test("连续瞬时失败达到上限后终止轮询", () => {
    assert.equal(reachedVideoPollFailureLimit(VIDEO_POLL_TRANSIENT_FAILURE_LIMIT - 1), false);
    assert.equal(reachedVideoPollFailureLimit(VIDEO_POLL_TRANSIENT_FAILURE_LIMIT), true);
});
