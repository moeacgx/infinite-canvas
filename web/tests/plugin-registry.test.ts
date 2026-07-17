import assert from "node:assert/strict";
import test from "node:test";

import { hasUpgrade } from "@/lib/canvas/plugin-registry";

test("官方插件仅在远端语义化版本更高时提示升级", () => {
    assert.equal(hasUpgrade("1.1.0", "1.1.1"), true);
    assert.equal(hasUpgrade("1.2.1", "1.2.1"), false);
    assert.equal(hasUpgrade("2.0.0", "1.9.9"), false);
});
