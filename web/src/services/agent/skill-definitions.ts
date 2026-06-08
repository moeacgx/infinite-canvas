import type { Skill } from "@/services/api/skills";

export type OpenAITool = {
    type: "function";
    function: {
        name: string;
        description: string;
        parameters: {
            type: "object";
            properties: Record<string, { type: string; description: string; enum?: string[]; minimum?: number; maximum?: number }>;
            required: string[];
        };
    };
};

/**
 * Convert our Skill definitions to OpenAI function calling format.
 */
export function buildToolDefinitions(skills: Skill[]): OpenAITool[] {
    return skills.map((skill) => ({
        type: "function" as const,
        function: {
            name: skill.name,
            description: skill.description,
            parameters: {
                type: "object" as const,
                properties: Object.fromEntries(
                    skill.parameters.map((param) => [
                        param.name,
                        {
                            type: param.type,
                            description: param.description,
                            ...(param.enum ? { enum: param.enum } : {}),
                            ...(param.name === "count" ? { minimum: 1, maximum: 4 } : {}),
                        },
                    ]),
                ),
                required: skill.parameters.filter((p) => p.required).map((p) => p.name),
            },
        },
    }));
}
