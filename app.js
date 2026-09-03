
/* Where this site is mounted, derived at runtime — never configured, because
   the hosting location isn't fixed: "/" on a root domain (and on the local
   dev server), "/Fuel-Finder/" under a GitHub Pages *project* subpath.

   document.currentScript is the <script> element currently executing, and
   its .src is the browser's fully-resolved absolute URL for this very file.
   That's reliable at any depth and any host precisely because the build
   rewrites asset references to be depth-relative (app.js, ../app.js,
   ../../app.js), so they always resolve back to the same site root. Strip
   the filename off that resolved path and what's left is the base path.

   Everything that reads or writes the URL — routeFromPath() and every
   pushState — goes through this, so the app never assumes root hosting. */
const BASE_PATH = (() => {
  try{
    const src = document.currentScript && document.currentScript.src;
    if(!src) return "/";
    return new URL(src, location.href).pathname.replace(/[^/]*$/, "");
  }catch(err){ return "/"; }
})();

/* "/find/" -> "/Fuel-Finder/find/". Takes the root-relative path the app
   thinks in and returns the real one for wherever the site actually lives. */
const sitePath = p => BASE_PATH + String(p).replace(/^\//, "");

/* p.reviewed is an ISO date ("2026-08-26") — when that product's review
   text (thesis/pros/cons) was last actually written or verified, taken
   from git history rather than typed by hand. Formatted here rather than
   stored pre-formatted so the stored value stays sortable/machine-usable. */
const REVIEW_MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function formatReviewDate(iso){
  const d = new Date(iso + "T00:00:00Z");
  return `${d.getUTCDate()} ${REVIEW_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

const CATEGORY_LABEL = {gel:"gel", drink:"drink mix", electrolyte:"electrolyte"};
const CATEGORY_PLURAL = {gel:"gels", drink:"drink mixes", electrolyte:"electrolytes"};
const CATEGORY_PAGE_SLUG = {gel: "gels", drink: "drink-mixes", electrolyte: "electrolytes"};
/* Past six columns the table gets cramped and hard to actually compare —
   cap it here rather than let it grow unbounded. */
const MAX_COMPARE = 6;

/* Logs searches that didn't match anything in the catalog, so whoever runs
   the site can see what people are actually looking for and go write that
   review next. Backed by localStorage for now — this only sees requests
   made in the same browser, which is fine while the site is local-only.
   When this moves onto a live server, swap the bodies of save()/list()/
   remove()/clear() for real network calls (e.g. POST/GET/DELETE against an
   API) — every caller elsewhere in the file goes through this object, so
   nothing outside these four functions needs to change. */
const RequestLog = (() => {
  const KEY = "fuelfinder_requests";
  const read = () => { try{ return JSON.parse(localStorage.getItem(KEY)) || []; }catch(e){ return []; } };
  const write = list => { try{ localStorage.setItem(KEY, JSON.stringify(list)); }catch(e){} };
  return {
    save(query){
      const q = query.trim();
      if(!q) return;
      const list = read();
      const existing = list.find(r => r.query.toLowerCase() === q.toLowerCase());
      const now = new Date().toISOString();
      if(existing){ existing.count++; existing.lastSeen = now; }
      else list.unshift({query: q, count: 1, firstSeen: now, lastSeen: now});
      write(list);
    },
    list(){ return read().sort((a,b) => b.count - a.count || new Date(b.lastSeen) - new Date(a.lastSeen)); },
    remove(query){ write(read().filter(r => r.query !== query)); },
    clear(){ write([]); }
  };
})();

const RANGE = {
  carbs:   {min:20, max:45,  scale:50,  unit:"g",  label:"Carbohydrate"},
  sodium:  {min:0,  max:200, scale:300, unit:"mg", label:"Sodium"},
  caffeine:{min:0,  max:100, scale:200, unit:"mg", label:"Caffeine"}
};

const TARGET_RATE = 90;
const MARATHON_G  = 300;

/* Gels and drink mixes are carb-fuel products, scored by cost per gram of
   carbohydrate. Electrolyte products are near-zero-carb by design — the
   same math would divide by ~0 — so they're scored by cost per 1000mg of
   sodium instead, the number that actually varies between them. */
function derive(p){
  if(p.category === "electrolyte"){
    const costPer1000Na = p.sodium ? (p.price / p.sodium) * 1000 : null;
    return {costPer1000Na};
  }
  const perGram   = p.price / p.carbs;
  const perHour   = TARGET_RATE / p.carbs;
  const costHour  = perHour * p.price;
  const gels300   = Math.ceil(MARATHON_G / p.carbs);
  const cost300   = gels300 * p.price;
  const sodiumHr  = p.sodium === null ? null : Math.round(perHour * p.sodium);
  return {perGram, perHour, costHour, gels300, cost300, sodiumHr};
}
PRODUCTS.forEach(p => Object.assign(p, derive(p)));

/* Gut comfort (gels only). Fixed scale, not normalized against the current
   catalog: 1 ingredient scores 100, 15+ scores 0, linear between. Anchored
   to a realistic ingredient-count range rather than whatever happens to be
   in the catalog today, so this number means the same thing regardless of
   what else has been added or removed. This isn't a stand-in for someone
   actually testing the product; it's what the declared ingredient panel
   implies, same as every other number here. */
function ingredientGutScore(p){
  const count = p.ingredients.split(",").length;
  const t = (count - 1) / (15 - 1);
  return Math.round((1 - Math.min(1, Math.max(0, t))) * 100);
}
PRODUCTS.forEach(p => { if(p.category === "gel") p.gut = ingredientGutScore(p); });

/* Overall score. Each category scores its own dimensions — gels and drinks
   share rate/density/sodium/cost, gels alone add gut tolerance (the only
   category where it's judged), electrolytes get a wholly different set
   built from their own fields. Every dimension is scored against a FIXED
   scale (worst, best below), not against whatever else happens to be in
   the catalog — a 90 here means the same thing regardless of what's added
   or removed later. Anchors are grounded in real sports-nutrition
   reference points where they exist (carb density, sodium, potassium) —
   see the Methodology page for what each is based on and where the
   grounding is weaker (calcium, magnesium, both cost dimensions, gut
   comfort — those are pragmatic anchors, not physiological ones). A
   product's score is the plain average of whichever dimensions it has a
   real value for — missing data is dropped, not counted against it, and
   the "Based on N of X measures" note on the page says when that's
   happened. */
const SCORE_DIMS = {
  gel: [
    ["rate", "Absorption rate", p=>p.ratioScore, 0, 100, "How much carbohydrate an hour the glucose-to-fructose blend can move. Scored from the stated or derived ratio (1:0.8 tops out this scale); an Estimated ratio counts the same as a Stated one here."],
    ["dens", "Carb density", p=>p.carbs, 0, 90, "How much fuel one sachet carries. 90 g is the ceiling here, matching the top of the range cited for multi-transportable-carb intake."],
    ["cost", "Value (cost/gram)", p=>p.perGram, 0.15, 0.02, "Price of one gram of carbohydrate. Not physiological -- a market-based scale from {{money:0.15}}/g (0) to {{money:0.02}}/g (100)."],
    ["gut",  "Gut comfort", p=>p.gut, 0, 100, "A proxy, not a taste or tolerance test: shorter ingredient lists score higher, from 15 ingredients (0) to 1 (100). Nobody has actually run these through anyone's gut for this score."]
  ],
  drink: [
    ["rate", "Absorption rate", p=>p.ratioScore, 0, 100, "How much carbohydrate an hour the glucose-to-fructose blend can move. Scored from the stated or derived ratio (1:0.8 tops out this scale); an Estimated ratio counts the same as a Stated one here."],
    ["dens", "Carb density", p=>p.carbs, 0, 90, "How much fuel one scoop or sachet carries. 90 g is the ceiling here, matching the top of the range cited for multi-transportable-carb intake."],
    ["sod",  "Sodium", p=>p.sodium, 0, 1000, "Sodium carried by the mix itself, on a scale topping out at 1000 mg -- the upper end of what's typically lost to sweat in an hour."],
    ["cost", "Value (cost/gram)", p=>p.perGram, 0.15, 0.02, "Price of one gram of carbohydrate. Not physiological -- a market-based scale from {{money:0.15}}/g (0) to {{money:0.02}}/g (100)."]
  ],
  electrolyte: [
    ["sod",  "Sodium dose", p=>p.sodium, 0, 1000, "Sodium per serving, on a scale topping out at 1000 mg -- a single dose covering the top of what's typically lost to sweat in an hour."],
    ["cost", "Value (cost/1000mg Na)", p=>p.costPer1000Na, 3.00, 1.00, "What it costs to get 1000 mg of sodium from this product. Not physiological -- a market-based scale from {{money:3.00}} (0) to {{money:1.00}} (100)."],
    ["pot",  "Potassium", p=>p.potassium, 0, 200, "Potassium per serving, on a scale topping out at 200 mg -- roughly the upper end of typical hourly sweat loss."],
    ["cal",  "Calcium", p=>p.calcium, 0, 100, "Calcium per serving. Weaker grounding than sodium/potassium -- sweat calcium loss is minor and not really a primary target during exercise; the 100 mg ceiling is this catalog's practical high end, not a physiological one."],
    ["mag",  "Magnesium", p=>p.magnesium, 0, 60, "Magnesium per serving, on a scale topping out at 60 mg, roughly matching cited hourly sweat-loss ranges."]
  ]
};

/* Computes the overall score AND keeps the per-dimension breakdown that
   produced it — the score badge shows just the number, but the "Score
   breakdown" section on each product page shows its work, same reasoning
   as making gut comfort transparent rather than an unexplained figure. */
function computeScore(p){
  const breakdown = [];
  SCORE_DIMS[p.category].forEach(([key,label,get,worst,best,what]) => {
    const mine = get(p);
    if(mine === null || mine === undefined) return;
    const t = (mine - worst) / (best - worst);
    breakdown.push({key, label, what, score: Math.round(Math.min(1, Math.max(0, t)) * 100)});
  });
  const overall = breakdown.length ? Math.round(breakdown.reduce((a,b)=>a+b.score,0) / breakdown.length) : null;
  /* possible is the dimension count a product COULD have shown data for,
     regardless of how many it actually did -- the gap between the two is
     exactly the "missing data isn't penalized, just excluded" caveat from
     the Methodology page, made visible in context instead of buried there. */
  return {overall, breakdown, possible: SCORE_DIMS[p.category].length};
}
PRODUCTS.forEach(p => { const s = computeScore(p); p.overallScore = s.overall; p.scoreBreakdown = s.breakdown; p.scorePossible = s.possible; });
function scoreTier(score){ return score >= 65 ? "best" : score >= 35 ? "mid" : "worst"; }
function scoreTierLabel(score){ return score >= 65 ? "Strong" : score >= 35 ? "Mixed" : "Weak"; }

function scoreCarb(p){ return Math.round(p.carbs / 45 * 100); }
function scoreCost(p){ return Math.max(5, Math.round(100 - (p.perGram - 0.05) / 0.11 * 90)); }
function scoreSodium(p){
  if(p.sodiumHr === null) return null;
  return Math.min(100, Math.round(p.sodiumHr / 700 * 100));
}

/* Capability set.
   get()  positions and ranks against the field  (an index, never shown)
   show() what the reader actually sees          (a real measured value)
   what   fixed definition of the measure, identical for every product
   note() one derived consequence of that value                        */
const CAPS = [
  {key:"rate", name:"Rate ceiling",
   what:"How much carbohydrate an hour the glucose-to-fructose blend can move.",
   get:p => p.ratioScore,
   show:p => p.ratio.replace(/\s/g,"").replace(":"," : "),
   legend:p => p.ratio.replace(/\s|~/g,""),
   note:p => p.ratioScore >= 90 ? "Above 90 g/hr." : "Around 60 to 75 g/hr."},

  {key:"dens", name:"Carbohydrate per sachet",
   what:"How much fuel one sachet carries, which sets how many you open.",
   get:p => scoreCarb(p),
   show:p => p.carbs + " g",
   legend:p => p.carbs + "g",
   note:p => `${p.perHour.toFixed(1)} sachets an hour to hold 90 g/hr.`},

  {key:"sod", name:"Sodium per sachet",
   what:"Sodium carried by the gel, against 400 to 1000 mg an hour typically lost.",
   get:p => scoreSodium(p),
   show:p => p.sodium === null ? null : p.sodium + " mg",
   legend:p => p.sodium === null ? "n/d" : p.sodium + "mg",
   note:p => p.sodiumHr === null ? "Not declared on the panel." : `${p.sodiumHr} mg an hour at 90 g/hr.`},

  {key:"cost", name:"Cost per gram",
   what:"Price of one gram of carbohydrate, the only unit that compares across sachet sizes.",
   get:p => scoreCost(p),
   show:p => moneyPrecise(p.perGram, 3),
   legend:p => moneyPrecise(p.perGram, 3),
   note:p => `${money(p.cost300)} to fuel a four-hour marathon.`},

  {key:"gut", name:"Gut tolerance",
   what:"Judged from the formulation. The only measure here we have not counted.",
   judged:true,
   get:p => p.gut,
   show:p => p.gut,
   legend:p => p.gut,
   note:p => `${p.ingredients.split(",").length} ingredients.`}
];

/* Rank among the field. Every capability is higher-is-better. */
function rank(cap, p){
  const vals = PRODUCTS.map(cap.get).filter(v => v !== null);
  const mine = cap.get(p);
  if(mine === null) return null;
  return {n: vals.filter(v => v > mine).length + 1, of: vals.length};
}
function field(cap){
  const vals = PRODUCTS.map(cap.get).filter(v => v !== null);
  return {min: Math.min(...vals), max: Math.max(...vals)};
}

const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));

/* Naive +s pluralization broke on "pouch" ("pouchs"). Covers the servingWord
   values actually in the catalog (sachet, scoop, stick, tablet, pouch) via
   the general English ch/sh/s/x/z -> "es" rule rather than a per-word list,
   so it also holds for whatever unit word gets added next. */
const pluralize = (word, count = 2) => {
  if(count === 1) return word;
  return /(ch|sh|s|x|z)$/i.test(word) ? word + "es" : word + "s";
};

/* A small "?" that shows its definition instantly on hover/focus via CSS
   (no native title-attribute delay, no JS). tabindex makes it keyboard
   reachable; aria-label carries the text to screen readers even without
   a hover, since the tooltip span itself is visually hidden until then. */
const infoTip = text => `<span class="info-ic" tabindex="0" aria-label="${esc(text)}">?<span class="info-tip">${esc(text)}</span></span>`;

/* Currency display. Every price in the catalog is stored in USD — this
   only affects how it's *shown*. Rates come from Frankfurter (ECB data,
   free, no API key or account needed), fetched at most once a day and
   cached in localStorage; if the fetch fails for any reason (offline,
   API down), everything just silently stays in USD rather than showing
   a broken or stale conversion. Prose in a product's thesis/pros/cons —
   editorial copy written once, not live data — always stays in the
   dollar figures it was written with; only the structured price fields
   (buy links, the comparison table, cost-per-gram, the calculator)
   convert. */
const CURRENCY_SYMBOL = {USD:"$", GBP:"£", EUR:"€"};
const FX_CACHE_KEY = "fuelfinder_fx_rates";
const CURRENCY_KEY = "fuelfinder_currency";
let currentCurrency = (() => {
  try{ return localStorage.getItem(CURRENCY_KEY) || "USD"; }catch(err){ return "USD"; }
})();
let fxRates = {USD:1};

(function loadFxRates(){
  try{
    const cached = JSON.parse(localStorage.getItem(FX_CACHE_KEY) || "null");
    const today = new Date().toISOString().slice(0,10);
    if(cached && cached.date === today){ fxRates = cached.rates; return; }
  }catch(err){}
  fetch("https://api.frankfurter.dev/v1/latest?base=USD&symbols=EUR,GBP")
    .then(r => r.json())
    .then(data => {
      fxRates = {USD:1, EUR:data.rates.EUR, GBP:data.rates.GBP};
      try{ localStorage.setItem(FX_CACHE_KEY, JSON.stringify({date:data.date, rates:fxRates})); }catch(err){}
      if(currentCurrency !== "USD") refreshCurrentView();
    })
    .catch(()=>{ /* stays USD-only */ });
})();

function convert(usd){
  const rate = fxRates[currentCurrency];
  return rate ? usd * rate : usd;
}
function money(n){ return CURRENCY_SYMBOL[currentCurrency] + convert(n).toFixed(2); }
/* Every current call site is a cost-comparison figure (per gram, per
   1000mg sodium) that's almost always well under one unit of currency --
   "$0.063" reads like a typo next to a real sticker price, "6.3 cents" is
   what someone would actually say. Only kicks in below 1 unit; a value
   that happens to cross it (e.g. an expensive electrolyte's cost/1000mg)
   still gets normal $/£/€ formatting. GBP uses "p" (pence), not "cents". */
function moneyPrecise(n, decimals){
  const v = convert(n);
  if(v < 1){
    let cents = (v * 100).toFixed(1);
    if(cents.endsWith(".0")) cents = cents.slice(0, -2);
    return currentCurrency === "GBP" ? `${cents}p` : `${cents} cents`;
  }
  return CURRENCY_SYMBOL[currentCurrency] + v.toFixed(decimals);
}

/* Product copy (thesis/pros/cons/yes/no) embeds prices as {{money:N}}
   tokens rather than hardcoded "$N" so they convert with the currency
   switcher like every number in the tables already does. */
function renderMoney(str){
  return str.replace(/\{\{money:(\d+(?:\.\d+)?)\}\}/g, (_, n) => moneyPrecise(Number(n), 2));
}

/* Re-paints whatever page the URL says we're on, preserving scroll —
   used after a currency change (user-driven) or the FX rates arriving
   late (network-driven), neither of which should jump the page to top
   the way a real navigation does. */
function refreshCurrentView(){
  const y = window.scrollY;
  routeFromPath();
  window.scrollTo(0, y);
}

/* GoatCounter's script only auto-counts the very first pageload — it has
   no way to know this is a client-routed SPA. Wrapping pushState once,
   here, makes every in-app navigation register as a real pageview too,
   without having to remember to call this at each of the many places
   the app calls pushState directly. The setTimeout defers the count
   until after the caller's own synchronous code (which sets
   document.title right after pushState in every one of those places)
   has finished, so GoatCounter records the page's real title rather
   than whatever it still was mid-navigation. */
(function trackSpaNavigation(){
  const nativePushState = history.pushState.bind(history);
  history.pushState = function(...args){
    nativePushState(...args);
    setTimeout(() => {
      if(window.goatcounter && window.goatcounter.count){
        window.goatcounter.count({path: location.pathname, title: document.title});
      }
    }, 0);
  };
})();

const ord = n => n + (["th","st","nd","rd"][(n%100-20)%10] || ["th","st","nd","rd"][n%100] || "th");

/* Turns catalog prose (which is HTML — tags and entities alike) into the
   plain text a meta description needs. Parsing it and reading textContent
   does both jobs at once: a regex that only strips tags leaves "&mdash;"
   sitting there as literal characters, and setting that as an attribute
   value re-escapes the ampersand, so "&amp;mdash;" is what ships. */
function stripHtml(s){
  const d = document.createElement("div");
  d.innerHTML = String(s);
  return d.textContent;
}

const DEFAULT_DESCRIPTION = "Gel, drink mix and electrolyte reviews built from declared nutrition panels -- cost per gram, sodium and absorption rate compared, not marketing copy.";

/* Title/description for the tab, search snippets, and social previews.
   clearNavHighlights() calls this with null on every non-product render to
   restore the site-wide defaults — this is a single hash-routed document,
   so nothing else clears a previous product's tags on the way out. */
function setShareMeta(p){
  const title = p ? p.name + " - Fuel Finder" : "Fuel Finder - Endurance nutrition reviews";
  const desc = p ? stripHtml(renderMoney(p.thesis)) : DEFAULT_DESCRIPTION;
  [["meta[name='description']","content",desc],
   ["meta[property='og:title']","content",title],
   ["meta[property='og:description']","content",desc],
   ["meta[name='twitter:title']","content",title],
   ["meta[name='twitter:description']","content",desc]
  ].forEach(([sel,attr,val]) => { const el = document.querySelector(sel); if(el) el.setAttribute(attr, val); });

  /* Preload hint for the product hero photo: dropped into <head> so the
     browser can start fetching it before the body (and this script) even
     runs. Baked into the prerendered static HTML for each route, so it's
     there from the very first byte on the live site, not just added after
     JS executes. */
  let preload = document.querySelector('link[data-role="photo-preload"]');
  if(p && p.photo){
    if(!preload){
      preload = document.createElement("link");
      preload.rel = "preload";
      preload.as = "image";
      preload.dataset.role = "photo-preload";
      document.head.appendChild(preload);
    }
    preload.href = sitePath(p.photo);
  } else if(preload){
    preload.remove();
  }
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

function prov(p){
  return p.ratioProv === "Stated" ? "" : " &middot; " + esc(p.ratioProv.toLowerCase());
}

/* The comparison set is fully user-controlled — any product, including the
   one being reviewed, can be removed or searched for and added back.
   Whenever the product being reviewed IS in the set, it's pinned as the
   leftmost column; removing it takes it out like any other product rather
   than forcing it back. Kept per-category so switching between Gels, Drink
   mixes and Electrolytes doesn't mix incompatible products into one table
   or clobber the comparison you built in another category. */
let compareIds = {
  gel: PRODUCTS.filter(p => p.category === "gel").slice(0,5).map(p => p.id),
  drink: PRODUCTS.filter(p => p.category === "drink").slice(0,5).map(p => p.id),
  electrolyte: PRODUCTS.filter(p => p.category === "electrolyte").slice(0,5).map(p => p.id)
};
let CURRENT = PRODUCTS[0];

function compareSet(cur){
  const ids = compareIds[cur.category].filter(id => PRODUCTS.some(p => p.id === id));
  const idx = ids.indexOf(cur.id);
  if(idx > 0){ ids.splice(idx, 1); ids.unshift(cur.id); }
  return ids.map(id => PRODUCTS.find(p => p.id === id));
}

function table(cur){
  const set = compareSet(cur);
  const unit = cur.servingWord || "sachet";
  /* 5th field is the definition. The numbers are useless to a reader who
     does not know what they measure. Electrolyte products get a different
     row set entirely — carbs aren't the point, sodium/potassium/calcium/
     magnesium are, so "cost per gram of carbohydrate" would be meaningless
     (often a divide-by-near-zero) for this category. */
  const rows = cur.category === "electrolyte" ? [
    ["Sodium", p=>`${p.sodium} mg`, p=>p.sodium, "hi",
     "The main electrolyte lost in sweat, and the biggest single driver of cramping and hyponatremia risk."],
    ["Potassium", p=>p.potassium==null?"not declared":`${p.potassium} mg`, p=>p.potassium, "hi",
     "Works alongside sodium in muscle and nerve function."],
    ["Calcium", p=>p.calcium==null?"not declared":`${p.calcium} mg`, p=>p.calcium, "hi",
     "Involved in muscle contraction; lost in far smaller amounts than sodium."],
    ["Magnesium", p=>p.magnesium==null?"not declared":`${p.magnesium} mg`, p=>p.magnesium, "hi",
     "Supports muscle and nerve function; some evidence it blunts cramping."],
    ["Carbohydrate", p=>`${p.carbs} g`, null, null,
     "Minimal by design. This is a hydration product, not a fuel source."],
    [`Price per ${unit}`, p=>money(p.price), p=>p.price, "lo",
     `What one ${unit} costs.`],
    ["Cost per 1000mg sodium", p=>p.costPer1000Na==null?"not declared":moneyPrecise(p.costPer1000Na, 2), p=>p.costPer1000Na, "lo",
     "The only price that compares across different sodium concentrations."]
  ] : [
    ["Carbohydrate", p=>`${p.carbs} g`, p=>p.carbs, "hi",
     `How much fuel one ${unit} carries.`],
    ["Glucose : fructose", p=>p.ratio, p=>p.ratioScore, "hi",
     "Governs how fast you absorb it. More fructose, higher ceiling."],
    ["Sodium", p=>p.sodium===null?"not declared":`${p.sodium} mg`, p=>p.sodium, "hi",
     "Against 400 to 1000 mg an hour typically lost in sweat."],
    ...(set.some(p => p.caffeine > 0)
        ? [["Caffeine", p=>`${p.caffeine} mg`, null, null,
            "A preference, not a quality, so it is not scored."]] : []),
    ["Provenance", p=>p.ratioProv, null, null,
     "Whether that ratio is read off the panel, computed from it, or inferred."],
    [`Price per ${unit}`, p=>money(p.price), p=>p.price, "lo",
     `What one costs. Not comparable across ${unit} sizes.`],
    ["Cost per gram", p=>moneyPrecise(p.perGram, 3), p=>p.perGram, "lo",
     `The only price that compares across ${unit} sizes.`],
    [`${pluralize(unit[0].toUpperCase()+unit.slice(1))} for 90 g/hr`, p=>p.perHour.toFixed(1), p=>p.perHour, "lo",
     `How many you open an hour to hold a 90 g/hr target.`]
  ];
  rows.unshift(["Overall score", p=>p.overallScore===null?"n/d":p.overallScore, p=>p.overallScore, "hi",
   "An average of the various variables measured."]);

  /* At the cap there's nothing to add, so the column simply isn't there —
     no button, no message, no dashed slot implying more room exists. */
  const atMax = set.length >= MAX_COMPARE;
  const addLabel = CATEGORY_LABEL[cur.category];
  const addCell = atMax ? "" : `<th class="addcol-cell">
       <div class="finder">
         <button class="add-trigger" id="addbtn"><span class="plus">+</span>Add ${esc(addLabel)}</button>
         <div class="fpanel" id="fpanel" hidden>
           <input id="fq" placeholder="Search the database" autocomplete="off">
           <div class="fres" id="fres"></div>
         </div>
       </div>
     </th>`;

  const head = `<tr><th>Measure</th>` + set.map(p =>
    `<th class="pcol${p.id===cur.id?' this':''}">
       <span class="thbrand">${esc(p.brand)}</span>
       <span class="thname">${esc(p.name)}</span>
       <button class="rm" data-rm="${p.id}" title="Remove from comparison"${set.length<=1?' disabled':''}>&times;</button>
     </th>`).join("") + addCell +
    `</tr>`;

  const body = rows.map(([l,fmt,key,dir,def]) => {
    let b=null,w=null;
    if(key){ const v=set.map(key).filter(x=>x!==null&&x!==undefined);
      if(v.length>1){ b = dir==="hi"?Math.max(...v):Math.min(...v); w = dir==="hi"?Math.min(...v):Math.max(...v);} }
    return `<tr><th><span class="rowlab">${l}</span><span class="rowdef">${esc(renderMoney(def))}</span></th>` + set.map(p=>{
      const v = key?key(p):null; let c = p.id===cur.id?"this":"";
      if(v!==null&&v!==undefined&&b!==null){ if(v===b)c+=" best"; else if(v===w)c+=" worst"; }
      return `<td${c?` class="${c.trim()}"`:""}>${fmt(p)}</td>`;
    }).join("") + (atMax ? "" : `<td class="addcol-cell"></td>`) + `</tr>`;
  }).join("");

  /* Fixed per-column widths (via colgroup, with table-layout:fixed) so each
     gel's column stays the same size whether it's one of two or one of five —
     removing or adding a column changes the table's total width, not how
     wide the surviving columns are. The trailing .addcol is a permanent
     empty column — the "+ Add" control lives there instead of floating
     beside the section heading, so adding a gel is always in the same
     place the columns themselves are. Omitted entirely once the comparison
     is at MAX_COMPARE — no slot, no option, nothing to click. */
  const cols = `<colgroup><col class="labelcol">${set.map(()=>'<col class="gelcol">').join("")}${atMax ? "" : '<col class="addcol">'}</colgroup>`;

  return `<div class="tw"><table>${cols}<thead>${head}</thead><tbody>${body}</tbody></table></div>`;
}

function drawResults(q){
  const box = document.getElementById("fres"); if(!box) return;
  const pool = PRODUCTS.filter(p => p.category === CURRENT.category);
  const have = new Set(compareSet(CURRENT).map(p => p.id));
  const s = q.trim().toLowerCase();
  const hits = pool.filter(p => !have.has(p.id) &&
    (p.name + " " + p.brand + " " + p.code).toLowerCase().includes(s));
  const label = CATEGORY_LABEL[CURRENT.category];
  box.innerHTML = hits.length
    ? hits.map(p => `<button data-add="${p.id}">${esc(p.name)}<span>${esc(p.brand)} &middot; ${p.category==="electrolyte"?`${p.sodium} mg Na`:`${p.carbs} g`} &middot; ${p.category==="electrolyte"?(p.costPer1000Na==null?"n/d":moneyPrecise(p.costPer1000Na, 2)+"/1000mg"):moneyPrecise(p.perGram, 3)+"/g"}</span></button>`).join("")
    : `<p>${have.size >= pool.length
        ? `Every ${label} in the database is already in this comparison.`
        : `No ${label} matches that.`}</p>`;
}

/* Per-product Review schema.org JSON-LD, one genuine single-author review
   per product page. reviewRating mirrors the same null-check the score
   badge itself uses (p.overallScore===null, see render()) — some products
   don't have enough declared data for a computed score, and this omits the
   whole rating block for those rather than emit a fake 0. Built as a plain
   object and serialized with JSON.stringify so product names/brands with
   quotes or other special characters escape correctly; never hand-built
   with template-literal string concatenation. */
function reviewSchema(p){
  const obj = {
    "@context": "https://schema.org",
    "@type": "Review",
    itemReviewed: {
      "@type": "Product",
      name: p.name,
      brand: {"@type": "Organization", name: p.brand},
      ...(p.photo ? {image: location.origin + sitePath(p.photo)} : {})
    },
    author: {"@type": "Person", name: "Lourenço Faria e Maia", url: location.origin + sitePath("/about/")},
    ...(p.reviewed ? {datePublished: p.reviewed} : {}),
    ...(p.overallScore === null ? {} : {
      reviewRating: {
        "@type": "Rating",
        ratingValue: p.overallScore,
        bestRating: 100,
        worstRating: 0
      }
    }),
    reviewBody: stripHtml(renderMoney(p.thesis))
  };
  /* Escape "</" so a stray closing script tag inside any field can't break
     out of the element this gets embedded in via innerHTML below. */
  return JSON.stringify(obj).replace(/<\//g, "<\\/");
}

/* Home > category > product, both as visible UI (breadcrumbHTML) and as
   BreadcrumbList JSON-LD (breadcrumbSchema) from the same three stops, so
   the two can never drift out of sync with each other. */
function breadcrumbStops(p){
  return [
    {name: "Home", url: sitePath("/")},
    {name: CATEGORY_PLURAL[p.category][0].toUpperCase() + CATEGORY_PLURAL[p.category].slice(1), url: sitePath(`/find/${p.category}/`)},
    {name: p.name, url: sitePath(`${p.category}/${p.id}/`)}
  ];
}
function breadcrumbSchema(p){
  const obj = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: breadcrumbStops(p).map((s, i) => ({
      "@type": "ListItem", position: i + 1, name: s.name, item: location.origin + s.url
    }))
  };
  return JSON.stringify(obj).replace(/<\//g, "<\\/");
}
function breadcrumbHTML(p){
  const stops = breadcrumbStops(p);
  return `<nav class="crumbs" aria-label="Breadcrumb">${stops.map((s, i) =>
    i === stops.length - 1
      ? `<span aria-current="page">${esc(s.name)}</span>`
      : `<a href="${s.url}">${esc(s.name)}</a><span class="crumb-sep">&rsaquo;</span>`
  ).join("")}</nav>`;
}

function render(p){
  CURRENT = p;
  document.getElementById("toc").style.display = "";
  const costRank = rank({get:q=>scoreCost(q)}, p);
  document.getElementById("page").innerHTML = `
  <script type="application/ld+json">${reviewSchema(p)}<\/script>
  <script type="application/ld+json">${breadcrumbSchema(p)}<\/script>
  ${breadcrumbHTML(p)}
  <div class="hero">
    <div>
      <p class="eye">During-effort fuel &middot; ${CATEGORY_LABEL[p.category]} &middot; reviewed ${formatReviewDate(p.reviewed)}</p>
      <h1>${esc(p.name)}${p.overallScore===null?"":` <span class="score-badge tier-${scoreTier(p.overallScore)}" title="Overall score among ${CATEGORY_PLURAL[p.category]}, averaged from what this product declares">${p.overallScore}</span>`}</h1>
      <p class="meta">${esc(p.brand)} &nbsp;/&nbsp; ${esc(p.serving)} &nbsp;/&nbsp; ${p.category==="electrolyte"?`${p.sodium} mg sodium`:`${p.carbs} g carbohydrate`} &nbsp;/&nbsp; ${money(p.price)}</p>
      <p class="thesis">${renderMoney(p.thesis)}</p>
    </div>
    <div class="shot-stage">
    ${p.photo
      ? `<img class="shot" src="${sitePath(p.photo)}" alt="${esc(p.name)} ${esc(p.servingWord || "sachet")} package" loading="eager" fetchpriority="high" decoding="async">`
      : `<div class="shot-ph" role="img" aria-label="Photo not yet available for ${esc(p.name)}">
           <svg viewBox="0 0 537 1030" xmlns="http://www.w3.org/2000/svg">
             <defs>
               <linearGradient id="ph-body" x1="0" y1="0" x2="1" y2="0">
                 <stop offset="0" style="stop-color:var(--sunk)"/>
                 <stop offset="0.5" style="stop-color:var(--panel)"/>
                 <stop offset="1" style="stop-color:var(--sunk)"/>
               </linearGradient>
             </defs>
             <rect x="72" y="16" width="393" height="998" rx="6" fill="url(#ph-body)" stroke="var(--rule-2)" stroke-width="2"/>
             <path d="M72 16 h118 l-40 52 40 52 h-118 z" fill="var(--ground)" stroke="var(--rule-2)" stroke-width="2"/>
             <line x1="72" y1="102" x2="465" y2="102" stroke="var(--rule)" stroke-width="2"/>
             <line x1="72" y1="928" x2="465" y2="928" stroke="var(--rule)" stroke-width="2"/>
           </svg>
           <span>Photo coming soon</span>
         </div>`}
    </div>
  </div>

  ${p.overallScore===null ? "" : `
  <section id="score-breakdown">
    <div class="sh"><h2>Score breakdown</h2><span class="rule"></span></div>
    <p class="sub">Each dimension below is scored 0 to 100 against a fixed scale, not against the rest of the catalog, so adding a product never moves this number. The overall score is the average of the dimensions this product declares data for. <a href="${sitePath("/methodology/")}" data-page="methodology">How the scales are set &rarr;</a></p>
    <div class="sb-layout">
    <div class="sb-layout-left">
      <div class="sb">
        <div class="sb-tile tier-${scoreTier(p.overallScore)}">
          <div class="sb-num">${p.overallScore}<span class="denom">/100</span></div>
          <div class="sb-label">${scoreTierLabel(p.overallScore)}</div>
          ${p.scoreBreakdown.length < p.scorePossible ? `<div class="sb-basis">Based on ${p.scoreBreakdown.length} of ${p.scorePossible} measures ${infoTip("A dimension a product doesn't declare is left out of its average rather than counted against it -- so this score reflects fewer measures than a product with a full panel.")}</div>` : ""}
        </div>
        <div class="sb-rows">${p.scoreBreakdown.map(d => `
          <div class="sb-row"><span class="sb-row-label">${esc(d.label)} ${infoTip(renderMoney(d.what))}</span><span class="sb-bar"><i style="--v:${d.score}"></i></span><span class="sb-row-score num">${d.score}</span></div>`).join("")}
        </div>
      </div>
    </div>
    <div class="sb-layout-right">
      ${p.category === "electrolyte" ? `
      <div class="pcell">
        <div class="k">Cost per 1000mg sodium</div>
        <div class="v num">${p.costPer1000Na==null?"n/d":moneyPrecise(p.costPer1000Na, 2)}<small>/1000mg</small></div>
      </div>
      <div class="pcell">
        <div class="k">Sodium per ${p.servingWord||"serving"}</div>
        <div class="v num">${p.sodium}<small>mg</small></div>
      </div>` : `
      <div class="pcell">
        <div class="k">Cost per gram of carbohydrate</div>
        <div class="v num">${moneyPrecise(p.perGram, 3)}<small>/g</small></div>
      </div>
      <div class="pcell">
        <div class="k">Glucose : fructose${prov(p)}</div>
        <div class="v num">${p.ratio.replace(" : ",'<span class="sep">:</span>').replace(/\s/g,"")}</div>
      </div>`}
    </div>
    </div>
  </section>`}

  <section id="comparison">
    <div class="sh"><h2>Comparison</h2><span class="rule"></span>
      <span class="n" id="gelsHeldCount">${compareSet(p).length} of ${PRODUCTS.filter(x=>x.category===p.category).length} ${CATEGORY_PLURAL[p.category]} held</span>
    </div>
    <p class="sub">Prices per single sachet at the cheapest box size we track. Best in green, worst in red, across the gels shown.</p>
    <div id="tableWrap">${table(p)}</div>
  </section>

  <section id="verdict">
    <div class="sh"><h2>Verdict</h2><span class="rule"></span><span class="n">what it does &middot; what it costs</span></div>
    <div class="pc">
      <div class="pcx up"><h3>What it does well</h3><ul>${p.pros.map(x=>`<li>${esc(renderMoney(x))}</li>`).join("")}</ul></div>
      <div class="pcx dn"><h3>What it costs you</h3><ul>${p.cons.map(x=>`<li>${esc(renderMoney(x))}</li>`).join("")}</ul></div>
    </div>
  </section>

  <section id="buy">
    <div class="sh"><h2>Where to buy</h2><span class="rule"></span></div>
    <p class="sub">Prices and links as last checked. The price next to the name above is per unit at the cheapest box size we track -- a single-unit price below may run higher.</p>
    ${p.buy && p.buy.length ? `<div class="buy">${p.buy.map(b => `
      <a class="buy-row" href="${esc(b.url)}" target="_blank" rel="noopener">
        <span class="buy-retailer">${esc(b.retailer)}</span>
        <span class="buy-price num">${money(b.price)}${b.pack ? ` <small>${esc(b.pack)}</small>` : ""}</span>
        <span class="buy-go">Visit &rarr;</span>
      </a>`).join("")}</div>` : `<p class="buy-empty">Not yet checked at retail.</p>`}
  </section>

  <section id="who">
    <div class="sh"><h2>Who this is for</h2><span class="rule"></span><span class="n">the numbers, applied</span></div>
    <p class="sub">The field tells you what it is. This is who should act on it.</p>
    <div class="pc">
      <div class="pcx wy"><h3>Worth the money if</h3><ul>${p.yes.map(x=>`<li>${esc(renderMoney(x))}</li>`).join("")}</ul></div>
      <div class="pcx wn"><h3>Look elsewhere if</h3><ul>${p.no.map(x=>`<li>${esc(renderMoney(x))}</li>`).join("")}</ul></div>
    </div>
  </section>

  <footer>
    <p><b>Ingredients as declared.</b> ${esc(p.ingredients)}.</p>
    <p>Every derived figure on this page is computed from the declared nutrition panel, never entered by hand.</p>
  </footer>
  <div id="tocSpacer" aria-hidden="true"></div>`;
  window.scrollTo(0,0);
  initTOC(p);
}

/* re-run after every render() since #page (and its section ids) are rebuilt from scratch */
let tocObserver = null;
function initTOC(p){
  const toc = document.getElementById("toc");
  document.getElementById("tocHead").textContent = p.name;
  if(tocObserver) tocObserver.disconnect();
  const links = [...toc.querySelectorAll("button")];
  const sections = links.map(a => document.getElementById(a.dataset.sec)).filter(Boolean);
  links.forEach((a,i) => a.classList.toggle("active", i===0));
  fitAnchorSpacer(sections);
  if(!sections.length) return;
  tocObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if(!entry.isIntersecting) return;
      const link = toc.querySelector(`button[data-sec="${entry.target.id}"]`);
      links.forEach(a => a.classList.remove("active"));
      link.classList.add("active");
    });
  }, {rootMargin: "-40% 0px -50% 0px", threshold: 0});
  sections.forEach(s => tocObserver.observe(s));
}

/* How far below a section's top edge we land, so its heading clears the
   sticky header instead of tucking underneath it. */
function headerOffset(){
  const bar = document.querySelector(".bar");
  return (bar ? bar.getBoundingClientRect().height : 52) + 12;
}

/* A section near the end of the page can be shorter than one viewport height,
   which caps how far the browser can scroll — jumping to its toc link then
   lands wherever that cap happens to be (often overlapping an earlier
   section) instead of at the target. Pad the bottom of the page by exactly
   the missing amount so every section can reach its resting scroll position. */
function fitAnchorSpacer(sections){
  const spacer = document.getElementById("tocSpacer");
  if(!spacer || !sections.length) return;
  spacer.style.height = "0px";
  const last = sections[sections.length - 1];
  const neededTop = last.getBoundingClientRect().top + window.scrollY - headerOffset();
  const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
  const deficit = neededTop - maxScroll;
  if(deficit > 0) spacer.style.height = Math.ceil(deficit) + "px";
}
window.addEventListener("resize", () => fitAnchorSpacer(
  [...document.getElementById("toc").querySelectorAll("button")]
    .map(a => document.getElementById(a.dataset.sec)).filter(Boolean)
));

/* Plain buttons, not <a href="#id">: native fragment-jump heuristics (used to
   avoid landing content under a sticky header) vary by engine and were
   landing inconsistently between adjacent sections even with preventDefault.
   A button has no default navigation to fight, so the scroll position is
   always exactly the one computed below. They also leave the URL alone, so
   the current #category/product-id permalink stays in the address bar. */
document.getElementById("toc").addEventListener("click", e => {
  const a = e.target.closest("button[data-sec]");
  if(!a) return;
  const el = document.getElementById(a.dataset.sec);
  if(!el) return;
  const targetTop = el.getBoundingClientRect().top + window.scrollY - headerOffset();
  window.scrollTo({top: Math.max(0, targetTop), behavior: "smooth"});
});

/* ---- nav menus: one per category, each Brand > product, grouped from the
   data. Each category's menu is independent (its own .dd), but they share
   one open/close and brand-submenu behavior via delegation below. */
/* Clears the "on" state from every top-level nav link — the category
   dropdowns plus the plain hash-routed links (Find My Gel, Calculator) —
   so each render*() function starts from a known state before lighting up
   whichever link matches where it's navigating to. */
function clearNavHighlights(){
  document.querySelectorAll(".nav > .nv > a").forEach(a => a.classList.remove("on"));
  document.getElementById("find-link").classList.remove("on");
  document.getElementById("calc-link").classList.remove("on");
  closeMobileNav();
  setShareMeta(null);
  setRobotsMeta(null);
}

function buildMenu(category){
  const dd = document.getElementById(`dd-${category}`);
  const items = PRODUCTS.filter(p => p.category === category);
  const brands = items.reduce((m,p) => {
    (m[p.brand] = m[p.brand] || []).push(p);
    return m;
  }, {});
  dd.innerHTML = Object.keys(brands).sort().map(brand => `
    <div class="br">
      <button type="button" class="br-toggle" aria-expanded="false">${esc(brand)} <i>&rsaquo;</i></button>
      <div class="submenu">${brands[brand].map(p =>
        `<a href="${sitePath(`/${p.category}/${p.id}/`)}" data-i="${PRODUCTS.indexOf(p)}">${esc(p.short)} <em>${p.category==="electrolyte"?`${p.sodium} mg`:`${p.carbs} g`}</em></a>`).join("")}</div>
    </div>`).join("");
}
["gel","drink","electrolyte"].forEach(buildMenu);

function select(i){
  const p = PRODUCTS[i];
  document.querySelectorAll(".dd a[data-i]").forEach(b => b.setAttribute("aria-current", +b.dataset.i === i));
  clearNavHighlights();
  document.querySelectorAll(".nav > .nv > a").forEach(a => a.classList.toggle("on", a.dataset.cat === p.category));
  const ids = compareIds[p.category];
  if(!ids.includes(p.id)) ids.unshift(p.id);
  /* Permalink: /category/id/, pushed so Back/Forward walk reviews. Skipped
     when the path already matches (we were called FROM the router) so
     routing in never stacks a duplicate history entry. */
  const want = sitePath(p.category + "/" + p.id + "/");
  if(location.pathname !== want){ try{ history.pushState(null, "", want); }catch(err){} }
  document.title = p.name + " - Fuel Finder";
  setShareMeta(p);
  render(p);
}

function closeMenu(){
  document.querySelectorAll(".nv.open").forEach(x => x.classList.remove("open"));
  document.querySelectorAll(".br.open").forEach(br => br.classList.remove("open"));
  document.querySelectorAll(".nav [aria-expanded]").forEach(el => el.setAttribute("aria-expanded", "false"));
}

/* Mobile nav drawer: a separate open/close concern from closeMenu() above —
   closeMenu() resets the Gels/Drink mixes/Electrolytes accordions, this
   toggles the whole drawer those accordions live inside on narrow screens. */
function closeMobileNav(){
  const nav = document.getElementById("siteNav");
  const btn = document.getElementById("menuToggle");
  if(!nav || !btn) return;
  nav.classList.remove("mnav-open");
  btn.setAttribute("aria-expanded", "false");
  btn.textContent = "Menu";
}
function openMobileNav(){
  document.getElementById("siteNav").classList.add("mnav-open");
  const btn = document.getElementById("menuToggle");
  btn.setAttribute("aria-expanded", "true");
  btn.textContent = "Close";
}
document.getElementById("menuToggle").addEventListener("click", () => {
  document.getElementById("siteNav").classList.contains("mnav-open") ? closeMobileNav() : openMobileNav();
});

/* The category label navigates straight to /gels/ etc. The brand
   dropdown is a hover/focus preview on desktop only (:hover and
   :focus-within in CSS reveal .dd, no JS needed) -- touch devices have
   no hover to preview with, so on mobile a tap just goes straight to
   the category page, which is a full replacement for browsing brands
   there anyway. */
document.querySelectorAll(".nv > a[data-cat]").forEach(link => {
  link.addEventListener("click", e => {
    e.preventDefault();
    closeMenu();
    const cat = link.dataset.cat;
    try{ history.pushState(null, "", sitePath(`/${CATEGORY_PAGE_SLUG[cat]}/`)); }catch(err){}
    renderCategoryPage(cat);
  });
});

/* These live as literal href="/find/", href="/calculator/" etc. in
   index.html, which isn't templated at build time and so can't know the
   mount point. Point them at the real one now that it's known — this also
   keeps middle-click / open-in-new-tab honest, not just the click handler. */
document.getElementById("find-link").setAttribute("href", sitePath("/find/"));
document.getElementById("calc-link").setAttribute("href", sitePath("/calculator/"));
document.getElementById("footer-about-link").setAttribute("href", sitePath("/about/"));
document.getElementById("footer-methodology-link").setAttribute("href", sitePath("/methodology/"));
document.getElementById("home-link").setAttribute("href", sitePath("/"));
document.querySelectorAll(".nv > a[data-cat]").forEach(a => a.setAttribute("href", sitePath(`/${CATEGORY_PAGE_SLUG[a.dataset.cat]}/`)));

document.getElementById("find-link").addEventListener("click", e => {
  e.preventDefault();
  try{ history.pushState(null, "", sitePath("/find/")); }catch(err){}
  renderFinder();
});
document.getElementById("calc-link").addEventListener("click", e => {
  e.preventDefault();
  try{ history.pushState(null, "", sitePath("/calculator/")); }catch(err){}
  renderCalculator();
});
document.getElementById("footer-about-link").addEventListener("click", e => {
  e.preventDefault();
  try{ history.pushState(null, "", sitePath("/about/")); }catch(err){}
  renderAbout();
});
document.getElementById("footer-methodology-link").addEventListener("click", e => {
  e.preventDefault();
  try{ history.pushState(null, "", sitePath("/methodology/")); }catch(err){}
  renderMethodology();
});

const currencySel = document.getElementById("currencySel");
currencySel.value = currentCurrency;
currencySel.addEventListener("change", () => {
  currentCurrency = currencySel.value;
  try{ localStorage.setItem(CURRENCY_KEY, currentCurrency); }catch(err){}
  refreshCurrentView();
});

document.addEventListener("click", e=>{
  if(!e.target.closest(".nv")) closeMenu();
  if(!e.target.closest("#siteNav") && !e.target.closest("#menuToggle")) closeMobileNav();
});

document.addEventListener("keydown", e=>{
  if(e.key === "Escape"){
    const openTrigger = document.querySelector(".nv.open > a");
    const mobileWasOpen = document.getElementById("siteNav").classList.contains("mnav-open");
    closeMenu();
    closeMobileNav();
    /* Closing without moving focus back drops a keyboard user wherever the
       flyout happened to be, often behind the collapsed menu. Send it back
       to whichever trigger they opened. */
    if(openTrigger) openTrigger.focus();
    else if(mobileWasOpen) document.getElementById("menuToggle").focus();
  }
});

document.querySelector(".nav").addEventListener("click", e=>{
  const tog = e.target.closest(".br-toggle");
  if(tog){
    /* Close sibling brands within this category only — not the full
       closeMenu(), which would also drop the parent .nv's own open state.
       On desktop that's masked by :hover keeping the flyout visible either
       way, but on a tap-only device there's no hover to fall back on, so
       clearing the parent here would collapse the whole category the
       instant you tried to open a brand inside it. */
    const br = tog.parentElement;
    const wasOpen = br.classList.contains("open");
    br.parentElement.querySelectorAll(".br.open").forEach(x => {
      x.classList.remove("open");
      x.querySelector(".br-toggle").setAttribute("aria-expanded", "false");
    });
    br.classList.toggle("open", !wasOpen);
    tog.setAttribute("aria-expanded", String(!wasOpen));
    return;
  }
  const b = e.target.closest(".dd a[data-i]"); if(!b) return;
  e.preventDefault();
  select(+b.dataset.i);
  closeMenu();
  document.activeElement.blur();   /* close the hover menu after choosing */
});

/* Adding/removing a comparison column only needs the table (and its count)
   redrawn in place — not a full render(), which would also reset scroll
   position and blow away the finder panel's open/search state. */
function refreshComparison(){
  document.getElementById("tableWrap").innerHTML = table(CURRENT);
  document.getElementById("gelsHeldCount").textContent = `${compareSet(CURRENT).length} of ${PRODUCTS.filter(x=>x.category===CURRENT.category).length} ${CATEGORY_PLURAL[CURRENT.category]} held`;
}

const page = document.getElementById("page");
page.addEventListener("click", e => {
  const rm = e.target.closest("[data-rm]");
  if(rm){ compareIds[CURRENT.category] = compareSet(CURRENT).filter(p => p.id !== rm.dataset.rm).map(p => p.id);
          refreshComparison(); return; }

  const add = e.target.closest("#addbtn");
  if(add){ const pn = document.getElementById("fpanel");
           pn.hidden = !pn.hidden;
           if(!pn.hidden){
             /* fixed positioning (so the panel isn't clipped by the table's
                own horizontal scroll container) means its coordinates have
                to be computed from the trigger button each time it opens. */
             const r = add.getBoundingClientRect();
             pn.style.top = (r.bottom + 7) + "px";
             pn.style.right = (window.innerWidth - r.right) + "px";
             const q = document.getElementById("fq"); q.value = ""; drawResults(""); q.focus();
           }
           return; }

  const pick = e.target.closest("[data-add]");
  if(pick){ if(compareSet(CURRENT).length < MAX_COMPARE){
              compareIds[CURRENT.category] = [...compareSet(CURRENT).map(p => p.id), pick.dataset.add];
            }
            document.getElementById("fpanel").hidden = true;
            refreshComparison(); return; }

  if(e.target.closest("#adminUnlock")){ checkAdminPassword(); return; }

  const go = e.target.closest(".home-go");
  if(go && go.dataset.i !== undefined){ select(+go.dataset.i); return; }

  const fcLink = e.target.closest("[data-fc-link]");
  if(fcLink){
    e.preventDefault();
    const cat = fcLink.dataset.fcLink;
    try{ history.pushState(null, "", sitePath("/find/" + cat + "/")); }catch(err){}
    renderFinder(cat);
    return;
  }

  /* In-body links inside dynamically-rendered content (e.g. the About page's
     prose linking to Methodology/Find Your Fuel) — unlike the header/footer
     nav, this markup is torn down and rebuilt on every render(), so it can't
     hold its own addEventListener the way footer-about-link etc. do. */
  const pageLink = e.target.closest("[data-page]");
  if(pageLink){
    e.preventDefault();
    const dest = { about: ["/about/", renderAbout], methodology: ["/methodology/", renderMethodology],
                    find: ["/find/", () => renderFinder()], calculator: ["/calculator/", renderCalculator],
                    gels: ["/gels/", () => renderCategoryPage("gel")],
                    "drink-mixes": ["/drink-mixes/", () => renderCategoryPage("drink")],
                    electrolytes: ["/electrolytes/", () => renderCategoryPage("electrolyte")] }[pageLink.dataset.page];
    if(dest){
      try{ history.pushState(null, "", sitePath(dest[0])); }catch(err){}
      dest[1]();
    }
    return;
  }

  const bcLink = e.target.closest(".bc-link");
  if(bcLink && bcLink.dataset.i !== undefined){ e.preventDefault(); select(+bcLink.dataset.i); return; }

  const recentNav = e.target.closest(".recent-nav");
  if(recentNav){
    const track = recentNav.parentElement.querySelector(".recent-track");
    const card = track?.querySelector(".recent-card");
    const step = card ? card.getBoundingClientRect().width + 14 : 300;
    track?.scrollBy({ left: recentNav.classList.contains("recent-prev") ? -step * 2 : step * 2, behavior: "smooth" });
    return;
  }

  const lbTab = e.target.closest("[data-lb-cat]");
  if(lbTab){
    const cat = lbTab.dataset.lbCat;
    if(cat === leaderboardCat) return;
    leaderboardCat = cat;
    lbTab.closest(".lb-tabs").querySelectorAll(".lb-tab").forEach(t => {
      const on = t.dataset.lbCat === cat;
      t.classList.toggle("active", on);
      t.setAttribute("aria-selected", String(on));
    });
    document.getElementById("lbIndicator").style.transform = `translateX(${LB_CATS.indexOf(cat) * 100}%)`;
    document.getElementById("lbList").innerHTML = leaderboardRowsHTML(cat);
    return;
  }

  const sortTh = e.target.closest("[data-cat-sort]");
  if(sortTh){
    const idx = +sortTh.dataset.catSort;
    categorySort = categorySort.colIndex === idx
      ? {colIndex: idx, dir: categorySort.dir === "desc" ? "asc" : "desc"}
      : {colIndex: idx, dir: "desc"};
    sortTh.parentElement.querySelectorAll("[data-cat-sort]").forEach(th => {
      th.classList.remove("sorted-asc", "sorted-desc");
    });
    sortTh.classList.add("sorted-" + categorySort.dir);
    document.getElementById("catTableBody").innerHTML = categoryTableRowsHTML(categoryPageCat);
    return;
  }

  const accHead = e.target.closest(".acc-head");
  if(accHead){
    const item = accHead.closest(".acc-item");
    const wasOpen = item.classList.contains("open");
    /* Single-open accordion: opening one closes any other in the same
       group, so the page stays as short as the reference image showed. */
    item.parentElement.querySelectorAll(".acc-item.open").forEach(other => {
      if(other !== item){ other.classList.remove("open"); other.querySelector(".acc-head").setAttribute("aria-expanded", "false"); }
    });
    item.classList.toggle("open", !wasOpen);
    accHead.setAttribute("aria-expanded", String(!wasOpen));
    return;
  }

  const result = e.target.closest(".site-search-results button[data-i]");
  if(result){ select(+result.dataset.i); return; }

  const req = e.target.closest("[data-request]");
  if(req){ renderWaiting(req.dataset.request); return; }

  const removeReq = e.target.closest("[data-remove-request]");
  if(removeReq){ RequestLog.remove(removeReq.dataset.removeRequest); renderRequestsAdmin(); return; }

  const clearAll = e.target.closest("#clearAllRequests");
  if(clearAll){ RequestLog.clear(); renderRequestsAdmin(); return; }

  const fc = e.target.closest("[data-fc]");
  if(fc){ renderFinder(fc.dataset.fc); return; }

  const fq = e.target.closest("[data-fq]");
  if(fq){ const key = fq.dataset.fq, val = fq.dataset.fv;
          finderAnswers[key] = finderAnswers[key] === val ? null : val;
          document.querySelectorAll(`.fq-opt[data-fq="${key}"]`).forEach(b =>
            b.classList.toggle("on", b.dataset.fv === finderAnswers[key]));
          document.getElementById("finderResultsBody").innerHTML = finderResultsHTML();
          return; }

  const cf = e.target.closest("[data-cf]");
  if(cf){ const key = cf.dataset.cf, val = cf.dataset.cv;
          calcAnswers[key] = val;
          document.querySelectorAll(`.fq-opt[data-cf="${key}"]`).forEach(b =>
            b.classList.toggle("on", b.dataset.cv === calcAnswers[key]));
          document.getElementById("calcResultsBody").innerHTML = calcResultsHTML();
          return; }

  if(!e.target.closest(".finder")){
    const pn = document.getElementById("fpanel"); if(pn) pn.hidden = true;
  }
});
page.addEventListener("input", e => {
  if(e.target.id === "fq") drawResults(e.target.value);
  if(e.target.id === "siteSearch") drawSiteSearch(e.target.value);
  if(e.target.id === "calcHoursSel" || e.target.id === "calcMinsSel"){
    calcAnswers.hours = Number(document.getElementById("calcHoursSel").value);
    calcAnswers.minutes = Number(document.getElementById("calcMinsSel").value);
    document.getElementById("calcResultsBody").innerHTML = calcResultsHTML();
  }
});
page.addEventListener("keydown", e => {
  if(e.target.id === "adminPass" && e.key === "Enter"){ checkAdminPassword(); return; }
  if(e.target.id !== "siteSearch" || e.key !== "Enter") return;
  const q = e.target.value.trim();
  if(!q) return;
  const s = q.toLowerCase();
  const hit = PRODUCTS.find(p => (p.name + " " + p.brand + " " + p.code).toLowerCase().includes(s));
  if(hit) select(PRODUCTS.indexOf(hit));
  else renderWaiting(q);
});

/* Gel/drink/electrolyte finder: a short per-category quiz that scores
   products against the reader's answers using the same min-max-against-
   peers approach as overallScore, with weights driven by what was picked
   instead of a fixed dimension list. Each category gets its own question
   set — the gel questions don't all translate (drink mixes have no gut-
   comfort data and are all caffeine-free; electrolytes aren't a duration-
   scaled carb fuel at all) — but they share one mechanism and one visual
   language. Caffeine is a hard filter for gels (binary yes/no on the
   panel); everything else is a soft preference so an unusual combination
   of answers never produces zero results. */
const FINDER_CATS = [["gel","Gels"], ["drink","Drink Mixes"], ["electrolyte","Electrolytes"]];

const FINDER_QUESTIONS = {
  gel: [
    {key:"duration", label:"How long is the effort?", opts:[
      ["under90","Under 90 min"], ["90to3h","90 min – 3 hrs"], ["over3h","Over 3 hrs"]]},
    {key:"sensitivity", label:"Stomach sensitivity?", opts:[
      ["sensitive","Sensitive"], ["noissues","No issues"]]},
    {key:"caffeine", label:"Caffeine?", opts:[
      ["want","Want it"], ["avoid","Avoid it"], ["dontcare","Don't care"]]},
    {key:"electrolytes", label:"Do you want electrolytes in your gel?", opts:[
      ["yes","Yes"], ["no","No"], ["dontcare","Don't care"]]}
  ],
  drink: [
    {key:"duration", label:"How long is the effort?", opts:[
      ["under90","Under 90 min"], ["90to3h","90 min – 3 hrs"], ["over3h","Over 3 hrs"]]},
    {key:"carbs", label:"How many carbs do you want in your mix?", opts:[
      ["low","Low"], ["med","Medium"], ["high","High"]]},
    {key:"electrolytes", label:"Do you want electrolytes in your mix?", opts:[
      ["yes","Yes"], ["no","No"], ["dontcare","Don't care"]]}
  ],
  electrolyte: [
    {key:"sodium", label:"How much sodium are you looking for?", opts:[
      ["light","Light"], ["moderate","Moderate"], ["heavy","Heavy"]]},
    {key:"priority", label:"What matters more?", opts:[
      ["cost","Lowest cost"], ["profile","Fullest mineral profile"]]}
  ]
};

let finderAnswers = {category: "gel"};

function finderHasAnswer(){
  return Object.entries(finderAnswers).some(([k,v]) => k !== "category" && v);
}

function findMatches(answers){
  const cat = answers.category;
  const pool = PRODUCTS.filter(p => p.category === cat);
  const dims = [];

  if(cat === "gel"){
    /* Caffeine used to hard-filter the pool -- "want" could drop a
       14-gel category down to 5 with the other 9 simply gone. Scored
       like every other preference here instead, so a caffeine answer
       re-ranks the full list rather than cutting it. */
    if(answers.caffeine === "want") dims.push(["caf", p=>p.caffeine, "hi", 2]);
    else if(answers.caffeine === "avoid") dims.push(["caf", p=>p.caffeine, "lo", 2]);
    dims.push(["gut", p=>p.gut, "hi", answers.sensitivity === "sensitive" ? 3 : 1]);
    if(answers.electrolytes === "yes") dims.push(["sod", p=>p.sodium, "hi", 3]);
    else if(answers.electrolytes === "no") dims.push(["sod", p=>p.sodium, "lo", 2]);
    const durW = answers.duration === "over3h" ? 3 : answers.duration === "90to3h" ? 1.5 : 0.5;
    dims.push(["cost", p=>p.perGram, "lo", durW]);
    dims.push(["dens", p=>p.carbs, "hi", durW * 0.7]);
    dims.push(["rate", p=>p.ratioScore, "hi", 1]);
  } else if(cat === "drink"){
    if(answers.electrolytes === "yes") dims.push(["sod", p=>p.sodium, "hi", 3]);
    else if(answers.electrolytes === "no") dims.push(["sod", p=>p.sodium, "lo", 2]);
    const durW = answers.duration === "over3h" ? 3 : answers.duration === "90to3h" ? 1.5 : 0.5;
    dims.push(["cost", p=>p.perGram, "lo", durW]);
    if(answers.carbs === "low") dims.push(["dens", p=>p.carbs, "lo", 3]);
    else if(answers.carbs === "high") dims.push(["dens", p=>p.carbs, "hi", 3]);
    dims.push(["rate", p=>p.ratioScore, "hi", 1]);
  } else {
    if(answers.sodium === "light") dims.push(["sod", p=>p.sodium, "lo", 3]);
    else if(answers.sodium === "heavy") dims.push(["sod", p=>p.sodium, "hi", 3]);
    const costW = answers.priority === "cost" ? 4 : 1;
    const profileW = answers.priority === "profile" ? 3 : 1;
    dims.push(["cost", p=>p.costPer1000Na, "lo", costW]);
    dims.push(["pot", p=>p.potassium, "hi", profileW]);
    dims.push(["cal", p=>p.calcium, "hi", profileW]);
    dims.push(["mag", p=>p.magnesium, "hi", profileW]);
  }

  const scored = pool.map(p => {
    let total = 0, wsum = 0;
    dims.forEach(([,get,dir,w]) => {
      const mine = get(p);
      if(mine === null || mine === undefined) return;
      const vals = pool.map(get).filter(v => v !== null && v !== undefined);
      const min = Math.min(...vals), max = Math.max(...vals);
      const t = max === min ? 1 : (mine - min) / (max - min);
      total += (dir === "hi" ? t : 1 - t) * w;
      wsum += w;
    });
    return {p, matchScore: wsum ? total / wsum : 0};
  });
  scored.sort((a,b) => b.matchScore - a.matchScore || (b.p.overallScore ?? 0) - (a.p.overallScore ?? 0));
  return scored;
}

function finderQuizHTML(){
  return FINDER_QUESTIONS[finderAnswers.category].map(q => `
    <div class="fq-group">
      <div class="fq-label">${esc(q.label)}</div>
      <div class="fq-opts">${q.opts.map(([v,l]) => `
        <button type="button" class="fq-opt${finderAnswers[q.key]===v?" on":""}" data-fq="${q.key}" data-fv="${v}">${esc(l)}</button>`).join("")}</div>
    </div>`).join("");
}

function finderStatsHTML(cat, p){
  if(cat === "gel"){
    return `<span>Gut comfort <b>${p.gut}</b></span>
      <span>Sodium <b>${p.sodium===null?"n/d":p.sodium+" mg"}</b></span>
      <span>Caffeine <b>${p.caffeine>0?p.caffeine+" mg":"None"}</b></span>
      <span>Cost/g <b>${moneyPrecise(p.perGram, 3)}</b></span>`;
  }
  if(cat === "drink"){
    return `<span>Carbohydrate <b>${p.carbs} g</b></span>
      <span>Sodium <b>${p.sodium===null?"n/d":p.sodium+" mg"}</b></span>
      <span>Cost/g <b>${moneyPrecise(p.perGram, 3)}</b></span>`;
  }
  return `<span>Sodium <b>${p.sodium} mg</b></span>
    <span>Potassium <b>${p.potassium==null?"n/d":p.potassium+" mg"}</b></span>
    <span>Cost/1000mg Na <b>${p.costPer1000Na==null?"n/d":moneyPrecise(p.costPer1000Na, 2)}</b></span>`;
}

/* Always renders the full category, ranked -- previously this returned
   nothing but a prompt until a quiz question was answered, so a crawler
   (and a browser without JS) saw zero product links here. It also used
   to split into a "top 3" card grid plus a separate compact list for
   everything else; that's gone too, per direct feedback -- one ranked
   list, same card treatment top to bottom, so nothing reads as
   arbitrarily cut off at 3. */
function finderResultsHTML(){
  const cat = finderAnswers.category;
  const ranked = finderHasAnswer()
    ? findMatches(finderAnswers)
    : PRODUCTS.filter(p => p.category === cat)
        .slice().sort((a,b) => (b.overallScore ?? -1) - (a.overallScore ?? -1))
        .map(p => ({p}));

  return `
  <div class="fr-grid">${ranked.map((m,i) => { const p = m.p; return `
    <div class="fr-card">
      <div class="fr-rank">${i+1}</div>
      <div class="fr-body">
        <div class="fr-name"><b>${esc(p.name)}</b>${p.overallScore===null?"":`<span class="fr-score tier-${scoreTier(p.overallScore)}">${p.overallScore}</span>`}</div>
        <div class="fr-brand">${esc(p.brand)}</div>
        <div class="fr-stats">${finderStatsHTML(cat, p)}</div>
      </div>
      <button class="home-go fr-go" data-i="${PRODUCTS.indexOf(p)}">View review &rarr;</button>
    </div>`; }).join("")}</div>`;
}

/* The full category, not whatever the quiz currently has filtered down to
   -- ItemList should describe the whole collection this page represents,
   same as a category page's product grid would, regardless of which
   quiz answers happen to be selected right now. */
function itemListSchema(cat){
  const items = PRODUCTS.filter(p => p.category === cat);
  const obj = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    itemListElement: items.map((p, i) => ({
      "@type": "ListItem", position: i + 1, name: p.name,
      url: location.origin + sitePath(`${p.category}/${p.id}/`)
    }))
  };
  return JSON.stringify(obj).replace(/<\//g, "<\\/");
}

/* Category landing pages (/gels/, /drink-mixes/, /electrolytes/) — the
   pages that can actually rank for "best energy gel" and similar, since
   the 41 individual product pages target brand names, not the category.
   Distinct from /find/{cat}/: that page is the interactive quiz tool,
   this one is a static, sortable comparison over the whole category with
   its own framing copy, meant to be landed on directly from search.
   CATEGORY_PAGE_SLUG lives up with CATEGORY_LABEL/CATEGORY_PLURAL near
   the top of the file since the nav-link setup code below runs at
   module load, before this block would otherwise be defined. */
const CATEGORY_PAGE_TITLE = {
  gel: "Energy gels, compared on the numbers",
  drink: "Drink mixes, compared on the numbers",
  electrolyte: "Electrolyte products, compared on the numbers"
};
const CATEGORY_PAGE_DESC = {
  gel: "19 energy gels compared on glucose:fructose ratio, cost per gram of carbohydrate, and score -- sortable, no affiliate links.",
  drink: "12 endurance drink mixes compared on ratio, sodium, cost per gram, and score -- sortable, no affiliate links.",
  electrolyte: "10 electrolyte products compared on sodium dose, cost per 1000mg sodium, and score -- sortable, no affiliate links."
};
const CATEGORY_PAGE_INTRO = {
  gel: `Every gel on this page claims to be the best fuel for endurance racing. The label rarely says why. Two numbers explain most of the real difference: the glucose-to-fructose ratio, which sets how much carbohydrate your gut can actually absorb in an hour, and cost per gram, the only price that's comparable once sachets range from 22&nbsp;g to 90&nbsp;g. A 1:0.8 blend supports a meaningfully higher intake rate than one built on maltodextrin alone or an older 2:1 ratio -- the field's ceiling sits around 90&nbsp;g/hr, and the table below shows exactly where each product lands against it. Sodium is shown when a gel carries any, though most carry little to none on purpose; that's what a dedicated electrolyte product is for, which is also why gels aren't scored against a sodium target here. Sort any column, or run a duration through the <a href="${sitePath("/calculator/")}" data-page="calculator">calculator</a> to see how many sachets an effort actually needs.`,
  drink: `Drink mixes do a job a gel doesn't have to: carry fluid, and in most formulas, meaningful sodium alongside the carbohydrate. That's the real axis of difference below -- a 90&nbsp;g sachet built for a bottle isn't comparable to a 22&nbsp;g one meant to be sipped concentrated, so cost per gram of carbohydrate is the number that travels across serving sizes, same as it is for gels. The glucose-to-fructose ratio still governs how much of that carbohydrate an hour your gut can move; the field's ceiling is around 90&nbsp;g/hr, the same anchor used throughout this site. Sodium is shown per serving and, unlike gels, does factor into a drink mix's score, since carrying electrolytes alongside fuel is closer to the point of a drink mix than a gel. Sort by any column, or run a duration through the <a href="${sitePath("/calculator/")}" data-page="calculator">calculator</a> to see how many scoops or sachets an effort actually needs.`,
  electrolyte: `Electrolyte products are built to replace sodium, not carbohydrate -- most carry next to none -- so the price that matters here is cost per 1000&nbsp;mg of sodium, not per gram of anything. That number varies more than the marketing suggests: some tablets carry triple the sodium of others at a similar price, and box size changes the per-dose math more than flavor does. Potassium, calcium and magnesium are shown too, when a product declares them -- the gel and drink mix pages on this site set electrolyte content aside for exactly this category to cover. Sort the table by sodium dose, by cost, or by score to see the field from whichever angle actually matters for your race.`
};

function categoryTableCols(cat){
  if(cat === "electrolyte"){
    return [
      ["Sodium", p => `${p.sodium} mg`, p => p.sodium, "hi"],
      ["Potassium", p => p.potassium==null ? "not declared" : `${p.potassium} mg`, p => p.potassium ?? -1, "hi"],
      ["Calcium", p => p.calcium==null ? "not declared" : `${p.calcium} mg`, p => p.calcium ?? -1, "hi"],
      ["Magnesium", p => p.magnesium==null ? "not declared" : `${p.magnesium} mg`, p => p.magnesium ?? -1, "hi"],
      ["Carbohydrate", p => `${p.carbs} g`, p => p.carbs, "lo"],
      ["Price", p => money(p.price), p => p.price, "lo"],
      ["Cost / 1000mg Na", p => p.costPer1000Na==null ? "n/d" : moneyPrecise(p.costPer1000Na, 2), p => p.costPer1000Na ?? Infinity, "lo"],
      ["Score", p => p.overallScore==null ? "n/d" : p.overallScore, p => p.overallScore ?? -1, "hi"]
    ];
  }
  return [
    ["Carbohydrate", p => `${p.carbs} g`, p => p.carbs, "hi"],
    ["Ratio", p => p.ratio, p => p.ratioScore, "hi"],
    ["Provenance", p => p.ratioProv, null, null],
    ["Sodium", p => p.sodium===null ? "not declared" : `${p.sodium} mg`, p => p.sodium ?? -1, "hi"],
    ["Price", p => money(p.price), p => p.price, "lo"],
    ["Cost / gram", p => moneyPrecise(p.perGram, 3), p => p.perGram, "lo"],
    ["For 90 g/hr", p => `${p.perHour.toFixed(1)} ${pluralize(p.servingWord || "sachet", p.perHour)}`, p => p.perHour, "lo"],
    ["Score", p => p.overallScore==null ? "n/d" : p.overallScore, p => p.overallScore ?? -1, "hi"]
  ];
}

let categorySort = {colIndex: -1, dir: "desc"};
let categoryPageCat = null;

function categoryTableRowsHTML(cat){
  const cols = categoryTableCols(cat);
  const items = PRODUCTS.filter(p => p.category === cat);
  const {colIndex, dir} = categorySort;
  const sorted = colIndex === -1
    ? items.slice().sort((a,b) => (b.overallScore ?? -1) - (a.overallScore ?? -1))
    : items.slice().sort((a,b) => {
        const [,,key] = cols[colIndex];
        const av = key(a), bv = key(b);
        return dir === "asc" ? (av > bv ? 1 : av < bv ? -1 : 0) : (av < bv ? 1 : av > bv ? -1 : 0);
      });
  return sorted.map(p => `
    <tr>
      <th><a href="${sitePath(`/${p.category}/${p.id}/`)}" data-i="${PRODUCTS.indexOf(p)}" class="bc-link cat-table-name">${esc(p.name)}<span class="cat-table-brand">${esc(p.brand)}</span></a></th>
      ${cols.map(([,fmt]) => `<td>${fmt(p)}</td>`).join("")}
    </tr>`).join("");
}

function categoryTableHTML(cat){
  const cols = categoryTableCols(cat);
  return `
  <div class="tw"><table class="cat-table">
    <colgroup><col class="labelcol">${cols.map(()=>"<col>").join("")}</colgroup>
    <thead><tr>
      <th>Product</th>
      ${cols.map(([label,,key], i) => key
        ? `<th class="sortable${categorySort.colIndex===i?" sorted-"+categorySort.dir:""}" data-cat-sort="${i}">${esc(label)}</th>`
        : `<th>${esc(label)}</th>`).join("")}
    </tr></thead>
    <tbody id="catTableBody">${categoryTableRowsHTML(cat)}</tbody>
  </table></div>`;
}

function categoryCalloutsHTML(cat){
  const items = PRODUCTS.filter(p => p.category === cat);
  if(cat === "electrolyte"){
    const cheapest = items.filter(p => p.costPer1000Na!=null).reduce((b,p) => p.costPer1000Na < b.costPer1000Na ? p : b);
    const highestNa = items.reduce((b,p) => p.sodium > b.sodium ? p : b);
    return `<div class="cat-callouts">
      <a class="cat-callout bc-link" href="${sitePath(`/electrolyte/${cheapest.id}/`)}" data-i="${PRODUCTS.indexOf(cheapest)}">
        <span class="cat-callout-label">Cheapest per 1000mg sodium</span>
        <span class="cat-callout-name">${esc(cheapest.name)}</span>
        <span class="cat-callout-stat">${moneyPrecise(cheapest.costPer1000Na, 2)}</span>
      </a>
      <a class="cat-callout bc-link" href="${sitePath(`/electrolyte/${highestNa.id}/`)}" data-i="${PRODUCTS.indexOf(highestNa)}">
        <span class="cat-callout-label">Highest sodium dose</span>
        <span class="cat-callout-name">${esc(highestNa.name)}</span>
        <span class="cat-callout-stat">${highestNa.sodium} mg</span>
      </a>
    </div>`;
  }
  const cheapest = items.reduce((b,p) => p.perGram < b.perGram ? p : b);
  const highestRatio = items.reduce((b,p) => p.ratioScore > b.ratioScore ? p : b);
  return `<div class="cat-callouts">
    <a class="cat-callout bc-link" href="${sitePath(`/${cat}/${cheapest.id}/`)}" data-i="${PRODUCTS.indexOf(cheapest)}">
      <span class="cat-callout-label">Cheapest per gram</span>
      <span class="cat-callout-name">${esc(cheapest.name)}</span>
      <span class="cat-callout-stat">${moneyPrecise(cheapest.perGram, 3)}</span>
    </a>
    <a class="cat-callout bc-link" href="${sitePath(`/${cat}/${highestRatio.id}/`)}" data-i="${PRODUCTS.indexOf(highestRatio)}">
      <span class="cat-callout-label">Highest ratio</span>
      <span class="cat-callout-name">${esc(highestRatio.name)}</span>
      <span class="cat-callout-stat">${highestRatio.ratio}</span>
    </a>
  </div>`;
}

function setPageMeta(title, desc){
  document.title = title;
  [["meta[name='description']","content",desc],
   ["meta[property='og:title']","content",title],
   ["meta[property='og:description']","content",desc],
   ["meta[name='twitter:title']","content",title],
   ["meta[name='twitter:description']","content",desc]
  ].forEach(([sel,attr,val]) => { const el = document.querySelector(sel); if(el) el.setAttribute(attr, val); });
}

function renderCategoryPage(cat){
  categorySort = {colIndex: -1, dir: "desc"};
  categoryPageCat = cat;
  clearNavHighlights();
  document.querySelectorAll(".nav > .nv > a").forEach(a => a.classList.toggle("on", a.dataset.cat === cat));
  setPageMeta(`${CATEGORY_PAGE_TITLE[cat]} - Fuel Finder`, CATEGORY_PAGE_DESC[cat]);
  document.getElementById("toc").style.display = "none";
  const count = PRODUCTS.filter(p => p.category === cat).length;
  document.getElementById("page").innerHTML = `
  <script type="application/ld+json">${itemListSchema(cat)}<\/script>
  <div class="home-hero">
    <p class="eye">${count} ${esc(CATEGORY_PLURAL[cat])} reviewed</p>
    <h1>${esc(CATEGORY_PAGE_TITLE[cat])}</h1>
    <p class="thesis cat-intro">${CATEGORY_PAGE_INTRO[cat]}</p>
  </div>
  ${categoryCalloutsHTML(cat)}
  <section id="cat-table-section">
    <div class="sh"><h2>Full comparison</h2><span class="rule"></span></div>
    ${categoryTableHTML(cat)}
  </section>
  <p class="thesis cat-outro">Not sure which of these fits? <a href="${sitePath(`/find/${cat}/`)}" data-fc-link="${cat}">Answer a few questions</a> and we'll rank the catalog for your race instead of just the numbers.</p>`;
  window.scrollTo(0,0);
}

function renderFinder(cat){
  finderAnswers = {category: FINDER_QUESTIONS[cat] ? cat : "gel"};
  document.title = "Find your fuel - Fuel Finder";
  clearNavHighlights();
  document.getElementById("find-link").classList.add("on");
  document.getElementById("toc").style.display = "none";
  document.getElementById("page").innerHTML = `
  <script type="application/ld+json">${itemListSchema(finderAnswers.category)}<\/script>
  <div class="home-hero">
    <p class="eye">Not sure where to start</p>
    <h1>Find your fuel</h1>
    <p class="thesis">Answer a few quick questions and we'll point you to the gels, drink mixes, or electrolytes in our catalog that fit.</p>
    <div class="fq-opts finder-cat-switch">${FINDER_CATS.map(([v,l]) => `
      <button type="button" class="fq-opt${finderAnswers.category===v?" on":""}" data-fc="${v}">${esc(l)}</button>`).join("")}</div>
  </div>
  <section id="finder-quiz">
    <div class="fq" id="finderQuizBody">${finderQuizHTML()}</div>
  </section>
  <section id="finder-results">
    <div class="sh"><h2>The right ${esc(CATEGORY_LABEL[finderAnswers.category])} for you</h2><span class="rule"></span></div>
    <div id="finderResultsBody">${finderResultsHTML()}</div>
  </section>`;
  window.scrollTo(0,0);
}

/* Race fueling calculator. Two inputs — carb tolerance (mapped to a target
   g/hr rate, since most readers don't know their own number) and effort
   duration — give a total carb target, then every gel and drink mix in the
   catalog is priced against that target so it's directly comparable to the
   existing product tables rather than a new interaction pattern. */
const CALC_TOLERANCE = [
  ["new", "New to this", 45],
  ["some", "Some experience", 75],
  ["experienced", "Very experienced", 90]
];
const CALC_HOURS = [...Array(16).keys()];       // 0–15 hr
const CALC_MINS = [0, 15, 30, 45];
let calcAnswers = {tolerance: "some", hours: 3, minutes: 0, category: "gel"};

function calcTargetRate(){
  const t = CALC_TOLERANCE.find(t => t[0] === calcAnswers.tolerance);
  return t ? t[2] : CALC_TOLERANCE[1][2];
}
function calcTotalCarbs(){
  const hours = Number(calcAnswers.hours) + Number(calcAnswers.minutes) / 60;
  return hours > 0 ? Math.round(calcTargetRate() * hours) : 0;
}

function calcResultsHTML(){
  const total = calcTotalCarbs();
  const rows = PRODUCTS.filter(p => p.category === calcAnswers.category).map(p => {
    const unit = p.servingWord || "sachet";
    const count = total > 0 ? Math.ceil(total / p.carbs) : 0;
    return {p, unit, count, cost: count * p.price};
  }).sort((a,b) => a.cost - b.cost);

  const durLabel = `${calcAnswers.hours} hr${calcAnswers.minutes ? ` ${calcAnswers.minutes} min` : ""}`;
  return `
  <div class="pcell calc-total">
    <div class="k">Carbohydrate needed for this effort</div>
    <div class="v num">${total}<small>g</small></div>
    <div class="calc-rate">${calcTargetRate()} g/hr &times; ${durLabel}</div>
  </div>
  <p class="calc-note">This is a reference range from the sports-nutrition literature, not a personal prescription -- body mass, gut training and heat all shift what an individual can actually absorb. <a href="${sitePath("/methodology/")}" data-page="methodology">How these rates are set &rarr;</a></p>
  <div class="fq-opts calc-fueltype">
    <button type="button" class="fq-opt${calcAnswers.category==="gel"?" on":""}" data-cf="category" data-cv="gel">Gels</button>
    <button type="button" class="fq-opt${calcAnswers.category==="drink"?" on":""}" data-cf="category" data-cv="drink">Isotonic drinks</button>
  </div>
  <div class="tw calc-tw"><table>
    <colgroup><col class="labelcol"><col class="gelcol"><col class="gelcol"></colgroup>
    <thead><tr><th>Product</th><th>You'll need</th><th>Total cost</th></tr></thead>
    <tbody>${rows.map(r => `
      <tr>
        <th><button class="home-go calc-link" data-i="${PRODUCTS.indexOf(r.p)}">${esc(r.p.name)}</button></th>
        <td>${total > 0 ? `${r.count} ${esc(pluralize(r.unit, r.count))}` : "-"}</td>
        <td>${total > 0 ? money(r.cost) : "-"}</td>
      </tr>`).join("")}</tbody>
  </table></div>`;
}

function renderCalculator(){
  document.title = "Race Fueling Calculator - Fuel Finder";
  clearNavHighlights();
  document.getElementById("calc-link").classList.add("on");
  document.getElementById("toc").style.display = "none";
  calcAnswers = {tolerance: "some", hours: 3, minutes: 0, category: "gel"};
  document.getElementById("page").innerHTML = `
  <div class="home-hero">
    <p class="eye">Plan your race</p>
    <h1>How much fuel do you need?</h1>
    <p class="thesis">Two quick inputs, and we'll show how many sachets or scoops of every gel and drink mix in the catalog gets you there -- and what it costs.</p>
  </div>
  <section id="calc-inputs">
    <div class="fq">
      <div class="fq-group">
        <div class="fq-label">How used to taking carbs during exercise are you?</div>
        <div class="fq-opts">${CALC_TOLERANCE.map(([v,l]) => `
          <button type="button" class="fq-opt${calcAnswers.tolerance===v?" on":""}" data-cf="tolerance" data-cv="${v}">${esc(l)}</button>`).join("")}</div>
      </div>
      <div class="fq-group">
        <div class="fq-label">How long is the effort?</div>
        <div class="calc-time">
          <select id="calcHoursSel" class="calc-select">${CALC_HOURS.map(h => `
            <option value="${h}"${calcAnswers.hours===h?" selected":""}>${h} hr</option>`).join("")}</select>
          <select id="calcMinsSel" class="calc-select">${CALC_MINS.map(m => `
            <option value="${m}"${calcAnswers.minutes===m?" selected":""}>${m} min</option>`).join("")}</select>
        </div>
      </div>
    </div>
  </section>
  <section id="calc-results">
    <div class="sh"><h2>Your carb target</h2><span class="rule"></span></div>
    <div id="calcResultsBody">${calcResultsHTML()}</div>
  </section>`;
  window.scrollTo(0,0);
}

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
          ? `<a href="${sitePath(`/${CATEGORY_PAGE_SLUG[cat]}/`)}" class="home-go" data-page="${CATEGORY_PAGE_SLUG[cat]}">Browse ${label}</a>`
          : `<p class="home-soon">Coming soon</p>`}
      </div>`;
    }).join("")}
  </div>`;
}

