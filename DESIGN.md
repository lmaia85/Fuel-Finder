---
name: Fuel Finder
description: Endurance fuel, scored from the label.
colors:
  ground: "#07090C"
  panel: "#0C1015"
  rule: "#171E26"
  rule-2: "#232D38"
  ink: "#E8EEF1"
  dim: "#8C99A3"
  faint: "#7A8790"
  signal-cyan: "#3BD0EC"
  verdict-green: "#A9D62B"
  verdict-red: "#F0576E"
typography:
  display:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "clamp(34px, 5.6vw, 54px)"
    fontWeight: 800
    lineHeight: 0.98
    letterSpacing: "-0.035em"
  headline:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 700
    letterSpacing: "0.02em"
  title:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 700
  body:
    fontFamily: "IBM Plex Sans, system-ui, sans-serif"
    fontSize: "clamp(16px, 2vw, 19px)"
    fontWeight: 400
    lineHeight: 1.5
  data:
    fontFamily: "IBM Plex Mono, ui-monospace, monospace"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
    fontFeature: "tnum"
  label:
    fontFamily: "IBM Plex Mono, ui-monospace, monospace"
    fontSize: "12px"
    fontWeight: 400
    letterSpacing: "0.14em"
rounded:
  hairline: "2px"
  chip: "7px"
  stage: "10px"
  card: "14px"
  pill: "999px"
spacing:
  gutter-mobile: "16px"
  gutter: "28px"
  card-gap: "14px"
  section: "36px"
components:
  button-primary:
    backgroundColor: "{colors.signal-cyan}"
    textColor: "{colors.ground}"
    rounded: "{rounded.pill}"
    padding: "9px 16px"
    typography: "{typography.label}"
  button-primary-hover:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.signal-cyan}"
  chip-option:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.dim}"
    rounded: "20px"
    padding: "10px 16px"
  chip-option-selected:
    backgroundColor: "rgba(59,208,236,.10)"
    textColor: "{colors.signal-cyan}"
  card:
    backgroundColor: "{colors.panel}"
    rounded: "{rounded.card}"
    padding: "24px 26px"
  input-search:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    padding: "18px 20px"
  score-pill:
    rounded: "{rounded.chip}"
    padding: ".3em .55em"
---

# Design System: Fuel Finder

## Overview

**Creative North Star: "The Lab Readout"**

Fuel Finder looks like an instrument panel reading a nutrition label: a near-black field, hairline rules, monospace numbers in tabular columns, and one cyan signal that marks what is live or selected. It is the opposite of supplement marketing. There are no lifestyle photos, no gradients on type, and no hype colors. Product photos appear as evidence on a lit stage, the same way a sample sits under a lab lamp.

Density is moderate to high. Tables, scores and per-gram costs are the content, so the system favors legible data over breathing room, and puts one large Archivo display headline at the top of each page for orientation. Everything below it is small caps, mono labels, and rules.

The emotional register is calm, skeptical, and precise. Color carries meaning, never mood.

