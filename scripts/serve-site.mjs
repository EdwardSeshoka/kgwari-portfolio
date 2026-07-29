/**
 * Serves the built `site/` folder over HTTP for local preview.
 *
 * It mirrors the two edge behaviours the deployed site depends on, so that a
 * link which works here works in production:
 *
 *   - extensionless URLs resolve to the index.html inside their folder, the
 *     job of the CloudFront Function in `infra/cdk/lib/stacks/portfolio-stack.ts`;
 *   - anything unresolved answers 404 with `404.html`, the job of the
 *     distribution's error responses.
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, dirname, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const siteDir = join(dirname(fileURLToPath(import.meta.url)), "..", "site");
const port = Number(process.env.PORT ?? 4321);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".json": "application/json",
};

/** The same mapping the CloudFront Function performs. */
function toKey(uri) {
  if (uri.endsWith("/")) return `${uri}index.html`;
  if (uri.lastIndexOf(".") < uri.lastIndexOf("/")) return `${uri}/index.html`;
  return uri;
}

createServer(async (req, res) => {
  const uri = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  const key = normalize(toKey(uri)).replace(/^(\.\.[/\\])+/, "");

  try {
    const body = await readFile(join(siteDir, key));
    res.writeHead(200, {
      "content-type": MIME[extname(key)] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(body);
  } catch {
    try {
      const notFound = await readFile(join(siteDir, "404.html"));
      res.writeHead(404, { "content-type": MIME[".html"], "cache-control": "no-store" });
      res.end(notFound);
    } catch {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end(`Not found: ${key}\nRun \`npm run site\` first.`);
    }
  }
}).listen(port, () => {
  console.log(`Serving ${siteDir} on http://localhost:${port}`);
});