function bestValueInCategory(cat){
  const items = PRODUCTS.filter(p => p.category === cat && typeof p.perGram === "number");
  if(!items.length) return null;
  return items.reduce((best, p) => p.perGram < best.perGram ? p : best);
}

function highestRatedInCategory(cat){
  const items = PRODUCTS.filter(p => p.category === cat && p.overallScore !== null);
  if(!items.length) return null;
  return items.reduce((best, p) => p.overallScore > best.overallScore ? p : best);
}

/* Small hand-drawn inline icons, not an icon-font or CDN library — this
   site's only network calls are the ones documented at the top of
   index.html (fonts, GoatCounter, Frankfurter, product photos), and an
   icon CDN would be a fifth. currentColor so a cell just sets color. */
const ICON = {
  star: '<path d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6-5.4-3-5.4 3 1.2-6-4.5-4.2 6.1-.7z"/>',
  tag: '<path d="M3 3h8l10 10-8 8L3 11V3z"/><circle cx="7.8" cy="7.8" r="1.3" fill="currentColor" stroke="none"/>',
  zap: '<path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z"/>',
  sachet: '<path d="M8.5 3c-1 0-1.5 1-1.5 2v2c-1.2.8-2 2.2-2 4v7c0 1.9 1.3 2.9 3 3.1 2.6.3 5.4.3 8 0 1.7-.2 3-1.2 3-3.1v-7c0-1.8-.8-3.2-2-4V5c0-1-.5-2-1.5-2-.7 0-1.3.4-1.7 1-.4-.6-1-1-1.7-1s-1.3.4-1.6 1c-.4-.6-1-1-1.7-1z"/><path d="M9 18.3c1.3.4 2.7.4 4 0" stroke-width="1.3"/><path d="M13 8.2 10 13h2l-1 3.8 3.5-5.3H12z" fill="currentColor" stroke="none"/>',
  droplet: '<path d="M12 3c4 5 7 8.5 7 12a7 7 0 0 1-14 0c0-3.5 3-7 7-12z"/>',
  flask: '<path d="M9 3h6M10 3v6L4.6 18.4A2 2 0 0 0 6.3 21h11.4a2 2 0 0 0 1.7-3.1L14 9V3"/>',
  bottle: '<rect x="10.3" y="2.2" width="3.4" height="2.2" rx="0.6"/><path d="M10.3 4.6h3.4c0 .9 0 1.4.9 2 1.1.8 1.4 2 1.4 3.4v8.5c0 1.5-1.2 2.4-3 2.5-1.4.1-2.6.1-4 0-1.8-.1-3-1-3-2.5V10c0-1.4.3-2.6 1.4-3.4.9-.6.9-1.1.9-2z"/><path d="M7.6 14.6c1.1.6 2.2-.6 3.3 0s2.2.6 3.3 0" stroke-width="1.3"/>',
  glass: '<path d="M8 4h8l-1.2 14.6c-.1 1.3-1.3 2.4-2.8 2.4s-2.7-1.1-2.8-2.4z"/><path d="M12 8.8v4.4M9.9 11h4.2" stroke-width="1.4"/><circle cx="9.6" cy="6.6" r=".5" fill="currentColor" stroke="none"/><circle cx="14.3" cy="7.2" r=".4" fill="currentColor" stroke="none"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="M15.3 8.7l-1.8 4.8-4.8 1.8 1.8-4.8z"/>',
  chevronLeft: '<path d="M15 5l-7 7 7 7"/>',
  chevronRight: '<path d="M9 5l7 7-7 7"/>'
};
function icon(name){
  return `<svg class="cell-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name]}</svg>`;
}

