
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

/* Gut comfort (gels only). Computed from ingredient count, min-max
   normalized against the gel field — fewer ingredients scores higher. This
   isn't a stand-in for someone actually testing the product; it's what the
   declared ingredient panel implies, same as every other number here. */
function ingredientGutScore(p){
  const gels = PRODUCTS.filter(x => x.category === "gel");
  const counts = gels.map(x => x.ingredients.split(",").length);
  const min = Math.min(...counts), max = Math.max(...counts);
  const mine = p.ingredients.split(",").length;
  const t = max === min ? 1 : (mine - min) / (max - min);
  return Math.round((1 - t) * 100);
}
PRODUCTS.forEach(p => { if(p.category === "gel") p.gut = ingredientGutScore(p); });

/* Overall score. Each category scores its own dimensions — gels and drinks
   share rate/density/sodium/cost, gels alone add gut tolerance (the only
   category where it's judged), electrolytes get a wholly different set
   built from their own fields. Every dimension is min-max normalized
   against that product's category peers rather than a fixed scale, so it
   self-adjusts as products are added instead of needing retuning. A
   product's score is the plain average of whichever dimensions it has a
   real value for — missing data is dropped, not counted against it. */
const SCORE_DIMS = {
  gel: [
    ["rate", "Absorption rate", p=>p.ratioScore, "hi"],
    ["dens", "Carb density", p=>p.carbs, "hi"],
    ["sod",  "Sodium", p=>p.sodium, "hi"],
    ["cost", "Value (cost/gram)", p=>p.perGram, "lo"],
    ["gut",  "Gut comfort", p=>p.gut, "hi"]
  ],
  drink: [
    ["rate", "Absorption rate", p=>p.ratioScore, "hi"],
    ["dens", "Carb density", p=>p.carbs, "hi"],
    ["sod",  "Sodium", p=>p.sodium, "hi"],
    ["cost", "Value (cost/gram)", p=>p.perGram, "lo"]
  ],
  electrolyte: [
    ["sod",  "Sodium dose", p=>p.sodium, "hi"],
    ["cost", "Value (cost/1000mg Na)", p=>p.costPer1000Na, "lo"],
    ["pot",  "Potassium", p=>p.potassium, "hi"],
    ["cal",  "Calcium", p=>p.calcium, "hi"],
    ["mag",  "Magnesium", p=>p.magnesium, "hi"]
  ]
};

/* Computes the overall score AND keeps the per-dimension breakdown that
   produced it — the score badge shows just the number, but the "Score
   breakdown" section on each product page shows its work, same reasoning
   as making gut comfort transparent rather than an unexplained figure. */
function computeScore(p){
  const peers = PRODUCTS.filter(x => x.category === p.category);
  const breakdown = [];
  SCORE_DIMS[p.category].forEach(([key,label,get,dir]) => {
    const mine = get(p);
    if(mine === null || mine === undefined) return;
    const vals = peers.map(get).filter(v => v !== null && v !== undefined);
    const min = Math.min(...vals), max = Math.max(...vals);
    const t = max === min ? 1 : (mine - min) / (max - min);
    breakdown.push({key, label, score: Math.round((dir === "hi" ? t : 1 - t) * 100)});
  });
  const overall = breakdown.length ? Math.round(breakdown.reduce((a,b)=>a+b.score,0) / breakdown.length) : null;
  return {overall, breakdown};
}
PRODUCTS.forEach(p => { const s = computeScore(p); p.overallScore = s.overall; p.scoreBreakdown = s.breakdown; });
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
function moneyPrecise(n, decimals){ return CURRENCY_SYMBOL[currentCurrency] + convert(n).toFixed(decimals); }

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

const DEFAULT_DESCRIPTION = "Gel, drink mix and electrolyte reviews built from declared nutrition panels — cost per gram, sodium and absorption rate compared across every product, not marketing copy.";

/* Title/description for the tab, search snippets, and social previews.
   clearNavHighlights() calls this with null on every non-product render to
   restore the site-wide defaults — this is a single hash-routed document,
   so nothing else clears a previous product's tags on the way out. */
