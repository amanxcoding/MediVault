import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const contentTypes: Record<string, string> = {
  "app.js": "text/javascript; charset=utf-8",
  "redesign.js": "text/javascript; charset=utf-8",
  "medivault.js": "text/javascript; charset=utf-8",
  "backend-ui.js": "text/javascript; charset=utf-8",
  "styles.css": "text/css; charset=utf-8",
  "medivault-design-system.css": "text/css; charset=utf-8",
};

export async function GET(_request: Request, context: { params: Promise<{ asset: string }> }) {
  const { asset } = await context.params;
  if (!(asset in contentTypes)) return new Response("Not found", { status: 404 });
  const root = process.cwd();
  const content = asset === "app.js"
    ? await readFile(join(root, "app.js"))
    : asset === "redesign.js"
      ? await readFile(join(root, "redesign.js"))
      : asset === "medivault.js"
        ? await readFile(join(root, "medivault.js"))
        : asset === "backend-ui.js"
          ? await readFile(join(root, "backend-ui.js"))
        : asset === "styles.css"
          ? await readFile(join(root, "styles.css"))
          : await readFile(join(root, "medivault-design-system.css"));
  return new Response(content, {
    headers: {
      "Content-Type": contentTypes[asset],
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
