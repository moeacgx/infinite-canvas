"use client";

import { useEffect, useState } from "react";
import { Button, Form, Input, Modal, Popconfirm, Tag, Tooltip } from "antd";
import { Download, Edit2, Plus, Trash2, Upload as UploadIcon } from "lucide-react";
import { App } from "antd";
import { useSkillStore } from "@/stores/use-skill-store";
import type { PromptSkill } from "@/services/api/prompt-skills";

export function SkillPresetPicker() {
    const { message } = App.useApp();
    const allSkills = useSkillStore((s) => s.allSkills)();
    const activeSkillId = useSkillStore((s) => s.activeSkillId);
    const setActiveSkill = useSkillStore((s) => s.setActiveSkill);
    const addLocalSkill = useSkillStore((s) => s.addLocalSkill);
    const updateLocalSkill = useSkillStore((s) => s.updateLocalSkill);
    const deleteLocalSkill = useSkillStore((s) => s.deleteLocalSkill);
    const exportLocalSkills = useSkillStore((s) => s.exportLocalSkills);
    const importLocalSkills = useSkillStore((s) => s.importLocalSkills);
    const localSkills = useSkillStore((s) => s.localSkills);

    const [editingSkill, setEditingSkill] = useState<Partial<PromptSkill> | null>(null);
    const [form] = Form.useForm();
    const isEditing = Boolean(editingSkill?.id);
    const isLocalSkill = (id: string) => id.startsWith("local-");

    useEffect(() => {
        if (editingSkill) form.setFieldsValue({ icon: "🎨", ...editingSkill });
    }, [editingSkill, form]);

    const handleSave = async () => {
        const values = await form.validateFields();
        if (isEditing && editingSkill?.id) {
            updateLocalSkill(editingSkill.id, values);
            message.success("技能已更新");
        } else {
            addLocalSkill({ ...values, author: "本地" });
            message.success("技能已创建");
        }
        setEditingSkill(null);
    };

    const handleExport = () => {
        const json = exportLocalSkills();
        const blob = new Blob([json], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "my-skills.json";
        a.click();
        URL.revokeObjectURL(url);
    };

    const handleImport = () => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".json";
        input.onchange = async (e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (!file) return;
            const text = await file.text();
            const count = importLocalSkills(text);
            message.success(`已导入 ${count} 个技能`);
        };
        input.click();
    };

    if (allSkills.length === 0 && localSkills.length === 0) {
        return (
            <div className="flex items-center gap-2">
                <span className="text-xs text-stone-500 dark:text-stone-400">Skill 预设</span>
                <div className="flex-1" />
                <Tooltip title="新建本地技能">
                    <Button size="small" type="text" icon={<Plus className="size-3.5" />} onClick={() => setEditingSkill({ icon: "🎨" })} />
                </Tooltip>
                <Tooltip title="导入技能 JSON">
                    <Button size="small" type="text" icon={<UploadIcon className="size-3.5" />} onClick={handleImport} />
                </Tooltip>
                {renderModal()}
            </div>
        );
    }

    function renderModal() {
        return (
            <Modal title={isEditing ? "编辑技能" : "新建本地技能"} open={Boolean(editingSkill)} onCancel={() => setEditingSkill(null)} onOk={() => void handleSave()} okText="保存" cancelText="取消" destroyOnHidden width={640}>
                <Form form={form} layout="vertical" requiredMark={false} initialValues={editingSkill || {}}>
                    <div className="grid grid-cols-[80px_1fr] gap-4">
                        <Form.Item name="icon" label="图标">
                            <Input placeholder="🎨" maxLength={2} />
                        </Form.Item>
                        <Form.Item name="name" label="名称" rules={[{ required: true, message: "请输入技能名称" }]}>
                            <Input placeholder="例如：吉卜力风格" />
                        </Form.Item>
                    </div>
                    <Form.Item name="description" label="描述">
                        <Input placeholder="简短描述技能用途" />
                    </Form.Item>
                    <Form.Item name="systemPrompt" label="系统提示词" rules={[{ required: true, message: "请输入系统提示词" }]} extra="这段提示词会注入到 AI 对话中，引导模型生成更好的图片提示词">
                        <Input.TextArea rows={6} placeholder="You are an expert prompt engineer..." />
                    </Form.Item>
                    <div className="grid grid-cols-3 gap-4">
                        <Form.Item name="defaultModel" label="默认模型">
                            <Input placeholder="可选" />
                        </Form.Item>
                        <Form.Item name="defaultQuality" label="默认质量">
                            <Input placeholder="high" />
                        </Form.Item>
                        <Form.Item name="defaultSize" label="默认尺寸">
                            <Input placeholder="1024x1024" />
                        </Form.Item>
                    </div>
                    <Form.Item name="category" label="分类">
                        <Input placeholder="可选，如：风格、角色、场景" />
                    </Form.Item>
                </Form>
            </Modal>
        );
    }

    return (
        <div>
            <div className="flex items-center gap-2 mb-2">
                <span className="text-xs text-stone-500 dark:text-stone-400">Skill 预设</span>
                <div className="flex-1" />
                <Tooltip title="新建本地技能">
                    <Button size="small" type="text" icon={<Plus className="size-3.5" />} onClick={() => setEditingSkill({ icon: "🎨" })} />
                </Tooltip>
                {localSkills.length > 0 && (
                    <Tooltip title="导出本地技能">
                        <Button size="small" type="text" icon={<Download className="size-3.5" />} onClick={handleExport} />
                    </Tooltip>
                )}
                <Tooltip title="导入技能 JSON">
                    <Button size="small" type="text" icon={<UploadIcon className="size-3.5" />} onClick={handleImport} />
                </Tooltip>
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1">
                <Tag.CheckableTag checked={!activeSkillId} onChange={() => setActiveSkill(null)} className={!activeSkillId ? "!bg-stone-200 dark:!bg-stone-700" : ""}>
                    无预设
                </Tag.CheckableTag>
                {allSkills.map((skill) => (
                    <Tooltip key={skill.id} title={skill.description || skill.systemPrompt?.slice(0, 100)}>
                        <Tag.CheckableTag
                            checked={activeSkillId === skill.id}
                            onChange={() => setActiveSkill(activeSkillId === skill.id ? null : skill.id)}
                            className={activeSkillId === skill.id ? "!bg-blue-50 !text-blue-600 !border-blue-200 dark:!bg-blue-900/30 dark:!text-blue-400" : ""}
                        >
                            <span className="mr-1">{skill.icon || "🎨"}</span>
                            {skill.name}
                            {isLocalSkill(skill.id) && (
                                <span className="ml-1 inline-flex gap-0.5">
                                    <button
                                        type="button"
                                        className="hover:text-blue-500"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setEditingSkill(skill);
                                        }}
                                    >
                                        <Edit2 className="size-3" />
                                    </button>
                                    <Popconfirm title="确定删除？" onConfirm={() => deleteLocalSkill(skill.id)} okText="删除" cancelText="取消">
                                        <button
                                            type="button"
                                            className="hover:text-red-500"
                                            onClick={(e) => e.stopPropagation()}
                                        >
                                            <Trash2 className="size-3" />
                                        </button>
                                    </Popconfirm>
                                </span>
                            )}
                        </Tag.CheckableTag>
                    </Tooltip>
                ))}
            </div>
            {renderModal()}
        </div>
    );
}
