"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { pluginType: string; resetKey?: unknown; children: ReactNode; fallback?: ReactNode };
type State = { error: Error | null };

export class CanvasPluginErrorBoundary extends Component<Props, State> {
    state: State = { error: null };

    static getDerivedStateFromError(error: Error): State {
        return { error };
    }

    componentDidCatch(error: Error, info: ErrorInfo) {
        console.error(`[plugin] 渲染失败：${this.props.pluginType}`, error, info);
    }

    componentDidUpdate(previous: Props) {
        if ((previous.pluginType !== this.props.pluginType || previous.resetKey !== this.props.resetKey) && this.state.error) this.setState({ error: null });
    }

    render() {
        if (!this.state.error) return this.props.children;
        return (
            this.props.fallback || (
                <div className="flex h-full min-h-24 w-full flex-col items-center justify-center gap-1 p-4 text-center text-xs text-red-500">
                    <span className="font-medium">插件渲染失败</span>
                    <span className="max-w-full break-all opacity-70">{this.props.pluginType}</span>
                </div>
            )
        );
    }
}
