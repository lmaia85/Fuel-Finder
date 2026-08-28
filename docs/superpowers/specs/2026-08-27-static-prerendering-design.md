# Static prerendering for individually indexable reviews

## Problem

Fuel Finder is a single-page app. Every product review lives behind a hash
route (`#gel/maurten-gel-100`) that `routeFromHash()` resolves client-side.
Search engines index whatever renders at a URL, and hash fragments are not
distinct URLs for indexing purposes — so all 27 reviews collapse to a single
indexable page (the bare `/`). None of them can individually rank for
searches like "SiS Beta Fuel review," and a link to a specific review shared
on social media or in a message has no real content to preview.

## Goals

- Every product review, plus Find Your Fuel and the Calculator, gets a real,
  distinct URL that returns actual content without executing JavaScript.
- The interactive experience (comparison tables, the quiz, the calculator)
  is unchanged for anyone browsing with JS enabled.
- The day-to-day editing workflow is unchanged: edit `fuelcheck-products.js`,
  push, done. The build step runs automatically in CI and is otherwise
  invisible.
- No framework migration. No new runtime dependency for site visitors.

## Non-goals

- Server-side rendering / a Node backend at request time. This is a fully
  static site; the "build" happens once per push, not per visit.
- Any change to the review content, scoring logic, or visual design.
- Optimizing for specific keyword rankings. The goal is making pages
  indexable at all, not SEO copywriting.

## Approach: headless-browser prerendering

At build time, a script starts the site locally, uses a headless browser
(Puppeteer) to actually visit every route, waits for the existing
client-side code to render it exactly as a real visitor would see it, and
saves the resulting HTML as a real file. This guarantees the crawler-visible
content can never drift from the real site, because it isn't reimplemented
anywhere — it's a snapshot of the real thing.

Two alternatives were considered and rejected:

- **Porting `render()` to a build-time language (Node)** — would require
  maintaining two implementations of "how to draw a product page" in sync
  by hand forever. Rejected: this codebase's whole design principle is that
  nothing is duplicated or hand-maintained in two places (see the top-level
  comments in `index.html` and `fuelcheck-products.js`).
- **Adopting a static site generator (11ty, Astro, etc.)** — would work, but
  is a full framework migration that throws away the current
  dependency-free, hand-editable simplicity for a problem that doesn't need
  that much machinery. Rejected as disproportionate to the problem.

## Routing: switch from hash to real paths

Because prerendering generates a real file for every route, there is no
"SPA on static hosting" problem to work around — every URL the app can
navigate to already has a matching static file. So the app's internal
routing switches from hash-based to path-based:

| Today | New |
|---|---|
| `#gel/maurten-gel-100` | `/gel/maurten-gel-100/` |
| `#drink/tailwind-endurance-fuel-lemon` | `/drink/tailwind-endurance-fuel-lemon/` |
| `#electrolyte/lmnt-citrus-salt` | `/electrolyte/lmnt-citrus-salt/` |
| `#find` | `/find/` |
| `#calculator` | `/calculator/` |
| `#requests` | `/requests/` (unlisted — see below) |
| (none) | `/` — homepage, unchanged |

Implementation: `routeFromHash()` becomes `routeFromPath()`, reading
`location.pathname` instead of `location.hash.slice(1)`; the
`hashchange` listener becomes a `popstate` listener; `select()`'s
`history.pushState(null, "", "#" + p.category + "/" + p.id)` becomes
`history.pushState(null, "", "/" + p.category + "/" + p.id + "/")`. This is
a mechanical rename, not a logic change — the same route-matching, the same
`select()`/`render()` call, just reading from a different part of the URL.

The owner-only Requests page keeps a real generated file (so the owner can
still reach it directly) but is excluded from `sitemap.xml` and rendered
with `<meta name="robots" content="noindex">`, set by
`renderRequestsAdmin()`/`renderAdminGate()` the same way those functions
already set `document.title` per view.

## File structure

```
/
├── index.html              # homepage shell, unchanged in spirit
├── styles.css              # extracted from index.html's <style> block
├── app.js                  # extracted from index.html's <script> blocks
├── fuelcheck-products.js   # unchanged
├── og-image.png            # from the trust-signals work (separate task)
├── sitemap.xml             # generated
├── robots.txt              # generated
├── gel/<id>/index.html            # generated, one per gel
├── drink/<id>/index.html          # generated, one per drink mix
├── electrolyte/<id>/index.html    # generated, one per electrolyte
├── find/index.html                # generated
├── calculator/index.html          # generated
├── requests/index.html            # generated, noindex, excluded from sitemap
├── Product Photos/         # unchanged
└── scripts/
    └── build.js            # the prerendering script
```

### Why extract CSS/JS out of index.html

