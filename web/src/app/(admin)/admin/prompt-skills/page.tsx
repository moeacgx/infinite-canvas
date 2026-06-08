"use client";

import { CloudDownloadOutlined, DeleteOutlined, EditOutlined, PlusOutlined } from "@ant-design/icons";
import { ProTable, type ProColumns } from "@ant-design/pro-components";
import { App, Button, Flex, Form, Input, Modal, Space, Tag, Tooltip, Typography } from "antd";
import { useEffect, useState } from "react";

import type { PromptSkill } from "@/services/api/prompt-skills";
import { syncSkillRepo } from "@/services/api/prompt-skills";
import { useAdminPromptSkills } from "./use-admin-prompt-skills";

export default function AdminPromptSkillsPage() {
    const { message } = App.useApp();
    const { skills, isLoading, saveSkill, deleteSkill, refreshSkills } = useAdminPromptSkills();
    const [form] = Form.useForm<Partial<PromptSkill>>();
    const [editingSkill, setEditingSkill] = useState<Partial<PromptSkill> | null>(null);
    const [deletingSkill, setDeletingSkill] = useState<PromptSkill | null>(null);
    const [isSyncing, setIsSyncing] = useState(false);
    const [isSyncOpen, setIsSyncOpen] = useState(false);
    const [syncForm] = Form.useForm<{ repoUrl: string; branch: string; skillsPath: string }>();

    const handleSync = async () => {
        const values = await syncForm.validateFields();
        setIsSyncing(true);
        try {
            const token = (await import("@/stores/use-user-store")).useUserStore.getState().token;
            const result = await syncSkillRepo(token, values.repoUrl, values.branch, values.skillsPath);
            message.success(`已同步 ${result.synced} 个技能`);
            await refreshSkills();
            setIsSyncOpen(false);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "同步失败");
        } finally {
            setIsSyncing(false);
        }
    };

    useEffect(() => {
        if (editingSkill) form.setFieldsValue(editingSkill);
    }, [editingSkill, form]);

    const handleSave = async () => {
        const values = await form.validateFields();
        await saveSkill({ ...editingSkill, ...values });
        setEditingSkill(null);
    };

    const columns: ProColumns<PromptSkill>[] = [
        {
            title: "图标",
            dataIndex: "icon",
            width: 64,
            align: "center",
            render: (_, item) => <span className="text-xl">{item.icon || "🎨"}</span>,
        },
        {
            title: "名称",
            dataIndex: "name",
            width: 180,
            render: (_, item) => (
                <Typography.Text strong ellipsis style={{ maxWidth: 180, display: "block" }}>
                    {item.name}
                </Typography.Text>
            ),
        },
        {
            title: "描述",
            dataIndex: "description",
            width: 260,
            render: (_, item) => (
                <Typography.Text type="secondary" ellipsis style={{ maxWidth: 260, display: "block" }}>
                    {item.description || "-"}
                </Typography.Text>
            ),
        },
        {
            title: "分类",
            dataIndex: "category",
            width: 120,
            render: (_, item) => item.category ? <Tag>{item.category}</Tag> : <Typography.Text type="secondary">-</Typography.Text>,
        },
        {
            title: "默认模型",
            dataIndex: "defaultModel",
            width: 160,
            render: (_, item) => (
                <Typography.Text type="secondary" ellipsis style={{ maxWidth: 160, display: "block" }}>
                    {item.defaultModel || "-"}
                </Typography.Text>
            ),
        },
        {
            title: "作者",
            dataIndex: "author",
            width: 100,
            render: (_, item) => <Typography.Text type="secondary">{item.author || "-"}</Typography.Text>,
        },
        {
            title: "操作",
            key: "actions",
            width: 96,
            align: "right",
            render: (_, item) => (
                <Space size={4}>
                    <Tooltip title="编辑">
                        <Button type="text" size="small" icon={<EditOutlined />} onClick={() => setEditingSkill(item)} />
                    </Tooltip>
                    <Tooltip title="删除">
                        <Button danger type="text" size="small" icon={<DeleteOutlined />} onClick={() => setDeletingSkill(item)} />
                    </Tooltip>
                </Space>
            ),
        },
    ];

    return (
        <main style={{ padding: 24 }}>
            <Flex vertical gap={16}>
                <ProTable<PromptSkill>
                    rowKey="id"
                    columns={columns}
                    dataSource={skills}
                    loading={isLoading}
                    search={false}
                    defaultSize="middle"
                    tableLayout="fixed"
                    cardProps={{ variant: "borderless" }}
                    headerTitle={
                        <Space>
                            <Typography.Text strong>技能预设列表</Typography.Text>
                            <Tag>{skills.length} 条</Tag>
                        </Space>
                    }
                    options={{ density: true, setting: true, reload: () => void refreshSkills() }}
                    toolBarRender={() => [
                        <Button key="sync" icon={<CloudDownloadOutlined />} onClick={() => setIsSyncOpen(true)}>
                            从 GitHub 同步
                        </Button>,
                        <Button key="add" type="primary" icon={<PlusOutlined />} onClick={() => setEditingSkill({ icon: "🎨" })}>
                            新增
                        </Button>,
                    ]}
                    pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (value) => `共 ${value} 条` }}
                />
            </Flex>

            <Modal
                title={editingSkill?.id ? "编辑技能预设" : "新增技能预设"}
                open={Boolean(editingSkill)}
                width={720}
                onCancel={() => setEditingSkill(null)}
                onOk={() => void handleSave()}
                okText="保存"
                cancelText="取消"
                destroyOnHidden
            >
                <Form form={form} layout="vertical" requiredMark={false}>
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
                        <Input.TextArea rows={8} placeholder="You are an expert prompt engineer..." />
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
                    <div className="grid grid-cols-2 gap-4">
                        <Form.Item name="category" label="分类">
                            <Input placeholder="可选，如：风格、角色、场景" />
                        </Form.Item>
                        <Form.Item name="author" label="作者">
                            <Input placeholder="可选" />
                        </Form.Item>
                    </div>
                </Form>
            </Modal>

            <Modal
                title="删除技能预设"
                open={Boolean(deletingSkill)}
                onCancel={() => setDeletingSkill(null)}
                onOk={async () => {
                    if (!deletingSkill) return;
                    await deleteSkill(deletingSkill.id);
                    setDeletingSkill(null);
                }}
                okText="删除"
                okButtonProps={{ danger: true }}
                cancelText="取消"
            >
                确定删除「{deletingSkill?.name}」吗？删除后用户将无法使用此技能预设。
            </Modal>

            <Modal title="从 GitHub 仓库同步 Skills" open={isSyncOpen} onCancel={() => !isSyncing && setIsSyncOpen(false)} onOk={() => void handleSync()} okText="开始同步" okButtonProps={{ loading: isSyncing }} cancelText="取消" destroyOnHidden width={600}>
                <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
                    输入任意 GitHub 仓库地址，系统会自动拉取其 skills 目录下的所有 SKILL.md 文件并导入。支持 OpenDesign、GPT-Image-2-Skill 等开源 skill 仓库。
                </Typography.Paragraph>
                <Form form={syncForm} layout="vertical" requiredMark={false} initialValues={{ repoUrl: "https://github.com/nexu-io/open-design", branch: "main", skillsPath: "skills" }}>
                    <Form.Item name="repoUrl" label="仓库地址" rules={[{ required: true, message: "请输入 GitHub 仓库 URL" }]}>
                        <Input placeholder="https://github.com/owner/repo" />
                    </Form.Item>
                    <Flex gap={16}>
                        <Form.Item name="branch" label="分支" style={{ flex: 1 }}>
                            <Input placeholder="main" />
                        </Form.Item>
                        <Form.Item name="skillsPath" label="Skills 目录路径" style={{ flex: 1 }}>
                            <Input placeholder="skills" />
                        </Form.Item>
                    </Flex>
                </Form>
            </Modal>
        </main>
    );
}
