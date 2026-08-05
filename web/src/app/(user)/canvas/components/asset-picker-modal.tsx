"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { App, Empty, Input, Modal, Pagination, Spin, Tabs, Tag } from "antd";
import { AudioLines, Search } from "lucide-react";

import { cn } from "@/lib/utils";
import { useAssetStore, type Asset } from "@/stores/use-asset-store";
import { fetchAssetLibrary, type AssetLibraryItem } from "@/services/api/assets";
import { uploadImage } from "@/services/image-storage";
import type { InsertAssetPayload } from "../types";

export type AssetPickerTab = "my-assets" | "library";
export type { InsertAssetPayload } from "../types";

type Props = {
    open: boolean;
    defaultTab?: AssetPickerTab;
    onInsert: (payload: InsertAssetPayload) => void;
    onClose: () => void;
};

export function AssetPickerModal({ open, defaultTab = "my-assets", onInsert, onClose }: Props) {
    const [activeTab, setActiveTab] = useState<AssetPickerTab>(defaultTab);

    useEffect(() => {
        if (open) setActiveTab(defaultTab);
    }, [open, defaultTab]);

    return (
        <Modal title="选择素材" open={open} onCancel={onClose} footer={null} width={860} destroyOnHidden styles={{ body: { padding: "0 24px 24px", minHeight: 480 } }}>
            <Tabs
                activeKey={activeTab}
                onChange={(key) => setActiveTab(key as AssetPickerTab)}
                items={[
                    { key: "my-assets", label: "我的素材", children: <MyAssetsTab onInsert={onInsert} /> },
                    { key: "library", label: "素材库", children: <LibraryTab onInsert={onInsert} /> },
                ]}
            />
        </Modal>
    );
}

const PAGE_SIZE = 8;

const kindOptions = [
    { label: "全部", value: "all" },
    { label: "文本", value: "text" },
    { label: "图片", value: "image" },
    { label: "视频", value: "video" },
    { label: "音频", value: "audio" },
];

function LibraryTab({ onInsert }: { onInsert: (payload: InsertAssetPayload) => void }) {
    const { message } = App.useApp();
    const [keyword, setKeyword] = useState("");
    const [kindFilter, setKindFilter] = useState("");
    const [page, setPage] = useState(1);
    const [inserting, setInserting] = useState<string | null>(null);

    const query = useQuery({
        queryKey: ["asset-picker-library", keyword, kindFilter, page],
        queryFn: () => fetchAssetLibrary({ keyword, type: kindFilter, page, pageSize: PAGE_SIZE }),
        retry: false,
    });

    const items = query.data?.items || [];
    const total = query.data?.total || 0;

    const handleInsert = async (asset: AssetLibraryItem) => {
        try {
            setInserting(asset.id);
            const assetType = String(asset.type);
            if (assetType === "text") {
                onInsert({ kind: "text", content: asset.content, title: asset.title, source: "library" });
            } else if (assetType === "video") {
                onInsert({ kind: "video", url: asset.url, title: asset.title, source: "library" });
            } else if (assetType === "audio") {
                onInsert({ kind: "audio", url: asset.url, title: asset.title, source: "library" });
            } else {
                const stored = await uploadImage(asset.url);
                onInsert({ kind: "image", dataUrl: stored.url, storageKey: stored.storageKey, width: stored.width, height: stored.height, bytes: stored.bytes, mimeType: stored.mimeType, title: asset.title, source: "library" });
            }
        } catch (error) {
            message.error(error instanceof Error ? error.message : "插入失败");
        } finally {
            setInserting(null);
        }
    };

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
                <Input
                    className="w-56"
                    size="small"
                    prefix={<Search className="size-3.5 text-stone-400" />}
                    placeholder="搜索素材"
                    value={keyword}
                    allowClear
                    onChange={(e) => {
                        setPage(1);
                        setKeyword(e.target.value);
                    }}
                />
                <div className="flex gap-1.5">
                    {[
                        { label: "全部", value: "" },
                        { label: "文本", value: "text" },
                        { label: "图片", value: "image" },
                        { label: "视频", value: "video" },
                        { label: "音频", value: "audio" },
                    ].map((opt) => (
                        <Tag.CheckableTag
                            key={opt.value || "all"}
                            checked={kindFilter === opt.value}
                            className={cn("prompt-filter-tag", kindFilter === opt.value && "is-active")}
                            onChange={() => {
                                setPage(1);
                                setKindFilter(opt.value);
                            }}
                        >
                            {opt.label}
                        </Tag.CheckableTag>
                    ))}
                </div>
            </div>

            {query.isLoading ? (
                <div className="flex justify-center py-16">
                    <Spin />
                </div>
            ) : items.length ? (
                <div className="grid grid-cols-4 gap-3">
                    {items.map((asset) => (
                        <PickerCard key={asset.id} title={asset.title} kind={asset.type} cover={asset.coverUrl} loading={inserting === asset.id} onClick={() => void handleInsert(asset)} />
                    ))}
                </div>
            ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有素材" className="py-12" />
            )}

            {total > PAGE_SIZE && (
                <div className="flex justify-center">
                    <Pagination size="small" current={page} pageSize={PAGE_SIZE} total={total} onChange={setPage} showSizeChanger={false} />
                </div>
            )}
        </div>
    );
}

