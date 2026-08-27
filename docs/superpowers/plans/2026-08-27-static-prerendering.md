# Static Prerendering for Indexable Reviews Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every product review (plus Find Your Fuel, the Calculator, and the owner's Requests page) gets a real, distinct, static URL with real content in the HTML — no JavaScript required to see it — while the interactive experience stays exactly as it is today for anyone with JS enabled.

**Architecture:** Extract the site's inline CSS/JS into shared files, switch client-side routing from hash fragments to real paths (`history.pushState`/`popstate`), then add a Node build script that uses a headless browser (Puppeteer) to visit every route of the real, running app and snapshot the rendered HTML into a deployable `_site/` directory — guaranteeing the crawler-visible content can never drift from what a real visitor sees, since it's a capture of the actual app, not a reimplementation. A GitHub Actions workflow runs this on every push to `main` and deploys the result to GitHub Pages, so day-to-day editing (`fuelcheck-products.js`, push) is unchanged.

**Tech Stack:** Vanilla HTML/CSS/JS (no change), Node.js + Puppeteer (build-time only, never shipped to visitors), GitHub Actions + GitHub Pages.

**Spec:** `docs/superpowers/specs/2026-08-27-static-prerendering-design.md`

## Global Constraints

- No framework migration. No new runtime dependency for site visitors — Puppeteer and Node are build-time only.
- The day-to-day editing workflow (edit `fuelcheck-products.js`, push) must not change.
- Generated pages must render identically to the live app — content is captured from the real running app, never reimplemented in a second language/runtime.
- Asset references on generated pages must be relative (computed by folder depth), not root-absolute, because final hosting location (root domain vs. GitHub Pages project subpath) isn't decided yet.
- This plan proceeds against `main`'s current `index.html` (1536 lines, confirmed via `wc -l` on the `seo-prerendering-spec` branch). A separate branch, `mobile-nav-fix` (PR #1), also touches `index.html` and is not yet merged — this plan's CSS/JS extraction will need a rebase once that lands. Do not merge the two branches as part of this plan; that's a follow-up the user will handle.

**Planning-level refinement not in the spec's file-structure diagram:** the spec shows generated files (`gel/<id>/index.html`, etc.) living directly in the repo tree. This plan instead has the build script assemble everything — the static source files plus every generated page — into a `_site/` output directory, which is what actually gets deployed. This changes nothing about the final URLs or site behavior; it just keeps CI build output out of the tracked source repo (so `node_modules/`, `scripts/`, `docs/`, `.github/`, etc. never end up shipped to visitors) — a standard build/output separation. If the user objects to this when reviewing, it's a one-line change to the artifact-upload path in Task 8.

---

## File Structure

```
/                                    (repo root — source, unchanged philosophy)
├── index.html                       # MODIFY: extract <style>/<script>, add real-path links
├── styles.css                       # NEW (Task 1): extracted CSS
├── app.js                           # NEW (Task 2): extracted JS, later modified (Tasks 4-5)
├── fuelcheck-products.js            # unchanged
├── Product Photos/                  # unchanged
├── package.json                     # NEW (Task 3, extended Task 6)
├── scripts/
│   ├── dev-server.js                # NEW (Task 3): local static server + SPA fallback
│   └── build.js                     # NEW (Task 6, extended Task 7): prerendering + sitemap/robots
├── .github/workflows/
│   └── deploy.yml                   # NEW (Task 8)
└── _site/                           # BUILD OUTPUT ONLY — never committed, gitignored (Task 6)
    ├── index.html, styles.css, app.js, fuelcheck-products.js, Product Photos/  (copied)
    ├── gel/<id>/index.html          # generated, one per gel
    ├── drink/<id>/index.html        # generated, one per drink mix
    ├── electrolyte/<id>/index.html  # generated, one per electrolyte
    ├── find/index.html              # generated
    ├── calculator/index.html        # generated
    ├── requests/index.html          # generated, noindex, excluded from sitemap
    ├── sitemap.xml                  # generated
    └── robots.txt                   # generated
```

---

### Task 1: Extract inline CSS into `styles.css`

**Files:**
- Create: `styles.css`
- Modify: `index.html:54-399` (the `<style>...</style>` block)

**Interfaces:**
- Produces: a `styles.css` file at the repo root containing exactly the current inline CSS, referenced by `index.html` via `<link rel="stylesheet" href="styles.css">`.

