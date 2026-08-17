"use client";

import CodeMirror from "@uiw/react-codemirror";
import { Alert, App, Button, Checkbox, Modal, Segmented, Select } from "antd";
import { useEffect, useMemo, useState } from "react";

import { PLUGIN_RETURNS, PLUGIN_TEMPLATES, PLUGIN_VARIABLES, validateModelPluginScript } from "@/services/api/model-plugin";
import type { ModelCapability, ModelChannel } from "@/stores/use-config-store";

const MAX_SCRIPT_LENGTH = 100_000;
const capabilityOptions: Array<{ label: string; value: ModelCapability }> = [
    { label: "生图", value: "image" },
    { label: "视频", value: "video" },
    { label: "文本", value: "text" },
    { label: "音频", value: "audio" },
];

export function ModelScriptEditor({ open, channel, onSave, onClose }: { open: boolean; channel: ModelChannel | null; onSave: (model: string, capability: ModelCapability, script: string) => void; onClose: () => void }) {
    const { message } = App.useApp();
    const [model, setModel] = useState("");
    const [capability, setCapability] = useState<ModelCapability>("image");
    const [draft, setDraft] = useState("");
    const [riskAccepted, setRiskAccepted] = useState(false);

    const readScript = (targetModel: string, targetCapability: ModelCapability) => channel?.modelScripts?.[targetModel]?.[targetCapability] || "";
    useEffect(() => {
        if (!open || !channel) return;
        const configured = Object.entries(channel.modelScripts || {}).flatMap(([name, scripts]) => capabilityOptions.flatMap((item) => (scripts?.[item.value] ? [{ model: name, capability: item.value }] : [])))[0];
        const nextModel = configured?.model || channel.models[0] || "";
        const nextCapability = configured?.capability || guessCapability(nextModel);
        setModel(nextModel);
        setCapability(nextCapability);
        setDraft(readChannelScript(channel, nextModel, nextCapability));
        setRiskAccepted(false);
    }, [channel, open]);

    const variables = useMemo(() => PLUGIN_VARIABLES.filter((item) => !item.capabilities || item.capabilities.includes(capability)), [capability]);
    const switchTarget = (nextModel: string, nextCapability: ModelCapability) => {
        setModel(nextModel);
        setCapability(nextCapability);
        setDraft(readScript(nextModel, nextCapability));
        setRiskAccepted(false);
    };
    const save = () => {
        const script = draft.trim();
        if (!model) return message.warning("请先选择模型");
        if (script.length > MAX_SCRIPT_LENGTH) return message.error("脚本不能超过 100000 字符");
        if (script && !riskAccepted) return message.warning("请先确认脚本会使用渠道 API Key 并可能产生费用");
        if (script) {
            try {
                validateModelPluginScript(script);
            } catch (error) {
                return message.error(error instanceof Error ? error.message : "脚本安全检查未通过");
            }
        }
        onSave(model, capability, script);
        message.success(script ? "调用脚本已保存" : "已恢复系统默认调用");
        onClose();
    };

    return (
        <Modal
            open={open}
            title={`自定义模型调用 · ${channel?.name || "本地渠道"}`}
            width={1080}
            centered
            onCancel={onClose}
            styles={{ body: { padding: 0 } }}
            footer={
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap gap-2">
                        {PLUGIN_TEMPLATES[capability].map((template) => (
                            <Button key={template.label} size="small" onClick={() => { setDraft(template.script); setRiskAccepted(false); }}>
                                插入{template.label}模板
                            </Button>
                        ))}
                        <Button size="small" danger onClick={() => setDraft("")}>恢复默认调用</Button>
                    </div>
                    <div className="flex gap-2"><Button onClick={onClose}>取消</Button><Button type="primary" onClick={save}>保存</Button></div>
                </div>
            }
        >
            <div className="border-t border-stone-200 dark:border-stone-800">
                <div className="grid gap-3 border-b border-stone-200 p-4 md:grid-cols-[minmax(0,1fr)_360px] dark:border-stone-800">
                    <Select value={model || undefined} placeholder="选择模型" showSearch options={(channel?.models || []).map((name) => ({ label: name, value: name }))} onChange={(value) => switchTarget(value, capability)} />
                    <Segmented block value={capability} options={capabilityOptions} onChange={(value) => switchTarget(model, value as ModelCapability)} />
                    <Alert className="md:col-span-2" type="warning" showIcon message="脚本在禁止联网的 CSP Worker 中运行，只获得密钥占位符；宿主仅在当前渠道同源请求头中注入真实 API Key。脚本仍可能发起计费请求，请只使用你理解且信任的脚本。" />
                    <Checkbox className="md:col-span-2" checked={riskAccepted} onChange={(event) => setRiskAccepted(event.target.checked)}>我理解脚本会使用当前渠道 API Key，并可能产生费用</Checkbox>
                </div>
                <div className="flex h-[58vh] min-h-[420px]">
                    <aside className="thin-scrollbar w-[320px] shrink-0 overflow-y-auto border-r border-stone-200 bg-stone-50/70 p-4 dark:border-stone-800 dark:bg-stone-900/40">
                        <div className="text-xs font-semibold text-stone-500">返回要求</div>
                        <p className="mt-1 text-xs leading-5 text-stone-600 dark:text-stone-300">{PLUGIN_RETURNS[capability]}</p>
                        <div className="mt-4 text-xs font-semibold text-stone-500">可用变量</div>
                        <div className="mt-2 space-y-2">
                            {variables.map((item) => <button key={item.name} type="button" className="block w-full rounded-md border border-transparent p-2 text-left hover:border-stone-200 hover:bg-white dark:hover:border-stone-700 dark:hover:bg-stone-800" onClick={() => setDraft((value) => `${value}${value ? "\n" : ""}${item.name}`)}><code className="text-xs font-semibold">{item.name}</code><span className="ml-2 text-[10px] text-stone-400">{item.type}</span><div className="mt-1 text-xs text-stone-500">{item.desc}</div></button>)}
                        </div>
                    </aside>
                    <div className="min-w-0 flex-1 overflow-hidden">
                        <CodeMirror value={draft} onChange={setDraft} height="100%" placeholder="// 留空使用系统默认调用" className="h-full [&_.cm-editor]:h-full [&_.cm-scroller]:overflow-auto" style={{ height: "100%", fontSize: 13 }} />
                    </div>
                </div>
                <div className={`border-t px-4 py-2 text-right text-xs ${draft.length > MAX_SCRIPT_LENGTH ? "text-red-600" : "text-stone-400"}`}>{draft.length.toLocaleString()} / {MAX_SCRIPT_LENGTH.toLocaleString()}</div>
            </div>
        </Modal>
    );
}

function readChannelScript(channel: ModelChannel, model: string, capability: ModelCapability) {
    return channel.modelScripts?.[model]?.[capability] || "";
}

function guessCapability(model: string): ModelCapability {
    const value = model.toLowerCase();
    if (/video|veo|sora|seedance|kling|wan/.test(value)) return "video";
    if (/audio|tts|speech|voice|music/.test(value)) return "audio";
    if (/image|imagen|banana|flux|dall|seedream|sdxl/.test(value)) return "image";
    return "text";
}
