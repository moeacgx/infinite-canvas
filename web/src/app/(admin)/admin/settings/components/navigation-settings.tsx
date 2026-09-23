"use client";

import { App, Button, Empty, Flex, Input, Space, Switch, Typography } from "antd";
import { ArrowDown, ArrowUp, Plus, RotateCcw, Trash2 } from "lucide-react";
import { nanoid } from "nanoid";

import { defaultNavigationItems, type NavigationItem } from "@/lib/navigation";

type NavigationSettingsProps = {
    value?: NavigationItem[];
    onChange?: (items: NavigationItem[]) => void;
};

export function NavigationSettings({ value = defaultNavigationItems, onChange }: NavigationSettingsProps) {
    const { modal } = App.useApp();
    const update = (index: number, patch: Partial<NavigationItem>) => onChange?.(value.map((item, i) => (i === index ? { ...item, ...patch } : item)));
    const move = (index: number, offset: number) => {
        const items = [...value];
        [items[index], items[index + offset]] = [items[index + offset], items[index]];
        onChange?.(items);
    };

    return (
        <Flex vertical gap={12}>
            <Typography.Text type="secondary">为用户侧顶栏添加菜单，移动端导航同步显示，最多 20 项。隐藏菜单只影响入口展示，不限制页面访问。修改后点击“保存设置”生效。</Typography.Text>
            {value.length === 0 && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无菜单，可添加链接或恢复默认" />}
            {value.map((item, index) => (
                <Flex key={item.id} gap={12} align="center" wrap style={{ padding: 12, borderRadius: 8, background: "var(--ant-color-fill-quaternary)" }}>
                    <Typography.Text type="secondary">{index + 1}</Typography.Text>
                    <Input aria-label={`第 ${index + 1} 项菜单名称`} placeholder="菜单名称" maxLength={40} value={item.label} onChange={(event) => update(index, { label: event.target.value })} style={{ width: 160 }} />
                    <Input
                        aria-label={`第 ${index + 1} 项菜单地址`}
                        placeholder="站内路径 /canvas 或 https://example.com"
                        maxLength={2048}
                        value={item.href}
                        onChange={(event) => update(index, { href: event.target.value })}
                        style={{ flex: "1 1 260px" }}
                    />
                    <Space>
                        <Switch aria-label={`显示第 ${index + 1} 项菜单`} checked={item.enabled} onChange={(enabled) => update(index, { enabled })} />
                        <Typography.Text>显示</Typography.Text>
                    </Space>
                    <Space>
                        <Switch aria-label={`第 ${index + 1} 项菜单在新标签打开`} checked={item.newTab} onChange={(newTab) => update(index, { newTab })} />
                        <Typography.Text>新标签</Typography.Text>
                    </Space>
                    <Space size={4}>
                        <Button aria-label={`上移第 ${index + 1} 项菜单`} title="上移" icon={<ArrowUp size={16} />} disabled={index === 0} onClick={() => move(index, -1)} />
                        <Button aria-label={`下移第 ${index + 1} 项菜单`} title="下移" icon={<ArrowDown size={16} />} disabled={index === value.length - 1} onClick={() => move(index, 1)} />
                        <Button danger aria-label={`移除第 ${index + 1} 项菜单`} title="移除" icon={<Trash2 size={16} />} onClick={() => onChange?.(value.filter((_, i) => i !== index))} />
                    </Space>
                </Flex>
            ))}
            <Space wrap>
                <Button icon={<Plus size={16} />} disabled={value.length >= 20} onClick={() => onChange?.([...value, { id: nanoid(), label: "", href: "", enabled: true, newTab: false }])}>
                    添加顶栏菜单
                </Button>
                <Button
                    icon={<RotateCcw size={16} />}
                    onClick={() => modal.confirm({ title: "恢复默认菜单？", content: "当前菜单草稿将替换为默认的六个入口，保存设置后生效。", onOk: () => onChange?.(defaultNavigationItems.map((item) => ({ ...item }))) })}
                >
                    恢复默认
                </Button>
            </Space>
        </Flex>
    );
}