function PickerCard({ title, kind, cover, loading, onClick }: { title: string; kind: string; cover: string; loading?: boolean; onClick: () => void }) {
    return (
        <button
            type="button"
            className="group relative cursor-pointer overflow-hidden rounded-lg border border-stone-200 bg-white text-left transition hover:border-stone-400 hover:shadow-md dark:border-stone-700 dark:bg-stone-900 dark:hover:border-stone-500"
            onClick={onClick}
            disabled={loading}
        >
            {cover ? (
                <img src={cover} alt={title} className="aspect-[4/3] w-full object-cover" />
            ) : kind === "audio" ? (
                <div className="flex aspect-[4/3] items-center justify-center bg-stone-100 text-stone-500 dark:bg-stone-800 dark:text-stone-400">
                    <AudioLines className="size-10" />
                </div>
            ) : (
                <div className="flex aspect-[4/3] items-center justify-center bg-stone-100 p-3 text-center text-xs leading-5 text-stone-500 dark:bg-stone-800 dark:text-stone-400">{title}</div>
            )}
            <div className="p-2.5">
                <div className="flex items-center justify-between gap-2">
                    <span className="line-clamp-1 text-xs font-medium text-stone-800 dark:text-stone-200">{title}</span>
                    <Tag className="m-0 shrink-0 text-[10px]">{kind === "image" ? "图片" : kind === "video" ? "视频" : kind === "audio" ? "音频" : "文本"}</Tag>
                </div>
            </div>
            {loading && (
                <div className="absolute inset-0 flex items-center justify-center bg-white/60 dark:bg-stone-900/60">
                    <Spin size="small" />
                </div>
            )}
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-stone-950/0 text-sm font-medium text-white opacity-0 transition group-hover:bg-stone-950/55 group-hover:opacity-100">插入</div>
        </button>
    );
}

function MyAssetsTab({ onInsert }: { onInsert: (payload: InsertAssetPayload) => void }) {
    const assets = useAssetStore((state) => state.assets);
    const [keyword, setKeyword] = useState("");
    const [kindFilter, setKindFilter] = useState("all");
    const [page, setPage] = useState(1);

    const filtered = useMemo(() => {
        const query = keyword.trim().toLowerCase();
        return assets
            .filter((a) => a.kind === "text" || a.kind === "image" || a.kind === "video" || a.kind === "audio")
            .filter((a) => kindFilter === "all" || a.kind === kindFilter)
            .filter((a) => !query || [a.title, ...(a.tags || [])].join(" ").toLowerCase().includes(query));
    }, [assets, keyword, kindFilter]);

    const visible = useMemo(() => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [filtered, page]);

    useEffect(() => {
        const maxPage = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
        setPage((v) => Math.min(v, maxPage));
    }, [filtered.length]);

    const handleInsert = (asset: Asset) => {
        if (asset.kind === "text") {
            onInsert({ kind: "text", content: asset.data.content, title: asset.title, assetId: asset.id, source: "asset" });
        } else {
            onInsert(
                asset.kind === "video"
                    ? {
                          kind: "video",
                          url: asset.data.url,
                          storageKey: asset.data.storageKey,
                          title: asset.title,
                          assetId: asset.id,
                          width: asset.data.width,
                          height: asset.data.height,
                          bytes: asset.data.bytes,
                          mimeType: asset.data.mimeType,
                          source: "asset",
                      }
                    : asset.kind === "audio"
                      ? {
                            kind: "audio",
                            url: asset.data.url,
                            storageKey: asset.data.storageKey,
                            title: asset.title,
                            assetId: asset.id,
                            bytes: asset.data.bytes,
                            mimeType: asset.data.mimeType,
                            durationMs: asset.data.durationMs,
                            source: "asset",
                        }
                      : {
                            kind: "image",
                            dataUrl: asset.data.dataUrl,
                            storageKey: asset.data.storageKey,
                            title: asset.title,
                            assetId: asset.id,
                            width: asset.data.width,
                            height: asset.data.height,
                            bytes: asset.data.bytes,
                            mimeType: asset.data.mimeType,
                            source: "asset",
                        },
            );
        }
    };

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
                <Input
                    className="w-56"
                    size="small"
                    prefix={<Search className="size-3.5 text-stone-400" />}
                    placeholder="搜索素材"
                    value={keyword}
                    allowClear
                    onChange={(e) => {
                        setPage(1);
                        setKeyword(e.target.value);
                    }}
                />
                <div className="flex gap-1.5">
                    {kindOptions.map((opt) => (
                        <Tag.CheckableTag
                            key={opt.value}
                            checked={kindFilter === opt.value}
                            className={cn("prompt-filter-tag", kindFilter === opt.value && "is-active")}
                            onChange={() => {
                                setPage(1);
                                setKindFilter(opt.value);
                            }}
                        >
                            {opt.label}
                        </Tag.CheckableTag>
                    ))}
                </div>
            </div>

            {visible.length ? (
                <div className="grid grid-cols-4 gap-3">
                    {visible.map((asset) => (
                        <PickerCard key={asset.id} title={asset.title} kind={asset.kind} cover={asset.coverUrl || (asset.kind === "image" ? asset.data.dataUrl : "")} onClick={() => handleInsert(asset)} />
                    ))}
                </div>
            ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有素材" className="py-12" />
            )}

            {filtered.length > PAGE_SIZE && (
                <div className="flex justify-center">
                    <Pagination size="small" current={page} pageSize={PAGE_SIZE} total={filtered.length} onChange={setPage} showSizeChanger={false} />
                </div>
            )}
        </div>
    );
}
