/**
 * Builds the multi-page site into `site/`, which the deploy workflow syncs to
 * S3 wholesale.
 *
 * Output:
 *   site/index.html            the overview
 *   site/<slug>/index.html     one per entry in pages.mjs
 *   site/404.html              served by CloudFront's error response
 *   site/assets/site.css       the page styles
 *   site/assets/fonts.css      the @font-face block
 *   site/assets/fonts/*.woff2  subsetted webfonts, shared across pages
 *   site/assets/diagrams/*.svg the rendered C4 diagrams
 *
 * Assets are emitted as real files rather than inlined: with four pages the
 * fonts alone would otherwise be carried four times, and the browser can cache
 * them once across the whole site.
 *
 * Each page fragment declares its diagrams twice — `data-puml-id` on the frame
 * that gets the <img>, and `data-puml-source` on the <pre> that gets the source
 * text. Both are filled here, and a diagram named in a fragment but missing
 * from `rendered/` fails the build rather than shipping a broken image.
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync, rmSync, cpSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pages, notFoundPage } from "./pages.mjs";
import { renderPage, renderStandalone } from "./layout.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "site");
const assetsDir = join(outDir, "assets");

const escapeHtml = (text) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The intrinsic size, so the frame reserves its space before the SVG arrives. */
function svgSize(svg) {
  const viewBox = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg);
  if (!viewBox) return null;
  return { width: Math.round(Number(viewBox[1])), height: Math.round(Number(viewBox[2])) };
}

// --- collect the diagrams
const diagramsDir = join(here, "diagrams");
const renderedDir = join(here, "rendered");
const diagrams = new Map();

for (const file of readdirSync(diagramsDir).filter((f) => f.endsWith(".puml")).sort()) {
  const id = file.slice(0, -".puml".length);
  let svg;
  try {
    svg = readFileSync(join(renderedDir, `${id}.svg`), "utf8");
  } catch {
    throw new Error(`Missing rendered/${id}.svg — run \`npm run diagrams\` before building.`);
  }
  diagrams.set(id, {
    svg,
    size: svgSize(svg),
    source: readFileSync(join(diagramsDir, file), "utf8").trim(),
  });
}

/** Fills the diagram frames and source blocks a fragment declares. */
function expandDiagrams(html, pageName) {
  const used = new Set();
  let position = 0;

  let expanded = html.replace(
    /<div class="diagram-frame" data-puml-id="([\w-]+)"><\/div>/g,
    (_match, id) => {
      const diagram = diagrams.get(id);
      if (!diagram) throw new Error(`${pageName}: no diagram source named "${id}"`);
      used.add(id);

      const size = diagram.size
        ? ` width="${diagram.size.width}" height="${diagram.size.height}"`
        : "";
      // The first diagram on a page is what the reader is waiting for; deferring
      // it would leave an empty frame at the top. The rest load on approach.
      const loading =
        position++ === 0 ? ` fetchpriority="high"` : ` loading="lazy" decoding="async"`;

      return `<div class="diagram-frame"><img src="/assets/diagrams/${id}.svg" alt="${id} diagram"${size}${loading}></div>`;
    }
  );

  expanded = expanded.replace(
    /<pre data-puml-source="([\w-]+)"><\/pre>/g,
    (_match, id) => {
      const diagram = diagrams.get(id);
      if (!diagram) throw new Error(`${pageName}: no diagram source named "${id}"`);
      used.add(id);
      return `<pre>${escapeHtml(diagram.source)}</pre>`;
    }
  );

  return { html: expanded, used };
}

// --- write the pages
rmSync(outDir, { recursive: true, force: true });
mkdirSync(assetsDir, { recursive: true });

const usedAcrossSite = new Set();

function emit(page, html, standalone) {
  const fragment = readFileSync(join(here, "pages", page.file), "utf8").trimEnd();
  const { html: body, used } = expandDiagrams(fragment, page.file);
  used.forEach((id) => usedAcrossSite.add(id));

  const path = standalone
    ? join(outDir, `${page.slug}.html`)
    : join(outDir, page.slug, "index.html");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, html(page, body));
  return path;
}

const written = [
  ...pages.map((page) => emit(page, renderPage, false)),
  emit(notFoundPage, renderStandalone, true),
];

// --- copy the shared assets
writeFileSync(join(assetsDir, "site.css"), readFileSync(join(here, "styles.css")));
writeFileSync(join(assetsDir, "fonts.css"), readFileSync(join(here, "fonts.css")));
cpSync(join(here, "fonts"), join(assetsDir, "fonts"), { recursive: true });

mkdirSync(join(assetsDir, "diagrams"), { recursive: true });
for (const [id, diagram] of diagrams) {
  writeFileSync(join(assetsDir, "diagrams", `${id}.svg`), diagram.svg);
}

const orphans = [...diagrams.keys()].filter((id) => !usedAcrossSite.has(id));

console.log(`Wrote ${written.length} pages to ${outDir}`);
for (const path of written) console.log(`  · ${path.slice(outDir.length + 1)}`);
console.log(`  ${diagrams.size} diagrams, ${readdirSync(join(here, "fonts")).length} fonts`);
if (orphans.length) {
  console.warn(`  ! rendered but not shown on any page: ${orphans.join(", ")}`);
}
