export function createLinkedAbortController(parentSignal?: AbortSignal) {
    const controller = new AbortController();
    if (!parentSignal) return { controller, dispose: () => undefined };

    const abort = () => controller.abort(parentSignal.reason);
    if (parentSignal.aborted) {
        abort();
        return { controller, dispose: () => undefined };
    }

    parentSignal.addEventListener("abort", abort, { once: true });
    return {
        controller,
        dispose: () => parentSignal.removeEventListener("abort", abort),
    };
}
