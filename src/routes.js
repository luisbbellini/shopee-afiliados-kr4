// Lógica compartilhada entre o servidor local (server.js) e a função da Vercel (api/index.js)
import crypto from 'node:crypto';
import { ShopeeAffiliate, clearLearned } from './shopee.js';
import { mockResponse } from './mock.js';
import { findOpportunities } from './opportunities.js';
import { favList, favSave, aiTest, editImage, favRemove, getSettingsPublic, saveSettings, getSettings, notify, dailyJob, videoScript, videoInsights, videoOCR, fetchImage, imagesZip, slug, extOf, storeEnabled, trending, recordSnapshot } from './features.js';
import { getJSON, itemHistory } from './store.js';

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
    store: storeEnabled(), aiServer: !!(process.env.AI_API_KEY || process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY || process.env.GEMINI_API_KEY),
  }),

  // Testa se as credenciais funcionam com uma consulta mínima.
  'POST /api/check': async (b, { client, source }) => {
    const r = await client.raw('{ productOfferV2(keyword: "garrafa", limit: 1) { nodes { itemId } } }');
    const err = r.errors?.map((e) => e.message + (e.extensions?.code ? ` [${e.extensions.code}]` : '')).join(' · ');
    return { ok: !r.errors?.length && !!r.data, source, error: err || null };
  },

  'POST /api/products': async (b, ctx) => { const r = await paged('productOffers', b, ctx); snap(r.nodes); return r; },
  'POST /api/opportunities': async (b, { client, key }) => { const r = await findOpportunities(client, key, b); snap(r.all); delete r.all; return r; },

  // Lista "Para gravar"
  'POST /api/fav/list': async () => ({ items: await favList() }),
  'POST /api/fav/save': async (b) => ({ item: await favSave(b.item || b) }),
  'POST /api/fav/remove': async (b) => { await favRemove(b.itemId); return { ok: true }; },

  // Histórico / Em alta
  'POST /api/trending': async (b) => trending({ days: Number(b.days) || 7, minDelta: Number(b.minDelta) || 1, limit: 150 }),
  'POST /api/history': async (b) => ({ points: await itemHistory(b.itemId, 30) }),

  // Configurações e alertas
  'POST /api/settings/get': async () => ({ settings: await getSettingsPublic(), lastCron: await getJSON('lastCron', null) }),
  'POST /api/settings/save': async (b) => { await saveSettings(b); return { settings: await getSettingsPublic() }; },
  'POST /api/alerts/test': async (b, ctx) => notify(await getSettings(), 'Shopee Afiliados', 'Teste de alerta: está funcionando! ✅', ctx.panelUrl),
  'POST /api/cron/run': async (b, ctx) => dailyJob(ctx.client, ctx.key, { panelUrl: ctx.panelUrl }),
  'GET /api/cron': async (b, ctx) => dailyJob(ctx.client, ctx.key, { panelUrl: ctx.panelUrl }),

  // Roteiro com IA (chave do aparelho ou da Vercel)
  'POST /api/script': async (b, ctx) => ({ script: await videoScript(b, ctx.ai) }),
  'POST /api/ai/test': async (b, ctx) => aiTest(ctx.ai),
  'POST /api/video-ocr': async (b, ctx) => videoOCR(b, ctx.ai),
  'POST /api/video-insights': async (b, ctx) => ({ insights: await videoInsights(b, ctx.ai) }),
  'POST /api/image-edit': async (b, ctx) => {
    const r = await editImage(b, ctx.ai);
    return { __binary: r.buf, contentType: r.type, filename: `editada-${Date.now()}.${extOf(r.type)}`, info: r.model };
  },

  // Fotos
  'POST /api/image': async (b) => { const { buf, type } = await fetchImage(b.url); return { __binary: buf, contentType: type, filename: slug(b.name) + '.' + extOf(type) }; },
  'POST /api/images-zip': async (b) => ({ __binary: await imagesZip(b.items || []), contentType: 'application/zip', filename: (b.filename ? slug(b.filename) : 'fotos-para-gravar') + '.zip' }),
  'POST /api/shops': (b, ctx) => paged('shopOffers', b, ctx),
  'POST /api/offers': (b, ctx) => paged('shopeeOffers', b, ctx),
  'POST /api/conversions': (b, ctx) => scrolled('conversionReport', b, ctx),
  'POST /api/validated': (b, ctx) => scrolled('validatedReport', b, ctx),
  'POST /api/feeds': (b, { client }) => client.listItemFeeds(b),
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

