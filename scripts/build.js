const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");
const { startServer } = require("./dev-server");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "_site");

const STATIC_FILES = ["index.html", "styles.css", "app.js", "fuelcheck-products.js"];
const STATIC_DIRS = ["Product Photos"];

const REL_ASSET_RE = /(href|src)="(?!https?:\/\/|\/\/|\/|#|mailto:|data:)([^"]+)"/g;

function rewriteRelativePaths(html, depth){
  const prefix = "../".repeat(depth);
  return html.replace(REL_ASSET_RE, (match, attr, value) => `${attr}="${prefix}${value}"`);
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

function copyStaticFiles(){
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  for(const file of STATIC_FILES){
    copyRecursive(path.join(ROOT, file), path.join(OUT, file));
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
  return [
    ...products.map(p => ({
      urlPath: `/${p.category}/${p.id}/`,
      filePath: `${p.category}/${p.id}/index.html`,
      depth: 2
    })),
    { urlPath: "/find/", filePath: "find/index.html", depth: 1 },
    { urlPath: "/calculator/", filePath: "calculator/index.html", depth: 1 },
    { urlPath: "/requests/", filePath: "requests/index.html", depth: 1 }
  ];
}

async function renderRoute(page, port, route){
  await page.goto(`http://localhost:${port}${route.urlPath}`, { waitUntil: "load" });
  await page.waitForFunction(
    () => document.getElementById("page").children.length > 0,
    { timeout: 5000 }
  );
  const html = await page.evaluate(() => document.documentElement.outerHTML);
  return rewriteRelativePaths(html, route.depth);
}

async function build(){
  copyStaticFiles();

  const { server, port } = await startServer(0);
  const browser = await puppeteer.launch();
  const page = await browser.newPage();

  try{
    const routes = await discoverRoutes(page, port);

    for(const route of routes){
      const html = await renderRoute(page, port, route);
      const outPath = path.join(OUT, route.filePath);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, "<!doctype html>\n" + html);
      console.log(`  wrote ${route.filePath}`);
    }

    if(routes.length === 0){
      throw new Error("No routes were discovered — PRODUCTS may have failed to load. Aborting without deploying.");
    }

    console.log(`Build complete: ${routes.length} pages generated in _site/`);
    return routes;
  } finally {
    await browser.close();
    server.close();
  }
}

if(require.main === module){
  build().catch(err => {
    console.error("Build failed:", err);
    process.exit(1);
  });
}

module.exports = { build, rewriteRelativePaths };
