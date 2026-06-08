import { apiGet, apiPost, apiDelete } from "@/services/api/request";

export type PromptSkill = {
    id: string;
    name: string;
    description: string;
    systemPrompt: string;
    icon: string;
    category: string;
    defaultModel: string;
    defaultQuality: string;
    defaultSize: string;
    author: string;
    createdAt: string;
    updatedAt: string;
};

// Public API - fetch server skills for all users
export async function fetchPromptSkills() {
    return apiGet<PromptSkill[]>("/api/prompt-skills");
}

// Admin API
export async function fetchAdminPromptSkills(token: string) {
    return apiGet<PromptSkill[]>("/api/admin/prompt-skills", undefined, token);
}

export async function saveAdminPromptSkill(token: string, skill: Partial<PromptSkill>) {
    return apiPost<PromptSkill>("/api/admin/prompt-skills", skill, token);
}

export async function deleteAdminPromptSkill(token: string, id: string) {
    return apiDelete<boolean>(`/api/admin/prompt-skills/${encodeURIComponent(id)}`, token);
}
