const http = require('node:http'), fs = require('node:fs'), path = require('node:path')
const root = process.cwd()
const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json; charset=utf-8', '.svg':'image/svg+xml' }
http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0])
  const file = path.join(root, url === '/' ? 'preview/index.html' : url)
  if (!file.startsWith(root)) { res.writeHead(403).end(); return }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404).end('not found'); return }
    res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' })
    res.end(data)
  })
}).listen(7788, '127.0.0.1', () => console.log('preview on http://127.0.0.1:7788'))
