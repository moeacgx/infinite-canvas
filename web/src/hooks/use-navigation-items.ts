"use client";

import { Link as LinkIcon } from "lucide-react";

import { navigationTools } from "@/constant/navigation-tools";
import { getVisibleNavigationItems } from "@/lib/navigation";
import { useConfigStore } from "@/stores/use-config-store";

export function useNavigationItems() {
    const items = useConfigStore((state) => state.publicSettings?.ui?.navigationItems);
    return getVisibleNavigationItems(items).map((item) => ({
        ...item,
        icon: navigationTools.find((tool) => `/${tool.slug}` === item.href)?.icon ?? LinkIcon,
    }));
}
