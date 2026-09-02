/**
 * One head builder for every route. Routes describe themselves; canonical, Open
 * Graph, Twitter and JSON-LD are derived here so no route can ship half a set.
 */

export const SITE_URL = "https://atc.fbritoferreira.com";
export const AUTHOR_URL = "https://www.fbritoferreira.com";
export const PAPER_URL = `${AUTHOR_URL}/research/atc-decision-support/`;

export const APP_ID = `${SITE_URL}#app`;
export const PERSON_ID = `${AUTHOR_URL}/#person`;
export const WEBSITE_ID = `${SITE_URL}#website`;

const OG_IMAGE = `${SITE_URL}/logo512.png`;

export const APP_NAME = "ATC Decision Support";
export const APP_TAGLINE =
  "Multi-detector air traffic control decision support";

type MetaTag = Record<string, string>;

export interface SeoOptions {
  /** Route path, always with a leading slash. */
  path: string;
  title: string;
  description: string;
  /** Extra JSON-LD nodes merged into the page graph. */
  nodes?: Array<Record<string, unknown>>;
  /** Trail after Home; the current page is appended automatically. */
  breadcrumb?: Array<{ name: string; path: string }>;
  noIndex?: boolean;
}

/**
 * Cloudflare Pages serves prerendered routes from their directory index and
 * 308s the bare path to the trailing-slash form, so the trailing slash IS the
 * canonical URL. Emitting the bare path pointed every canonical at a redirect.
 */
export const canonicalFor = (path: string) =>
  `${SITE_URL}${path.replace(/\/?$/, "/")}`;

function personNode() {
  return {
    "@type": "Person",
    "@id": PERSON_ID,
    name: "Filipe Brito Ferreira",
    url: AUTHOR_URL,
    sameAs: [
      "https://github.com/fbritoferreira",
      "https://linkedin.com/in/fbritoferreira",
    ],
  };
}

function websiteNode() {
  return {
    "@type": "WebSite",
    "@id": WEBSITE_ID,
    url: `${SITE_URL}/`,
    name: `${APP_NAME} — live demo`,
    description: APP_TAGLINE,
    publisher: { "@id": PERSON_ID },
    inLanguage: "en-GB",
  };
}

/**
 * The application itself. Declared on every route so the SoftwareApplication
 * the whitepaper points at resolves no matter which URL a crawler lands on.
 */
function appNode() {
  return {
    "@type": "SoftwareApplication",
    "@id": APP_ID,
    name: APP_NAME,
    url: `${SITE_URL}/`,
    description:
      "Eleven deterministic doctrinal detectors behind a predictive orchestrator, running against recorded incident scenarios and live ADS-B traffic.",
    applicationCategory: "SimulationApplication",
    operatingSystem: "Web browser",
    browserRequirements: "Requires JavaScript",
    author: { "@id": PERSON_ID },
    publisher: { "@id": PERSON_ID },
    inLanguage: "en-GB",
    isBasedOn: PAPER_URL,
    subjectOf: {
      "@type": "ScholarlyArticle",
      "@id": `${PAPER_URL}#article`,
      url: PAPER_URL,
      headline:
        "A Multi-Detector Decision-Support Architecture for Air Traffic Control",
    },
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
      availability: "https://schema.org/InStock",
    },
  };
}

export function seo(options: SeoOptions) {
  const {
    path,
    title,
    description,
    nodes = [],
    breadcrumb = [],
    noIndex = false,
  } = options;

  const url = canonicalFor(path);
  const fullTitle = path === "/" ? title : `${title} — ${APP_NAME}`;

  const trail = [{ name: "Home", path: "/" }, ...breadcrumb];
  const breadcrumbNode =
    trail.length > 1
      ? [
          {
            "@type": "BreadcrumbList",
            "@id": `${url}#breadcrumb`,
            itemListElement: trail.map((item, i) => ({
              "@type": "ListItem",
              position: i + 1,
              name: item.name,
              item: canonicalFor(item.path),
            })),
          },
        ]
      : [];

  const pageNode = {
    "@type": "WebPage",
    "@id": `${url}#webpage`,
    url,
    name: fullTitle,
    description,
    isPartOf: { "@id": WEBSITE_ID },
    about: { "@id": APP_ID },
    inLanguage: "en-GB",
    ...(breadcrumbNode.length && {
      breadcrumb: { "@id": `${url}#breadcrumb` },
    }),
  };

  const graph = {
    "@context": "https://schema.org",
    "@graph": [
      websiteNode(),
      personNode(),
      appNode(),
      pageNode,
      ...breadcrumbNode,
      ...nodes,
    ],
  };

  const meta: Array<MetaTag> = [
    { title: fullTitle },
    { name: "description", content: description },
    { name: "author", content: "Filipe Brito Ferreira" },
    {
      name: "robots",
      content: noIndex ? "noindex, follow" : "index, follow",
    },
    {
      name: "googlebot",
      content: noIndex
        ? "noindex, follow"
        : "index, follow, max-image-preview:large, max-snippet:-1",
    },
    { property: "og:type", content: "website" },
    { property: "og:site_name", content: `${APP_NAME} — live demo` },
    { property: "og:title", content: fullTitle },
    { property: "og:description", content: description },
    { property: "og:url", content: url },
    { property: "og:locale", content: "en_GB" },
    { property: "og:image", content: OG_IMAGE },
    { property: "og:image:width", content: "512" },
    { property: "og:image:height", content: "512" },
    { property: "og:image:alt", content: `${APP_NAME} radar display` },
    { name: "twitter:card", content: "summary" },
    { name: "twitter:title", content: fullTitle },
    { name: "twitter:description", content: description },
    { name: "twitter:image", content: OG_IMAGE },
    { name: "twitter:creator", content: "@fbritoferreira" },
  ];

  const links = [
    { rel: "canonical", href: url },
    { rel: "alternate", hrefLang: "en-GB", href: url },
    { rel: "alternate", hrefLang: "x-default", href: url },
    // The demo is an artifact of the paper; point crawlers at the source of record.
    { rel: "author", href: PAPER_URL },
  ];

  const scripts = [
    { type: "application/ld+json", children: JSON.stringify(graph) },
  ];

  return { meta, links, scripts };
}

/**
 * Document-level tags only. Canonical, description, Open Graph and JSON-LD are
 * per-page and belong to the leaf route: emitting them here too gave every page
 * two conflicting canonicals and two JSON-LD blocks.
 */
export function rootHead() {
  return {
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { name: "theme-color", content: "#000000" },
      { name: "apple-mobile-web-app-title", content: APP_NAME },
      { name: "application-name", content: APP_NAME },
    ],
    links: [
      { rel: "manifest", href: "/manifest.json" },
      { rel: "icon", href: "/favicon.ico" },
      { rel: "apple-touch-icon", href: "/logo192.png" },
    ],
  };
}
