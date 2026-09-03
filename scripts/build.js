const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");
const { minify } = require("terser");
const { startServer } = require("./dev-server");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "_site");

const STATIC_FILES = ["index.html", "404.html", "styles.css", "app.js", "fuelcheck-products.js", "og-image.png", "CNAME", "googlea7cf71d0f425b9ee.html"];
const STATIC_DIRS = ["img"];

/* Already-relative references (styles.css, img/products/x.webp): prefix
   them with enough "../" to climb back to the site root. */
const REL_ASSET_RE = /(href|src)="(?!https?:\/\/|\/\/|\/|#|mailto:|data:)([^"]+)"/g;

/* Site-root-absolute references (/img/products/x.webp, /find/). The app
   itself thinks in site-root terms at runtime — it resolves those against
   the base path it derives from where app.js loaded — but a *generated*
   page must not, because it may be served from a project subpath. Strip the
   leading slash and give them the same depth-relative prefix, so nothing in
   _site/ depends on the site being mounted at a domain root.
   Excludes "//" (protocol-relative), which is an external reference. */
const ROOT_ASSET_RE = /(href|src)="\/(?!\/)([^"]*)"/g;

const SITE_URL = process.env.SITE_URL || "https://fuelfinder.fit";

function buildSitemap(routes, baseUrl){
  /* "/" is a discovered route in its own right now, so it needs no special
     casing here — it's already first in the list. */
  const urls = routes.filter(r => r.urlPath !== "/requests/").map(r => r.urlPath);
  const body = urls.map(u => `  <url><loc>${baseUrl}${u}</loc></url>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

function buildRobotsTxt(baseUrl){
  /* No Disallow for /requests/ — it's already excluded from the sitemap
     and marked noindex in its own <meta> tag (Task 5). Disallowing it here
     too would stop crawlers from ever fetching it, which means they'd
     never see the noindex tag either — a page can still surface in search
     with no snippet in that case. Letting them fetch it and read the
     noindex tag is the correct way to keep a page out of results. */
  return `User-agent: *\nAllow: /\n\nSitemap: ${baseUrl}/sitemap.xml\n`;
}

function rewriteRelativePaths(html, depth){
  const prefix = "../".repeat(depth);
  return html
    .replace(REL_ASSET_RE, (match, attr, value) => `${attr}="${prefix}${value}"`)
    .replace(ROOT_ASSET_RE, (match, attr, value) => `${attr}="${prefix}${value}"`);
}

function copyRecursive(src, dest){
  const stats = fs.statSync(src);
  if(stats.isDirectory()){
    fs.mkdirSync(dest, { recursive: true });
    for(const entry of fs.readdirSync(src)){
      copyRecursive(path.join(src, entry), path.join(dest, entry));
    }
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

/* app.js and fuelcheck-products.js are hand-written and readable in the
   repo on purpose (they're what the site's own "view source" comments
   point people at) -- this only shrinks the *deployed* copy. Both stay
   plain scripts (not modules), so top-level `const PRODUCTS` etc. still
   land as real globals the way the rest of the app expects. */
const MINIFY_JS = new Set(["app.js", "fuelcheck-products.js"]);

async function copyStaticFiles(){
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  for(const file of STATIC_FILES){
    const dest = path.join(OUT, file);
    if(MINIFY_JS.has(file)){
      const src = fs.readFileSync(path.join(ROOT, file), "utf8");
      const result = await minify(src, { sourceMap: false });
      if(result.error) throw result.error;
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, result.code);
    } else {
      copyRecursive(path.join(ROOT, file), dest);
    }
  }
  for(const dir of STATIC_DIRS){
    copyRecursive(path.join(ROOT, dir), path.join(OUT, dir));
  }
}

async function discoverRoutes(page, port){
  await page.goto(`http://localhost:${port}/`, { waitUntil: "load" });
  const products = await page.evaluate(() =>
    PRODUCTS.map(p => ({ category: p.category, id: p.id }))
  );

  /* The real safety check: a partial or broken catalog file can leave
     PRODUCTS parsed but empty. Bail here, before the fixed routes below are
     appended — once they are, the list is never empty and a count check
     downstream can't tell a healthy build from a catalog that vanished. */
  if(products.length === 0){
    throw new Error("PRODUCTS loaded as empty — fuelcheck-products.js may be broken or partial. Aborting without deploying.");
  }

  return [
    /* Depth 0: the landing page. copyStaticFiles() puts the source
       index.html here first, with its empty <main id="page">; rendering it
       as a route overwrites that with the real, JS-filled content — which
       matters because it's the sitemap's highest-priority URL. */
    { urlPath: "/", filePath: "index.html", depth: 0 },
    ...products.map(p => ({
      urlPath: `/${p.category}/${p.id}/`,
      filePath: `${p.category}/${p.id}/index.html`,
      depth: 2
    })),
    { urlPath: "/find/", filePath: "find/index.html", depth: 1 },
    /* The homepage's "Browse X" cards link straight at these, so a direct
       load, reload or shared link has to resolve to a real file. */
    ...["gel", "drink", "electrolyte"].map(cat => ({
      urlPath: `/find/${cat}/`,
      filePath: `find/${cat}/index.html`,
      depth: 2
    })),
    { urlPath: "/calculator/", filePath: "calculator/index.html", depth: 1 },
    { urlPath: "/search/", filePath: "search/index.html", depth: 1 },
    { urlPath: "/methodology/", filePath: "methodology/index.html", depth: 1 },
    { urlPath: "/about/", filePath: "about/index.html", depth: 1 },
    { urlPath: "/requests/", filePath: "requests/index.html", depth: 1 },
    { urlPath: "/gels/", filePath: "gels/index.html", depth: 1 },
    { urlPath: "/drink-mixes/", filePath: "drink-mixes/index.html", depth: 1 },
    { urlPath: "/electrolytes/", filePath: "electrolytes/index.html", depth: 1 }
  ];
}

async function renderRoute(page, port, route){
  await page.goto(`http://localhost:${port}${route.urlPath}`, { waitUntil: "load" });
  await page.waitForFunction(
    () => document.getElementById("page").children.length > 0,
    { timeout: 5000 }
  );
  /* The dev server injects <base href="/"> into its SPA-fallback response so
     relative assets resolve locally no matter how deep the requested path is.
     That tag must never survive into a generated page: it's already an
     absolute "/" value, so the relative-path rewrite below skips it, and it
     would then override every rewritten "../" reference at deploy time —
     defeating the whole point of depth-relative assets under a subpath. */
  await page.evaluate(() => document.querySelector("base")?.remove());
  let html = await page.evaluate(() => document.documentElement.outerHTML);
  /* Anything built at runtime from location.origin (e.g. the JSON-LD
     Review schema's absolute image URL) reflects wherever Puppeteer
     actually is right now — the local dev server's ephemeral port, not
     the real deployed domain. Fix that up before it ever gets written to
     a file: swap the captured origin for the real one, globally. */
  html = html.split(`http://localhost:${port}`).join(SITE_URL);
  return rewriteRelativePaths(html, route.depth);
}

async function build(){
  await copyStaticFiles();

  let server = null;
  let browser = null;

  try{
    let port;
    ({ server, port } = await startServer(0));
    /* GitHub Actions' runners don't have Chromium's setuid sandbox available
       (no privileged user namespaces), so a plain launch() dies immediately
       with "No usable sandbox!". --no-sandbox is the standard, documented
       fix for exactly this class of CI container — safe here since the
       whole build already runs inside GitHub's own short-lived, single-
       purpose runner, not a shared or untrusted host. */
    browser = await puppeteer.launch({ args: ["--no-sandbox", "--disable-setuid-sandbox"] });
    const page = await browser.newPage();

    const routes = await discoverRoutes(page, port);

    for(const route of routes){
      const html = await renderRoute(page, port, route);
      const outPath = path.join(OUT, route.filePath);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, "<!doctype html>\n" + html);
      console.log(`  wrote ${route.filePath}`);
    }

    fs.writeFileSync(path.join(OUT, "sitemap.xml"), buildSitemap(routes, SITE_URL));
    fs.writeFileSync(path.join(OUT, "robots.txt"), buildRobotsTxt(SITE_URL));

    console.log(`Build complete: ${routes.length} pages generated in _site/, plus sitemap.xml and robots.txt`);
    return routes;
  } finally {
    if(browser) await browser.close();
    if(server) server.close();
  }
}

if(require.main === module){
  build().catch(err => {
    console.error("Build failed:", err);
    process.exit(1);
  });
}

module.exports = { build, rewriteRelativePaths };
