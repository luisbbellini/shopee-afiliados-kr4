// Função da Vercel: recebe todas as chamadas /api/* (via rewrite no vercel.json)
import { handle } from '../src/routes.js';

export default async function handler(req, res) {
  try {
    const url = new URL(req.url, 'http://x');
    const route = url.searchParams.get('route');
    const pathname = route ? '/api/' + route.replace(/^\/+/, '') : url.pathname;
    let body = req.body;
    if (typeof body === 'string') body = body ? JSON.parse(body) : {};
    const r = await handle(req.method, pathname, body || {}, req.headers);
    res.status(r.status).setHeader('Cache-Control', 'no-store').json(r.body);
  } catch (e) {
    res.status(500).json({ errors: [{ message: e.message }] });
  }
}