- [ ] **Step 1: Create `styles.css` with the current inline CSS**

Copy the contents of `index.html` lines 55-398 (everything between the `<style>` and `</style>` tags, not including those tags themselves) verbatim into a new file `styles.css`.

- [ ] **Step 2: Replace the inline block in `index.html` with a link tag**

Replace:
```html
<style>
:root{
  --ground:#07090C; --panel:#0C1015; --sunk:#04060899;
  ...
.calc-link:hover{color:var(--me)}
</style>
```
(the full block from `index.html:54` through `index.html:399`) with:
```html
<link rel="stylesheet" href="styles.css">
```

- [ ] **Step 3: Verify the site still renders identically**

```bash
cd "/Users/lourenco/Desktop/Personal/Claude Projects/Fuel Finder"
python3 -m http.server 8935 > /tmp/ff-verify.log 2>&1 &
sleep 1
curl -s http://localhost:8935/styles.css | head -3
curl -s http://localhost:8935/index.html | grep -c '<style>'
```
Expected: `styles.css` returns real CSS content (starts with `:root{`), and the grep for `<style>` in `index.html` returns `0` (no inline style block left).

Then open `http://localhost:8935/index.html` in a browser and visually confirm the homepage looks identical to before (dark background, cyan accents, header nav styled correctly). Stop the server: `kill %1`.

- [ ] **Step 4: Commit**

```bash
git add styles.css index.html
git commit -m "Extract inline CSS into styles.css"
```

---

### Task 2: Extract inline JS into `app.js`

**Files:**
- Create: `app.js`
- Modify: `index.html:427-1534` (the two inline `<script>` blocks, keeping the `fuelcheck-products.js` script tag)

**Interfaces:**
- Produces: `app.js` at the repo root, loaded after `fuelcheck-products.js`, containing every function this plan's later tasks modify (`select`, `routeFromHash`, `clearNavHighlights`, `categoryCardsHTML`, `renderAdminGate`, `renderRequestsAdmin`, etc.) exactly as they exist today.

- [ ] **Step 1: Create `app.js` from the two inline script blocks**

Copy `index.html` lines 429-625 (the first inline `<script>` block's content — `CATEGORY_LABEL` through `esc`/`money`/`ord`) followed immediately by lines 628-1533 (the second inline `<script>` block's content — `prov` through the final `routeFromHash();` call) into a new file `app.js`, in that order, with nothing else in between. Do not modify any of the copied code in this task — it's a pure relocation.

- [ ] **Step 2: Replace the two script blocks in `index.html` with one script tag**

`index.html` currently has, in order:
```html
<script src="fuelcheck-products.js"></script>
<script>
const CATEGORY_LABEL = {gel:"gel", drink:"drink mix", electrolyte:"electrolyte"};
...
const ord = n => n + (["th","st","nd","rd"][(n%100-20)%10] || ["th","st","nd","rd"][n%100] || "th");

</script>
<script>
function prov(p){
...
routeFromHash();
</script>
</body>
</html>
```

Replace everything from the first `<script>` (the one starting with `const CATEGORY_LABEL`) through the final `</script>` with:
```html
<script src="app.js"></script>
```

So the end of the file becomes:
```html
<script src="fuelcheck-products.js"></script>
<script src="app.js"></script>
</body>
</html>
```

- [ ] **Step 3: Verify the site is fully functional**

```bash
cd "/Users/lourenco/Desktop/Personal/Claude Projects/Fuel Finder"
python3 -m http.server 8935 > /tmp/ff-verify.log 2>&1 &
sleep 1
curl -s http://localhost:8935/app.js | head -3
curl -s http://localhost:8935/index.html | grep -c 'function select'
```
Expected: `app.js` starts with `const CATEGORY_LABEL`, and the grep against `index.html` returns `0` (no leftover inline JS).

Then open `http://localhost:8935/index.html` in a browser, open the browser console, and confirm there are no JS errors on load. Click into a product review, confirm the comparison table and score breakdown render. Use the browser back button, confirm it returns to the homepage. Stop the server: `kill %1`.

- [ ] **Step 4: Commit**

```bash
git add app.js index.html
git commit -m "Extract inline JS into app.js"
```

---

### Task 3: Local dev server with SPA fallback

**Files:**
- Create: `scripts/dev-server.js`
- Create: `package.json`

