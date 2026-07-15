import { create } from "zustand";
import { nanoid } from "nanoid";

export type WorkbenchAgentCommand = {
    id: string;
    prompt?: string;
    run: boolean;
};

type WorkbenchAgentStore = {
    imageCommand: WorkbenchAgentCommand | null;
    videoCommand: WorkbenchAgentCommand | null;
    dispatchImage: (command: Omit<WorkbenchAgentCommand, "id">) => string;
    dispatchVideo: (command: Omit<WorkbenchAgentCommand, "id">) => string;
    consumeImage: (id: string) => void;
    consumeVideo: (id: string) => void;
};

export const useWorkbenchAgentStore = create<WorkbenchAgentStore>((set) => ({
    imageCommand: null,
    videoCommand: null,
    dispatchImage: (command) => {
        const id = nanoid();
        set({ imageCommand: { ...command, id } });
        return id;
    },
    dispatchVideo: (command) => {
        const id = nanoid();
        set({ videoCommand: { ...command, id } });
        return id;
    },
    consumeImage: (id) => set((state) => (state.imageCommand?.id === id ? { imageCommand: null } : state)),
    consumeVideo: (id) => set((state) => (state.videoCommand?.id === id ? { videoCommand: null } : state)),
}));
