import assert from "node:assert/strict";
import test from "node:test";

import { displayedLatestVersion, isNewerVersion, mergeReleases, type ReleaseInfo } from "@/lib/release";

const release = (version: string): ReleaseInfo => ({ version, date: "", items: [{ type: "新增", content: version }] });

test("版本比较按语义化版本的主次补丁位判断", () => {
    assert.equal(isNewerVersion("v0.9.0", "v0.8.1"), true);
    assert.equal(isNewerVersion("v0.8.2", "v0.8.1"), true);
    assert.equal(isNewerVersion("v0.8.0", "v0.8.1"), false);
    assert.equal(isNewerVersion("invalid", "v0.8.1"), false);
});

test("远端仓库版本落后时仍显示当前 fork 版本", () => {
    assert.equal(displayedLatestVersion("v0.2.6\n", "v0.8.1"), "v0.8.1");
    assert.equal(displayedLatestVersion("v0.9.0", "v0.8.1"), "v0.9.0");
});

test("本地更新日志优先并与远端日志去重合并", () => {
    assert.deepEqual(
        mergeReleases([release("v0.8.0"), release("v0.7.0")], [release("v0.8.1"), release("v0.8.0")]).map((item) => item.version),
        ["v0.8.1", "v0.8.0", "v0.7.0"],
    );
});