**Interfaces:**
- Produces: `startServer(port = 0)` — an async function returning `{ server, port }`, exported from `scripts/dev-server.js` via `module.exports`. `port: 0` lets the OS assign a free port (used by tests and, later, by the build script); a specific port can be passed for interactive use. Task 6 imports and reuses this function directly — it must not be duplicated there.
- Consumes: nothing from earlier tasks except the repo's static files (`index.html`, `styles.css`, `app.js`, `fuelcheck-products.js`, `Product Photos/`), which must already be correct on disk (Tasks 1-2).

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "fuel-finder-build",
  "private": true,
  "version": "1.0.0",
  "scripts": {
    "dev": "node scripts/dev-server.js"
  }
}
```

- [ ] **Step 2: Create `scripts/dev-server.js`**

```js
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const MIME = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".xml": "application/xml",
  ".txt": "text/plain"
};

function startServer(port = 0){
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent(req.url.split("?")[0]);
      const filePath = path.join(ROOT, urlPath);

      fs.stat(filePath, (err, stats) => {
        if(!err && stats.isFile()){
          serveFile(filePath, res);
          return;
        }
        if(!err && stats.isDirectory()){
          const indexPath = path.join(filePath, "index.html");
          if(fs.existsSync(indexPath)){
            serveFile(indexPath, res);
            return;
          }
        }
        serveFallback(res);
      });
    });
    server.listen(port, () => {
      resolve({ server, port: server.address().port });
    });
  });
}

function serveFile(filePath, res){
  const ext = path.extname(filePath);
  res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
  fs.createReadStream(filePath).pipe(res);
}

function serveFallback(res){
  const indexPath = path.join(ROOT, "index.html");
  let html = fs.readFileSync(indexPath, "utf8");
  /* Only this local dev/build server needs this: it's always mounted at
     its own root (no hosting subpath to worry about locally), so a fixed
     base href makes every relative asset reference in index.html resolve
     correctly no matter how deep the requested path is (e.g.
     /gel/some-id/). The source file itself stays untouched — this string
     is injected only in the HTTP response, never written to disk — and
     the eventually-deployed generated pages get their own depth-correct
     rewrite from the build script (Task 6), independent of this. */
  html = html.replace("<head>", '<head>\n<base href="/">');
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(html);
}

if(require.main === module){
  startServer(process.env.PORT ? Number(process.env.PORT) : 4173).then(({ port }) => {
    console.log(`Dev server running at http://localhost:${port}/`);
  });
}

module.exports = { startServer };
```

- [ ] **Step 3: Verify real files, directory-index, and the SPA fallback all serve correctly**

```bash
cd "/Users/lourenco/Desktop/Personal/Claude Projects/Fuel Finder"
PORT=4173 node scripts/dev-server.js &
sleep 1

echo "--- real file ---"
curl -s http://localhost:4173/styles.css | head -1

echo "--- real file, index.html itself ---"
curl -s http://localhost:4173/index.html | grep -c '<title>Fuel Finder'

echo "--- fallback for an unmatched deep path ---"
curl -s http://localhost:4173/gel/maurten-gel-100/ | grep -c '<base href="/">'