**Key Characteristics:**
- Dark-only: near-black ground (#07090C) with slightly raised panels, no light theme.
- Three typefaces with strict jobs: Archivo for headlines and names, Plex Sans for prose, Plex Mono for data, labels and UI chrome.
- One interactive accent (cyan). Green and red appear only as verdicts.
- Hairline borders and tonal panels carry structure; shadows are rare.
- Uppercase, tracked mono labels for navigation, eyebrows and table headers.

## Colors

A near-monochrome dark instrument palette with one signal color and a verdict pair.

### Primary
- **Signal Cyan** (#3BD0EC): the only interactive and "this one" color. Links on hover, focus rings, selected quiz options, the active leaderboard tab, primary buy buttons, score-breakdown bars, the highlighted column for the current product in comparison tables, the "Finder" half of the wordmark, and eyebrows. Its 10% tint (`rgba(59,208,236,.10)`, `--band`) marks selected surfaces.

### Secondary
- **Verdict Green** (#A9D62B): best-in-comparison values and top-tier scores. Always paired with a ▲ marker or a score so meaning never relies on hue alone.
- **Verdict Red** (#F0576E): worst-in-comparison values, bottom-tier scores, and destructive hover (remove-from-compare).

### Neutral
- **Ground Black** (#07090C): page background and header.
- **Panel Graphite** (#0C1015): cards, dropdowns, inputs, tooltips; one step up from the ground.
- **Rule** (#171E26): table row dividers and section separators.
- **Rule Strong** (#232D38): card and input borders, header underline, section-heading rules.
- **Ink** (#E8EEF1): primary text and in-content links.
- **Dim** (#8C99A3): secondary text, subtitles, unselected controls.
- **Faint** (#7A8790): meta text, table headers, nav at rest, link underlines (5.4:1 on ground, WCAG AA).

### Named Rules
**The Single Signal Rule.** Cyan means "interactive, selected, or this product". Never use it decoratively, and never introduce a second accent hue.

**The Verdict-Only Rule.** Green and red are reserved for scores and best/worst comparisons. They never appear as brand color, backgrounds, icons, or success/error chrome unrelated to a verdict.

## Typography

**Display Font:** Archivo 800/700 (with system-ui)
**Body Font:** IBM Plex Sans 400/500 (with system-ui)
**Label/Mono Font:** IBM Plex Mono 400/500/600 (with ui-monospace). This is also the `body` element default, so any unstyled UI text reads as data.

**Character:** A tight, heavy grotesk for headlines, set against a technical mono that makes every number and label look measured. Plex Sans handles only prose that has to be read in sentences.

### Hierarchy
- **Display** (Archivo 800, clamp(34px, 5.6vw, 54px), line-height .98, -0.035em): the page `h1`, one per page.
- **Headline** (Archivo 700, 15px, uppercase, 0.02em): section headings, followed by a hairline rule that fills the row.
- **Title** (Archivo 700, 14–15px): product names in cards, results and buy rows.
- **Body** (Plex Sans 400, clamp(16px, 2vw, 19px), 1.5, max 54ch): the thesis paragraph under each h1. Smaller subtitles use Plex Sans 13px in Dim, max 64ch.
- **Data** (Plex Mono 12.5–15px, tabular numerals): tables, prices, scores, calculator outputs.
- **Label** (Plex Mono 12px, uppercase, 0.12–0.2em tracking): nav, eyebrows, table headers, meta lines, pill buttons.

### Named Rules
**The Numbers Are Mono Rule.** Every quantity (grams, mg, cents, scores, ratios) is set in Plex Mono with tabular figures so columns align and values read as measurements.

**The One Headline Rule.** Archivo at display size appears once per page. Section headings stay small, uppercase and ruled.

## Layout

A single centered column capped at 1180px, with 28px side gutters (16px at ≤800px). Product review pages add a left sticky table of contents as a flex sibling with a 40px gap. Sections stack with 36px vertical padding and a Rule divider between them. Card grids ("bento") run four columns on desktop and two at ≤800px, with a 14px gap. The header is a sticky 52px bar. At ≤800px the nav collapses into a hamburger drawer and the hero grid drops to one column. The main breakpoint is 800px, with minor tweaks at 360px, 600px and 1400px.

## Elevation & Depth

Flat by default. Depth comes from tonal layering (Ground → Panel) and 1px Rule Strong borders, not shadows. Card hover lifts by translateY(-3px) and switches the border to cyan, with no shadow, to avoid repainting many cards at once. The one soft light source is the product photo stage: a faint radial highlight behind the product plus a contact shadow beneath it, so dark packaging stays legible on a dark page.

### Shadow Vocabulary
- **Floating overlay** (`box-shadow: 0 8px 24px rgba(0,0,0,.5)`): tooltips and the floating "See your results" pill only. These are elements that sit above scrolling content.
- **Product drop** (`filter: drop-shadow(0 14px 16px rgba(0,0,0,.45))`): product photos on the stage.

### Named Rules
**The Flat Panel Rule.** Cards and panels never carry a resting shadow. Shadows are only for things that genuinely float over content.

## Shapes

Softly rounded containers inside a rectilinear grid. Cards and list panels use 14px corners and photo stages 10px. Score chips use 7px, and interactive pills (buy buttons, quiz options, leaderboard tabs) are fully rounded. Tables, the header, dropdown menus, inputs and the Find Your Fuel results list stay square, which keeps the data areas looking like a readout. Score bars are 4px tall with 2px corners.

## Components

### Buttons
- **Shape:** full pill (999px / 100px).
- **Primary (buy):** Signal Cyan fill, Ground text, uppercase mono label 12px/0.1em, padding 9px 16px. On row hover it inverts to Ink fill with cyan text.
- **Floating jump pill:** Panel fill, cyan border and text, 24px radius, floating overlay shadow, fixed bottom-center.
- **Icon/utility:** small square buttons (22px, 5px radius) with Rule Strong border; destructive ones turn red on hover.

### Chips
- **Quiz option:** Panel fill, Rule Strong border, Dim mono 13px, 20px radius. Hover gives a cyan border with Ink text. Selected uses the cyan tint fill, cyan border and cyan text.
- **Score pill:** mono 600 13px, 7px radius, 1px border in the tier color over a 10–14% tint of that color. Tiers are best (green), mid (cyan) and worst (red).

### Cards / Containers
- **Corner Style:** 14px.
- **Background:** Panel Graphite.
- **Shadow Strategy:** none at rest (see Flat Panel Rule).
- **Border:** 1px Rule Strong, which turns cyan on hover for linked cards.
- **Internal Padding:** 24px 26px (bento), 16px (compact cards).
- **Entrance:** staggered fade-up (14px, 0.5s, cubic-bezier(.16,1,.3,1), 60ms steps).

### Inputs / Fields
- **Style:** square, Panel or Ground fill, 1px Rule Strong border, mono text. The homepage search is 15px with 18px 20px padding.
- **Focus:** border shifts to cyan (outline removed only where this replacement exists). Everything else gets the global 2px cyan `:focus-visible` ring.

### Navigation
- **Header:** sticky 52px Ground bar with a Rule Strong underline. The wordmark is Archivo 800 uppercase with "Finder" in cyan. Nav links are mono 12px, uppercase, 0.14em, Faint at rest and Ink when active. Category links open square Panel dropdowns (brand, then product).
- **Mobile:** a "Menu" toggle opens a drawer at ≤800px.
- **Review TOC:** a left column of section buttons with a short hairline tick that extends on the active item.

### Comparison Table (signature)
Square, fixed-layout, 12.5px mono with tabular figures. Headers are uppercase 12px Faint. The current product's column is outlined in cyan with a 7% cyan tint. Best values are green with ▲, worst values are red.

### Photo Stage (signature)
A fixed-height box (300px, 220px mobile) in Panel with a 10px radius. A soft radial light sits behind the product and a contact shadow sits beneath, so tubes, pouches and sachets all read at the same size.

## Do's and Don'ts

### Do:
- **Do** set every number in Plex Mono with tabular figures.
- **Do** use cyan only for interactive, selected, or "this product" states.
- **Do** pair green/red verdicts with a non-color cue (▲, score number, label).
- **Do** keep product photos on the lit photo stage rather than bare on the page.
- **Do** separate sections with hairline rules and small uppercase Archivo headings.

### Don't:
- **Don't** add a light theme, gradients on text, or a second accent hue.
- **Don't** use green or red as decoration, brand color, or generic success/error chrome.
- **Don't** give cards resting shadows; shadows are for floating overlays only.
- **Don't** use bounce or elastic easing on new motion; prefer ease-out curves like cubic-bezier(.16,1,.3,1).
- **Don't** animate width/height/padding; use transform, opacity or grid-template-rows.
