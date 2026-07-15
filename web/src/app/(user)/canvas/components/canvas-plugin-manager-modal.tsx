"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { App, Button, Input, Modal, Popconfirm, Switch, Tabs } from "antd";
import { AlertTriangle, Download, Puzzle, RefreshCw, Trash2 } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import { installPluginFromUrl, setPluginEnabled, uninstallPlugin, unsafeCanvasPluginsEnabled, updatePlugin } from "@/lib/canvas/plugin-loader";
import { fetchOfficialPlugins, type OfficialPluginEntry } from "@/lib/canvas/plugin-registry";
import { usePluginStore, type InstalledPlugin } from "@/stores/use-plugin-store";
import { useThemeStore } from "@/stores/use-theme-store";

export function CanvasPluginManagerModal({ open, onClose }: { open: boolean; onClose: () => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const { message, modal } = App.useApp();
    const plugins = usePluginStore((state) => state.plugins);
    const [url, setUrl] = useState("");
    const [installing, setInstalling] = useState(false);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [official, setOfficial] = useState<OfficialPluginEntry[]>([]);
    const [loadingOfficial, setLoadingOfficial] = useState(false);
    const [officialError, setOfficialError] = useState("");
    const installedById = useMemo(() => new Map(plugins.map((plugin) => [plugin.id, plugin])), [plugins]);

    const loadOfficial = useCallback(async () => {
        setLoadingOfficial(true);
        setOfficialError("");
        try {
            setOfficial(await fetchOfficialPlugins());
        } catch (error) {
            setOfficialError(error instanceof Error ? error.message : String(error));
        } finally {
            setLoadingOfficial(false);
        }
    }, []);

    useEffect(() => {
        if (open && !official.length && !loadingOfficial && !officialError) void loadOfficial();
    }, [loadOfficial, loadingOfficial, official.length, officialError, open]);

    const installUrl = async () => {
        const target = url.trim();
        if (!target) return;
        setInstalling(true);
        try {
            const plugin = await installPluginFromUrl(target, { unsafeRemote: true });
            message.success(`已安装 ${plugin.name}`);
            setUrl("");
        } catch (error) {
            message.error(`安装失败：${error instanceof Error ? error.message : String(error)}`);
        } finally {
            setInstalling(false);
        }
    };

    const confirmInstallUrl = () => {
        if (!url.trim()) return;
        modal.confirm({
            title: "确认执行第三方插件？",
            content: "该地址返回的 JavaScript 将在当前页面执行，并可能读取浏览器中的配置和画布数据。请只继续安装你完全信任的来源。",
            okText: "信任并安装",
            cancelText: "取消",
            okButtonProps: { danger: true },
            onOk: installUrl,
        });
    };

    const installOfficial = async (entry: OfficialPluginEntry) => {
        setBusyId(entry.id);
        try {
            const plugin = await installPluginFromUrl(entry.url, { official: true });
            message.success(`已安装 ${plugin.name}`);
        } catch (error) {
            message.error(`安装失败：${error instanceof Error ? error.message : String(error)}`);
        } finally {
            setBusyId(null);
        }
    };

    const run = async (plugin: InstalledPlugin, action: () => Promise<unknown>, success: string) => {
        setBusyId(plugin.id);
        try {
            await action();
            message.success(success);
        } catch (error) {
            message.error(error instanceof Error ? error.message : String(error));
        } finally {
            setBusyId(null);
        }
    };

    const controls = (plugin: InstalledPlugin) => (
        <div className="flex shrink-0 items-center gap-1">
            <Switch size="small" checked={plugin.enabled} loading={busyId === plugin.id} onChange={(enabled) => void run(plugin, () => setPluginEnabled(plugin, enabled), enabled ? "已启用" : "已禁用")} />
            {!plugin.local ? (
                <Button type="text" size="small" icon={<RefreshCw className="size-4" />} loading={busyId === plugin.id} title="更新" onClick={() => void run(plugin, () => updatePlugin(plugin), "已更新")} />
            ) : null}
            <Popconfirm title="卸载该插件？" okText="卸载" cancelText="取消" onConfirm={() => uninstallPlugin(plugin.id)}>
                <Button type="text" size="small" danger icon={<Trash2 className="size-4" />} title="卸载" />
            </Popconfirm>
        </div>
    );

    const row = (key: string, name: string, version: string, description: string | undefined, action: ReactNode, icon?: ReactNode) => (
        <div key={key} className="flex items-center gap-3 rounded-xl border px-3 py-2.5" style={{ borderColor: theme.node.stroke, background: theme.node.fill }}>
            <span className="grid size-9 shrink-0 place-items-center rounded-lg" style={{ background: theme.toolbar.activeBg, color: theme.node.muted }}>
                {icon || <Puzzle className="size-4" />}
            </span>
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-sm font-medium" style={{ color: theme.node.text }}>
                    <span className="truncate">{name}</span>
                    <span className="rounded-full px-1.5 py-0.5 text-[10px]" style={{ background: theme.toolbar.activeBg, color: theme.node.muted }}>v{version}</span>
                </div>
                {description ? <div className="mt-0.5 truncate text-xs" style={{ color: theme.node.muted }}>{description}</div> : null}
            </div>
            {action}
        </div>
    );

    const officialContent = (
        <div className="space-y-2">
            <div className="flex items-center justify-between text-xs" style={{ color: theme.node.muted }}>
                <span>来自 Infinite Canvas 官方插件注册表</span>
                <Button type="text" size="small" icon={<RefreshCw className={loadingOfficial ? "size-4 animate-spin" : "size-4"} />} disabled={loadingOfficial} onClick={() => void loadOfficial()}>刷新</Button>
            </div>
            {officialError ? <div className="rounded-lg border p-3 text-xs" style={{ borderColor: theme.node.stroke, color: theme.node.muted }}>加载失败：{officialError}</div> : null}
            <div className="thin-scrollbar max-h-[48vh] space-y-2 overflow-auto">
                {official.map((entry) => {
                    const installed = installedById.get(entry.id);
                    return row(entry.id, entry.name, entry.version, entry.description, installed ? controls(installed) : <Button type="primary" size="small" icon={<Download className="size-4" />} loading={busyId === entry.id} onClick={() => void installOfficial(entry)}>安装</Button>, typeof entry.icon === "string" ? <span>{entry.icon}</span> : undefined);
                })}
                {!loadingOfficial && !officialError && !official.length ? <EmptyHint text="暂无官方插件" /> : null}
            </div>
        </div>
    );

    const installedContent = <div className="thin-scrollbar max-h-[52vh] space-y-2 overflow-auto">{plugins.length ? plugins.map((plugin) => row(plugin.id, plugin.name, plugin.version, plugin.description || plugin.url, controls(plugin))) : <EmptyHint text="尚未安装插件" />}</div>;
    const urlContent = (
        <div className="space-y-3">
            <div className="flex gap-2"><Input value={url} onChange={(event) => setUrl(event.target.value)} onPressEnter={confirmInstallUrl} placeholder="HTTPS 插件 JS 地址" allowClear /><Button type="primary" loading={installing} onClick={confirmInstallUrl}>安装</Button></div>
            <p className="text-xs leading-5" style={{ color: theme.node.muted }}>第三方插件必须使用 HTTPS；本地开发允许 localhost 或 127.0.0.1。</p>
        </div>
    );

    return (
        <Modal title="画布节点插件" open={open} onCancel={onClose} footer={null} centered width={680}>
            <div className="space-y-3">
                <div className="flex items-start gap-2 rounded-lg border px-3 py-2 text-xs leading-5" style={{ borderColor: "#f59e0b55", background: "#f59e0b14", color: theme.node.text }}>
                    <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" />
                    <span>插件代码会在当前页面执行，并可访问浏览器中的画布和配置数据。只安装可信来源。</span>
                </div>
                <Tabs defaultActiveKey="official" items={[{ key: "official", label: "官方插件", children: officialContent }, { key: "installed", label: `已安装 ${plugins.length || ""}`, children: installedContent }, ...(unsafeCanvasPluginsEnabled ? [{ key: "url", label: "URL 安装（危险）", children: urlContent }] : [])]} />
            </div>
        </Modal>
    );
}

function EmptyHint({ text }: { text: string }) {
    return <div className="py-10 text-center text-sm opacity-55">{text}</div>;
}
