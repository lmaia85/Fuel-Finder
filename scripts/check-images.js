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
