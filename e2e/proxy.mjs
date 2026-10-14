// Mimics the Supabase gateway for supabase-js: /rest/v1 -> PostgREST, /auth/v1 -> stub.
import http from 'node:http';
const [port, upstream] = [Number(process.argv[2]), process.argv[3]];
http.createServer((req, res) => {
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*',
    'access-control-allow-methods': '*', 'access-control-expose-headers': '*' };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  if (!req.url.startsWith('/rest/v1')) { res.writeHead(200, { ...cors, 'content-type': 'application/json' }); return res.end('{}'); }
  const url = new URL(req.url.slice('/rest/v1'.length) || '/', upstream);
  const up = http.request(url, { method: req.method, headers: { ...req.headers, host: url.host } }, (r) => {
    res.writeHead(r.statusCode, { ...r.headers, ...cors }); r.pipe(res);
  });
  up.on('error', (e) => { res.writeHead(502, cors); res.end(String(e)); });
  req.pipe(up);
}).listen(port, '127.0.0.1');
