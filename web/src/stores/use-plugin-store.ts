import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { localForageStorage } from "@/lib/localforage-storage";

export type InstalledPlugin = {
    id: string;
    name: string;
    version: string;
    description?: string;
    url: string;
    source: string;
    enabled: boolean;
    local?: boolean;
    official?: boolean;
    installedAt: string;
};

type PluginStore = {
    plugins: InstalledPlugin[];
    upsert: (plugin: Omit<InstalledPlugin, "installedAt"> & { installedAt?: string }) => void;
    setEnabled: (id: string, enabled: boolean) => void;
    remove: (id: string) => void;
};

export const usePluginStore = create<PluginStore>()(
    persist(
        (set) => ({
            plugins: [],
            upsert: (plugin) =>
                set((state) => {
                    const next = { ...plugin, installedAt: plugin.installedAt || new Date().toISOString() };
                    return { plugins: state.plugins.some((item) => item.id === plugin.id) ? state.plugins.map((item) => (item.id === plugin.id ? next : item)) : [next, ...state.plugins] };
                }),
            setEnabled: (id, enabled) => set((state) => ({ plugins: state.plugins.map((item) => (item.id === id ? { ...item, enabled } : item)) })),
            remove: (id) => set((state) => ({ plugins: state.plugins.filter((item) => item.id !== id) })),
        }),
        { name: "infinite-canvas:plugin_store", storage: createJSONStorage(() => localForageStorage) },
    ),
);
