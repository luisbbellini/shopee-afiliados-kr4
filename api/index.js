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
    res.setHeader('Cache-Control', 'no-store');
    if (r.binary) {
      res.setHeader('Content-Type', r.contentType || 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${r.filename || 'arquivo'}"`);
      if (r.info) res.setHeader('X-Info', encodeURIComponent(r.info));
      return res.status(200).send(r.binary);
    }
    res.status(r.status).json(r.body);
  } catch (e) {
    res.status(500).json({ errors: [{ message: e.message }] });
  }
}
