import { cp, writeFile, readFile, access } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const clientDir = resolve(root, "dist/client");
const shell = resolve(clientDir, "_shell.html");
const index = resolve(clientDir, "index.html");
const SITE_URL = "https://atc.fbritoferreira.com";

const exists = async (p) => {
  try {
    await access(p);
    return true;
  } catch (err) {
    if (err.code === "ENOENT") return false;
    throw err;
  }
};

// The shell is only the fallback for routes that were not prerendered. When a
// prerendered index.html exists it carries the real head for "/" and must not
// be overwritten by the empty shell.
const shellExists = await exists(shell);
const indexIsPrerendered = await exists(index);

if (!shellExists) {
  console.log("[postbuild] no _shell.html found, skipping rename");
} else if (indexIsPrerendered) {
  console.log("[postbuild] index.html is prerendered, keeping it");
} else {
  await writeFile(index, await readFile(shell, "utf8"));
  console.log("[postbuild] _shell.html -> index.html");
}

// The fallback must be /index.html, not /_shell.html. Pages normalises .html
// asset paths to extensionless and issues a 308, so a "/* /_shell.html 200"
// rule turns every request into a redirect to /_shell instead of a rewrite
// (measured on a preview deploy: every route returned 308 -> /_shell).
// index.html is the directory index, which Pages serves without that rewrite.
// Static assets still take precedence over this rule, so prerendered routes
// are served as themselves and only unknown paths fall through to the shell.
await writeFile(resolve(clientDir, "_redirects"), "/* /index.html 200\n");
console.log("[postbuild] wrote _redirects (SPA fallback only — functions handle /api/*)");

// The generated sitemap needs three corrections before it is valid and complete:
// the namespace must be the literal http:// sitemap protocol URI (strict
// validators reject the https variant), "/" is omitted entirely, and link
// crawling adds "/live" alongside "/live/" — two URLs for one page. Pages
// serves the trailing-slash form, so that is the one to advertise.
const sitemapPath = resolve(clientDir, "sitemap.xml");
if (await exists(sitemapPath)) {
  let xml = await readFile(sitemapPath, "utf8");
  xml = xml.replace(
    'xmlns="https://www.sitemaps.org/schemas/sitemap/0.9"',
    'xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"',
  );

  const seen = new Set();
  xml = xml.replace(/\s*<url>[\s\S]*?<\/url>/g, (block) => {
    const loc = block.match(/<loc>(.*?)<\/loc>/)?.[1] ?? "";
    const normalised = loc.replace(/\/?$/, "/");
    if (!normalised || seen.has(normalised)) return "";
    seen.add(normalised);
    return block.replace(loc, normalised);
  });

  if (!seen.has(`${SITE_URL}/`)) {
    const today = new Date().toISOString().slice(0, 10);
    xml = xml.replace(
      "<url>",
      `<url>\n    <loc>${SITE_URL}/</loc>\n    <lastmod>${today}</lastmod>\n  </url>\n  <url>`,
    );
  }
  await writeFile(sitemapPath, xml);
  console.log(`[postbuild] normalised sitemap.xml (${seen.size + 1} urls)`);
}

const functionsSrc = resolve(root, "functions");
const functionsDst = resolve(root, "dist/functions");
try {
  await access(functionsSrc);
  await cp(functionsSrc, functionsDst, { recursive: true });
  console.log("[postbuild] copied functions/ -> dist/functions/ (sibling of client/)");
} catch (err) {
  if (err.code === "ENOENT") {
    console.log("[postbuild] no functions/ dir, skipping");
  } else {
    throw err;
  }
}
