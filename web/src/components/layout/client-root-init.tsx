"use client";

import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { App } from "antd";

import { fetchImageModels } from "@/services/api/image";
import { applyFetchedModelsToConfig, type AiConfig, useConfigStore } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";

export function ClientRootInit({ children }: { children: ReactNode }) {
    const { message } = App.useApp();
    const handledConfigParams = useRef(false);
    const pathname = usePathname();
    const hydrateUser = useUserStore((state) => state.hydrateUser);
    const loadPublicSettings = useConfigStore((state) => state.loadPublicSettings);
    const publicSettings = useConfigStore((state) => state.publicSettings);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const isLoginPage = pathname === "/login" || pathname === "/admin/login";

    useEffect(() => {
        void loadPublicSettings();
    }, [loadPublicSettings]);

    useEffect(() => {
        if (!isLoginPage) void hydrateUser();
    }, [hydrateUser, isLoginPage]);

    useEffect(() => {
        if (handledConfigParams.current) return;
        const searchParams = new URLSearchParams(window.location.search);
        const mode = (searchParams.get("mode") || "").trim().toLowerCase();
        const baseUrl = searchParams.get("baseUrl") || searchParams.get("baseurl");
        const apiKey = searchParams.get("apiKey") || searchParams.get("apikey");
        const newApiGroup = searchParams.get("group") || "";
        const newApiTextGroup = searchParams.get("textGroup") || "";
        const newApiImageGroup = searchParams.get("imageGroup") || "";
        const newApiAudioGroup = searchParams.get("audioGroup") || "";
        const newApiVideoGroup = searchParams.get("videoGroup") || "";
        if (mode !== "newapi" && !baseUrl && !apiKey) return;
        if (mode === "newapi" && (!baseUrl || !newApiGroup)) return;
        if (mode !== "newapi" && !publicSettings) return;
        handledConfigParams.current = true;
        searchParams.delete("mode");
        searchParams.delete("group");
        searchParams.delete("textGroup");
        searchParams.delete("imageGroup");
        searchParams.delete("audioGroup");
        searchParams.delete("videoGroup");
        searchParams.delete("baseUrl");
        searchParams.delete("baseurl");
        searchParams.delete("apiKey");
        searchParams.delete("apikey");
        window.history.replaceState(null, "", `${window.location.pathname}${searchParams.size ? `?${searchParams}` : ""}${window.location.hash}`);
        if (mode === "newapi") {
            updateConfig("channelMode", "newapi");
            updateConfig("baseUrl", baseUrl || "");
            updateConfig("newApiGroup", newApiGroup);
            updateConfig("newApiTextGroup", newApiTextGroup);
            updateConfig("newApiImageGroup", newApiImageGroup);
            updateConfig("newApiAudioGroup", newApiAudioGroup);
            updateConfig("newApiVideoGroup", newApiVideoGroup);
            void hydrateNewApiModels({
                baseUrl: baseUrl || "",
                newApiGroup,
                newApiTextGroup,
                newApiImageGroup,
                newApiAudioGroup,
                newApiVideoGroup,
                updateConfig,
                message,
                openConfigDialog,
            });
            return;
        }
        if (!publicSettings) return;
        if (!publicSettings.modelChannel.allowCustomChannel) {
            openConfigDialog(false);
            message.error("后台未允许用户自定义渠道，请联系管理员进行配置");
            return;
        }
        updateConfig("channelMode", "local");
        if (baseUrl) updateConfig("baseUrl", baseUrl);
        if (apiKey) updateConfig("apiKey", apiKey);
        openConfigDialog(false);
    }, [message, openConfigDialog, publicSettings, updateConfig]);

    return <>{children}</>;
}

async function hydrateNewApiModels({
    baseUrl,
    newApiGroup,
    newApiTextGroup,
    newApiImageGroup,
    newApiAudioGroup,
    newApiVideoGroup,
    updateConfig,
    message,
    openConfigDialog,
}: {
    baseUrl: string;
    newApiGroup: string;
    newApiTextGroup: string;
    newApiImageGroup: string;
    newApiAudioGroup: string;
    newApiVideoGroup: string;
    updateConfig: <K extends keyof AiConfig>(key: K, value: AiConfig[K]) => void;
    message: ReturnType<typeof App.useApp>["message"];
    openConfigDialog: (shouldPromptContinue?: boolean) => void;
}) {
    const config = useConfigStore.getState().config;
    const newApiConfig: AiConfig = { ...config, channelMode: "newapi", baseUrl, newApiGroup, newApiTextGroup, newApiImageGroup, newApiAudioGroup, newApiVideoGroup };
    try {
        const models = await fetchImageModels(newApiConfig);
        const nextConfig = applyFetchedModelsToConfig(newApiConfig, models);
        (Object.keys(nextConfig) as Array<keyof AiConfig>).forEach((key) => {
            if (newApiConfig[key] !== nextConfig[key]) updateConfig(key, nextConfig[key]);
        });
    } catch (error) {
        openConfigDialog(false);
        message.error(error instanceof Error ? error.message : "读取模型失败");
    }
}
