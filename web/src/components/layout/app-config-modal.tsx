"use client";

import { App, Button, Form, Input, Modal, Progress, Segmented, Select } from "antd";
import { CircleAlert, Cloud, Plus, RefreshCw, Trash2, Wifi } from "lucide-react";
import { useState } from "react";

import { ModelPicker } from "@/components/model-picker";
import { fetchChannelModels, fetchImageModels } from "@/services/api/image";
import { syncAppDataToWebdav, type AppSyncDomainKey, type AppSyncProgressEvent } from "@/services/app-sync";
import { testWebdavConnection, WEBDAV_MANIFEST_FILE_NAME } from "@/services/webdav-sync";
import { audioFormatOptions, audioVoiceOptions, normalizeAudioSpeedValue } from "@/lib/audio-generation";
import {
    applyFetchedModelsToConfig,
    channelModeAllowed,
    createModelChannel,
    defaultBaseUrlForApiFormat,
    isNewApiConfig,
    modelOptionLabel,
    resolveAllowedChannelMode,
    useConfigStore,
    useEffectiveConfig,
    withLocalChannels,
    type AiConfig,
    type ApiCallFormat,
    type ChannelMode,
    type ModelCapability,
    type ModelChannel,
} from "@/stores/use-config-store";

type ModelGroup = {
    capability: ModelCapability;
    modelKey: "imageModel" | "videoModel" | "textModel" | "audioModel";
    modelsKey: "imageModels" | "videoModels" | "textModels" | "audioModels";
    defaultLabel: string;
    optionsLabel: string;
};

type UpdateAiConfig = <K extends keyof AiConfig>(key: K, value: AiConfig[K]) => void;
type ModelChannelSettings = NonNullable<ReturnType<typeof useConfigStore.getState>["publicSettings"]>["modelChannel"];
type WebdavDomainProgress = {
    label: string;
    stage: string;
    current?: number;
    total?: number;
    status?: "active" | "success" | "exception";
};

const modelGroups: ModelGroup[] = [
    { capability: "image", modelKey: "imageModel", modelsKey: "imageModels", defaultLabel: "默认生图模型", optionsLabel: "生图模型可选项" },
    { capability: "video", modelKey: "videoModel", modelsKey: "videoModels", defaultLabel: "默认视频模型", optionsLabel: "视频模型可选项" },
    { capability: "text", modelKey: "textModel", modelsKey: "textModels", defaultLabel: "默认文本模型", optionsLabel: "文本模型可选项" },
    { capability: "audio", modelKey: "audioModel", modelsKey: "audioModels", defaultLabel: "默认音频模型", optionsLabel: "音频模型可选项" },
];

const apiFormatOptions: Array<{ label: string; value: ApiCallFormat }> = [
    { label: "OpenAI", value: "openai" },
    { label: "Gemini", value: "gemini" },
];

const webdavDomainKeys: AppSyncDomainKey[] = ["canvas", "assets", "image-workbench", "video-workbench"];
const webdavDomainLabels: Record<AppSyncDomainKey, string> = {
    canvas: "画布",
    assets: "我的素材",
    "image-workbench": "生图工作台",
    "video-workbench": "视频创作台",
};

function createWebdavDomainProgress(): Record<AppSyncDomainKey, WebdavDomainProgress> {
    return webdavDomainKeys.reduce(
        (progress, key) => ({
            ...progress,
            [key]: { label: webdavDomainLabels[key], stage: "等待同步" },
        }),
        {} as Record<AppSyncDomainKey, WebdavDomainProgress>,
    );
}

