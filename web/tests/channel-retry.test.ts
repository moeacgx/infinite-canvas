import assert from "node:assert/strict";
import test from "node:test";

import { isRetryableNewApiReadFailure, NEW_API_READ_RETRY_DELAYS_MS } from "../src/services/api/channel-retry.ts";

test("New API 只读请求使用长任务轮询退避窗口", () => {
    assert.deepEqual(NEW_API_READ_RETRY_DELAYS_MS, [2000, 4000, 8000, 10000, 10000]);
});

test("New API 只重试幂等读取的瞬时网络错误", () => {
    assert.equal(isRetryableNewApiReadFailure({ channelMode: "newapi", method: "GET", code: "ERR_NETWORK" }), true);
    assert.equal(isRetryableNewApiReadFailure({ channelMode: "newapi", method: "HEAD", code: "ETIMEDOUT" }), true);
    assert.equal(isRetryableNewApiReadFailure({ channelMode: "newapi", method: "GET", hasResponse: true, status: 502 }), true);
    assert.equal(isRetryableNewApiReadFailure({ channelMode: "newapi", method: "POST", code: "ERR_NETWORK" }), false);
    assert.equal(isRetryableNewApiReadFailure({ channelMode: "newapi", method: "GET", code: "ERR_CANCELED", aborted: true }), false);
    assert.equal(isRetryableNewApiReadFailure({ channelMode: "local", method: "GET", code: "ERR_NETWORK" }), false);
});
