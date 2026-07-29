/**
 * Wraps a page fragment in the shared document shell: head, sticky masthead
 * nav, the page container, the previous/next pager and the colophon.
 *
 * The fragments under `pages/` hold only what is unique to a page — everything
 * that appears on all four lives here, so it cannot drift between copies.
 * A fragment is the *inside* of `.page`; the wrapper is added below.
 */
import { pages, href } from "./pages.mjs";

const BRAND = "Kgwari";
const BRAND_SUB = "C4 Architecture";
const DESCRIPTION =
  "Context, container and component diagrams for the repositories behind Kgwari, a cross-platform wine-discovery product.";

function masthead(currentSlug) {
  const links = pages
    .map((page) => {
      const current = page.slug === currentSlug ? ' aria-current="page"' : "";
      return `<a href="${href(page.slug)}"${current}>${page.nav}</a>`;
    })
    .join("\n        ");

  return `<header class="masthead">
    <div class="masthead-inner">
      <a class="brand" href="/">${BRAND}<span>${BRAND_SUB}</span></a>
      <nav>
        ${links}
      </nav>
    </div>
  </header>`;
}

function pager(currentSlug) {
  const index = pages.findIndex((page) => page.slug === currentSlug);
  const previous = pages[index - 1];
  const next = pages[index + 1];
  if (!previous && !next) return "";

  const link = (page, direction) => `      <a class="${direction}" href="${href(page.slug)}">
        <div class="dir">${direction === "prev" ? "Previous" : "Next"}</div>
        <div class="where">${page.where}</div>
        <div class="what">${page.what}</div>
      </a>`;

  return `
  <nav class="pager">
${[previous && link(previous, "prev"), next && link(next, "next")].filter(Boolean).join("\n")}
  </nav>
`;
}

const COLOPHON = `
  <footer class="colophon">
    <div>Diagrams generated from the PlantUML sources in <code>site-src/diagrams</code></div>
    <div>C4 model · Simon Brown · c4model.com</div>
  </footer>
`;

function document_(title, content) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="${DESCRIPTION}">
<link rel="stylesheet" href="/assets/fonts.css">
<link rel="stylesheet" href="/assets/site.css">
</head>

<body>
${content}
</body>
</html>
`;
}

/**
 * @param {{slug: string, title: string}} page
 * @param {string} body the fragment — the inside of `.page`
 */
export function renderPage(page, body) {
  return document_(
    page.title,
    `  ${masthead(page.slug)}

  <div class="page">
${body}
${pager(page.slug)}${COLOPHON}  </div>`
  );
}

/**
 * The 404 page: no nav, no pager, no page container. It is reached through
 * CloudFront's error response rather than by navigation, so it carries none of
 * the chrome that implies a position in the reading order.
 */
export function renderStandalone(page, body) {
  return document_(page.title, body);
}
