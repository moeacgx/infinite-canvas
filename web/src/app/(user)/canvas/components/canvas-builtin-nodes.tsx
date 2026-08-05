import { FileText, Globe2, Group, Image as ImageIcon, Layers3, Music2, Settings2, Video } from "lucide-react";

import { registerNodeDefinitions } from "@/lib/canvas/node-registry";
import type { CanvasNodeDefinition, CanvasNodeResource } from "@/types/canvas-plugin";
import { NODE_SPECS } from "../constants";
import { CanvasNodeType, type CanvasNodeData } from "../types";

function builtinResource(node: CanvasNodeData): CanvasNodeResource | null {
    if ((node.type === CanvasNodeType.Image || node.type === CanvasNodeType.Panorama) && node.metadata?.content) return { kind: "image", url: node.metadata.content };
    if (node.type === CanvasNodeType.Video && node.metadata?.content) return { kind: "video", url: node.metadata.content };
    if (node.type === CanvasNodeType.Audio && node.metadata?.content) return { kind: "audio", url: node.metadata.content };
    if (node.type === CanvasNodeType.Text && (node.metadata?.content || node.metadata?.prompt)) return { kind: "text", text: node.metadata.content || node.metadata.prompt };
    return null;
}

const iconClass = "size-5";
const definitions: CanvasNodeDefinition[] = [
    { type: CanvasNodeType.Text, title: "文本", icon: <FileText className={iconClass} />, resource: builtinResource },
    { type: CanvasNodeType.Image, title: "图片", icon: <ImageIcon className={iconClass} />, minimapColor: "#10b981", keepAspectRatio: (node: CanvasNodeData) => !node.metadata?.freeResize, resource: builtinResource },
    { type: CanvasNodeType.Panorama, title: "全景图", icon: <Globe2 className={iconClass} />, minimapColor: "#22c55e", keepAspectRatio: () => true, resource: builtinResource },
    { type: CanvasNodeType.Video, title: "视频", icon: <Video className={iconClass} />, minimapColor: "#f97316", keepAspectRatio: () => true, resource: builtinResource },
    { type: CanvasNodeType.Audio, title: "音频", icon: <Music2 className={iconClass} />, minimapColor: "#a855f7", resource: builtinResource },
    { type: CanvasNodeType.Config, title: "生成配置", icon: <Settings2 className={iconClass} />, minimapColor: "#60a5fa", hasSourceHandle: false },
    { type: CanvasNodeType.Group, title: "组", icon: <Group className={iconClass} />, minimapColor: "#94a3b8", hasSourceHandle: false },
    { type: CanvasNodeType.Director, title: "导演台", icon: <Layers3 className={iconClass} />, minimapColor: "#06b6d4" },
].map((definition) => {
    const spec = NODE_SPECS[definition.type as CanvasNodeType];
    return { ...definition, title: spec.title, defaultSize: { width: spec.width, height: spec.height }, defaultMetadata: spec.metadata };
});

let registered = false;
export function registerBuiltinNodes() {
    if (registered) return;
    registered = true;
    registerNodeDefinitions(definitions, "builtin");
}
