import type { Metadata } from "next";

import { CreativeWorkflowWorkspace } from "@/components/workflows/creative-workflow-workspace";

export const metadata: Metadata = {
    title: "创意工作流",
};

export default function WorkflowsPage() {
    return <CreativeWorkflowWorkspace />;
}