/* Homepage leaderboard: top 5 by score within a category, switchable via
   a tab strip. State lives here rather than in the URL — it's a lightweight
   homepage toggle, not a distinct page, so it resets on navigation/reload
   the same way calcAnswers does for the calculator. */
const LB_CATS = ["gel", "drink", "electrolyte"];
const LB_LABEL = {gel: "gels", drink: "drink mixes", electrolyte: "electrolytes"};
let leaderboardCat = "gel";

function topScoredInCategory(cat, n){
  return PRODUCTS.filter(p => p.category === cat && p.overallScore !== null)
    .slice().sort((a, b) => b.overallScore - a.overallScore).slice(0, n);
}

function productRowsHTML(products){
  return products.map((p, i) => `
    <a class="lb-row bc-link" href="${sitePath(`/${p.category}/${p.id}/`)}" data-i="${PRODUCTS.indexOf(p)}">
      <span class="lb-rank">${i + 1}</span>
      <img class="lb-thumb" src="${sitePath(p.photo)}" alt="${esc(p.name)} package" loading="lazy">
      <span class="lb-mid">
        <span class="lb-name">${esc(p.name)}</span>
        <span class="lb-meta">${esc(p.brand)}</span>
      </span>
      ${p.overallScore===null?"":`<span class="score-pill tier-${scoreTier(p.overallScore)}">${p.overallScore}</span>`}
    </a>`).join("");
}

