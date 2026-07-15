import React from "react";

import { emitCanvasEvent, onCanvasEvent } from "@/lib/canvas/canvas-event-bus";
import type { CanvasPluginApp } from "@/types/canvas-plugin";

export type PluginRuntime = CanvasPluginApp & {
    React: typeof React;
    jsx: typeof React.createElement;
    Fragment: typeof React.Fragment;
};

let runtime: PluginRuntime | null = null;

function injectCSS(css: string, key?: string) {
    const id = key ? `canvas-plugin-style-${key}` : undefined;
    if (id) document.getElementById(id)?.remove();
    const style = document.createElement("style");
    if (id) style.id = id;
    style.dataset.canvasPluginStyle = "true";
    style.textContent = css;
    document.head.appendChild(style);
    return () => style.remove();
}

export function getPluginRuntime(): PluginRuntime {
    if (!runtime) {
        runtime = {
            React,
            jsx: React.createElement,
            Fragment: React.Fragment,
            injectCSS,
            version: process.env.NEXT_PUBLIC_APP_VERSION || "dev",
            emit: emitCanvasEvent,
            on: onCanvasEvent,
        };
        (window as unknown as { InfiniteCanvasRuntime?: PluginRuntime }).InfiniteCanvasRuntime = runtime;
    }
    return runtime;
}
