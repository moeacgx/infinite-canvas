import assert from "node:assert/strict";
import test from "node:test";

import { isImeComposing, isPlainEnterKey } from "../src/lib/keyboard-event.ts";

type KeyboardEventLike = Parameters<typeof isPlainEnterKey>[0];

function enterEvent(overrides: Partial<KeyboardEventLike> = {}): KeyboardEventLike {
    return { key: "Enter", shiftKey: false, ctrlKey: false, metaKey: false, ...overrides };
}

test("普通 Enter 发送，组合输入和修饰键不发送", () => {
    assert.equal(isPlainEnterKey(enterEvent()), true);
    assert.equal(isPlainEnterKey(enterEvent({ shiftKey: true })), false);
    assert.equal(isPlainEnterKey(enterEvent({ ctrlKey: true })), false);
    assert.equal(isPlainEnterKey(enterEvent({ metaKey: true })), false);
    assert.equal(isPlainEnterKey(enterEvent({ nativeEvent: { isComposing: true } })), false);
    assert.equal(isPlainEnterKey(enterEvent({ nativeEvent: { keyCode: 229 } })), false);
    assert.equal(isPlainEnterKey(enterEvent({ key: "a" })), false);
});

test("兼容现代和旧版 IME 组合输入标记", () => {
    assert.equal(isImeComposing(enterEvent({ isComposing: true })), true);
    assert.equal(isImeComposing(enterEvent({ nativeEvent: { isComposing: true } })), true);
    assert.equal(isImeComposing(enterEvent({ keyCode: 229 })), true);
    assert.equal(isImeComposing(enterEvent({ nativeEvent: { keyCode: 229 } })), true);
    assert.equal(isImeComposing(enterEvent()), false);
});
