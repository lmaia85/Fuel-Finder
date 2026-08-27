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