function leaderboardRowsHTML(cat){
  return productRowsHTML(topScoredInCategory(cat, 5));
}

function leaderboardHTML(){
  return `
  <section class="defer-render">
    <div class="sh"><h2>Leaderboard</h2><span class="rule"></span></div>
    <div class="lb-tabs" role="tablist">
      <div class="lb-tab-indicator" id="lbIndicator" style="transform:translateX(${LB_CATS.indexOf(leaderboardCat) * 100}%)"></div>
      ${LB_CATS.map((cat, i) => `
      <button type="button" class="lb-tab${cat === leaderboardCat ? " active" : ""}" role="tab" aria-selected="${cat === leaderboardCat}" data-lb-cat="${cat}">${CATEGORY_PLURAL[cat][0].toUpperCase() + CATEGORY_PLURAL[cat].slice(1)}</button>`).join("")}
    </div>
    <div class="lb-list" id="lbList">${leaderboardRowsHTML(leaderboardCat)}</div>
  </section>`;
}

/* Homepage discovery grid: one dominant curated "popular" pick (the
   `popular:true` flag in the catalog, an editorial call since a static
   client-only site has no real usage data to rank by), two computed
   best-value picks (cheapest per gram of carb), a scale stat, and the
   three category browse links plus the quiz, all as one asymmetric grid
   instead of a flat row of identical cards. */
