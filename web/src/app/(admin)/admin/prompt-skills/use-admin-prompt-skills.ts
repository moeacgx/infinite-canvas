"use client";

import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";

import { fetchAdminPromptSkills, saveAdminPromptSkill, deleteAdminPromptSkill, type PromptSkill } from "@/services/api/prompt-skills";
import { useUserStore } from "@/stores/use-user-store";

export function useAdminPromptSkills() {
    const { message } = App.useApp();
    const queryClient = useQueryClient();
    const token = useUserStore((state) => state.token);
    const clearSession = useUserStore((state) => state.clearSession);

    const skillsQuery = useQuery({
        queryKey: ["admin", "prompt-skills", token],
        queryFn: () => fetchAdminPromptSkills(token),
        enabled: Boolean(token),
        retry: false,
    });

    const saveMutation = useMutation({
        mutationFn: (skill: Partial<PromptSkill>) => saveAdminPromptSkill(token, skill),
        onSuccess: async (_, skill) => {
            await queryClient.invalidateQueries({ queryKey: ["admin", "prompt-skills"] });
            message.success(skill.id ? "技能预设已保存" : "技能预设已新增");
        },
        onError: (error) => {
            message.error(error instanceof Error ? error.message : "保存失败");
        },
    });

    const deleteMutation = useMutation({
        mutationFn: (id: string) => deleteAdminPromptSkill(token, id),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: ["admin", "prompt-skills"] });
            message.success("技能预设已删除");
        },
        onError: (error) => {
            message.error(error instanceof Error ? error.message : "删除失败");
        },
    });

    useEffect(() => {
        const error = skillsQuery.error;
        if (!error) return;
        const errorMessage = error instanceof Error ? error.message : "读取技能预设失败";
        message.error(errorMessage);
        if (errorMessage.includes("未登录") || errorMessage.includes("权限不足") || errorMessage.includes("登录状态无效")) clearSession();
    }, [skillsQuery.error, clearSession, message]);

    return {
        skills: skillsQuery.data || [],
        isLoading: skillsQuery.isFetching || saveMutation.isPending || deleteMutation.isPending,
        saveSkill: (skill: Partial<PromptSkill>) => saveMutation.mutateAsync(skill),
        deleteSkill: (id: string) => deleteMutation.mutateAsync(id),
        refreshSkills: () => skillsQuery.refetch(),
    };
}
