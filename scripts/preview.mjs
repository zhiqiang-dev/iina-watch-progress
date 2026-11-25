import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve("dist");
const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, "http://localhost");
    if (url.pathname === "/") {
      response.writeHead(302, { Location: `/ui/sidebar/index.html${url.search}` }).end();
      return;
    }
    const file = path.resolve(root, `.${url.pathname === "/" ? "/ui/sidebar/index.html" : url.pathname}`);
    if (!file.startsWith(`${root}/`)) { response.writeHead(403).end(); return; }
    let body = await readFile(file);
    const appearance = ["light", "dark"].includes(url.searchParams.get("appearance")) ? url.searchParams.get("appearance") : null;
    if (file.endsWith("index.html")) body = Buffer.from(body.toString().replace('<script src="index.js" defer></script>',
      '<script src="/preview.js"></script><script src="index.js" defer></script>').replace('href="style.css"',
      `href="style.css${appearance ? `?appearance=${appearance}` : ""}"`));
    if (file.endsWith("style.css") && appearance) body = Buffer.from(body.toString().replace(
      "@media(prefers-color-scheme:dark)", appearance === "dark" ? "@media all" : "@media not all"));
    const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };
    response.writeHead(200, { "Content-Type": types[path.extname(file)] || "text/plain" }).end(body);
  } catch { response.writeHead(404).end("Not found. Run pnpm build first."); }
});
server.listen(4173, "127.0.0.1", () => process.stdout.write("Preview: http://127.0.0.1:4173\n"));