function homeBentoHTML(){
  const bestGel = bestValueInCategory("gel");
  const bestDrink = bestValueInCategory("drink");
  const hero = PRODUCTS.find(p => p.popular) || bestGel || bestDrink || PRODUCTS[0];
  const gelCount = PRODUCTS.filter(p => p.category === "gel").length;
  const drinkCount = PRODUCTS.filter(p => p.category === "drink").length;
  const electrolyteCount = PRODUCTS.filter(p => p.category === "electrolyte").length;

  const topGel = highestRatedInCategory("gel");
  const topDrink = highestRatedInCategory("drink");
  const topElectrolyte = highestRatedInCategory("electrolyte");
  const RATED_KIND = {gel: "gel", drink: "drink mix", electrolyte: "electrolyte"};
  const rated = [topGel, topDrink, topElectrolyte].filter(Boolean).map(p => `
    <a class="bc bc-rated bc-link" href="${sitePath(`/${p.category}/${p.id}/`)}" data-i="${PRODUCTS.indexOf(p)}">
      ${icon("flask")}
      <span class="score-pill tier-${scoreTier(p.overallScore)}">${p.overallScore}</span>
      <span class="bc-kind">Highest rated ${RATED_KIND[p.category]}</span>
      <img class="bc-photo" src="${sitePath(p.photo)}" alt="${esc(p.name)} package" loading="lazy">
      <span class="bc-name">${esc(p.name)}</span>
      <span class="bc-hero-brand">${esc(p.brand)}</span>
      <p class="bc-hero-note">The highest overall score of any ${RATED_KIND[p.category]} we've reviewed, averaged from what it declares against a fixed scale -- not against the rest of the catalog.</p>
    </a>`);

  const flagships = [`
    <a class="bc bc-hero bc-link" href="${sitePath(`/${hero.category}/${hero.id}/`)}" data-i="${PRODUCTS.indexOf(hero)}">
      ${icon("star")}
      <span class="bc-kind">Popular pick</span>
      <img class="bc-photo" src="${sitePath(hero.photo)}" alt="${esc(hero.name)} package" loading="eager">
      <span class="bc-name">${esc(hero.name)}</span>
      <span class="bc-hero-brand">${esc(hero.brand)}</span>
      <p class="bc-hero-note">The most recognized name in the category, and one of the highest glucose:fructose ratios we've tested.</p>
    </a>`];

  if(bestGel && bestGel !== hero) flagships.push(`
    <a class="bc bc-bvg bc-link" href="${sitePath(`/${bestGel.category}/${bestGel.id}/`)}" data-i="${PRODUCTS.indexOf(bestGel)}">
      ${icon("tag")}
      <span class="bc-kind">Best value gel</span>
      <img class="bc-photo" src="${sitePath(bestGel.photo)}" alt="${esc(bestGel.name)} package" loading="eager">
      <span class="bc-name">${esc(bestGel.name)}</span>
      <span class="bc-hero-brand">${esc(bestGel.brand)}</span>
      <span class="bc-stat">${moneyPrecise(bestGel.perGram, 3)}/g carb</span>
      <p class="bc-hero-note">The cheapest way to get a gram of carbohydrate across every gel we've reviewed, recalculated as the catalog grows.</p>
    </a>`);
  if(bestDrink && bestDrink !== hero) flagships.push(`
    <a class="bc bc-bvd bc-link" href="${sitePath(`/${bestDrink.category}/${bestDrink.id}/`)}" data-i="${PRODUCTS.indexOf(bestDrink)}">
      ${icon("tag")}
      <span class="bc-kind">Best value drink mix</span>
      <img class="bc-photo" src="${sitePath(bestDrink.photo)}" alt="${esc(bestDrink.name)} package" loading="eager">
      <span class="bc-name">${esc(bestDrink.name)}</span>
      <span class="bc-hero-brand">${esc(bestDrink.brand)}</span>
      <span class="bc-stat">${moneyPrecise(bestDrink.perGram, 3)}/g carb</span>
      <p class="bc-hero-note">The cheapest way to get a gram of carbohydrate across every drink mix we've reviewed, recalculated as the catalog grows.</p>
    </a>`);

  const categories = [`
    <a class="bc bc-gel" href="${sitePath("/gels/")}" data-page="gels">
      ${icon("sachet")}
      <span class="bc-kind">Gels</span>
      <span class="bc-stat">${gelCount} reviewed</span>
    </a>`, `
    <a class="bc bc-drk" href="${sitePath("/drink-mixes/")}" data-page="drink-mixes">
      ${icon("bottle")}
      <span class="bc-kind">Drink mixes</span>
      <span class="bc-stat">${drinkCount} reviewed</span>
    </a>`, `
    <a class="bc bc-ele" href="${sitePath("/electrolytes/")}" data-page="electrolytes">
      ${icon("glass")}
      <span class="bc-kind">Electrolytes</span>
      <span class="bc-stat">${electrolyteCount} reviewed</span>
    </a>`, `
    <a class="bc bc-cta" href="${sitePath("/find/")}" data-page="find">
      ${icon("compass")}
      <span class="bc-kind">Not sure?</span>
      <span class="bc-stat">Take the Find Your Fuel quiz</span>
    </a>`];

  return `
  <section>
    <div class="sh"><h2>From the catalog</h2><span class="rule"></span></div>
    <div class="bento-flagship">${flagships.join("")}</div>
    <div class="bento">${categories.join("")}</div>
  </section>
  ${rated.length ? `
  <section class="defer-render">
    <div class="sh"><h2>Highest rated</h2><span class="rule"></span></div>
    <div class="bento-flagship">${rated.join("")}</div>
  </section>` : ""}
  ${leaderboardHTML()}`;
}