kill %1
```
Expected: first command prints `:root{...}` (real CSS); second prints `1` (index.html served correctly); third prints `1` (fallback injected the base tag — no such file/directory exists yet, since generation doesn't happen until Task 6).

- [ ] **Step 4: Commit**

```bash
git add package.json scripts/dev-server.js
git commit -m "Add local dev server with SPA fallback for unmatched routes"
```

---

### Task 4: Migrate routing from hash to real paths

**Files:**
- Modify: `app.js` (functions: `select`, `clearNavHighlights`, `categoryCardsHTML`, `routeFromHash`→`routeFromPath`, the `hashchange` listener, the `home-link` click handler)
- Modify: `index.html:404-410` (header nav markup), `index.html` (the `.home-go` click delegation inside the big `page.addEventListener("click", ...)` handler — now in `app.js` after Task 2, not `index.html`)

**Interfaces:**
- Produces: `routeFromPath()` (replaces `routeFromHash()`), reading `location.pathname` instead of `location.hash`. Every other task and any future code that needs to trigger routing calls this function by this name.
- Consumes: nothing new — this is a rename/behavior change of existing functions relocated to `app.js` by Task 2.

- [ ] **Step 1: Update `select()` to push a real path instead of a hash**

Find this in `app.js` (relocated from the original `index.html:967-981`, unchanged by Task 2):
```js
function select(i){
  const p = PRODUCTS[i];
  document.querySelectorAll(".dd button[data-i]").forEach(b => b.setAttribute("aria-current", +b.dataset.i === i));
  clearNavHighlights();
  document.querySelectorAll(".nav > .nv > a").forEach(a => a.classList.toggle("on", a.dataset.cat === p.category));
  const ids = compareIds[p.category];
  if(!ids.includes(p.id)) ids.unshift(p.id);
  /* Permalink: #category/id, pushed so Back/Forward walk reviews. Skipped when
     the hash already matches (we were called FROM the router) so routing in
     never stacks a duplicate history entry. */
  const want = "#" + p.category + "/" + p.id;
  if(location.hash !== want){ try{ history.pushState(null, "", want); }catch(err){} }
  document.title = p.name + " — Fuel Finder";
  render(p);
}
```

Replace with:
```js
function select(i){
  const p = PRODUCTS[i];
  document.querySelectorAll(".dd button[data-i]").forEach(b => b.setAttribute("aria-current", +b.dataset.i === i));
  clearNavHighlights();
  document.querySelectorAll(".nav > .nv > a").forEach(a => a.classList.toggle("on", a.dataset.cat === p.category));
  const ids = compareIds[p.category];
  if(!ids.includes(p.id)) ids.unshift(p.id);
  /* Permalink: /category/id/, pushed so Back/Forward walk reviews. Skipped
     when the path already matches (we were called FROM the router) so
     routing in never stacks a duplicate history entry. */
  const want = "/" + p.category + "/" + p.id + "/";
  if(location.pathname !== want){ try{ history.pushState(null, "", want); }catch(err){} }
  document.title = p.name + " — Fuel Finder";
  render(p);
}
```

- [ ] **Step 2: Update `routeFromHash` → `routeFromPath`, reading the path instead of the hash**

Find:
```js
/* Hash routing. #category/product-id is a review permalink, #requests is the
   owner view, and anything else — including no hash — is the landing page.
   select() pushes permalinks; Back/Forward arrive here via hashchange. */
function routeFromHash(){
  const h = location.hash.slice(1);
  if(h === "requests"){ renderRequestsAdmin(); return; }
  if(h === "find"){ renderFinder(); return; }
  const fm = h.match(/^find\/([a-z]+)$/);
  if(fm){ renderFinder(fm[1]); return; }
  if(h === "calculator"){ renderCalculator(); return; }
  const m = h.match(/^([a-z]+)\/(.+)$/);
  if(m){
    const p = PRODUCTS.find(x => x.category === m[1] && x.id === m[2]);
    if(p){ select(PRODUCTS.indexOf(p)); return; }
  }
  renderHome();
}
window.addEventListener("hashchange", routeFromHash);

document.getElementById("home-link").addEventListener("click", e => {
  e.preventDefault();
  closeMenu();
  /* push, not replace: Back from the landing page returns to the review */
  try{ history.pushState(null, "", location.pathname); }catch(err){}
  renderHome();
});

routeFromHash();
```

Replace with:
```js
/* Path routing. /category/product-id/ is a review permalink, /requests/ is
   the owner view, and anything else — including bare / — is the landing
   page. select() pushes permalinks; Back/Forward arrive here via popstate. */
function routeFromPath(){
  const h = location.pathname.replace(/^\/|\/$/g, "");
  if(h === "requests"){ renderRequestsAdmin(); return; }
  if(h === "find"){ renderFinder(); return; }
  const fm = h.match(/^find\/([a-z]+)$/);
  if(fm){ renderFinder(fm[1]); return; }
  if(h === "calculator"){ renderCalculator(); return; }
  const m = h.match(/^([a-z]+)\/(.+)$/);
  if(m){
    const p = PRODUCTS.find(x => x.category === m[1] && x.id === m[2]);
    if(p){ select(PRODUCTS.indexOf(p)); return; }
  }
  renderHome();
}
window.addEventListener("popstate", routeFromPath);

document.getElementById("home-link").addEventListener("click", e => {
  e.preventDefault();
  closeMenu();
  /* push, not replace: Back from the landing page returns to the review */
  try{ history.pushState(null, "", "/"); }catch(err){}
  renderHome();
});

