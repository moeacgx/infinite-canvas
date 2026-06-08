"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { nanoid } from "nanoid";
import type { PromptSkill } from "@/services/api/prompt-skills";

type SkillStore = {
    // User's local skills (stored in localStorage)
    localSkills: PromptSkill[];
    // Server skills (fetched, not persisted)
    serverSkills: PromptSkill[];
    // Currently active skill ID (null = no skill)
    activeSkillId: string | null;

    setServerSkills: (skills: PromptSkill[]) => void;
    setActiveSkill: (id: string | null) => void;
    activeSkill: () => PromptSkill | undefined;
    allSkills: () => PromptSkill[];

    // Local skill CRUD
    addLocalSkill: (skill: Omit<PromptSkill, "id" | "createdAt" | "updatedAt">) => string;
    updateLocalSkill: (id: string, updates: Partial<PromptSkill>) => void;
    deleteLocalSkill: (id: string) => void;

    // Import/Export
    exportLocalSkills: () => string; // JSON string
    importLocalSkills: (json: string) => number; // returns count imported
};

export const useSkillStore = create<SkillStore>()(
    persist(
        (set, get) => ({
            localSkills: [],
            serverSkills: [],
            activeSkillId: null,

            setServerSkills: (skills) => set({ serverSkills: skills }),
            setActiveSkill: (id) => set({ activeSkillId: id }),
            activeSkill: () => {
                const state = get();
                const id = state.activeSkillId;
                if (!id) return undefined;
                return [...state.serverSkills, ...state.localSkills].find((s) => s.id === id);
            },
            allSkills: () => {
                const state = get();
                return [...state.serverSkills, ...state.localSkills];
            },

            addLocalSkill: (skill) => {
                const id = `local-${nanoid()}`;
                const now = new Date().toISOString();
                const newSkill: PromptSkill = { ...skill, id, createdAt: now, updatedAt: now };
                set((state) => ({ localSkills: [...state.localSkills, newSkill] }));
                return id;
            },
            updateLocalSkill: (id, updates) =>
                set((state) => ({
                    localSkills: state.localSkills.map((s) =>
                        s.id === id ? { ...s, ...updates, updatedAt: new Date().toISOString() } : s
                    ),
                })),
            deleteLocalSkill: (id) =>
                set((state) => ({
                    localSkills: state.localSkills.filter((s) => s.id !== id),
                    activeSkillId: state.activeSkillId === id ? null : state.activeSkillId,
                })),

            exportLocalSkills: () => JSON.stringify(get().localSkills, null, 2),
            importLocalSkills: (json) => {
                try {
                    const imported = JSON.parse(json) as PromptSkill[];
                    if (!Array.isArray(imported)) return 0;
                    const now = new Date().toISOString();
                    const newSkills = imported
                        .filter((s) => s.name && s.systemPrompt)
                        .map((s) => ({ ...s, id: `local-${nanoid()}`, createdAt: now, updatedAt: now }));
                    set((state) => ({ localSkills: [...state.localSkills, ...newSkills] }));
                    return newSkills.length;
                } catch {
                    return 0;
                }
            },
        }),
        {
            name: "infinite-canvas:skill_store",
            partialize: (state) => ({
                localSkills: state.localSkills,
                activeSkillId: state.activeSkillId,
            }),
        }
    )
);