function setShareMeta(p){
  const title = p ? p.name + " — Fuel Finder" : "Fuel Finder — Endurance nutrition reviews";
  const desc = p ? stripHtml(p.thesis) : DEFAULT_DESCRIPTION;
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
    [`${unit[0].toUpperCase()+unit.slice(1)}s for 90 g/hr`, p=>p.perHour.toFixed(1), p=>p.perHour, "lo",
     `How many you open an hour to hold a 90 g/hr target.`]
  ];

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
    return `<tr><th><span class="rowlab">${l}</span><span class="rowdef">${esc(def)}</span></th>` + set.map(p=>{
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
    author: {"@type": "Organization", name: "Fuel Finder"},
    ...(p.reviewed ? {datePublished: p.reviewed} : {}),
    ...(p.overallScore === null ? {} : {
      reviewRating: {
        "@type": "Rating",
        ratingValue: p.overallScore,
        bestRating: 100,
        worstRating: 0
      }
    }),
    reviewBody: stripHtml(p.thesis)
  };
  /* Escape "</" so a stray closing script tag inside any field can't break
     out of the element this gets embedded in via innerHTML below. */
  return JSON.stringify(obj).replace(/<\//g, "<\\/");
}

function render(p){
  CURRENT = p;
  document.getElementById("toc").style.display = "";
  const costRank = rank({get:q=>scoreCost(q)}, p);
  document.getElementById("page").innerHTML = `
  <script type="application/ld+json">${reviewSchema(p)}<\/script>
  <div class="hero">
    <div>
      <p class="eye">During-effort fuel &middot; ${CATEGORY_LABEL[p.category]} &middot; reviewed ${formatReviewDate(p.reviewed)}</p>
      <h1>${esc(p.name)}${p.overallScore===null?"":` <span class="score-badge tier-${scoreTier(p.overallScore)}" title="Overall score among ${CATEGORY_PLURAL[p.category]}, averaged from what this product declares">${p.overallScore}</span>`}</h1>
      <p class="meta">${esc(p.brand)} &nbsp;/&nbsp; ${esc(p.serving)} &nbsp;/&nbsp; ${p.category==="electrolyte"?`${p.sodium} mg sodium`:`${p.carbs} g carbohydrate`} &nbsp;/&nbsp; ${money(p.price)}</p>
      <p class="thesis">${p.thesis}</p>
    </div>
    <div class="shot-stage">
    ${p.photo
      ? `<img class="shot" src="${sitePath(p.photo)}" alt="${esc(p.name)} sachet" loading="eager" fetchpriority="high" decoding="async">`
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
    <p class="sub">The overall score is the average of what's below, each measured against every other ${CATEGORY_LABEL[p.category]} we've reviewed.</p>
    <div class="sb-layout">
    <div class="sb-layout-left">
      <div class="sb">
        <div class="sb-tile tier-${scoreTier(p.overallScore)}">
          <div class="sb-num">${p.overallScore}</div>
          <div class="sb-label">${scoreTierLabel(p.overallScore)}</div>
        </div>
        <div class="sb-rows">${p.scoreBreakdown.map(d => `
          <div class="sb-row"><span class="sb-row-label">${esc(d.label)}</span><span class="sb-row-score num">${d.score}</span></div>`).join("")}
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
      <div class="pcx up"><h3>What it does well</h3><ul>${p.pros.map(x=>`<li>${esc(x)}</li>`).join("")}</ul></div>
      <div class="pcx dn"><h3>What it costs you</h3><ul>${p.cons.map(x=>`<li>${esc(x)}</li>`).join("")}</ul></div>
    </div>
  </section>

  <section id="buy">
    <div class="sh"><h2>Where to buy</h2><span class="rule"></span></div>
    <p class="sub">Prices and links as last checked.</p>
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
      <div class="pcx wy"><h3>Worth the money if</h3><ul>${p.yes.map(x=>`<li>${esc(x)}</li>`).join("")}</ul></div>
      <div class="pcx wn"><h3>Look elsewhere if</h3><ul>${p.no.map(x=>`<li>${esc(x)}</li>`).join("")}</ul></div>
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
  document.getElementById("about-link").classList.remove("on");
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
        `<button data-i="${PRODUCTS.indexOf(p)}">${esc(p.short)} <em>${p.category==="electrolyte"?`${p.sodium} mg`:`${p.carbs} g`}</em></button>`).join("")}</div>
    </div>`).join("");
}
["gel","drink","electrolyte"].forEach(buildMenu);

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
  const want = sitePath(p.category + "/" + p.id + "/");
  if(location.pathname !== want){ try{ history.pushState(null, "", want); }catch(err){} }
  document.title = p.name + " — Fuel Finder";
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

/* These two live as literal href="/find/" / href="/calculator/" in
   index.html, which isn't templated at build time and so can't know the
   mount point. Point them at the real one now that it's known — this also
   keeps middle-click / open-in-new-tab honest, not just the click handler. */