function recentlyReviewedHTML(){
  const recent = PRODUCTS.filter(p => p.reviewed).slice().sort((a, b) => b.reviewed.localeCompare(a.reviewed)).slice(0, 12);
  if(!recent.length) return "";
  return `
  <section class="defer-render">
    <div class="sh"><h2>Recently reviewed</h2><span class="rule"></span></div>
    <div class="recent-slider">
      <button type="button" class="recent-nav recent-prev" aria-label="Scroll left">${icon("chevronLeft")}</button>
      <div class="recent-track">
        ${recent.map(p => `
        <a class="recent-card bc-link" href="${sitePath(`/${p.category}/${p.id}/`)}" data-i="${PRODUCTS.indexOf(p)}">
          ${p.overallScore===null?"":`<span class="score-pill tier-${scoreTier(p.overallScore)}">${p.overallScore}</span>`}
          <img class="recent-photo" src="${sitePath(p.photo)}" alt="${esc(p.name)} package" loading="lazy">
          <span class="recent-kind">${CATEGORY_LABEL[p.category]}</span>
          <span class="recent-name">${esc(p.name)}</span>
          <span class="recent-brand">${esc(p.brand)}</span>
          <span class="recent-date">${formatReviewDate(p.reviewed)}</span>
        </a>`).join("")}
      </div>
      <button type="button" class="recent-nav recent-next" aria-label="Scroll right">${icon("chevronRight")}</button>
    </div>
  </section>`;
}

