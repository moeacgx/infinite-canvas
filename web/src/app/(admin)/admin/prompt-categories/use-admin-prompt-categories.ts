"use client";

import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App } from "antd";

import { deleteAdminPromptCategory, fetchAdminPromptCategories, saveAdminPromptCategory, type AdminPromptCategory } from "@/services/api/admin";
import { useUserStore } from "@/stores/use-user-store";

export function useAdminPromptCategories() {
    const { message } = App.useApp();
    const queryClient = useQueryClient();
    const token = useUserStore((state) => state.token);
    const clearSession = useUserStore((state) => state.clearSession);

    const categoriesQuery = useQuery({
        queryKey: ["admin", "prompt-categories", token],
        queryFn: () => fetchAdminPromptCategories(token),
        enabled: Boolean(token),
        retry: false,
    });

    const saveMutation = useMutation({
        mutationFn: (category: Partial<AdminPromptCategory>) => saveAdminPromptCategory(token, category),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: ["admin", "prompt-categories"] });
            await queryClient.invalidateQueries({ queryKey: ["admin", "prompts"] });
            message.success("分类已保存");
        },
        onError: (error) => {
            message.error(error instanceof Error ? error.message : "保存失败");
        },
    });

    const deleteMutation = useMutation({
        mutationFn: (category: string) => deleteAdminPromptCategory(token, category),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: ["admin", "prompt-categories"] });
            await queryClient.invalidateQueries({ queryKey: ["admin", "prompts"] });
            message.success("分类已删除");
        },
        onError: (error) => {
            message.error(error instanceof Error ? error.message : "删除失败");
        },
    });

    useEffect(() => {
        const error = categoriesQuery.error;
        if (!error) return;
        const errorMessage = error instanceof Error ? error.message : "读取分类失败";
        message.error(errorMessage);
        if (errorMessage.includes("未登录") || errorMessage.includes("权限不足") || errorMessage.includes("登录状态无效")) clearSession();
    }, [categoriesQuery.error, clearSession, message]);

    return {
        categories: categoriesQuery.data || [],
        isLoading: categoriesQuery.isFetching || saveMutation.isPending || deleteMutation.isPending,
        refreshCategories: () => categoriesQuery.refetch(),
        saveCategory: (category: Partial<AdminPromptCategory>) => saveMutation.mutateAsync(category),
        deleteCategory: (category: string) => deleteMutation.mutateAsync(category),
    };
}
