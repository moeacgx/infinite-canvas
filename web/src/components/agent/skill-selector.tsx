"use client";

import { Tag, Tooltip } from "antd";
import { ImageIcon, Video, Volume2, Sparkles } from "lucide-react";
import type { Skill } from "@/services/api/skills";

const SKILL_ICONS: Record<string, typeof ImageIcon> = {
    generate_image: ImageIcon,
    generate_video: Video,
    generate_audio: Volume2,
};

const SKILL_LABELS: Record<string, string> = {
    generate_image: "生成图片",
    generate_video: "生成视频",
    generate_audio: "生成音频",
};

export function SkillSelector({
    skills,
    enabled,
    onChange,
}: {
    skills: Skill[];
    enabled: string[];
    onChange: (skills: string[]) => void;
}) {
    const toggle = (name: string) => {
        onChange(
            enabled.includes(name)
                ? enabled.filter((s) => s !== name)
                : [...enabled, name]
        );
    };

    if (!skills.length) return null;

    return (
        <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1 text-xs text-stone-500 dark:text-stone-400">
                <Sparkles className="size-3.5" />
                Skills
            </div>
            {skills.map((skill) => {
                const Icon = SKILL_ICONS[skill.name] || Sparkles;
                const label = SKILL_LABELS[skill.name] || skill.name;
                const active = enabled.includes(skill.name);
                const modelCount =
                    skill.parameters.find((p) => p.name === "model")?.enum?.length || 0;
                return (
                    <Tooltip
                        key={skill.name}
                        title={`${skill.description}${modelCount ? ` (${modelCount} 个模型)` : ""}`}
                    >
                        <Tag.CheckableTag
                            checked={active}
                            onChange={() => toggle(skill.name)}
                            className={
                                active
                                    ? "!bg-blue-50 !text-blue-600 !border-blue-200 dark:!bg-blue-900/30 dark:!text-blue-400 dark:!border-blue-700"
                                    : ""
                            }
                        >
                            <Icon className="mr-1 inline size-3" />
                            {label}
                        </Tag.CheckableTag>
                    </Tooltip>
                );
            })}
        </div>
    );
}
