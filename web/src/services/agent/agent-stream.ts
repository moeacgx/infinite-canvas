export type StreamEvent =
    | { type: "content"; text: string }
    | { type: "tool_call_delta"; index: number; id?: string; name?: string; arguments?: string }
    | { type: "finish"; reason: string };

/**
 * Parse a single SSE chunk (may contain multiple data: lines).
 * Returns an array of events extracted from the chunk.
 */
export function parseAgentStreamChunk(chunk: string): StreamEvent[] {
    const events: StreamEvent[] = [];
    for (const eventBlock of chunk.split("\n\n")) {
        const data = eventBlock
            .split("\n")
            .find((line) => line.startsWith("data: "))
            ?.slice(6);
        if (!data || data === "[DONE]") {
            if (data === "[DONE]") events.push({ type: "finish", reason: "stop" });
            continue;
        }
        try {
            const parsed = JSON.parse(data) as {
                choices?: Array<{
                    delta?: {
                        content?: string | null;
                        tool_calls?: Array<{
                            index: number;
                            id?: string;
                            type?: string;
                            function?: { name?: string; arguments?: string };
                        }>;
                    };
                    finish_reason?: string | null;
                }>;
            };
            const choice = parsed.choices?.[0];
            if (!choice) continue;

            // Content delta
            if (choice.delta?.content) {
                events.push({ type: "content", text: choice.delta.content });
            }

            // Tool call deltas
            if (choice.delta?.tool_calls) {
                for (const tc of choice.delta.tool_calls) {
                    events.push({
                        type: "tool_call_delta",
                        index: tc.index,
                        id: tc.id,
                        name: tc.function?.name,
                        arguments: tc.function?.arguments,
                    });
                }
            }

            // Finish reason
            if (choice.finish_reason) {
                events.push({ type: "finish", reason: choice.finish_reason });
            }
        } catch {
            // Ignore malformed JSON
        }
    }
    return events;
}
