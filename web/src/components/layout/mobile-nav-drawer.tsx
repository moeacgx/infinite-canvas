"use client";

import { Drawer } from "antd";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { useNavigationItems } from "@/hooks/use-navigation-items";
import { isNavigationItemActive } from "@/lib/navigation";
import { cn } from "@/lib/utils";

type MobileNavDrawerProps = {
    open: boolean;
    onClose: () => void;
};

export function MobileNavDrawer({ open, onClose }: MobileNavDrawerProps) {
    const navigationItems = useNavigationItems();
    const pathname = usePathname();
    return (
        <Drawer title="导航" placement="left" size={280} open={open} onClose={onClose} className="md:hidden">
            <div className="space-y-1">
                {navigationItems.map((tool) => {
                    const Icon = tool.icon;
                    const active = isNavigationItemActive(tool.href, pathname);
                    return (
                        <Link
                            key={tool.id}
                            href={tool.href}
                            target={tool.newTab ? "_blank" : undefined}
                            rel={tool.newTab ? "noopener noreferrer" : undefined}
                            aria-current={active ? "page" : undefined}
                            onClick={onClose}
                            className={cn(
                                "flex items-center gap-3 rounded-lg px-3 py-3 text-base transition",
                                active ? "bg-stone-100 font-medium text-stone-950 dark:bg-stone-800 dark:text-stone-100" : "text-stone-600 hover:bg-stone-100 hover:text-stone-950 dark:text-stone-300 dark:hover:bg-stone-800 dark:hover:text-stone-100",
                            )}
                        >
                            <Icon className="size-5" />
                            <span>{tool.label}</span>
                        </Link>
                    );
                })}
            </div>
        </Drawer>
    );
}
