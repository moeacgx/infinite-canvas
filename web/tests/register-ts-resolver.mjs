import { registerHooks } from "node:module";

registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier.startsWith("@/")) {
            const target = new URL(`../src/${specifier.slice(2)}`, import.meta.url).href;
            try {
                return nextResolve(`${target}.ts`, context);
            } catch {
                return nextResolve(`${target}.tsx`, context);
            }
        }
        try {
            return nextResolve(specifier, context);
        } catch (error) {
            const isRelative = specifier.startsWith("./") || specifier.startsWith("../");
            const hasExtension = /\.[a-z0-9]+$/i.test(specifier);
            if (!isRelative || hasExtension) throw error;
            return nextResolve(`${specifier}.ts`, context);
        }
    },
});