Today the site's entire style and script live inline inside `index.html`.
If that stayed as-is, every one of the ~27+ generated pages would need a
full copy of that inline code baked in — roughly 1MB of duplicated CSS/JS
across the site, and no browser caching between pages (inline code can't be
cached independently of the HTML document it's embedded in). Extracting it
into `styles.css` and `app.js`, referenced by every page, means visiting a
second product page reuses what the browser already cached. This is a
mechanical extraction — copy the existing `<style>`/`<script>` contents into
their own files, add `<link>`/`<script src>` tags — no logic changes.

This does move the project from "one self-contained file" to "four flat
files, still zero build tooling required to hand-edit content" — the
tradeoff was discussed and accepted.

### Relative paths, not absolute

Hosting location isn't finalized yet — it might end up at a bare domain or
under a GitHub Pages project subpath (`username.github.io/Fuel-Finder/`).
Absolute paths like `/styles.css` would resolve incorrectly under a subpath.
Generated pages instead reference `styles.css`/`app.js` with paths relative
to their own depth (`./styles.css` from the root, `../styles.css` from
`/find/`, `../../styles.css` from `/gel/<id>/`), computed by the build
script from where each file is written. This works correctly regardless of
where the site ends up hosted, with no reconfiguring needed later.

## Build script (`scripts/build.js`)

1. Start a minimal local static file server for the repo root. Any
   requested path that doesn't correspond to an existing file yet is served
   `index.html`'s contents instead, so the client-side router can take over
   and render based on the requested path — the same fallback trick every
   SPA-on-static-hosting site uses. This fallback only exists in the local
   build server; the deployed site needs it because every real route will
   have a real file by then.
2. Launch a headless Puppeteer browser, load the homepage once, and ask the
   live page for its own route list: `PRODUCTS.map(p => ({category, id}))`,
   plus the three fixed routes (`find`, `calculator`, `requests`). The build
   never hand-maintains a second copy of what routes exist — it asks the
   real site, so a new product added to `PRODUCTS` is automatically
   included next build with no other change required.
3. For each route: navigate to it, wait for the route's content to actually
   render (poll for real rendered DOM, not a fixed delay), capture
   `document.documentElement.outerHTML`, and write it to the matching file
   path, creating directories as needed.
4. Because the capture happens after the page's own JS has run, the
   snapshot already has whatever `document.title` the existing code set for
   that route (`select()` already does this today). The one code addition
   needed: `select()`/`render()` currently only sets `document.title`, not
   the meta description, so every page (live or prerendered) currently
   shares one static description. Add a matching update to the meta
   description tag per product, built from `p.thesis` with its HTML markup
   (the `<b>` tags it contains) stripped down to plain text via a regex,
   through the same code path the live site already runs — so both the
   interactive site and the prerendered snapshot get accurate per-page
   descriptions from one change, not two.
5. Generate `sitemap.xml` and `robots.txt` from the same route list gathered
   in step 2 (the Requests page excluded from the sitemap).
6. Shut down the browser and local server.

If any route fails to render (timeout, a JS error), the script exits
non-zero and the build fails loudly rather than silently producing a
partial or broken snapshot.

## GitHub Actions workflow (`.github/workflows/deploy.yml`)

On every push to `main`:

1. Check out the repo.
2. Set up Node, install dependencies (Puppeteer is the only new one, added
   as a root-level `package.json` devDependency; `npm run build` runs
   `scripts/build.js`).
3. Run the build.
4. Upload the resulting site as a Pages artifact and deploy it via GitHub's
   standard `actions/configure-pages` / `actions/upload-pages-artifact` /
   `actions/deploy-pages` actions.

A build failure means nothing deploys — the live site stays on the last
successful build, visible as a failed run in the repo's Actions tab.

**One manual, one-time step**: the repo's Settings → Pages needs its source
set to "GitHub Actions" rather than a branch. This can't be done from git;
it's a checkbox in the GitHub UI, to be done when this is implemented.

## Testing plan

- Run the build script locally; confirm every generated file's `<title>`
  and meta description matches its product, and the homepage is unchanged.
- Serve the built output locally (not via `file://`) and click through:
  direct-load a product URL, reload mid-browse, navigate between products,
  confirm the URL bar and browser back/forward all behave correctly.
- Validate `sitemap.xml` is well-formed and `robots.txt` correctly
  references it and excludes `/requests/`.
- The test that actually matters for the stated goal: view the raw HTML of
  a generated product page with JavaScript disabled and confirm the review
  content is genuinely present, not just a shell waiting for a script to
  fill it in.
- In CI: a build that generates zero pages (e.g., because `PRODUCTS` failed
  to load) should fail the workflow rather than deploy an empty site — a
  sanity check comparing generated-file count to `PRODUCTS.length` guards
  against this.

## Relationship to other in-flight work

The `mobile-nav-fix` branch (PR #1) touches `index.html`'s nav markup and
JS. This spec's CSS/JS extraction will need to be rebased on top of
whatever lands there, not done in parallel against a stale copy of the
file. The favicon/`og:image`/schema-markup work discussed alongside this is
a separate, independent, bounded task — it isn't part of this spec.
