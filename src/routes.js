// Lógica compartilhada entre o servidor local (server.js) e a função da Vercel (api/index.js)
import crypto from 'node:crypto';
import { ShopeeAffiliate } from './shopee.js';
import { mockResponse } from './mock.js';

const MOCK = process.env.SHOPEE_MOCK === '1';
const PANEL_KEY = process.env.PANEL_KEY || '';

const client = new ShopeeAffiliate({
  appId: process.env.SHOPEE_APP_ID || (MOCK ? 'mock' : undefined),
  secret: process.env.SHOPEE_SECRET || (MOCK ? 'mock' : undefined),
  endpoint: process.env.SHOPEE_ENDPOINT || undefined,
});
if (MOCK) client.raw = async (q) => mockResponse(q);

// Cache curto em memória para economizar o limite de chamadas.
const cache = new Map();
const CACHE_MS = 5 * 60 * 1000;
async function cached(key, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < CACHE_MS) return { ...hit.v, cached: true };
  const v = await fn();
  if (!v.errors?.length) cache.set(key, { t: Date.now(), v });
  return v;
}

// Rotas da API local
const routes = {
  'GET /api/status': async () => ({ ok: true, mock: MOCK, locked: !!PANEL_KEY, appId: mask(client.appId), endpoint: client.endpoint }),

  'POST /api/products': (b) => paged('productOffers', b),
  'POST /api/shops': (b) => paged('shopOffers', b),
  'POST /api/offers': (b) => paged('shopeeOffers', b),
  'POST /api/conversions': (b) => scrolled('conversionReport', b),
  'POST /api/validated': (b) => scrolled('validatedReport', b),
  'POST /api/feeds': (b) => client.listItemFeeds(b).then(norm),
  'POST /api/feed-data': (b) => client.getItemFeedData(b),
  'POST /api/shortlink': (b) => client.shortLink(b),
  'POST /api/shortlinks': async (b) => {
    const out = [];
    for (const url of (b.urls || []).slice(0, 50)) {
      const r = await client.shortLink({ originUrl: url, subIds: b.subIds || [] });
      out.push({ originUrl: url, shortLink: r.data?.generateShortLink?.shortLink || null, error: r.errors?.[0]?.message });
    }
    return { data: out };
  },
  'POST /api/graphql': (b) => client.raw(b.query, b.variables),
  'POST /api/introspect': () => client.introspect(),
  'POST /api/diagnose': (b) => client.diagnose(b.keyword || 'garrafa'),
  'POST /api/cache/clear': async () => { cache.clear(); return { ok: true }; },
};

function paged(method, b = {}) {
  const key = method + JSON.stringify(b);
  if (b.allPages) return cached(key, () => client.allPages(method, b, { maxPages: Math.min(Number(b.maxPages) || 5, 50) }).then(norm));
  return cached(key, () => client[method](b).then(norm));
}
function scrolled(method, b = {}) {
  if (b.allPages) return client.allScroll(method, b, { maxPages: Math.min(Number(b.maxPages) || 10, 100) }).then(norm);
  return client[method](b).then(norm);
}
// Normaliza para { nodes, pageInfo, stripped, errors }
function norm(r) {
  if (r.nodes) return r;
  const root = Object.values(r.data || {})[0] || {};
  return { nodes: root.nodes || [], pageInfo: root.pageInfo, stripped: r.stripped || [], diagnostic: r.diagnostic, errors: r.errors, query: r.query };
}
function mask(s = '') { return s.length > 6 ? s.slice(0, 4) + '…' + s.slice(-2) : s; }


// Executa uma rota. Retorna { status, body }.
export async function handle(method, pathname, body = {}, headers = {}) {
  const key = `${method} ${pathname}`;
  const fn = routes[key];
  if (!fn) return { status: 404, body: { errors: [{ message: 'Rota não encontrada: ' + key }] } };
  if (PANEL_KEY && key !== 'GET /api/status') {
    const got = String(headers['x-panel-key'] || '');
    const ok = got.length === PANEL_KEY.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(PANEL_KEY));
    if (!ok) return { status: 401, body: { errors: [{ message: 'Senha do painel inválida' }], needKey: true } };
  }
  const t0 = Date.now();
  const out = await fn(body);
  return { status: 200, body: { ...out, ms: Date.now() - t0 } };
}
export const isMock = MOCK;