// Guarda a foto do dia das vendas (histórico) sem atrasar a resposta se o banco falhar.
function snap(nodes) { if (storeEnabled() && nodes?.length) recordSnapshot(nodes).catch(() => {}); }

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
// Rotas que não precisam das credenciais da Shopee
const NO_SHOPEE = new Set(['GET /api/status', 'POST /api/fav/list', 'POST /api/fav/save', 'POST /api/fav/remove', 'POST /api/trending', 'POST /api/history',
  'POST /api/settings/get', 'POST /api/settings/save', 'POST /api/alerts/test', 'POST /api/script', 'POST /api/video-insights', 'POST /api/video-ocr', 'POST /api/ai/test', 'POST /api/image-edit', 'POST /api/image', 'POST /api/images-zip', 'POST /api/cache/clear']);
const NEEDS_STORE = new Set(['POST /api/fav/list', 'POST /api/fav/save', 'POST /api/fav/remove', 'POST /api/trending', 'POST /api/history', 'POST /api/settings/get', 'POST /api/settings/save', 'POST /api/alerts/test', 'POST /api/cron/run', 'GET /api/cron']);
const safeEq = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

// Executa uma rota. Retorna { status, body }.
export async function handle(method, pathname, body = {}, headers = {}) {
  const key = `${method} ${pathname}`;
  const fn = routes[key];
  if (!fn) return { status: 404, body: { errors: [{ message: 'Rota não encontrada: ' + key }] } };
  const panelOk = !PANEL_KEY || safeEq(String(headers['x-panel-key'] || ''), PANEL_KEY);
  if (key === 'GET /api/cron') {
    // Chamada pela tarefa agendada da Vercel
    const CRON = process.env.CRON_SECRET || '';
    const auth = String(headers.authorization || '');
    const ok = (CRON && safeEq(auth, `Bearer ${CRON}`)) || (!CRON && /^vercel-cron/i.test(String(headers['user-agent'] || ''))) || (PANEL_KEY && panelOk);
    if (!ok) return { status: 401, body: { errors: [{ message: 'Não autorizado' }] } };
  } else if (key !== 'GET /api/status' && !panelOk) {
    return { status: 401, body: { errors: [{ message: 'Senha do painel inválida' }], needKey: true } };
  }
  if (NEEDS_STORE.has(key) && !storeEnabled()) {
    return { status: 200, body: { noStore: true, errors: [{ message: 'Banco de dados não configurado. Veja Manual → Ativar banco de dados.' }] } };
  }
  const ctx = getClient(key === 'GET /api/status' || key === 'GET /api/cron' ? {} : headers);
  ctx.panelUrl = headers['x-forwarded-host'] || headers.host ? `https://${headers['x-forwarded-host'] || headers.host}` : '';
  // IA: chave do aparelho (cabeçalhos) ou da Vercel (AI_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY ou GEMINI_API_KEY)
  const devKey = String(headers['x-ai-key'] || '').trim();
  ctx.ai = devKey
    ? { key: devKey, provider: String(headers['x-ai-provider'] || 'auto'), model: String(headers['x-ai-model'] || '').trim(), imageModel: String(headers['x-ai-image-model'] || '').trim() }
    : { key: process.env.AI_API_KEY || process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY || process.env.GEMINI_API_KEY || '', provider: process.env.AI_PROVIDER || 'auto', model: process.env.AI_MODEL || '', imageModel: process.env.AI_IMAGE_MODEL || '' };
  if (!ctx.client && !NO_SHOPEE.has(key)) {
    return { status: 400, body: { errors: [{ message: 'Credenciais da Shopee não configuradas. Abra ⚙ Configurações no painel.' }] } };
  }
  const t0 = Date.now();
  try {
    const out = await fn(body, ctx);
    if (out && out.__binary) return { status: 200, binary: out.__binary, contentType: out.contentType, filename: out.filename, info: out.info };
    return { status: 200, body: { ...out, ms: Date.now() - t0 } };
  } catch (e) {
    return { status: 200, body: { errors: [{ message: e.message }], ms: Date.now() - t0 } };
  }
}
export const isMock = MOCK;
