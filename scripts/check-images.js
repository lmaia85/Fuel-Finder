const fs = require("fs");
const path = require("path");

/* Fails the build if any page references a catalog photo that isn't
   actually in _site/img/products/ — the class of bug that let two
   broken images ship silently before. Run after `npm run build`. */

const OUT = path.join(__dirname, "..", "_site");
const PHOTO_RE = /img\/products\/[a-zA-Z0-9._-]+/g;

function walk(dir){
  let files = [];
  for(const entry of fs.readdirSync(dir, { withFileTypes: true })){
    const full = path.join(dir, entry.name);
    if(entry.isDirectory()) files = files.concat(walk(full));
    else if(entry.name.endsWith(".html")) files.push(full);
  }
  return files;
}

const missing = new Set();
let checked = 0;
for(const file of walk(OUT)){
  const html = fs.readFileSync(file, "utf8");
  for(const match of html.match(PHOTO_RE) || []){
    checked++;
    if(!fs.existsSync(path.join(OUT, match))) missing.add(match);
  }
}

if(missing.size){
  console.error(`check-images: ${missing.size} referenced photo(s) missing from _site/:`);
  for(const m of missing) console.error(`  ${m}`);
  process.exit(1);
}
console.log(`check-images: ${checked} photo reference(s) checked, all present.`);

/* Fails the deploy if a product photo's visible pixels sit off center in
   their own file. The page centers the image file, so lopsided empty space
   inside a transparent WebP shows up as a pack hugging one side of its
   stage. Decoded in headless Chrome (already installed for the build) so
   this needs no image library. Fix with: python3 scripts/frame-photos.py */
const MAX_OFFSET = 0.02;   // allowed drift of the content center, as a share of width/height
(async () => {
  const puppeteer = require("puppeteer");
  const dir = path.join(__dirname, "..", "img", "products");
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  const off = [];
  for(const name of fs.readdirSync(dir).filter(n => n.endsWith(".webp"))){
    const src = "data:image/webp;base64," + fs.readFileSync(path.join(dir, name)).toString("base64");
    const [dx, dy] = await page.evaluate(async src => {
      const img = new Image(); img.src = src; await img.decode();
      const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
      const ctx = c.getContext("2d"); ctx.drawImage(img, 0, 0);
      const a = ctx.getImageData(0, 0, c.width, c.height).data;
      let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
      for(let y = 0; y < c.height; y++) for(let x = 0; x < c.width; x++){
        if(a[(y * c.width + x) * 4 + 3] > 128){ if(x < x0) x0 = x; if(x > x1) x1 = x; if(y < y0) y0 = y; if(y > y1) y1 = y; }
      }
      return [(x0 + x1 + 1) / 2 / c.width - 0.5, (y0 + y1 + 1) / 2 / c.height - 0.5];
    }, src);
    if(Math.abs(dx) > MAX_OFFSET || Math.abs(dy) > MAX_OFFSET) off.push(`${name} (${(dx * 100).toFixed(1)}%, ${(dy * 100).toFixed(1)}%)`);
  }
  await browser.close();
  if(off.length){
    console.error(`check-images: ${off.length} photo(s) off center; run python3 scripts/frame-photos.py:`);
    for(const o of off) console.error(`  ${o}`);
    process.exit(1);
  }
  console.log("check-images: every product photo is centered.");
})();
