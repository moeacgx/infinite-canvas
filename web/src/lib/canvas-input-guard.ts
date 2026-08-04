const CANVAS_WHEEL_EXCLUSION_SELECTOR = "[data-canvas-no-zoom],.ant-modal,.ant-popover,.ant-dropdown,.ant-select-dropdown,.ant-picker-dropdown";
const CANVAS_DOUBLE_CLICK_EXCLUSION_SELECTOR = "[data-canvas-no-zoom],[data-node-id],[data-connection-id],[data-connection-create-menu]";

type ClosestTarget = {
    closest: (selector: string) => unknown;
};

function supportsClosest(target: unknown): target is ClosestTarget {
    return target !== null && (typeof target === "object" || typeof target === "function") && "closest" in target && typeof target.closest === "function";
}

function matchesClosest(target: unknown, selector: string): boolean {
    return supportsClosest(target) && Boolean(target.closest(selector));
}

export function shouldIgnoreCanvasWheel(target: unknown): boolean {
    return matchesClosest(target, CANVAS_WHEEL_EXCLUSION_SELECTOR);
}

export function shouldIgnoreCanvasDoubleClick(target: unknown): boolean {
    return matchesClosest(target, CANVAS_DOUBLE_CLICK_EXCLUSION_SELECTOR);
}

export function shouldStopCanvasPan(buttons: number): boolean {
    return buttons === 0;
}