document.getElementById("find-link").setAttribute("href", sitePath("/find/"));
document.getElementById("calc-link").setAttribute("href", sitePath("/calculator/"));
document.getElementById("about-link").setAttribute("href", sitePath("/methodology/"));

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
document.getElementById("about-link").addEventListener("click", e => {
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
  if(e.key === "Escape"){ closeMenu(); closeMobileNav(); }
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
  const b = e.target.closest(".dd button"); if(!b) return;
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
  const catPool = PRODUCTS.filter(p => p.category === cat);
  let pool = catPool;
  const dims = [];

  if(cat === "gel"){
    if(answers.caffeine === "want") pool = pool.filter(p => p.caffeine > 0);
    else if(answers.caffeine === "avoid") pool = pool.filter(p => p.caffeine === 0);
    if(!pool.length) pool = catPool;
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
  return scored.slice(0, 3);
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

function finderResultsHTML(){
  if(!finderHasAnswer()){
    return `<p class="buy-empty">Answer a question above to see your matches.</p>`;
  }
  const matches = findMatches(finderAnswers);
  const cat = finderAnswers.category;
  return `<div class="fr-grid">${matches.map((m,i) => { const p = m.p; return `
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

function renderFinder(cat){
  finderAnswers = {category: FINDER_QUESTIONS[cat] ? cat : "gel"};
  document.title = "Find your fuel — Fuel Finder";
  clearNavHighlights();
  document.getElementById("find-link").classList.add("on");
  document.getElementById("toc").style.display = "none";
  document.getElementById("page").innerHTML = `
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
    <div class="sh"><h2>Your matches</h2><span class="rule"></span></div>
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
  ["experienced", "Very experienced", 105]
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

  return `
  <div class="pcell calc-total">
    <div class="k">Carbohydrate needed for this effort</div>
    <div class="v num">${total}<small>g</small></div>
  </div>
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
        <td>${total > 0 ? `${r.count} ${esc(r.unit)}${r.count === 1 ? "" : "s"}` : "—"}</td>
        <td>${total > 0 ? money(r.cost) : "—"}</td>
      </tr>`).join("")}</tbody>
  </table></div>`;
}

function renderCalculator(){
  document.title = "Race Fueling Calculator — Fuel Finder";
  clearNavHighlights();
  document.getElementById("calc-link").classList.add("on");
  document.getElementById("toc").style.display = "none";
  calcAnswers = {tolerance: "some", hours: 3, minutes: 0, category: "gel"};
  document.getElementById("page").innerHTML = `
  <div class="home-hero">
    <p class="eye">Plan your race</p>
    <h1>How much fuel do you need?</h1>
    <p class="thesis">Two quick inputs, and we'll show how many sachets or scoops of every gel and drink mix in the catalog gets you there — and what it costs.</p>
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
          ? `<a href="${sitePath(`/find/${cat}/`)}" class="home-go" data-fc-link="${cat}">Browse ${label}</a>`
          : `<p class="home-soon">Coming soon</p>`}
      </div>`;
    }).join("")}
  </div>`;
}

function renderHome(){
  document.title = "Fuel Finder — Endurance nutrition reviews";
  clearNavHighlights();
  document.getElementById("toc").style.display = "none";
  document.getElementById("page").innerHTML = `
  <div class="home-hero">
    <p class="eye">Endurance nutrition, reviewed on the numbers</p>
    <h1>Fuel Finder</h1>
    <p class="thesis">Gel, drink mix and electrolyte reviews built from declared nutrition panels, not marketing copy.</p>
    <div class="home-search">
      <input id="siteSearch" placeholder="Search any gel, drink mix, or electrolyte" autocomplete="off">
      <div class="site-search-results" id="siteSearchResults"></div>
    </div>
  </div>
  ${categoryCardsHTML()}`;
  window.scrollTo(0,0);
}

function renderMethodology(){
  document.title = "Methodology — Fuel Finder";
  clearNavHighlights();
  document.getElementById("about-link").classList.add("on");
  document.getElementById("toc").style.display = "none";
  const gelCount = PRODUCTS.filter(p => p.category === "gel").length;
  const drinkCount = PRODUCTS.filter(p => p.category === "drink").length;
  const electrolyteCount = PRODUCTS.filter(p => p.category === "electrolyte").length;
  document.getElementById("page").innerHTML = `
  <div class="home-hero">
    <p class="eye">How this site works</p>
    <h1>Methodology</h1>
    <p class="thesis">Every number on this site comes from a product's own declared nutrition or supplement panel. Nothing is estimated unless it's labeled as an estimate, and nothing here is sponsored.</p>
  </div>

  <section>
    <div class="sh"><h2>Where the data comes from</h2><span class="rule"></span></div>
    <p class="thesis">Carbohydrate, sodium, calories and every other figure is read directly off the product's own label &mdash; the same panel you'd read on the packet. We don't estimate a number because a competitor discloses it and this product doesn't.</p>
    <p class="thesis">The one figure that sometimes needs interpretation is the glucose:fructose ratio, since not every brand states it outright. Each product's ratio is tagged with where it actually came from:</p>
    <ul class="thesis" style="padding-left:1.2em">
      <li><b>Stated</b> &mdash; the brand publishes the ratio directly.</li>
      <li><b>Derived</b> &mdash; computed from ingredient percentages the brand does disclose.</li>
      <li><b>Estimated</b> &mdash; inferred from what's on the panel when neither of the above is available, and treated as lower-confidence in the scoring.</li>
      <li><b>Not disclosed</b> &mdash; the brand doesn't say, and we don't guess.</li>
    </ul>
  </section>

  <section>
    <div class="sh"><h2>How scores are calculated</h2><span class="rule"></span></div>
    <p class="thesis">Every score on this site is relative, not absolute &mdash; each dimension (absorption rate, carb density, sodium, cost per gram, and gut comfort for gels) is scaled against every other product in the same category, not against a fixed external benchmark. That means scores shift slightly as products are added or removed; they're a snapshot of the field as it stands, not a permanent grade.</p>
    <p class="thesis">A product's overall score is the plain average of whichever dimensions it has real data for. Missing data is left out of the average, not counted against it &mdash; a product that doesn't disclose sodium isn't penalized for the gap, it's just scored on what it does disclose.</p>
    <p class="thesis">Gut comfort (gels only) is a proxy, not a taste or tolerance test: it's a min-max score of ingredient count within the gel category, on the reasoning that a shorter, simpler label is generally easier on the stomach. It's disclosed as what it is &mdash; an inference from the label, same as everything else here &mdash; not a stand-in for someone actually racing on it.</p>
  </section>

  <section>
    <div class="sh"><h2>Pricing</h2><span class="rule"></span></div>
    <p class="thesis">Prices are tracked from a specific retailer, linked directly on every product page, and reflect what that retailer listed as of the review date shown at the top of the page. Prices move; we don't re-check every listing daily, so treat the number as a recent snapshot and the link as the source of truth.</p>
    <p class="thesis">None of the links on this site are affiliate links. We don't earn anything when you click through or buy, and that's on purpose &mdash; it removes any incentive to rank a product higher because it pays better.</p>
  </section>

  <section>
    <div class="sh"><h2>Photos</h2><span class="rule"></span></div>
    <p class="thesis">Product photos are sourced only from the official brand site or an authorized retailer &mdash; never stock photography, never a competitor's marketing image. Where a brand's own photography wasn't clean enough to use as-is, we've edited the background, never the product itself.</p>
  </section>

  <section>
    <div class="sh"><h2>Review dates</h2><span class="rule"></span></div>
    <p class="thesis">The date on each product page reflects when that product's written review &mdash; its verdict, pros, cons and data &mdash; was last actually verified or revised, not when the page was last deployed. A photo swap or a copy-editing pass elsewhere on the site doesn't move a product's review date; a change to what the review actually claims does.</p>
  </section>

  <section>
    <div class="sh"><h2>The catalog today</h2><span class="rule"></span></div>
    <p class="thesis">${gelCount} gels, ${drinkCount} drink mixes and ${electrolyteCount} electrolyte products, and growing. Don't see something you use? Search for it &mdash; if it's not here yet, that tells us it should be.</p>
  </section>`;
  window.scrollTo(0,0);
}

/* Shown when a search doesn't match anything in the catalog — a clean
   dead end instead of no result at all, and a natural place to point
   people at what already exists while a new review gets written. */
function renderWaiting(query){
  RequestLog.save(query);
  document.title = query + " — not reviewed yet — Fuel Finder";
  clearNavHighlights();
  document.getElementById("toc").style.display = "none";
  document.getElementById("page").innerHTML = `
  <div class="home-hero">
    <p class="eye">Not reviewed yet</p>
    <h1>${esc(query)}</h1>
    <p class="thesis">We hold every review to the same bar: checked against the declared nutrition panel, no marketing copy taken at face value. That takes a bit of time, so this one isn't live yet &mdash; but it's on the list.</p>
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
  document.title = "Owner view — Fuel Finder";
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
  document.title = "Requested reviews — Fuel Finder";
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
