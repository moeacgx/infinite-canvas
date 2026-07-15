import { registerHooks } from "node:module";

registerHooks({
    resolve(specifier, context, nextResolve) {
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
