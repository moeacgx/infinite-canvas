import localforage from "localforage";

import type { PluginStorage } from "@/types/canvas-plugin";

type Handler = (payload: unknown) => void;
const handlers = new Map<string, Set<Handler>>();

export function emitCanvasEvent(event: string, payload?: unknown) {
    handlers.get(event)?.forEach((handler) => {
        try {
            handler(payload);
        } catch (error) {
            console.error(`[canvas-event] ${event} 处理失败`, error);
        }
    });
}

export function onCanvasEvent(event: string, handler: Handler) {
    let listeners = handlers.get(event);
    if (!listeners) {
        listeners = new Set();
        handlers.set(event, listeners);
    }
    listeners.add(handler);
    return () => listeners?.delete(handler);
}

const stores = new Map<string, LocalForage>();

export function createPluginStorage(pluginId: string): PluginStorage {
    let store = stores.get(pluginId);
    if (!store) {
        const storeName = `plugin_${pluginId.replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 80)}`;
        store = localforage.createInstance({ name: "infinite-canvas-plugins", storeName });
        stores.set(pluginId, store);
    }
    return {
        get: (key) => store!.getItem(key),
        set: async (key, value) => void (await store!.setItem(key, value)),
        remove: async (key) => void (await store!.removeItem(key)),
    };
}
