/**
 * The pages that make up the site, in reading order.
 *
 * `slug` drives everything: the source fragment (`pages/<slug>.html`), the
 * output path (`site/<slug>/index.html`, or `site/index.html` for the home
 * page), the nav link, and the previous/next pager. Adding a page here and
 * dropping in a matching fragment is the whole job.
 *
 * URLs are extensionless. A CloudFront Function rewrites `/client` to
 * `/client/index.html` at the edge — see `infra/cdk/lib/stacks/portfolio-stack.ts`.
 */
export const pages = [
  {
    slug: "",
    file: "home.html",
    title: "Kgwari — C4 Architecture Diagrams",
    nav: "Overview",
    where: "Overview",
    what: "The platform, and how five repositories fit together",
  },
  {
    slug: "client",
    file: "client.html",
    title: "Kgwari Client — C4 Architecture Diagrams",
    nav: "01 Client",
    where: "Kgwari Client",
    what: "kgwari-frontend-app · Expo · React Native + Web",
  },
  {
    slug: "api",
    file: "api.html",
    title: "Kgwari API — C4 Architecture Diagrams",
    nav: "02 API",
    where: "Kgwari API",
    what: "kgwari-backend-app · AWS CDK · Serverless",
  },
  {
    slug: "shared",
    file: "shared.html",
    title: "Kgwari Shared — C4 Architecture Diagrams",
    nav: "03 Shared",
    where: "Kgwari Shared",
    what: "kgwari-shared · Changesets · GitHub Packages",
  },
  {
    slug: "search",
    file: "search.html",
    title: "Kgwari Search — C4 Architecture Diagrams",
    nav: "04 Search",
    where: "Kgwari Search",
    what: "One ledger · DynamoDB projection · Amazon OpenSearch",
  },
  {
    slug: "localization",
    file: "localization.html",
    title: "Kgwari Localization — C4 Architecture Diagrams",
    nav: "05 Localization",
    where: "Kgwari Localization",
    what: "Seven tags · three content tiers · Bedrock + Amazon Translate",
  },
];

/**
 * The 404 page. Deliberately outside `pages`: it is served by CloudFront's
 * error response rather than reached by navigation, so it has no place in the
 * nav order and no previous/next.
 */
export const notFoundPage = {
  slug: "404",
  file: "404.html",
  title: "Not found — Kgwari Architecture",
  standalone: true,
};

/** `/` for the home page, `/client` for the rest. */
export function href(slug) {
  return slug === "" ? "/" : `/${slug}`;
}
