// Banco de dados: Redis via REST (Upstash / "Vercel KV" do Marketplace da Vercel).
// Ao conectar o banco ao projeto, a Vercel cria KV_REST_API_URL e KV_REST_API_TOKEN
// (ou UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN). Sem isso, o banco fica desligado
// e o painel usa o armazenamento do próprio aparelho onde der.

const URL_ = (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '').replace(/\/$/, '');
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';

// Modo de teste: banco em memória (SHOPEE_MOCK=1 ou STORE_MEMORY=1).
const MEMORY = !URL_ && (process.env.SHOPEE_MOCK === '1' || process.env.STORE_MEMORY === '1');
const mem = new Map();

export const storeEnabled = () => !!(URL_ && TOKEN) || MEMORY;

async function memCmd([c, k, ...a]) {
  const C = c.toUpperCase();
  const h = () => { if (!mem.has(k)) mem.set(k, new Map()); return mem.get(k); };
  switch (C) {
    case 'GET': return mem.has(k) ? mem.get(k) : null;
    case 'SET': mem.set(k, a[0]); return 'OK';
    case 'DEL': mem.delete(k); return 1;
    case 'EXPIRE': return 1;
    case 'HSET': { const m = h(); for (let i = 0; i < a.length; i += 2) m.set(a[i], a[i + 1]); return a.length / 2; }
    case 'HGET': return mem.get(k)?.get?.(a[0]) ?? null;
    case 'HDEL': { const m = mem.get(k); a.forEach((f) => m?.delete(f)); return 1; }
    case 'HGETALL': { const m = mem.get(k); return m ? [...m].flat() : []; }
    case 'HMGET': { const m = mem.get(k); return a.map((f) => m?.get(f) ?? null); }
    case 'SADD': { if (!mem.has(k)) mem.set(k, new Set()); a.forEach((x) => mem.get(k).add(x)); return 1; }
    case 'SISMEMBER': return mem.get(k)?.has(a[0]) ? 1 : 0;
    case 'SMEMBERS': return [...(mem.get(k) || [])];
    case 'PING': return 'PONG';
    default: throw new Error('memória: comando não suportado ' + C);
  }
}

export async function cmd(...args) {
  if (MEMORY) return memCmd(args.map(String));
  if (!storeEnabled()) throw new Error('Banco de dados não configurado');
  const res = await fetch(URL_, { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args.map(String)) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.error) throw new Error('Banco: ' + (j.error || res.status));
  return j.result;
}
// Vários comandos numa ida só.
export async function pipeline(cmds) {
  if (!cmds.length) return [];
  if (MEMORY) { const out = []; for (const c of cmds) out.push(await memCmd(c.map(String))); return out; }
  const res = await fetch(URL_ + '/pipeline', { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(cmds.map((c) => c.map(String))) });
  const j = await res.json().catch(() => []);
  if (!res.ok) throw new Error('Banco: ' + res.status);
  return j.map((x) => x.result);
}

const toObj = (arr) => { const o = {}; for (let i = 0; i < (arr || []).length; i += 2) o[arr[i]] = arr[i + 1]; return o; };
export async function hgetallJSON(key) {
  const o = toObj(await cmd('HGETALL', key));
  for (const k of Object.keys(o)) { try { o[k] = JSON.parse(o[k]); } catch {} }
  return o;
}
export async function getJSON(key, fallback = null) {
  const v = await cmd('GET', key);
  if (v === null || v === undefined) return fallback;
  try { return JSON.parse(v); } catch { return fallback; }
}
export const setJSON = (key, val) => cmd('SET', key, JSON.stringify(val));

// Data de hoje no fuso de São Paulo (AAAA-MM-DD)
export function today(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/* ---------------- histórico diário de vendas ---------------- */
// snap:<data>  hash itemId -> "vendas|preço|comissão"
// meta         hash itemId -> JSON com nome, imagem, links, loja (o mais recente)
export async function recordSnapshot(nodes = []) {
  if (!storeEnabled() || !nodes.length) return;
  const day = today();
  const snap = [], meta = [];
  for (const n of nodes) {
    if (!n?.itemId || n.sales === undefined) continue;
    snap.push(String(n.itemId), `${n.sales}|${n.priceMin ?? ''}|${n.commissionRate ?? ''}`);
    meta.push(String(n.itemId), JSON.stringify({ itemId: n.itemId, productName: n.productName, imageUrl: n.imageUrl, productLink: n.productLink, offerLink: n.offerLink, shopName: n.shopName, priceMin: n.priceMin, commissionRate: n.commissionRate, commission: n.commission, ratingStar: n.ratingStar, sales: n.sales }));
  }
  if (!snap.length) return;
  await pipeline([['HSET', `snap:${day}`, ...snap], ['EXPIRE', `snap:${day}`, 60 * 86400], ['HSET', 'meta', ...meta], ['SADD', 'snapdays', day]]);
}

const parseSnap = (o) => { const out = {}; for (const [k, v] of Object.entries(o)) { const [s, p, c] = String(v).split('|'); out[k] = { sales: +s, price: +p, rate: +c }; } return out; };

// Produtos que mais cresceram em vendas entre "dias" atrás e hoje.
export async function trending({ days = 7, minDelta = 1, limit = 100 } = {}) {
  const all = (await cmd('SMEMBERS', 'snapdays')).sort();
  if (!all.length) return { items: [], from: null, to: null, daysAvailable: 0 };
  const to = all[all.length - 1];
  const target = today(-days);
  const from = all.filter((d) => d <= target).pop() || all[0];
  if (from === to) return { items: [], from, to, daysAvailable: all.length };
  const [a, b] = await pipeline([['HGETALL', `snap:${from}`], ['HGETALL', `snap:${to}`]]);
  const A = parseSnap(toObj(a)), B = parseSnap(toObj(b));
  const rows = [];
  for (const [id, now] of Object.entries(B)) {
    const was = A[id];
    if (!was) continue;
    const delta = now.sales - was.sales;
    if (delta < minDelta) continue;
    rows.push({ itemId: id, delta, from: was.sales, to: now.sales, growth: was.sales ? delta / was.sales : null, rateChange: now.rate - was.rate });
  }
  rows.sort((x, y) => y.delta - x.delta);
  const top = rows.slice(0, limit);
  const metas = top.length ? await cmd('HMGET', 'meta', ...top.map((r) => r.itemId)) : [];
  const spanDays = Math.max(1, Math.round((new Date(to) - new Date(from)) / 86400000));
  return {
    items: top.map((r, i) => ({ ...(metas[i] ? JSON.parse(metas[i]) : { itemId: r.itemId }), ...r, perDay: r.delta / spanDays })),
    from, to, spanDays, daysAvailable: all.length, compared: Object.keys(B).length,
  };
}

// Histórico de um produto (para o gráfico no detalhe)
export async function itemHistory(itemId, days = 30) {
  const all = (await cmd('SMEMBERS', 'snapdays')).sort().slice(-days);
  if (!all.length) return [];
  const vals = await pipeline(all.map((d) => ['HGET', `snap:${d}`, String(itemId)]));
  return all.map((d, i) => vals[i] ? { day: d, ...parseSnap({ x: vals[i] }).x } : null).filter(Boolean);
}