export function AppConfigModal() {
    const { message } = App.useApp();
    const [loadingChannelId, setLoadingChannelId] = useState("");
    const [testingWebdav, setTestingWebdav] = useState(false);
    const [syncingWebdav, setSyncingWebdav] = useState(false);
    const [webdavSyncStatus, setWebdavSyncStatus] = useState("");
    const [webdavDomainProgress, setWebdavDomainProgress] = useState(createWebdavDomainProgress);
    const config = useConfigStore((state) => state.config);
    const webdav = useConfigStore((state) => state.webdav);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const setChannelMode = useConfigStore((state) => state.setChannelMode);
    const updateWebdavConfig = useConfigStore((state) => state.updateWebdavConfig);
    const isConfigOpen = useConfigStore((state) => state.isConfigOpen);
    const shouldPromptContinue = useConfigStore((state) => state.shouldPromptContinue);
    const setConfigDialogOpen = useConfigStore((state) => state.setConfigDialogOpen);
    const clearPromptContinue = useConfigStore((state) => state.clearPromptContinue);
    const publicSettings = useConfigStore((state) => state.publicSettings);
    const effectiveConfig = useEffectiveConfig();
    const modelChannel = publicSettings?.modelChannel;
    const channelModeOptions = buildChannelModeOptions(modelChannel);
    const effectiveMode = resolveAllowedChannelMode(config.channelMode, modelChannel);
    const localConfig = withLocalChannels(config, config.channels);
    const modelConfig = effectiveMode === "remote" ? effectiveConfig : effectiveMode === "local" ? localConfig : config;
    const modelOptions = modelConfig.models.map((model) => ({ label: modelOptionLabel(modelConfig, model), value: model }));
    const webdavReady = Boolean(webdav.url.trim());

    const finishConfig = () => {
        setConfigDialogOpen(false);
        if (!effectiveMode) return;
        if (effectiveMode === "local" && !localConfig.channels.some((channel) => channel.baseUrl.trim() && channel.apiKey.trim() && channel.models.length)) return;
        if (effectiveMode === "newapi" && (!config.baseUrl.trim() || !config.newApiGroup.trim())) return;
        if (!modelConfig.imageModel.trim() || !modelConfig.videoModel.trim() || !modelConfig.textModel.trim()) return;
        if (effectiveMode !== config.channelMode) updateConfig("channelMode", effectiveMode);
        message.success(shouldPromptContinue ? "配置已保存，请继续刚才的请求" : "配置已保存");
        clearPromptContinue();
    };

    const saveConfig = (nextConfig: AiConfig) => applyConfigPatch(updateConfig, config, nextConfig);

    const updateChannels = (channels: ModelChannel[]) => saveConfig(withLocalChannels({ ...config, channelMode: "local" }, channels));

    const updateChannel = (id: string, patch: Partial<ModelChannel>) => {
        updateChannels(config.channels.map((channel) => (channel.id === id ? { ...channel, ...patch, models: patch.models ? uniqueModels(patch.models) : channel.models } : channel)));
    };

    const updateChannelApiFormat = (channel: ModelChannel, apiFormat: ApiCallFormat) => {
        const baseUrl = !channel.baseUrl.trim() || channel.baseUrl.trim() === defaultBaseUrlForApiFormat(channel.apiFormat) ? defaultBaseUrlForApiFormat(apiFormat) : channel.baseUrl;
        updateChannel(channel.id, { apiFormat, baseUrl });
    };

    const addChannel = () => updateChannels([...config.channels, createModelChannel({ name: `渠道 ${config.channels.length + 1}` })]);

    const deleteChannel = (id: string) => {
        if (config.channels.length <= 1) {
            message.warning("至少保留一个本地渠道");
            return;
        }
        updateChannels(config.channels.filter((channel) => channel.id !== id));
    };

    const refreshChannel = async (channel: ModelChannel) => {
        if (!channel.baseUrl.trim() || !channel.apiKey.trim()) {
            message.error("请先填写该渠道的 Base URL 和 API Key");
            return;
        }
        setLoadingChannelId(channel.id);
        try {
            const models = await fetchChannelModels(channel);
            updateChannels(config.channels.map((item) => (item.id === channel.id ? { ...item, models } : item)));
            message.success(`${channel.name} 模型列表已更新`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "读取模型失败");
        } finally {
            setLoadingChannelId("");
        }
    };

    const refreshModels = async () => {
        if (!effectiveMode || effectiveMode === "remote") return;
        if (effectiveMode === "local") {
            const runnable = config.channels.filter((channel) => channel.baseUrl.trim() && channel.apiKey.trim());
            if (!runnable.length) {
                message.error("请先填写至少一个渠道的 Base URL 和 API Key");
                return;
            }
            setLoadingChannelId("all");
            try {
                const entries = await Promise.all(runnable.map(async (channel) => [channel.id, await fetchChannelModels(channel)] as const));
                const modelMap = new Map(entries);
                updateChannels(config.channels.map((channel) => (modelMap.has(channel.id) ? { ...channel, models: modelMap.get(channel.id) || [] } : channel)));
                message.success("全部本地渠道模型列表已更新");
            } catch (error) {
                message.error(error instanceof Error ? error.message : "读取模型失败");
            } finally {
                setLoadingChannelId("");
            }
            return;
        }
        const fetchConfig = { ...config, channelMode: effectiveMode };
        if (!isModelFetchConfigReady(fetchConfig)) {
            message.error(effectiveMode === "newapi" ? "请先填写 Base URL 和分组" : "请先填写 Base URL 和 API Key");
            return;
        }
        setLoadingChannelId("newapi");
        try {
            const models = await fetchImageModels(fetchConfig);
            const nextConfig = applyFetchedModelsToConfig(fetchConfig, models);
            applyConfigPatch(updateConfig, config, nextConfig);
            message.success("模型列表已更新");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "读取模型失败");
        } finally {
            setLoadingChannelId("");
        }
    };

    const updateCapabilityModels = (group: ModelGroup, models: string[]) => {
        const next = uniqueModels(models);
        const targetConfig = effectiveMode === "local" ? localConfig : config;
        updateConfig(group.modelsKey, next);
        if (!next.includes(targetConfig[group.modelKey])) updateConfig(group.modelKey, next[0] || "");
    };

    const changeChannelMode = (mode: ChannelMode) => {
        setChannelMode(mode);
    };

    const testWebdav = async () => {
        if (!webdavReady) {
            message.error("请先填写 WebDAV 地址");
            return;
        }
        setTestingWebdav(true);
        try {
            await testWebdavConnection(webdav);
            message.success("WebDAV 连接可用");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "WebDAV 连接测试失败");
        } finally {
            setTestingWebdav(false);
        }
    };

    const updateWebdavProgress = (event: AppSyncProgressEvent) => {
        setWebdavSyncStatus(event.stage);
        if (!event.domain) return;
        setWebdavDomainProgress((current) => ({
            ...current,
            [event.domain as AppSyncDomainKey]: {
                label: event.label || webdavDomainLabels[event.domain as AppSyncDomainKey],
                stage: event.stage,
                current: event.current,
                total: event.total,
                status: event.status,
            },
        }));
    };

    const syncWebdav = async () => {
        if (!webdavReady) {
            message.error("请先填写 WebDAV 地址");
            return;
        }
        setSyncingWebdav(true);
        setWebdavDomainProgress(createWebdavDomainProgress());
        setWebdavSyncStatus("准备同步");
        try {
            const result = await syncAppDataToWebdav(webdav, updateWebdavProgress);
            updateWebdavConfig("lastSyncedAt", result.syncedAt);
            message.success(`同步完成：${result.projects} 个画布，${result.assets} 个素材，${result.imageLogs + result.videoLogs} 条记录，本次上传 ${result.uploadedFiles} 个文件 ${formatBytes(result.uploadedBytes)}`);
        } catch (error) {
            setWebdavSyncStatus(error instanceof Error ? error.message : "WebDAV 同步失败");
            message.error(error instanceof Error ? error.message : "WebDAV 同步失败");
        } finally {
            setSyncingWebdav(false);
        }
    };

    return (
        <Modal
            title={
                <div>
                    <div className="text-lg font-semibold">配置与用户偏好</div>
                    <div className="mt-1 text-xs font-normal text-stone-500">模型、渠道和画布默认行为</div>
                </div>
            }
            open={isConfigOpen}
            width={960}
            centered
            onCancel={() => setConfigDialogOpen(false)}
            styles={{ body: { maxHeight: "72vh", overflowY: "auto", paddingRight: 18 } }}
            footer={
                <Button type="primary" onClick={finishConfig}>
                    完成
                </Button>
            }
        >
            <div className="pt-1">
                <Form layout="vertical" requiredMark={false}>
                    {channelModeOptions.length ? (
                        <Form.Item label="渠道模式" className="mb-5">
                            <Segmented block size="middle" value={effectiveMode} onChange={(value) => changeChannelMode(value as ChannelMode)} options={channelModeOptions} />
                        </Form.Item>
                    ) : (
                        <div className="mb-5 rounded-lg border border-stone-200 p-3 text-sm text-stone-500 dark:border-stone-800">管理员未开放可用渠道，请联系管理员在后台设置中开启至少一种渠道。</div>
                    )}
                    {!effectiveMode ? null : effectiveMode === "local" ? (
                        <>
                            <div className="mb-3 flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
                                <CircleAlert className="mt-0.5 size-4 shrink-0" />
                                <span>浏览器直连要求接口支持 CORS/OPTIONS；HTTPS 页面不能直连 HTTP 地址。网络受限时请改用后端渠道。</span>
                            </div>
                            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                                <div>
                                    <div className="text-sm font-semibold">本地直连渠道</div>
                                    <div className="mt-1 text-xs text-stone-500">可同时配置多个 OpenAI 或 Gemini 接口，同名模型也能按渠道区分。</div>
                                </div>
                                <div className="flex gap-2">
                                    <Button size="small" loading={loadingChannelId === "all"} onClick={() => void refreshModels()}>
                                        拉取全部模型
                                    </Button>
                                    <Button size="small" icon={<Plus className="size-4" />} onClick={addChannel}>
                                        新增渠道
                                    </Button>
                                </div>
                            </div>
                            <div className="mb-5 grid gap-3">
                                {config.channels.map((channel) => (
                                    <div key={channel.id} className="rounded-lg border border-stone-200 p-3 dark:border-stone-800">
                                        <div className="grid gap-3 md:grid-cols-2">
                                            <Form.Item label="渠道名称" className="mb-0">
                                                <Input value={channel.name} onChange={(event) => updateChannel(channel.id, { name: event.target.value })} />
                                            </Form.Item>
                                            <Form.Item label="调用格式" className="mb-0">
                                                <Segmented block value={channel.apiFormat} options={apiFormatOptions} onChange={(value) => updateChannelApiFormat(channel, value as ApiCallFormat)} />
                                            </Form.Item>
                                            <Form.Item label="Base URL" className="mb-0">
                                                <Input value={channel.baseUrl} onChange={(event) => updateChannel(channel.id, { baseUrl: event.target.value })} />
                                            </Form.Item>
                                            <Form.Item label="API Key" className="mb-0">
                                                <Input.Password value={channel.apiKey} onChange={(event) => updateChannel(channel.id, { apiKey: event.target.value })} />
                                            </Form.Item>
                                        </div>
                                        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                                            <span className="text-xs text-stone-500">已保存 {channel.models.length} 个模型</span>
                                            <div className="flex gap-2">
                                                <Button size="small" loading={loadingChannelId === channel.id} onClick={() => void refreshChannel(channel)}>
                                                    拉取模型
                                                </Button>
                                                <Button size="small" danger icon={<Trash2 className="size-4" />} disabled={config.channels.length <= 1} onClick={() => deleteChannel(channel.id)}>
                                                    删除
                                                </Button>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </>
                    ) : effectiveMode === "newapi" ? (
                        <>
                            <div className="grid gap-4 md:grid-cols-2">
                                <Form.Item label="Base URL" extra="跨域免 Key 请求要求接口允许当前站点来源并支持携带 Cookie。" className="mb-4">
                                    <Input value={config.baseUrl} onChange={(event) => updateConfig("baseUrl", event.target.value)} />
                                </Form.Item>
                                <Form.Item label="New API 默认分组" extra="未单独配置能力分组时使用。" className="mb-4">
                                    <Input value={config.newApiGroup} onChange={(event) => updateConfig("newApiGroup", event.target.value)} />
                                </Form.Item>
                            </div>
                            <div className="grid gap-4 md:grid-cols-4">
                                <Form.Item label="文本分组" className="mb-4">
                                    <Input placeholder="默认分组" value={config.newApiTextGroup} onChange={(event) => updateConfig("newApiTextGroup", event.target.value)} />
                                </Form.Item>
                                <Form.Item label="生图分组" className="mb-4">
                                    <Input placeholder="默认分组" value={config.newApiImageGroup} onChange={(event) => updateConfig("newApiImageGroup", event.target.value)} />
                                </Form.Item>
                                <Form.Item label="音频分组" className="mb-4">
                                    <Input placeholder="默认分组" value={config.newApiAudioGroup} onChange={(event) => updateConfig("newApiAudioGroup", event.target.value)} />
                                </Form.Item>
                                <Form.Item label="视频分组" className="mb-4">
                                    <Input placeholder="默认分组" value={config.newApiVideoGroup} onChange={(event) => updateConfig("newApiVideoGroup", event.target.value)} />
                                </Form.Item>
                            </div>
                            <div className="mb-5 flex items-center justify-between gap-3 rounded-lg border border-stone-200 px-3 py-2 dark:border-stone-800">
                                <div className="min-w-0">
                                    <div className="text-sm font-medium">模型列表</div>
                                    <div className="mt-1 text-xs text-stone-500">当前已保存 {config.models.length} 个模型</div>
                                </div>
                                <Button size="small" loading={loadingChannelId === "newapi"} onClick={() => void refreshModels()}>
                                    拉取模型列表
                                </Button>
                            </div>
                        </>
                    ) : (
                        <div className="mb-5 rounded-lg border border-stone-200 p-3 text-sm text-stone-500 dark:border-stone-800">
                            <div className="font-medium text-stone-900 dark:text-stone-100">后端渠道</div>
                            <div className="mt-1">由系统后台渠道转发请求，当前可用 {modelChannel?.availableModels.length || 0} 个模型。</div>
                        </div>
                    )}
                    {effectiveMode === "local" || effectiveMode === "newapi" ? (
                        <section className="mb-5 rounded-lg border border-stone-200 p-3 dark:border-stone-800">
                            <div className="mb-3">
                                <div className="text-sm font-semibold">模型可选项</div>
                                <div className="mt-1 text-xs text-stone-500">从已拉取模型中选择哪些模型可进入各类下拉。</div>
                            </div>
                            <div className="grid gap-4 md:grid-cols-2">
                                {modelGroups.map((group) => (
                                    <Form.Item key={group.modelsKey} label={group.optionsLabel} className="mb-0">
                                        <Select
                                            mode="multiple"
                                            showSearch
                                            allowClear
                                            maxTagCount="responsive"
                                            placeholder={modelConfig.models.length ? `请选择${group.optionsLabel}` : "请先拉取模型列表"}
                                            value={modelConfig[group.modelsKey]}
                                            options={modelOptions}
                                            onChange={(models) => updateCapabilityModels(group, models)}
                                        />
                                    </Form.Item>
                                ))}
                            </div>
                        </section>
                    ) : null}
                    {effectiveMode ? (
                        <>
                            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                                {modelGroups.map((group) => (
                                    <Form.Item key={group.modelKey} label={group.defaultLabel} className="mb-4">
                                        <ModelPicker config={modelConfig} value={modelConfig[group.modelKey]} onChange={(model) => updateConfig(group.modelKey, model)} capability={group.capability} fullWidth />
                                    </Form.Item>
                                ))}
                            </div>
                            <div className="grid gap-4 md:grid-cols-4">
                                <Form.Item label="画布默认生图张数" extra="新建画布生图和配置节点默认使用，单个节点仍可单独覆盖。" className="mb-4">
                                    <Input
                                        type="number"
                                        min={1}
                                        max={15}
                                        value={config.canvasImageCount}
                                        onChange={(event) => updateConfig("canvasImageCount", event.target.value)}
                                        onBlur={(event) => updateConfig("canvasImageCount", normalizeImageCount(event.target.value))}
                                    />
                                </Form.Item>
                                <Form.Item label="默认音频声音" className="mb-4">
                                    <Select value={config.audioVoice} options={audioVoiceOptions} onChange={(value) => updateConfig("audioVoice", value)} />
                                </Form.Item>
                                <Form.Item label="默认音频格式" className="mb-4">
                                    <Select value={config.audioFormat} options={audioFormatOptions} onChange={(value) => updateConfig("audioFormat", value)} />
                                </Form.Item>
                                <Form.Item label="默认音频语速" className="mb-4">
                                    <Input
                                        type="number"
                                        min={0.25}
                                        max={4}
                                        step={0.05}
                                        value={config.audioSpeed}
                                        onChange={(event) => updateConfig("audioSpeed", event.target.value)}
                                        onBlur={(event) => updateConfig("audioSpeed", normalizeAudioSpeedValue(event.target.value))}
                                    />
                                </Form.Item>
                            </div>
                            <Form.Item label="默认音频指令" className="mb-4">
                                <Input.TextArea rows={2} value={config.audioInstructions} placeholder="例如：自然、温暖、适合旁白。" onChange={(event) => updateConfig("audioInstructions", event.target.value)} />
                            </Form.Item>
                            {effectiveMode === "local" ? (
                                <Form.Item label="系统提示词" className="mb-0">
                                    <Input.TextArea rows={3} value={config.systemPrompt} placeholder="例如：你是一位擅长电影感写实摄影的视觉导演。" onChange={(event) => updateConfig("systemPrompt", event.target.value)} />
                                </Form.Item>
                            ) : null}
                        </>
                    ) : null}
                    <section className="mt-5 rounded-lg border border-stone-200 p-3 dark:border-stone-800">
                        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                            <div>
                                <div className="flex items-center gap-2 text-sm font-semibold">
                                    <Cloud className="size-4" />
                                    WebDAV 同步
                                </div>
                                <div className="mt-1 text-xs text-stone-500">同步画布、我的素材、生成记录和本地媒体文件，不包含 AI API Key；服务不支持 CORS 时可走 Next.js 转发。</div>
                            </div>
                            <div className="text-xs text-stone-500">{webdav.lastSyncedAt ? `上次同步 ${formatWebdavTime(webdav.lastSyncedAt)}` : "尚未同步"}</div>
                        </div>
                        <div className="grid gap-4 md:grid-cols-2">
                            <Form.Item label="连接方式" className="mb-4 md:col-span-2">
                                <Segmented
                                    block
                                    value={webdav.proxyMode}
                                    onChange={(value) => updateWebdavConfig("proxyMode", value as typeof webdav.proxyMode)}
                                    options={[
                                        { label: "前端直连", value: "direct" },
                                        { label: "Next.js 转发", value: "nextjs" },
                                    ]}
                                />
                            </Form.Item>
                            <Form.Item label="WebDAV 地址" className="mb-4">
                                <Input value={webdav.url} placeholder="https://nas.example.com/webdav" onChange={(event) => updateWebdavConfig("url", event.target.value)} />
                            </Form.Item>
                            <Form.Item label="远程目录" extra={`会在该目录下分业务目录保存，每个目录包含 ${WEBDAV_MANIFEST_FILE_NAME} 和 files/`} className="mb-4">
                                <Input value={webdav.directory} placeholder="infinite-canvas" onChange={(event) => updateWebdavConfig("directory", event.target.value)} />
                            </Form.Item>
                            <Form.Item label="用户名" className="mb-0">
                                <Input value={webdav.username} autoComplete="username" onChange={(event) => updateWebdavConfig("username", event.target.value)} />
                            </Form.Item>
                            <Form.Item label="密码 / 应用密码" className="mb-0">
                                <Input.Password value={webdav.password} autoComplete="current-password" onChange={(event) => updateWebdavConfig("password", event.target.value)} />
                            </Form.Item>
                        </div>
                        <div className="mt-4 flex flex-wrap items-center gap-2">
                            <Button icon={<Wifi className="size-4" />} disabled={!webdavReady || syncingWebdav} loading={testingWebdav} onClick={() => void testWebdav()}>
                                测试连接
                            </Button>
                            <Button type="primary" icon={<RefreshCw className="size-4" />} disabled={!webdavReady || testingWebdav} loading={syncingWebdav} onClick={() => void syncWebdav()}>
                                {syncingWebdav ? "同步中" : "立即同步"}
                            </Button>
                            {webdavSyncStatus ? <span className="text-xs text-stone-500">{webdavSyncStatus}</span> : null}
                        </div>
                        {syncingWebdav || webdavSyncStatus ? (
                            <div className="mt-3 grid gap-2">
                                {webdavDomainKeys.map((key) => {
                                    const item = webdavDomainProgress[key];
                                    const count = item.total ? `${item.current || 0}/${item.total}` : "";
                                    return (
                                        <div key={key} className="rounded-md border border-stone-200 px-3 py-2 dark:border-stone-800">
                                            <div className="mb-1 flex min-w-0 items-center justify-between gap-3 text-xs">
                                                <span className="shrink-0 font-medium text-stone-700 dark:text-stone-200">{item.label}</span>
                                                <span className="min-w-0 truncate text-right text-stone-500">
                                                    {item.stage}
                                                    {count ? ` · ${count}` : ""}
                                                </span>
                                            </div>
                                            <Progress percent={getWebdavProgressPercent(item)} size="small" status={getWebdavProgressStatus(item)} showInfo={false} />
                                        </div>
                                    );
                                })}
                            </div>
                        ) : null}
                    </section>
                </Form>
            </div>
        </Modal>
    );
}

function normalizeImageCount(value: string) {
    return String(Math.max(1, Math.min(15, Math.floor(Math.abs(Number(value)) || 3))));
}

function applyConfigPatch(updateConfig: UpdateAiConfig, current: AiConfig, next: AiConfig) {
    (Object.keys(next) as Array<keyof AiConfig>).forEach((key) => {
        if (current[key] !== next[key]) updateConfig(key, next[key]);
    });
}

function buildChannelModeOptions(modelChannel: ModelChannelSettings | null | undefined) {
    const modes: Array<{ label: string; value: ChannelMode }> = [
        { label: "本地直连", value: "local" },
        { label: "New API 免 Key", value: "newapi" },
        { label: "后端渠道", value: "remote" },
    ];
    return modes.filter((mode) => channelModeAllowed(modelChannel, mode.value));
}

function isModelFetchConfigReady(config: AiConfig) {
    if (!config.baseUrl.trim()) return false;
    if (isNewApiConfig(config)) return Boolean(config.newApiGroup.trim());
    return Boolean(config.apiKey.trim());
}

function uniqueModels(models: string[]) {
    return Array.from(new Set(models.map((model) => model.trim()).filter(Boolean)));
}

function formatWebdavTime(value: string) {
    return new Date(value).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function getWebdavProgressPercent(item: WebdavDomainProgress) {
    if (item.status === "success") return 100;
    if (item.total) return Math.min(100, Math.round(((item.current || 0) / item.total) * 100));
    if (item.status === "exception") return 100;
    if (item.stage === "等待同步") return 0;
    if (item.stage === "读取远端清单") return 12;
    if (item.stage === "读取本地数据") return 24;
    if (item.stage === "下载缺失媒体") return 36;
    if (item.stage === "写入本地合并结果") return 58;
    if (item.stage === "上传新增媒体") return 66;
    if (item.stage === "媒体已齐全" || item.stage === "媒体无需上传") return 74;
    if (item.stage.startsWith("上传清单")) return 90;
    return item.status === "active" ? 30 : 0;
}

function getWebdavProgressStatus(item: WebdavDomainProgress): "normal" | "active" | "success" | "exception" {
    if (item.status === "success" || item.status === "exception") return item.status;
    return item.status === "active" ? "active" : "normal";
}

function formatBytes(bytes: number) {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}