function renderHome(){
  document.title = "Fuel Finder - Endurance nutrition reviews";
  clearNavHighlights();
  document.getElementById("toc").style.display = "none";
  document.getElementById("page").innerHTML = `
  <div class="home-hero">
    <h1>Every gel says it's the best one.</h1>
    <div class="home-search">
      <label for="siteSearch" class="home-search-label">Search the catalog</label>
      <input id="siteSearch" placeholder="e.g. Maurten, SiS Beta Fuel" autocomplete="off">
      <div class="site-search-results" id="siteSearchResults"></div>
    </div>
  </div>
  ${homeBentoHTML()}
  ${recentlyReviewedHTML()}`;
  initRecentSlider();
  window.scrollTo(0,0);
}

/* Hides whichever arrow points past an edge already reached, instead of
   showing a control that would do nothing if clicked. Re-checked on every
   scroll (including the smooth-scroll animation an arrow click starts),
   so it stays correct through both button clicks and touch/trackpad swipe. */
function initRecentSlider(){
  document.querySelectorAll(".recent-slider").forEach(slider => {
    const track = slider.querySelector(".recent-track");
    const prev = slider.querySelector(".recent-prev");
    const next = slider.querySelector(".recent-next");
    if(!track || !prev || !next) return;
    const update = () => {
      prev.classList.toggle("at-edge", track.scrollLeft <= 1);
      next.classList.toggle("at-edge", track.scrollLeft + track.clientWidth >= track.scrollWidth - 1);
    };
    track.addEventListener("scroll", update, { passive: true });
    update();
  });
}

