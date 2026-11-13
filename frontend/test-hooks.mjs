// Resolve hook para los tests de Node (node --test): resuelve los imports
// relativos sin extensión del código propio ("./format" -> "./format.ts"),
// como ya hace el bundler de Next. Solo se usa en tests, nunca en la app.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { extname } from "node:path";

export async function resolve(specifier, context, nextResolve) {
  if ((specifier.startsWith("./") || specifier.startsWith("../")) && !extname(specifier)) {
    for (const ext of [".ts", ".tsx", "/index.ts"]) {
      const url = new URL(specifier + ext, context.parentURL);
      if (existsSync(fileURLToPath(url))) {
        return { url: url.href, shortCircuit: true };
      }
    }
  }
  return nextResolve(specifier, context);
}
