import { access } from "node:fs/promises";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith(".") || specifier.startsWith("/")) {
    const parentPath = context.parentURL ? dirname(fileURLToPath(context.parentURL)) : process.cwd();
    const candidate = resolvePath(parentPath, specifier);
    for (const extension of [".ts", ".mjs", ".js"]) {
      try {
        await access(candidate + extension);
        return nextResolve(pathToFileURL(candidate + extension).href, context);
      } catch {
        // Try the next source extension.
      }
    }
  }
  return nextResolve(specifier, context);
}