function renderAbout(){
  document.title = "About - Fuel Finder";
  clearNavHighlights();
  document.getElementById("toc").style.display = "none";
  document.getElementById("page").innerHTML = `
  <div class="home-hero">
    <p class="eye">Why this site exists</p>
    <h1>About Fuel Finder</h1>
    <p class="thesis">Pick up any gel or drink mix and the packaging tells you it's the best one. We got tired of trying to compare those claims to each other, so we started pulling the numbers straight off the label instead. That's really the whole idea behind this site.</p>
  </div>

  <section>
    <div class="sh"><h2>The problem</h2><span class="rule"></span></div>
    <p class="thesis">Read enough gel packaging and you start seeing the same words everywhere: "fast-absorbing," "optimal," "engineered for performance." None of it means anything you can actually measure, and none of it helps when you're standing in front of two products trying to decide between them. What you can measure is already printed on the label: carbs per serving, sodium, the glucose to fructose ratio, caffeine, cost. We take that and score it the same way for every product, so the packaging stops being the thing making the decision for you.</p>
  </section>

  <section>
    <div class="sh"><h2>What actually differs between products</h2><span class="rule"></span></div>
    <p class="thesis">Once you get past the marketing, most gels and drink mixes really only differ on a handful of things:</p>
    <ul class="thesis" style="padding-left:1.2em">
      <li><b>Carb density.</b> How many grams of carbohydrate you're getting per serving. It's what decides whether you need four gels an hour or six to hit your target.</li>
      <li><b>Glucose to fructose ratio.</b> A single carb source, usually just maltodextrin, caps out lower than a blend does. Glucose and fructose use two different transporters in your gut, so a blended product can move more carbohydrate per hour than a single-source one can. That's why almost everything built for really high intake is a blend.</li>
      <li><b>Sodium.</b> Some products build in a real dose of sodium every serving. Others carry almost none and assume you're getting it elsewhere. Neither way is wrong, it just changes what else you need to be carrying with you.</li>
      <li><b>Caffeine.</b> In some products by design, left out of others by design. Handy in the back half of a long race, unwelcome if you're already wired or running at 4am.</li>
      <li><b>Ingredient count.</b> A shorter label tends to sit easier on the stomach a few hours in. It's not a guarantee, but it's the reasoning behind the gut-comfort figure on every gel page.</li>
    </ul>
    <p class="thesis">Every product page breaks these out on their own instead of folding them into one number, so you can weigh whichever ones matter for your race.</p>
  </section>

  <section>
    <div class="sh"><h2>Who's behind this</h2><span class="rule"></span></div>
    <p class="thesis">I'm Lourenço Faria e Maia, an amateur endurance athlete with a background in cell biology. I've raced an Ironman 70.3 and more half marathons than I've bothered to count, and spent most of that time restocking a gear bag from whatever brand's marketing had gotten to me most recently.</p>
    <p class="thesis">What actually got this built was noticing how little of that marketing agreed with itself: one brand's gel is "optimally absorbed," and so is the next one's, at a different ratio, for different reasons, neither citing anything you could check. A background in cell biology made the gap between the claim and the label hard to ignore, so I started pulling the numbers directly off the packet instead of trusting the front of it. This site is that same exercise, done for the whole catalog instead of just my own gear bag.</p>
  </section>

  <section>
    <div class="sh"><h2>How we stay unbiased</h2><span class="rule"></span></div>
    <p class="thesis">Nobody paid to be listed here, and nothing ranks higher for being a bigger name. We don't run affiliate links either, so there's no reason for us to point you toward whatever pays best. Scores are set against a fixed scale we decided on ahead of time, not against whatever else happens to be in the catalog that week, so adding a new product never quietly moves anyone else's number. If you want the full mechanics of how a score actually gets built, that's on the <a href="${sitePath("/methodology/")}" data-page="methodology">Methodology</a> page.</p>
  </section>

  <section>
    <div class="sh"><h2>Not sure where to start?</h2><span class="rule"></span></div>
    <p class="thesis">Answer a few questions in the <a href="${sitePath("/find/")}" data-page="find">Find Your Fuel</a> quiz about how you're actually planning to use it, and it'll rank the catalog against your answers instead of a flat average.</p>
  </section>`;
  window.scrollTo(0,0);
}

function renderMethodology(){
  document.title = "Methodology - Fuel Finder";
  clearNavHighlights();
  document.getElementById("toc").style.display = "none";
  const gelCount = PRODUCTS.filter(p => p.category === "gel").length;
  const drinkCount = PRODUCTS.filter(p => p.category === "drink").length;
  const electrolyteCount = PRODUCTS.filter(p => p.category === "electrolyte").length;

  const sections = [
    { title: "Where the data comes from", body: `
      <p class="thesis">Carbohydrate, sodium, calories and every other figure is read directly off the product's own label -- the same panel you'd read on the packet. We don't estimate a number because a competitor discloses it and this product doesn't.</p>
      <p class="thesis">The one figure that sometimes needs interpretation is the glucose:fructose ratio, since not every brand states it outright. Each product's ratio is tagged with where it actually came from:</p>
      <ul class="thesis" style="padding-left:1.2em">
        <li><b>Stated</b> -- the brand publishes the ratio directly.</li>
        <li><b>Derived</b> -- computed from ingredient percentages the brand does disclose.</li>
        <li><b>Estimated</b> -- inferred from what's on the panel when neither of the above is available. It's marked as an estimate everywhere it appears, but it scores the same as a Stated ratio -- there's no confidence discount built into the number itself.</li>
        <li><b>Not disclosed</b> -- the brand doesn't say, and we don't guess.</li>
      </ul>` },
    { title: "How scores are calculated", body: `
      <p class="thesis">Every score on this site is absolute, not relative -- each dimension (absorption rate, carb density, cost per gram and gut comfort for gels; those plus sodium for drink mixes; sodium, potassium, calcium and magnesium for electrolytes) is scored against a fixed scale, not against whatever else happens to be in the catalog. A 90 means the same thing today as it will after the next product is added; scores only change when a product's own declared data changes.</p>
      <p class="thesis">Where real sports-nutrition reference points exist, the fixed scale is anchored to them: carb density tops out at 90 g, matching the upper end of the range cited for multi-transportable-carb intake; sodium scales top out at 1000 mg, the upper end of what's typically lost to sweat in an hour; potassium and magnesium follow the same logic at smaller scales. Hover any dimension label on a product page for its specific scale and reasoning.</p>
      <p class="thesis">Some dimensions don't have a physiological anchor to reach for and say so plainly: both cost dimensions are scored against a market-based price range, not a nutrition benchmark, and calcium's scale is anchored to this catalog's practical ceiling rather than sweat-loss research, since calcium loss during exercise is minor and isn't really a target most products are optimizing for.</p>
      <p class="thesis">A product's overall score is the plain average of whichever dimensions it has real data for. Missing data is left out of the average, not counted against it -- a product that doesn't disclose sodium isn't penalized for the gap, it's just scored on what it does disclose. Whenever that's happened, the product page says so directly: "Based on N of X measures" next to the score.</p>
      <p class="thesis">Gut comfort (gels only) is a proxy, not a taste or tolerance test: it's scored from ingredient count on a fixed 1-to-15 scale, on the reasoning that a shorter, simpler label is generally easier on the stomach. It's disclosed as what it is -- an inference from the label, same as everything else here -- not a stand-in for someone actually racing on it.</p>
      <p class="thesis">Sodium isn't part of a gel's overall score, though every gel page still shows what it carries. Gels are built to be a carbohydrate source first; sodium is usually left to a dedicated electrolyte product, and scoring gels on the same 0&ndash;1000 mg scale as an electrolyte tablet would mark down a gel for doing its job rather than someone else's. It's still worth knowing before you buy, which is why it stays on the page as a fact, not a mark.</p>` },
    { title: "The fueling calculator", body: `
      <p class="thesis">The calculator's three experience tiers map to 45, 75 and 90 g/hr of carbohydrate -- the same 90 g/hr ceiling the carb-density score is anchored to above, so nothing here recommends a rate the scoring scale treats as out of range.</p>
      <p class="thesis">These are reference points from the sports-nutrition literature on gut-trained athletes, not a personal prescription: body mass, gut training, heat and individual tolerance all shift what any one person can actually absorb, and the calculator doesn't ask about any of them. Treat the total it gives you as a starting point to test in training, not a number to hit on race day the first time you try it.</p>` },
    { title: "Pricing", body: `
      <p class="thesis">Prices are tracked from a specific retailer, linked directly on every product page, and reflect what that retailer listed as of the review date shown at the top of the page. Prices move; we don't re-check every listing daily, so treat the number as a recent snapshot and the link as the source of truth.</p>
      <p class="thesis">None of the links on this site are affiliate links. We don't earn anything when you click through or buy, and that's on purpose -- it removes any incentive to rank a product higher because it pays better.</p>` },
    { title: "Photos", body: `
      <p class="thesis">Product photos are sourced only from the official brand site or an authorized retailer -- never stock photography, never a competitor's marketing image. Where a brand's own photography wasn't clean enough to use as-is, we've edited the background, never the product itself.</p>` },
    { title: "Review dates", body: `
      <p class="thesis">The date on each product page reflects when that product's written review -- its verdict, pros, cons and data -- was last actually verified or revised, not when the page was last deployed. A photo swap or a copy-editing pass elsewhere on the site doesn't move a product's review date; a change to what the review actually claims does.</p>` },
    { title: "The catalog today", body: `
      <p class="thesis">${gelCount} gels, ${drinkCount} drink mixes and ${electrolyteCount} electrolyte products, and growing. Don't see something you use? Search for it -- if it's not here yet, that tells us it should be.</p>` }
  ];

  document.getElementById("page").innerHTML = `
  <div class="home-hero">
    <p class="eye">How this site works</p>
    <h1>Methodology</h1>
    <p class="thesis">Every number on this site comes from a product's own declared nutrition or supplement panel. Nothing is estimated unless it's labeled as an estimate, and nothing here is sponsored.</p>
  </div>

  <div class="accordion">
    ${sections.map((s, i) => `
    <div class="acc-item">
      <h2 class="acc-item-heading">
        <button type="button" class="acc-head" data-acc="${i}" aria-expanded="false" aria-controls="acc-panel-${i}" id="acc-head-${i}">
          <span class="acc-title">${esc(s.title)}</span>
          <span class="acc-toggle" aria-hidden="true"></span>
        </button>
      </h2>
      <div class="acc-panel" id="acc-panel-${i}" role="region" aria-labelledby="acc-head-${i}">
        <div class="acc-panel-in">${s.body}</div>
      </div>
    </div>`).join("")}
  </div>`;
  window.scrollTo(0,0);
}

/* Shown when a search doesn't match anything in the catalog — a clean
   dead end instead of no result at all, and a natural place to point
   people at what already exists while a new review gets written. */
function renderWaiting(query){
  RequestLog.save(query);
  document.title = query + " - not reviewed yet - Fuel Finder";
  clearNavHighlights();
  document.getElementById("toc").style.display = "none";
  document.getElementById("page").innerHTML = `
  <div class="home-hero">
    <p class="eye">Not reviewed yet</p>
    <h1>${esc(query)}</h1>
    <p class="thesis">We hold every review to the same bar: checked against the declared nutrition panel, no marketing copy taken at face value. That takes a bit of time, so this one isn't live yet -- but it's on the list.</p>
  </div>
  ${categoryCardsHTML()}`;
  window.scrollTo(0,0);
}

function drawSiteSearch(q){
  const box = document.getElementById("siteSearchResults");
  if(!box) return;
  const s = q.trim().toLowerCase();
  if(!s){ box.innerHTML = ""; return; }
  const hits = PRODUCTS.filter(p =>
    (p.name + " " + p.brand + " " + p.code).toLowerCase().includes(s)).slice(0, 8);
  box.innerHTML = hits.length
    ? hits.map(p => `<button data-i="${PRODUCTS.indexOf(p)}">${esc(p.name)}<span>${esc(p.brand)} &middot; ${CATEGORY_LABEL[p.category]}</span></button>`).join("")
    : `<p>No review of &ldquo;${esc(q.trim())}&rdquo; yet.<br>
         <button class="request-btn" data-request="${esc(q.trim())}">Request this one &rarr;</button></p>`;
}

/* Owner-only view of what RequestLog has collected — not linked from the
   nav, reached by putting #requests on the URL. Password-gated so a casual
   visitor who finds the URL doesn't see it, but this is a client-only site
   with no server: the password check runs in JS anyone can read, so this
   is a deterrent, not real security. */
const ADMIN_UNLOCK_KEY = "fuelfinder_admin_unlocked";
const ADMIN_PASSWORD = "Fuel";

function renderAdminGate(){
  document.title = "Owner view - Fuel Finder";
  clearNavHighlights();
  setRobotsMeta("noindex");
  document.getElementById("toc").style.display = "none";
  document.getElementById("page").innerHTML = `
  <div class="home-hero">
    <p class="eye">Owner view</p>
    <h1>Requested reviews</h1>
    <p class="thesis">This page is password protected.</p>
    <div class="admin-gate">
      <input type="password" id="adminPass" placeholder="Password" autocomplete="off">
      <button type="button" class="home-go" id="adminUnlock">Unlock</button>
      <p class="admin-gate-err" id="adminGateErr" hidden>Incorrect password.</p>
    </div>
  </div>`;
  window.scrollTo(0,0);
  document.getElementById("adminPass").focus();
}

function checkAdminPassword(){
  const input = document.getElementById("adminPass");
  if(input.value === ADMIN_PASSWORD){
    localStorage.setItem(ADMIN_UNLOCK_KEY, "1");
    renderRequestsAdmin();
  } else {
    document.getElementById("adminGateErr").hidden = false;
    input.value = "";
    input.focus();
  }
}

function renderRequestsAdmin(){
  if(localStorage.getItem(ADMIN_UNLOCK_KEY) !== "1"){ renderAdminGate(); return; }
  document.title = "Requested reviews - Fuel Finder";
  clearNavHighlights();
  setRobotsMeta("noindex");
  document.getElementById("toc").style.display = "none";
  const entries = RequestLog.list();
  document.getElementById("page").innerHTML = `
  <div class="home-hero">
    <p class="eye">Owner view</p>
    <h1>Requested reviews</h1>
    <p class="thesis">Searches that didn't match anything in the catalog, saved in this browser. ${entries.length ? `${entries.length} distinct ${entries.length===1?"request":"requests"}.` : "Nothing logged yet."}</p>
  </div>
  ${entries.length ? `
  <table class="req-table">
    <thead><tr><th>Query</th><th>Times searched</th><th>Last seen</th><th></th></tr></thead>
    <tbody>${entries.map(r => `<tr>
      <td>${esc(r.query)}</td>
      <td class="num">${r.count}</td>
      <td>${new Date(r.lastSeen).toLocaleDateString()}</td>
      <td><button class="req-remove" data-remove-request="${esc(r.query)}">Clear</button></td>
    </tr>`).join("")}</tbody>
  </table>
  <button class="req-clear-all" id="clearAllRequests">Clear all</button>` : ""}`;
  window.scrollTo(0,0);
}

/* Path routing. /category/product-id/ is a review permalink, /requests/ is
   the owner view, and anything else — including bare / — is the landing
   page. select() pushes permalinks; Back/Forward arrive here via popstate. */
function routeFromPath(){
  /* Strip the mount point first, so the patterns below only ever have to
     think in root-relative terms regardless of where the site is hosted. */
  const base = BASE_PATH.replace(/\/$/, "");
  let p = location.pathname;
  if(base && (p === base || p.startsWith(base + "/"))) p = p.slice(base.length);
  const h = p.replace(/^\/|\/$/g, "");
  if(h === "requests"){ renderRequestsAdmin(); return; }
  if(h === "find"){ renderFinder(); return; }
  const fm = h.match(/^find\/([a-z]+)$/);
  if(fm){ renderFinder(fm[1]); return; }
  if(h === "calculator"){ renderCalculator(); return; }
  if(h === "methodology"){ renderMethodology(); return; }
  const catBySlug = Object.entries(CATEGORY_PAGE_SLUG).find(([,slug]) => slug === h);
  if(catBySlug){ renderCategoryPage(catBySlug[0]); return; }
  if(h === "about"){ renderAbout(); return; }
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
  try{ history.pushState(null, "", BASE_PATH); }catch(err){}
  renderHome();
});

routeFromPath();