routeFromPath();
```

- [ ] **Step 3: Intercept clicks on the "Browse X" homepage links so they navigate client-side**

Find `categoryCardsHTML` in `app.js` (relocated from the original `index.html:1375-1390`):
```js
function categoryCardsHTML(){
  return `<div class="home-cats">
    ${["gel","drink","electrolyte"].map(cat => {
      const items = PRODUCTS.filter(p => p.category === cat);
      const label = CATEGORY_PLURAL[cat];
      return `
      <div class="home-cat">
        <h2>${label[0].toUpperCase()+label.slice(1)}</h2>
        <p>${items.length} reviewed</p>
        ${items.length
          ? `<a href="#find/${cat}" class="home-go">Browse ${label}</a>`
          : `<p class="home-soon">Coming soon</p>`}
      </div>`;
    }).join("")}
  </div>`;
}
```

Replace the `<a href=...>` line with:
```js
          ? `<a href="/find/${cat}/" class="home-go" data-fc-link="${cat}">Browse ${label}</a>`
```

Now find the delegated click handler in `app.js` (relocated from the original `index.html:1062-1063`):
```js
  const go = e.target.closest(".home-go");
  if(go && go.dataset.i !== undefined){ select(+go.dataset.i); return; }
```

Add a new branch immediately after it, so both are present:
```js
  const go = e.target.closest(".home-go");
  if(go && go.dataset.i !== undefined){ select(+go.dataset.i); return; }

  const fcLink = e.target.closest("[data-fc-link]");
  if(fcLink){
    e.preventDefault();
    const cat = fcLink.dataset.fcLink;
    try{ history.pushState(null, "", "/find/" + cat + "/"); }catch(err){}
    renderFinder(cat);
    return;
  }
```

- [ ] **Step 4: Update the header's Find Your Fuel / Calculator links to real paths and intercept them**

In `index.html`, find:
```html
    <a href="#find" id="find-link">Find Your Fuel</a>
    <a href="#calculator" id="calc-link">Calculator</a>
```

Replace with:
```html
    <a href="/find/" id="find-link">Find Your Fuel</a>
    <a href="/calculator/" id="calc-link">Calculator</a>
```

In `app.js`, find the block that wires up `.nv > a` click handling (relocated from the original `index.html:989-998`):
```js
document.querySelectorAll(".nv > a").forEach(link => {
  link.addEventListener("click", e => {
    e.preventDefault();
    const nv = link.parentElement;
    const wasOpen = nv.classList.contains("open");
    closeMenu();
    nv.classList.toggle("open", !wasOpen);
    link.setAttribute("aria-expanded", String(!wasOpen));
  });
});
```

Add immediately after it:
```js
document.getElementById("find-link").addEventListener("click", e => {
  e.preventDefault();
  try{ history.pushState(null, "", "/find/"); }catch(err){}
  renderFinder();
});
document.getElementById("calc-link").addEventListener("click", e => {
  e.preventDefault();
  try{ history.pushState(null, "", "/calculator/"); }catch(err){}
  renderCalculator();
});
```

- [ ] **Step 5: Verify routing end-to-end using the dev server**

```bash
cd "/Users/lourenco/Desktop/Personal/Claude Projects/Fuel Finder"
PORT=4173 node scripts/dev-server.js &
sleep 1
```

Then, in a browser, navigate to `http://localhost:4173/`:
- Click into any product review. Confirm the address bar shows a real path like `/gel/maurten-gel-100/`, not a hash.
- Click the browser Back button. Confirm it returns to the homepage.
- Click "Find Your Fuel" in the header. Confirm the address bar shows `/find/`.
- From the homepage, click "Browse Gels". Confirm the address bar shows `/find/gel/` and the quiz is pre-set to Gels.
- Reload the browser directly at `http://localhost:4173/gel/maurten-gel-100/`. Confirm the Maurten Gel 100 review renders correctly (this is the dev server's SPA fallback + `<base>` injection from Task 3 doing its job — if this fails, re-check Task 3's fallback logic before continuing).

```bash
kill %1
```

- [ ] **Step 6: Commit**

```bash
git add app.js index.html
git commit -m "Switch client-side routing from hash fragments to real paths"
```

---

### Task 5: Per-product meta description and Requests page noindex

**Files:**
- Modify: `app.js` (functions: `select`, `clearNavHighlights`, `renderAdminGate`, `renderRequestsAdmin`)

**Interfaces:**
- Produces: `setMetaDescription(text)`, `stripHtml(s)`, `setRobotsMeta(value)` — helper functions added to `app.js`. Task 6/7's build script relies on their effect (the rendered `<meta>` tags) but never calls them directly.
- Consumes: `p.thesis` (already exists on every product in `fuelcheck-products.js`), `clearNavHighlights()` (already exists, called by every render path — confirmed in Task 4).

