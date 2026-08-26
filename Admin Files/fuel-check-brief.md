# Fuel/Check — Project Brief & Build Spec

Handoff document. Drop this into a Claude project as knowledge, attach `fuel-check.html`,
and you can pick the build up cold from here.

Author: Lourenço Faria e Maia
Status as of August 2026: working prototype, one half finished, one half templated.

---

## 1. What it is

A tool that reads a sports nutrition product — gel, drink mix, pre-workout, recovery,
daily supplement — and evaluates it on **fitness for purpose**, plus a race-fuelling
calculator that works backwards from a target finish time to grams, sachets, sodium and fluid.

Two modes in one page: **Read a product** and **Plan race fuel**.

## 2. The thesis (this is the whole product)

General health scores are a category error for sports nutrition.

An energy gel is roughly 25 g of maltodextrin and fructose. On any conventional health
metric it scores terribly. Yuka would flag it red. That verdict is useless, because at
90 minutes into a race a gel is exactly the correct thing to eat.

**So the question is never "is this healthy." It is "is this the right thing, for this
effort, at this dose, and can your gut handle it."**

Everything in the build follows from that sentence. If a future change would let the tool
grade something down for being high in sugar, the change is wrong.

### Why this isn't a worse Yuka
Yuka does health scores well and already exists. The differentiation is domain judgement
that a general food-scoring app structurally cannot apply: purpose-specific dose ranges,
glucose:fructose ratio interpretation, per-hour intake maths, gut-tolerance framing.

### The signature insight to lead with
The glucose:fructose ratio is the most consequential number on a gel and is almost never
stated on the front of the pack. Glucose alone saturates its transporter near 60 g/hr.
Adding fructose opens a second pathway: 2:1 supports ~90 g/hr, 1:0.8 supports up to
120 g/hr in a gut-trained athlete. A glucose-only gel caps you at 60 g/hr no matter how
many you eat. This is the thing to demo.

## 3. Purpose of the project

Portfolio piece and conversation opener for health tech founders and interviews.
**Not a business.** Explicitly not optimising for retention, monetisation or user growth.

Consequences of that framing, all deliberate:
- Must be a live URL, usable in 60 seconds, mid-conversation. Not a repo.
- Must survive two follow-up questions ("how do you stop it making up numbers?",
  "where does the data come from?"). The answers are the actual content of the demo.
- Ten products working flawlessly beats a hundred working badly. The demo is always one product.
- No auth, no accounts, no user database, no mobile app. Scope creep is the enemy.

## 4. Current state

| Part | State |
|---|---|
| Race fuelling calculator | **Finished.** Pure maths, no model. Works now. |
| Barcode → Open Food Facts lookup | Working, with graceful not-found fallback |
| Label photo → extraction | Working (2-call split) |
| Evaluation against reference file | Working |
| Rendering / dose bars | Working |
| **Reference file (`CATEGORIES`)** | **5 categories as a template — needs filling out. This is the real remaining work.** |
| Deployment | Not done. Needs an API proxy. |

## 5. Architecture

Single HTML file, no build step, no framework. Three stages, deliberately separated.

**Stage 1 — Identify.** Barcode is the reliable route: `GET
world.openfoodfacts.org/api/v2/product/{barcode}.json`, no auth, CORS-friendly. If the
barcode isn't found, the tool asks for a photo of the nutrition panel rather than guessing.

**Stage 2 — Extract (photo path only).** Model transcribes the label. Transcription only:
no evaluation, no opinion. **Hard rule: never estimate, infer, or recall a typical value.
A missing number stays `null` and goes on the `unreadable` list.**

**Stage 3 — Classify and evaluate.** Model picks a category from the reference file and
evaluates only that category's checks, using only the reference file's ranges.

### The non-negotiable design rule
**All dose ranges come from the reference file in the page, never from the model.**
This is what makes the same product give the same answer twice, and it's the answer to the
"how do you stop it hallucinating" question. The model classifies and comments; it does not
supply numbers.

Everything the tool can't establish goes in a visible **"Could not establish"** block.
That block is the credibility of the whole thing — do not remove it to make output look tidier.

## 6. The reference file — the actual asset

`CATEGORIES` at the top of the `<script>`. Five categories present as a template:
`during-gel`, `during-drink`, `pre-workout`, `recovery`, `daily-supplement`.

Each check is:

```js
{ key:"carbs_g", name:"Carbohydrate", unit:"g",
  min:20, max:45, scale:50,     // evidence range, and the bar's full width
  note:"..." }                   // your voice — this is what makes it sound like a person
```

