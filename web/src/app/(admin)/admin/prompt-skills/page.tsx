"use client";

import { DeleteOutlined, EditOutlined, PlusOutlined } from "@ant-design/icons";
import { ProTable, type ProColumns } from "@ant-design/pro-components";
import { Button, Flex, Form, Input, Modal, Space, Tag, Tooltip, Typography } from "antd";
import { useEffect, useState } from "react";

import type { PromptSkill } from "@/services/api/prompt-skills";
import { useAdminPromptSkills } from "./use-admin-prompt-skills";

export default function AdminPromptSkillsPage() {
    const { skills, isLoading, saveSkill, deleteSkill, refreshSkills } = useAdminPromptSkills();
    const [form] = Form.useForm<Partial<PromptSkill>>();
    const [editingSkill, setEditingSkill] = useState<Partial<PromptSkill> | null>(null);
    const [deletingSkill, setDeletingSkill] = useState<PromptSkill | null>(null);

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
        </main>
    );
}