- [ ] **Step 1: Add the helper functions**

Add anywhere in `app.js` at top level (e.g. near `esc`/`money`/`ord`):
```js
function stripHtml(s){ return String(s).replace(/<[^>]+>/g, ""); }

const DEFAULT_DESCRIPTION = "Gel, drink mix and electrolyte reviews built from declared nutrition panels — cost per gram, sodium and absorption rate compared across every product, not marketing copy.";

function setMetaDescription(text){
  document.querySelector('meta[name="description"]').setAttribute("content", text);
}

function setRobotsMeta(value){
  let tag = document.querySelector('meta[name="robots"]');
  if(value){
    if(!tag){
      tag = document.createElement("meta");
      tag.setAttribute("name", "robots");
      document.head.appendChild(tag);
    }
    tag.setAttribute("content", value);
  } else if(tag){
    tag.remove();
  }
}
```

- [ ] **Step 2: Reset description and robots meta on every render, then override per-product**

Find `clearNavHighlights` in `app.js` (relocated from the original `index.html:945-949`):
```js
function clearNavHighlights(){
  document.querySelectorAll(".nav > .nv > a").forEach(a => a.classList.remove("on"));
  document.getElementById("find-link").classList.remove("on");
  document.getElementById("calc-link").classList.remove("on");
}
```

Replace with:
```js
function clearNavHighlights(){
  document.querySelectorAll(".nav > .nv > a").forEach(a => a.classList.remove("on"));
  document.getElementById("find-link").classList.remove("on");
  document.getElementById("calc-link").classList.remove("on");
  setMetaDescription(DEFAULT_DESCRIPTION);
  setRobotsMeta(null);
}
```

Now find `select()` again (as modified in Task 4) and add the description override right after the title line:
```js
  document.title = p.name + " — Fuel Finder";
  render(p);
```
becomes:
```js
  document.title = p.name + " — Fuel Finder";
  setMetaDescription(stripHtml(p.thesis));
  render(p);
```

- [ ] **Step 3: Mark the Requests page noindex**

Find `renderAdminGate` in `app.js` (relocated from the original `index.html:1449-1466`):
```js
function renderAdminGate(){
  document.title = "Owner view — Fuel Finder";
  clearNavHighlights();
```

Replace with:
```js
function renderAdminGate(){
  document.title = "Owner view — Fuel Finder";
  clearNavHighlights();
  setRobotsMeta("noindex");
```

Find `renderRequestsAdmin` (relocated from the original `index.html:1480-1484`):
```js
function renderRequestsAdmin(){
  if(localStorage.getItem(ADMIN_UNLOCK_KEY) !== "1"){ renderAdminGate(); return; }
  document.title = "Requested reviews — Fuel Finder";
  clearNavHighlights();
```

Replace with:
```js
function renderRequestsAdmin(){
  if(localStorage.getItem(ADMIN_UNLOCK_KEY) !== "1"){ renderAdminGate(); return; }
  document.title = "Requested reviews — Fuel Finder";
  clearNavHighlights();
  setRobotsMeta("noindex");
```

- [ ] **Step 4: Verify**

```bash
cd "/Users/lourenco/Desktop/Personal/Claude Projects/Fuel Finder"
PORT=4173 node scripts/dev-server.js &
sleep 1
```

In a browser at `http://localhost:4173/`, open the console and run:
```js
document.querySelector('meta[name="description"]').content
```
Expected: the default site description.

Click into the Maurten Gel 100 review, run the same console command again. Expected: a plain-text version of that product's thesis, with no `<b>` tags visible.

Navigate to `http://localhost:4173/requests/`, run:
```js
document.querySelector('meta[name="robots"]')?.content
```
Expected: `"noindex"`.

Navigate back to the homepage (click the "Fuel Finder" logo), run the description check again. Expected: back to the default description (proves the reset in `clearNavHighlights()` works, not just the override).

```bash
kill %1
```

- [ ] **Step 5: Commit**

```bash
git add app.js
git commit -m "Set per-product meta description and noindex the owner Requests page"
```

---

### Task 6: Build script — route discovery and prerendering