Qualitative checks (like glucose:fructose) set `qualitative:true`, `min/max/scale` to 0,
and carry the finding in the comment instead of a number.

### What to work on, in order
1. **Rewrite every `note` in your own voice.** Mine are placeholders showing tone. This is
   the highest-value hour in the project — it's what makes the demo sound like a
   biochemist who races, not a wrapper.
2. Extend the ingredient coverage. Sports nutrition is roughly 40 recurring ingredients:
   caffeine, creatine, beta-alanine, citrulline, bicarbonate, nitrate/beetroot, electrolytes,
   carb blends, BCAA/EAA, HMB, tart cherry, ashwagandha, taurine, carnitine, collagen,
   plus the standard vitamin/mineral set.
3. Add categories if needed (hydration tabs, real-food bars, chews).

## 7. Known problems to handle

- **Proprietary blends.** Total given, per-ingredient breakdown withheld. Must be copied
  exactly as printed and flagged, never estimated.
- **Per-serving vs per-scoop vs per-100g vs per-day.** The commonest source of wrong
  numbers. Needs explicit handling.
- **Open Food Facts coverage.** Crowdsourced and explicitly not guaranteed accurate.
  Niche endurance brands may be missing. **Do this first: scan 10 barcodes off your own
  shelf.** If coverage is thin, photo becomes the primary path and barcode the bonus —
  that changes what you polish.
- **Sweat sodium varies roughly fivefold between individuals.** Never present calculator
  sodium as precise.

## 8. Calculator logic (finished — reference only)

Carb rate by duration, g/hr:

| Duration | Rate |
|---|---|
| < 45 min | 0 — glycogen covers it |
| 45–90 min | 30–60 |
| 90–180 min | 60–90 |
| > 180 min | 70–90, or 90–120 if gut-trained |

Sodium by sweat rate: low 400 / average 700 / high 1000 mg per hour.
Fluid: 450 / 600 / 800 ml per hour.
Gels = ceil(total carbs ÷ carbs per serving).

The visceral output is the row of sachet icons — a 4-hour marathon at 75 g/hr is 300 g,
which is 12 gels. Most people have never seen that number. **That is the content hook.**

## 9. Design system

Clinical-meets-race-day. Biochemistry lab and the start line.

```
--ink:   #10161C    near-black, navy cast
--paper: #E7EBEC    cool pale grey
--cyan:  #00A9C7    primary accent (isotonic)
--lime:  #8FA800    in range
--amber: #E08A00    above range
--rose:  #D8324B    below range
--slate: #5A6B72    secondary text
```

Type: **Archivo** 700/800 display, **IBM Plex Sans** body, **IBM Plex Mono** for every
number and label. Mono on data is doing work — it reads as lab notebook and timing display.

**Signature element:** the dose bar. A track showing the evidence-supported range as a cyan
band, with the product's actual dose as a vertical tick, colour-coded by status. Shortfall
becomes visible instantly. Keep this — it's the thesis rendered visually.

## 10. Deployment

The page currently calls `api.anthropic.com` directly, which works inside Claude because
the key is handled for you. **On your own domain this would expose an API key in
client-side JavaScript.**

Fix: a minimal proxy — Cloudflare Worker or Vercel serverless function, ~20 lines — that
holds the key server-side and forwards the request. Change the `fetch` URL in `claude()`
to point at it. Nothing else changes.

Add basic rate limiting on the proxy so a shared link can't run up a bill.

## 11. Legal / duty of care

- Educational only. Not medical or nutritional advice. Keep the footer note.
- Attribute Open Food Facts and note it's crowdsourced (ODbL licence — attribution required).
- Frame output as **doses and evidence, not verdicts on brands.** "Contains 800 mg citrulline;
  studies use 6–8 g" is a fact. "Brand X is scamming you" is a claim you'd have to defend.
  The numbers do the work unaided, and it's the stronger format.
- No sports nutrition sponsorships while this is live, to keep the independence.

## 12. If it ever becomes an app

The **calculator is the retention hook**, not the scanner. The scanner answers a question
once; "how many gels for a 3:45 marathon" gets asked before every race. Build the app
around the calculator with the scanner as a feature, not the other way round.

Second-order idea worth keeping: comparison. Two gels side by side, per-gram-of-carb cost,
ratio, sodium. That's the thing people screenshot.

---

## Immediate next actions

1. Scan 10 barcodes off your shelf → does Open Food Facts have your products?
2. Rewrite the reference file notes in your own voice.
3. Extend the reference file to ~40 ingredients.
4. Stand up the proxy and deploy to a real URL.
5. Post the 12-gels marathon number. See if anyone cares.
