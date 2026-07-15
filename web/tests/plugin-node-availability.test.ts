import assert from "node:assert/strict";
import test from "node:test";

import { isKnownNodeType, registerNodeDefinitions, unregisterPluginNodes } from "@/lib/canvas/node-registry";

test("缺失插件节点不会被当成可用节点，重新注册后可恢复", () => {
    const pluginId = "availability-test";
    const type = `${pluginId}:node`;
    assert.equal(isKnownNodeType("text"), true);
    assert.equal(isKnownNodeType(type), false);

    registerNodeDefinitions([{ type, title: "测试节点", defaultSize: { width: 320, height: 240 } }], pluginId);
    assert.equal(isKnownNodeType(type), true);

    unregisterPluginNodes(pluginId);
    assert.equal(isKnownNodeType(type), false);
});
