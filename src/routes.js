// Lógica compartilhada entre o servidor local (server.js) e a função da Vercel (api/index.js)
import crypto from 'node:crypto';
import { ShopeeAffiliate, clearLearned } from './shopee.js';
import { mockResponse } from './mock.js';

const MOCK = process.env.SHOPEE_MOCK === '1';
const PANEL_KEY = process.env.PANEL_KEY || '';
const ENV_APP_ID = (process.env.SHOPEE_APP_ID || '').trim();
const ENV_SECRET = (process.env.SHOPEE_SECRET || '').trim();

// Um cliente por par de credenciais. As credenciais podem vir do aparelho
// (cabeçalhos x-shopee-app-id / x-shopee-secret, salvos no painel) ou da Vercel (.env).
const clients = new Map();
function getClient(headers = {}) {
  const hApp = String(headers['x-shopee-app-id'] || '').trim();
  const hSec = String(headers['x-shopee-secret'] || '').trim();
  const appId = hApp || ENV_APP_ID || (MOCK ? 'mock' : '');
  const secret = hSec || ENV_SECRET || (MOCK ? 'mock' : '');
  const source = hSec ? 'aparelho' : 'vercel';
  if (!appId || !secret) return { client: null, source };
  const key = fp(appId) + '|' + fp(secret);
  if (!clients.has(key)) {
    const c = new ShopeeAffiliate({ appId, secret, endpoint: process.env.SHOPEE_ENDPOINT || undefined });
    if (MOCK) c.raw = async (q) => mockResponse(q);
    clients.set(key, c);
  }
  return { client: clients.get(key), source, key };
}

// Cache curto em memória para economizar o limite de chamadas (separado por credencial).
const cache = new Map();
const CACHE_MS = 5 * 60 * 1000;
async function cached(key, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < CACHE_MS) return { ...hit.v, cached: true };
  const v = await fn();
  if (!v.errors?.length) cache.set(key, { t: Date.now(), v });
  return v;
}

// Rotas: cada uma recebe (body, ctx) com ctx = { client, source, key }
const routes = {
  'GET /api/status': async (b, { client, source }) => ({
    ok: true, mock: MOCK, locked: !!PANEL_KEY, source,
    appId: mask(client?.appId || ''), endpoint: client?.endpoint,
    check: { appId: fp(client?.appId || ''), secret: fp(client?.secret || '') },
  }),

  // Testa se as credenciais funcionam com uma consulta mínima.
  'POST /api/check': async (b, { client, source }) => {
    const r = await client.raw('{ productOfferV2(keyword: "garrafa", limit: 1) { nodes { itemId } } }');
    const err = r.errors?.map((e) => e.message + (e.extensions?.code ? ` [${e.extensions.code}]` : '')).join(' · ');
    return { ok: !r.errors?.length && !!r.data, source, error: err || null };
  },

  'POST /api/products': (b, ctx) => paged('productOffers', b, ctx),
  'POST /api/shops': (b, ctx) => paged('shopOffers', b, ctx),
  'POST /api/offers': (b, ctx) => paged('shopeeOffers', b, ctx),
  'POST /api/conversions': (b, ctx) => scrolled('conversionReport', b, ctx),
  'POST /api/validated': (b, ctx) => scrolled('validatedReport', b, ctx),
  'POST /api/feeds': (b, { client }) => client.listItemFeeds(b).then(norm),
  'POST /api/feed-data': (b, { client }) => client.getItemFeedData(b),
  'POST /api/shortlink': (b, { client }) => client.shortLink(b),
  'POST /api/shortlinks': async (b, { client }) => {
    const out = [];
    for (const url of (b.urls || []).slice(0, 50)) {
      const r = await client.shortLink({ originUrl: url, subIds: b.subIds || [] });
      out.push({ originUrl: url, shortLink: r.data?.generateShortLink?.shortLink || null, error: r.errors?.[0]?.message });
    }
    return { data: out };
  },
  'POST /api/graphql': (b, { client }) => client.raw(b.query, b.variables),
  'POST /api/introspect': (b, { client }) => client.introspect(),
  'POST /api/diagnose': (b, { client }) => client.diagnose(b.keyword || 'garrafa'),
  'POST /api/cache/clear': async () => { cache.clear(); clearLearned(); return { ok: true }; },
};

function paged(method, b = {}, { client, key }) {
  const ck = key + method + JSON.stringify(b);
  if (b.allPages) return cached(ck, () => client.allPages(method, b, { maxPages: Math.min(Number(b.maxPages) || 5, 50) }).then(norm));
  return cached(ck, () => client[method](b).then(norm));
}
function scrolled(method, b = {}, { client }) {
  if (b.allPages) return client.allScroll(method, b, { maxPages: Math.min(Number(b.maxPages) || 10, 100) }).then(norm);
  return client[method](b).then(norm);
}
// Normaliza para { nodes, pageInfo, stripped, errors }
function norm(r) {
  if (r.nodes) return r;
  const root = Object.values(r.data || {})[0] || {};
  return { nodes: root.nodes || [], pageInfo: root.pageInfo, stripped: r.stripped || [], diagnostic: r.diagnostic, errors: r.errors, query: r.query };
}
// Impressão digital (não revela o valor): tamanho + início do hash
function fp(v = '') { return `${String(v).length}:${crypto.createHash('sha256').update(String(v)).digest('hex').slice(0, 8)}`; }
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
  const ctx = getClient(key === 'GET /api/status' ? {} : headers);
  if (!ctx.client && key !== 'GET /api/status') {
    return { status: 400, body: { errors: [{ message: 'Credenciais da Shopee não configuradas. Abra ⚙ Credenciais no painel.' }] } };
  }
  const t0 = Date.now();
  const out = await fn(body, ctx);
  return { status: 200, body: { ...out, ms: Date.now() - t0 } };
}
export const isMock = MOCK;
