/**
 * Dev only: one origin for the web app and the PHP API, so the SameSite=Strict
 * session cookie works exactly as in production and the PHP needs no CORS.
 *
 *   http://localhost:3000/api/*  ->  PHP   (npm run dev:api,  port 8080)
 *   everything else              ->  Expo  (npm run web,      port 8081)
 *
 * Open http://localhost:3000, not :8081.
 */
const http = require('http');
const net = require('net');

const PORT = Number(process.env.PROXY_PORT) || 3000;
const PHP = { host: '127.0.0.1', port: Number(process.env.PHP_PORT) || 8080 };
const EXPO = { host: '127.0.0.1', port: Number(process.env.EXPO_PORT) || 8081 };

const target = (url) => (url.startsWith('/api/') ? PHP : EXPO);

const server = http.createServer((req, res) => {
  const t = target(req.url);
  const up = http.request(
    { ...t, path: req.url, method: req.method, headers: req.headers },
    (r) => {
      res.writeHead(r.statusCode, r.headers);
      r.pipe(res);
    },
  );
  up.on('error', () => {
    res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end(`Dev proxy: nothing is listening on :${t.port} (${t === PHP ? 'npm run dev:api' : 'npm run web'}).`);
  });
  req.pipe(up);
});

// Metro's hot reload uses a WebSocket.
server.on('upgrade', (req, socket, head) => {
  const t = target(req.url);
  const up = net.connect(t.port, t.host, () => {
    const lines = Object.entries(req.headers).map(([k, v]) => `${k}: ${v}`);
    up.write(`${req.method} ${req.url} HTTP/1.1\r\n${lines.join('\r\n')}\r\n\r\n`);
    up.write(head);
    socket.pipe(up).pipe(socket);
  });
  up.on('error', () => socket.destroy());
  socket.on('error', () => up.destroy());
});

server.listen(PORT, '127.0.0.1', () => console.log(`dev-proxy: http://localhost:${PORT}  (/api -> :${PHP.port}, rest -> :${EXPO.port})`));