**Files:**
- Create: `scripts/build.js`
- Modify: `package.json` (add `puppeteer` devDependency, add `build` script)
- Create: `.gitignore` (or modify if one exists — none exists currently) to exclude `_site/` and `node_modules/`

**Interfaces:**
- Produces: running `npm run build` populates `_site/` with copied static files plus one generated `index.html` per route (product, `find/`, `calculator/`, `requests/`). Also produces an in-memory `routes` array (each `{ urlPath, filePath, depth }`) that Task 7 extends this same script to consume for `sitemap.xml`/`robots.txt`.
- Consumes: `startServer` from `scripts/dev-server.js` (Task 3) — must not reimplement server logic here.

- [ ] **Step 1: Check whether Node has `puppeteer` available, and add it**

```bash
cd "/Users/lourenco/Desktop/Personal/Claude Projects/Fuel Finder"
npm install --save-dev puppeteer
```

This updates `package.json`'s `devDependencies` and creates `package-lock.json` and `node_modules/`.

- [ ] **Step 2: Create `.gitignore`**

```
node_modules/
_site/
```

- [ ] **Step 3: Add the `build` script to `package.json`**

`package.json`'s `scripts` block becomes:
```json
  "scripts": {
    "dev": "node scripts/dev-server.js",
    "build": "node scripts/build.js"
  },
```

- [ ] **Step 4: Create `scripts/build.js`**

```js
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
```

- [ ] **Step 5: Run the build and verify real content lands in the right files at the right depth**

```bash
cd "/Users/lourenco/Desktop/Personal/Claude Projects/Fuel Finder"
npm run build
```
Expected: console output lists every generated page, ending with `Build complete: N pages generated in _site/` where N equals the product count plus 3.

```bash
ls _site/gel/maurten-gel-100/index.html
grep -o '<title>[^<]*</title>' _site/gel/maurten-gel-100/index.html
grep -o '"\.\./\.\./styles\.css"' _site/gel/maurten-gel-100/index.html
grep -c "The best carbohydrate ratio you can buy" _site/gel/maurten-gel-100/index.html
grep -o '"\.\./styles\.css"' _site/find/index.html
```
Expected: the file exists; the title grep prints `<title>Maurten Gel 100 — Fuel Finder</title>` (proving `document.title`, set inside `select()`, was captured correctly for this specific product — not left over from whatever route was rendered before it); the next grep finds the relative path rewritten two levels deep (`../../styles.css`); the review-text grep returns `1` — the actual content is present in the raw file with no JavaScript executed to produce this output; the last grep finds it rewritten one level deep for `find/`.

- [ ] **Step 6: Verify the generated page truly works with JavaScript disabled**

In a browser, disable JavaScript (or use `curl` — this is the more decisive test since curl never executes JS):
```bash
curl -s file://$(pwd)/_site/gel/maurten-gel-100/index.html 2>/dev/null | grep -c "2.4 times the price per gram"
```
Expected: `1`. If this were `0`, the content would only exist after JS runs client-side, which defeats the entire purpose of this plan.

- [ ] **Step 7: Verify `_site/` works as plain static files — no fallback trickery needed**

This is the test that actually proves the point of this whole plan: once built, every route must be a real file a plain static file server can serve directly, with no SPA-fallback magic. Task 3's dev server (with its `<base>`-injecting fallback) is deliberately *not* used here — this uses a completely dumb static server instead, the same kind GitHub Pages itself is:

