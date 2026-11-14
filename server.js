// Servidor local: assina as chamadas à Shopee e serve o painel em http://localhost:3000
// Uso: node server.js   (Node 18+; sem npm install)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Lê .env simples (CHAVE=valor) antes de carregar as rotas
const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const { handle, isMock } = await import('./src/routes.js');
if (isMock) console.log('⚠️  Modo de teste (SHOPEE_MOCK=1): dados falsos, nada é enviado à Shopee.');

const PORT = Number(process.env.PORT || 3000);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname.startsWith('/api/')) {
      let body = {};
      if (req.method === 'POST') {
        const chunks = []; for await (const c of req) chunks.push(c);
        body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
      }
      const r = await handle(req.method, url.pathname, body, req.headers);
      res.writeHead(r.status, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify(r.body));
    }
    // Arquivos estáticos
    let file = path.join(__dirname, 'public', url.pathname === '/' ? 'index.html' : url.pathname);
    if (!file.startsWith(path.join(__dirname, 'public')) || !fs.existsSync(file)) { res.writeHead(404); return res.end('404'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ errors: [{ message: e.message }] }));
  }
}).listen(PORT, '0.0.0.0', async () => {
  console.log(`✅ Painel em http://localhost:${PORT}`);
  const os = await import('node:os');
  for (const list of Object.values(os.networkInterfaces()))
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) console.log(`📱 No celular (mesmo Wi-Fi): http://${a.address}:${PORT}`);
});
