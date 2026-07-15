import assert from "node:assert/strict";
import test from "node:test";

import { useWorkbenchAgentStore } from "../src/stores/use-workbench-agent-store.ts";

test("生图工作台命令只允许对应消费者取走", () => {
    useWorkbenchAgentStore.setState({ imageCommand: null, videoCommand: null });
    const id = useWorkbenchAgentStore.getState().dispatchImage({ prompt: "一只橘猫", run: true });
    assert.deepEqual(useWorkbenchAgentStore.getState().imageCommand, { id, prompt: "一只橘猫", run: true });

    useWorkbenchAgentStore.getState().consumeImage("other-command");
    assert.equal(useWorkbenchAgentStore.getState().imageCommand?.id, id);

    useWorkbenchAgentStore.getState().consumeImage(id);
    assert.equal(useWorkbenchAgentStore.getState().imageCommand, null);
});

test("生图和视频命令相互独立", () => {
    useWorkbenchAgentStore.setState({ imageCommand: null, videoCommand: null });
    const imageId = useWorkbenchAgentStore.getState().dispatchImage({ prompt: "图片", run: false });
    const videoId = useWorkbenchAgentStore.getState().dispatchVideo({ prompt: "视频", run: true });

    assert.equal(useWorkbenchAgentStore.getState().imageCommand?.id, imageId);
    assert.equal(useWorkbenchAgentStore.getState().videoCommand?.id, videoId);

    useWorkbenchAgentStore.getState().consumeVideo(videoId);
    assert.equal(useWorkbenchAgentStore.getState().videoCommand, null);
    assert.equal(useWorkbenchAgentStore.getState().imageCommand?.id, imageId);
});