```bash
cd "/Users/lourenco/Desktop/Personal/Claude Projects/Fuel Finder/_site"
python3 -m http.server 8936 > /tmp/ff-site-verify.log 2>&1 &
sleep 1
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8936/gel/maurten-gel-100/
curl -s http://localhost:8936/gel/maurten-gel-100/ | grep -c "2.4 times the price per gram"
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8936/nonexistent-route/
kill %1
cd "/Users/lourenco/Desktop/Personal/Claude Projects/Fuel Finder"
```
Expected: the first `curl` prints `200` (a real file exists at that exact path — no fallback involved); the second prints `1` (real content, served by a server with zero knowledge of this being a "SPA route"); the third prints `404` (correctly, since that route was never generated — proving the first `200` wasn't a blanket fallback masking everything).

- [ ] **Step 8: Commit**

```bash
git add scripts/build.js package.json package-lock.json .gitignore
git commit -m "Add Puppeteer-based prerendering build script"
```

---

### Task 7: Sitemap and robots.txt

**Files:**
- Modify: `scripts/build.js`

**Interfaces:**
- Consumes: the `routes` array already produced inside `build()` (Task 6) — no new discovery mechanism.
- Produces: `_site/sitemap.xml`, `_site/robots.txt`. Reads `process.env.SITE_URL`, defaulting to `https://lmaia85.github.io/Fuel-Finder` if unset (Task 8's workflow will set this explicitly; update it there directly if the eventual hosting domain differs).

- [ ] **Step 1: Add sitemap/robots generation functions**

In `scripts/build.js`, add near the top (after the `REL_ASSET_RE` definition):
```js
const SITE_URL = process.env.SITE_URL || "https://lmaia85.github.io/Fuel-Finder";

function buildSitemap(routes, baseUrl){
  const urls = ["/", ...routes.filter(r => r.urlPath !== "/requests/").map(r => r.urlPath)];
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
```

- [ ] **Step 2: Write both files at the end of `build()`**

Find, in `build()`:
```js
    console.log(`Build complete: ${routes.length} pages generated in _site/`);
    return routes;
```

Replace with:
```js
    fs.writeFileSync(path.join(OUT, "sitemap.xml"), buildSitemap(routes, SITE_URL));
    fs.writeFileSync(path.join(OUT, "robots.txt"), buildRobotsTxt(SITE_URL));

    console.log(`Build complete: ${routes.length} pages generated in _site/, plus sitemap.xml and robots.txt`);
    return routes;
```

- [ ] **Step 3: Verify**

```bash
cd "/Users/lourenco/Desktop/Personal/Claude Projects/Fuel Finder"
npm run build
cat _site/robots.txt
grep -c "<url>" _site/sitemap.xml
grep -c "requests" _site/sitemap.xml
head -c 200 _site/sitemap.xml
```
Expected: `robots.txt` shows `Allow: /` and a `Sitemap:` line pointing at `SITE_URL/sitemap.xml`; the `<url>` count equals the product count plus 3 (`/`, `/find/`, `/calculator/` — `/requests/` excluded); the `requests` grep returns `0`; the sitemap starts with `<?xml version="1.0" encoding="UTF-8"?>`.

- [ ] **Step 4: Commit**

```bash
git add scripts/build.js
git commit -m "Generate sitemap.xml and robots.txt from the build's route list"
```

---

### Task 8: GitHub Actions deploy workflow

**Files:**
- Create: `.github/workflows/deploy.yml`

**Interfaces:**
- Consumes: `npm run build` (Tasks 6-7) — this workflow doesn't know or care what the build does internally, only that it populates `_site/`.

- [ ] **Step 1: Create `.github/workflows/deploy.yml`**

```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npm run build
        env:
          SITE_URL: https://lmaia85.github.io/Fuel-Finder
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: _site

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 2: Sanity-check the YAML structurally**

```bash
cd "/Users/lourenco/Desktop/Personal/Claude Projects/Fuel Finder"
python3 -c "
import re
content = open('.github/workflows/deploy.yml').read()
for key in ['name:', 'on:', 'permissions:', 'jobs:', 'build:', 'deploy:', 'needs: build']:
    assert key in content, f'missing {key}'
print('structure OK')
"
```
Expected: `structure OK`. This isn't a full YAML/Actions schema validator (none is available without installing new tooling) — real validation happens in Step 3.

- [ ] **Step 3: One-time manual setup, then push and confirm**

This step cannot be done from git and must be done by the user in the GitHub UI:
1. Go to the repo's **Settings → Pages**.
2. Under **Source**, select **GitHub Actions** (not "Deploy from a branch").

Then:
```bash
git add .github/workflows/deploy.yml
git commit -m "Add GitHub Actions workflow to build and deploy to GitHub Pages"
git push -u origin seo-prerendering-spec
```

Open a PR, and after it's reviewed and merged to `main`, watch the repo's **Actions** tab for the workflow run. Confirm it succeeds, then visit `https://lmaia85.github.io/Fuel-Finder/gel/maurten-gel-100/` (or whichever product) and confirm the page loads with real content.

- [ ] **Step 4: Commit** (already done as part of Step 3 above — this task's commit is the push, not a separate local commit)

---

## Post-implementation note

Once this plan is fully executed and merged, the `mobile-nav-fix` branch (PR #1) will need to be rebased against the new `index.html`/`app.js` split before it can land cleanly, since it currently modifies the now-relocated inline `<style>`/`<script>` blocks directly. That rebase is not part of this plan.
