# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Amateur endurance athletes (runners, cyclists, triathletes) preparing for marathons, gran fondos, Ironman-distance and similar events. They are standing in front of a wall of gels, drink mixes and electrolytes, each claiming to be the best, and want to know which one actually suits how they plan to use it. They understand the basics (carbs per hour, sodium) but are not sports scientists.

## Product Purpose

Fuel Finder is a review and comparison site for endurance fuel built from each product's own declared nutrition panel. Success is a visitor leaving knowing which product to buy for their use case. Race-fueling planning (the calculator) supports that decision but is secondary.

## Positioning

Scores come from label data scored against a fixed scale set in advance, not relative to the catalog, so adding a product never moves anyone else's score. Derived numbers (cost per gram, sachets per hour, race cost) are computed, never typed in. Today: no affiliate links, no sponsorships, no paid placement. The owner describes this as true "for now": monetization may come later, so treat it as a current fact rather than a permanent brand promise, and flag any design that would quietly contradict it.

## Operating Context

- Visitors arrive from search (prerendered static routes, sitemap, Search Console) and social previews.
- Main paths: category pages (Gels, Drink mixes, Electrolytes), product review pages (score breakdown, comparison, verdict, where to buy, who it's for), Find Your Fuel quiz (ranks the catalog against the visitor's answers), Calculator, Search, About, Methodology.
- Prices are a snapshot from one named retailer per product as of the review date. The retailer link is the source of truth. Display currency: USD, GBP or EUR, converted via Frankfurter rates.

## Capabilities and Constraints

- Static site: `index.html` + `styles.css` + `app.js` + `fuelcheck-products.js` (the `PRODUCTS` catalog). Puppeteer prerenders every route into `_site/`. Deployed on GitHub Pages at `fuelfinder.fit`.
- Catalog: 69 products (38 gels, 17 drink mixes, 14 electrolytes) across 17 brands. Adding a product means adding one record; menus, search, scoring and comparison build themselves from it.
- Product photos live in `img/products/`, ~640px on the long edge, never inlined as base64.
- Third-party requests are limited to Google Fonts, GoatCounter (cookieless analytics, so no consent banner) and Frankfurter.
- Workflow: feature branch + PR to `main`; `main` auto-deploys.

## Brand Commitments

- Name: Fuel Finder. Voice: plain, direct, a little dry, skeptical of marketing claims; explains mechanics honestly ("a starting point to test in training, not a number to hit on race day").
- Avoid em dashes in copy (there was a sitewide sweep to remove them).
- Calculator and methodology content is a reference range from the sports-nutrition literature, never personal prescription. Keep that caveat wherever rates are shown.

## Evidence on Hand

- Declared nutrition panels, prices and retailer links for all 69 products (`fuelcheck-products.js`), official product photos (`img/products/`), an author photo (`img/lourenco.webp`) for the About page.
- No testimonials, user counts, press, lab tests or expert endorsements exist. Do not invent them.

## Product Principles

1. The label is the evidence. Every number traces to a declared panel or a visible computation. Estimates are labeled as estimates.
2. Help the visitor choose. Every surface should move someone closer to "this one, for my use case".
3. Fair by construction. Fixed scales and brand-blind ranking; no product looks better for being bigger or newer.
4. Honest limits. Say what the data can't tell you (gut tolerance, heat, individual absorption).
