"use client";

import { DeleteOutlined, EditOutlined, ExportOutlined, PlusOutlined } from "@ant-design/icons";
import { ProTable, type ProColumns } from "@ant-design/pro-components";
import { Button, Form, Input, Modal, Space, Tag, Tooltip, Typography } from "antd";
import { useEffect, useState } from "react";

import type { AdminPromptCategory } from "@/services/api/admin";
import { useAdminPromptCategories } from "./use-admin-prompt-categories";

export default function AdminPromptCategoriesPage() {
    const { categories, isLoading, refreshCategories, saveCategory, deleteCategory } = useAdminPromptCategories();
    const [form] = Form.useForm<Partial<AdminPromptCategory>>();
    const [editingCategory, setEditingCategory] = useState<Partial<AdminPromptCategory> | null>(null);
    const [deletingCategory, setDeletingCategory] = useState<AdminPromptCategory | null>(null);

    const isEditing = Boolean(editingCategory?.category);

    useEffect(() => {
        if (editingCategory) form.setFieldsValue({ ...editingCategory });
    }, [editingCategory, form]);

    const handleSave = async () => {
        const value = await form.validateFields();
        await saveCategory({ ...editingCategory, ...value });
        setEditingCategory(null);
    };

    const columns: ProColumns<AdminPromptCategory>[] = [
        {
            title: "分类 ID",
            dataIndex: "category",
            width: 200,
            render: (_, item) => <Typography.Text code>{item.category}</Typography.Text>,
        },
        {
            title: "名称",
            dataIndex: "name",
            width: 200,
            render: (_, item) => <Typography.Text strong>{item.name}</Typography.Text>,
        },
        {
            title: "描述",
            dataIndex: "description",
            render: (_, item) => <Typography.Text type="secondary">{item.description || "-"}</Typography.Text>,
        },
        {
            title: "类型",
            dataIndex: "remote",
            width: 100,
            render: (_, item) => (
                <Space size={4}>
                    <Tag color={item.remote ? "blue" : "default"}>{item.remote ? "远程" : "本地"}</Tag>
                    {item.remote && item.githubUrl ? (
                        <Typography.Link href={item.githubUrl} target="_blank">
                            <ExportOutlined />
                        </Typography.Link>
                    ) : null}
                </Space>
            ),
        },
        {
            title: "操作",
            key: "actions",
            width: 100,
            align: "right",
            render: (_, item) => (
                <Space size={4}>
                    <Tooltip title="编辑">
                        <Button type="text" size="small" icon={<EditOutlined />} onClick={() => setEditingCategory(item)} />
                    </Tooltip>
                    <Tooltip title="删除">
                        <Button danger type="text" size="small" icon={<DeleteOutlined />} onClick={() => setDeletingCategory(item)} />
                    </Tooltip>
                </Space>
            ),
        },
    ];

    return (
        <main style={{ padding: 24 }}>
            <ProTable<AdminPromptCategory>
                rowKey="category"
                columns={columns}
                dataSource={categories}
                loading={isLoading}
                search={false}
                defaultSize="middle"
                tableLayout="fixed"
                cardProps={{ variant: "borderless" }}
                headerTitle={
                    <Space>
                        <Typography.Text strong>分类列表</Typography.Text>
                        <Tag>{categories.length} 个</Tag>
                    </Space>
                }
                options={{ density: true, setting: true, reload: () => void refreshCategories() }}
                pagination={false}
                toolBarRender={() => [
                    <Button key="add" type="primary" icon={<PlusOutlined />} onClick={() => setEditingCategory({})}>
                        新增分类
                    </Button>,
                ]}
            />

            <Modal title={isEditing ? "编辑分类" : "新增分类"} open={Boolean(editingCategory)} width={560} onCancel={() => setEditingCategory(null)} onOk={() => void handleSave()} okText="保存" cancelText="取消" destroyOnHidden>
                <Form form={form} layout="vertical" requiredMark={false}>
                    <Form.Item name="category" label="分类 ID" rules={[{ required: true, message: "请输入分类 ID" }]} extra={isEditing ? "分类 ID 创建后不可修改" : "用于内部标识，如 my-prompts"}>
                        <Input disabled={isEditing} placeholder="例如：my-custom-prompts" />
                    </Form.Item>
                    <Form.Item name="name" label="分类名称" rules={[{ required: true, message: "请输入分类名称" }]}>
                        <Input placeholder="例如：我的提示词" />
                    </Form.Item>
                    <Form.Item name="description" label="描述">
                        <Input.TextArea rows={3} placeholder="可选，分类说明" />
                    </Form.Item>
                    {isEditing && editingCategory?.remote ? (
                        <>
                            <Form.Item label="GitHub URL">
                                <Input value={editingCategory.githubUrl} disabled />
                            </Form.Item>
                            <Form.Item label="类型">
                                <Tag color="blue">远程同步分类（不可修改）</Tag>
                            </Form.Item>
                        </>
                    ) : null}
                </Form>
            </Modal>

            <Modal
                title="删除分类"
                open={Boolean(deletingCategory)}
                onCancel={() => setDeletingCategory(null)}
                onOk={async () => {
                    if (!deletingCategory) return;
                    await deleteCategory(deletingCategory.category);
                    setDeletingCategory(null);
                }}
                okText="删除"
                okButtonProps={{ danger: true }}
                cancelText="取消"
            >
                确定删除分类「{deletingCategory?.name}」吗？如果该分类下有提示词，需要先移动或删除后才能删除分类。
            </Modal>
        </main>
    );
}
