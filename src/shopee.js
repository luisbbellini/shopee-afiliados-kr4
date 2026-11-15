// Cliente da Shopee Affiliate Open API (Brasil) — GraphQL + assinatura SHA256
// Sem dependências: usa fetch e crypto nativos do Node 18+.
import crypto from 'node:crypto';

export const ENDPOINT_BR = 'https://open-api.affiliate.shopee.com.br/graphql';

/* ------------------------------------------------------------------ */
/* Campos pedidos em cada consulta. Se a Shopee não reconhecer algum,  */
/* o cliente remove o campo e tenta de novo (veja autoStrip abaixo).   */
/* ------------------------------------------------------------------ */
export const FIELDS = {
  productOfferV2: `
    itemId productName productLink offerLink imageUrl
    priceMin priceMax priceDiscountRate
    sales ratingStar
    commissionRate sellerCommissionRate shopeeCommissionRate commission
    shopId shopName shopType
    productCatIds
    periodStartTime periodEndTime`,
  shopOfferV2: `
    shopId shopName shopType imageUrl ratingStar
    commissionRate sellerCommCoveRatio remainingBudget
    offerLink originalLink
    periodStartTime periodEndTime
    bannerInfo { count banners { fileName imageUrl imageSize imageWidth imageHeight } }`,
  shopeeOfferV2: `
    offerName offerType imageUrl commissionRate
    offerLink originalLink categoryId collectionId
    periodStartTime periodEndTime`,
  conversionReport: `
    purchaseTime clickTime conversionId checkoutId
    grossCommission cappedCommission totalBrandCommission estimatedTotalCommission
    shopeeCommissionCapped sellerCommission totalCommission netCommission
    mcnManagementFeeRate mcnManagementFee mcnContractId linkedMcnName
    buyerType utmContent device referrer productType
    orders {
      orderId orderStatus shopType
      items {
        shopId shopName completeTime promotionId modelId itemId itemName itemPrice
        displayItemStatus actualAmount refundAmount qty imageUrl
        itemTotalCommission itemSellerCommission itemSellerCommissionRate
        itemShopeeCommissionCapped itemShopeeCommissionRate itemNotes
        channelType attributionType fraudStatus fraudReason
        globalCategoryLv1Name globalCategoryLv2Name globalCategoryLv3Name
      }
    }`,
  validatedReport: `
    purchaseTime clickTime conversionId checkoutId
    grossCommission cappedCommission totalBrandCommission estimatedTotalCommission
    shopeeCommissionCapped sellerCommission totalCommission netCommission
    buyerType utmContent device referrer
    orders {
      orderId orderStatus shopType
      items {
        shopId shopName completeTime itemId itemName itemPrice actualAmount refundAmount qty imageUrl
        itemTotalCommission itemSellerCommission itemShopeeCommissionCapped
        displayItemStatus fraudStatus fraudReason attributionType channelType
      }
    }`,
  listItemFeeds: `datafeedId datafeedName description date feedMode totalCount`,
};

// Campos mínimos: usados quando a consulta completa falha, para descobrir o culpado.
export const CORE = {
  productOfferV2: 'itemId productName imageUrl priceMin priceMax commissionRate sales offerLink productLink shopName',
  shopOfferV2: 'shopId shopName commissionRate offerLink imageUrl',
  shopeeOfferV2: 'offerName commissionRate offerLink imageUrl',
  conversionReport: 'purchaseTime conversionId totalCommission utmContent orders { orderId orderStatus items { itemId itemName actualAmount itemTotalCommission } }',
  validatedReport: 'purchaseTime conversionId totalCommission utmContent orders { orderId orderStatus items { itemId itemName actualAmount itemTotalCommission } }',
};

// O que a API já rejeitou nesta instância (campos e argumentos), para não repetir o erro.
export const learned = {};
export function clearLearned() { for (const k of Object.keys(learned)) delete learned[k]; }

// Divide uma seleção GraphQL nos itens do primeiro nível: "a b c { d } e" -> ["a","b","c { d }","e"]
export function topLevel(sel) {
  const out = []; let depth = 0; let cur = '';
  for (const ch of sel.replace(/\s+/g, ' ').trim()) {
    if (ch === '{') depth++;
    if (ch === '}') depth--;
    if (ch === ' ' && depth === 0) {
      if (cur.trim()) { if (cur.trim().startsWith('{') && out.length) out[out.length - 1] += ' ' + cur.trim(); else out.push(cur.trim()); }
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) { if (cur.trim().startsWith('{') && out.length) out[out.length - 1] += ' ' + cur.trim(); else out.push(cur.trim()); }
  return out;
}
const fieldName = (item) => item.split(/[\s{]/)[0];
const isSystemError = (r) => (r.errors || []).some((e) => /system error|10000/i.test(`${e.message} ${e.extensions?.code ?? ''}`));

const PAGE_INFO_PAGED = 'pageInfo { page limit hasNextPage }';
const PAGE_INFO_SCROLL = 'pageInfo { limit hasNextPage scrollId }';

/* ------------------------------ util ------------------------------ */

// Serializa argumentos como literais GraphQL (evita ter de declarar tipos de variáveis).
function gqlValue(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : null;
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) return '[' + v.map(gqlValue).filter((x) => x !== null).join(', ') + ']';
  if (typeof v === 'object' && v.__enum) return v.__enum; // enum literal
  if (typeof v === 'object' && v.__var) return '$' + v.__var; // variável GraphQL
  if (typeof v === 'object') {
    const parts = Object.entries(v)
      .map(([k, val]) => [k, gqlValue(val)])
      .filter(([, val]) => val !== null)
      .map(([k, val]) => `${k}: ${val}`);
    return `{ ${parts.join(', ')} }`;
  }
  return JSON.stringify(String(v));
}

function gqlArgs(args) {
  const parts = Object.entries(args)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => [k, gqlValue(v)])
    .filter(([, v]) => v !== null)
    .map(([k, v]) => `${k}: ${v}`);
  return parts.length ? `(${parts.join(', ')})` : '';
}

// Remove um campo (e seu bloco { ... }, se houver) de uma seleção GraphQL.
export function removeField(query, field) {
  const re = new RegExp(`(^|[\\s{])${field}(?=[\\s{}]|$)`, 'g');
  let out = query;
  let m;
  while ((m = re.exec(out))) {
    const start = m.index + m[1].length;
    let end = start + field.length;
    // ignora se for argumento (seguido de ":") ou raiz com "("
    const rest = out.slice(end).trimStart();
    if (rest.startsWith(':') || rest.startsWith('(')) continue;
    if (rest.startsWith('{')) {
      let i = out.indexOf('{', end);
      let depth = 0;
      for (; i < out.length; i++) {
        if (out[i] === '{') depth++;
        else if (out[i] === '}') { depth--; if (depth === 0) { i++; break; } }
      }
      end = i;
    }
    out = out.slice(0, start) + out.slice(end);
    re.lastIndex = start;
  }
  return out;
}

// Campos de estrutura (listas/paginação): nunca são removidos automaticamente.
const STRUCTURAL = new Set(['nodes', 'pageInfo', 'rows', 'edges', 'items', 'node']);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ----------------------------- cliente ---------------------------- */

export class ShopeeAffiliate {
  constructor({ appId, secret, endpoint = ENDPOINT_BR, timeoutMs = 30000, autoStrip = true } = {}) {
    if (!appId || !secret) throw new Error('Defina SHOPEE_APP_ID e SHOPEE_SECRET no arquivo .env');
    // trim: espaço ou quebra de linha colados por engano invalidam a assinatura
    this.appId = String(appId).trim();
    this.secret = String(secret).trim();
    this.endpoint = endpoint;
    this.timeoutMs = timeoutMs;
    this.autoStrip = autoStrip;
  }

  sign(payload, timestamp) {
    return crypto
      .createHash('sha256')
      .update(this.appId + timestamp + payload + this.secret)
      .digest('hex');
  }

  // Chamada GraphQL crua e assinada.
  async raw(query, variables) {
    const body = JSON.stringify(variables ? { query, variables } : { query });
    const ts = Math.floor(Date.now() / 1000);
    const auth = `SHA256 Credential=${this.appId}, Timestamp=${ts}, Signature=${this.sign(body, ts)}`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: auth },
        body,
        signal: ctrl.signal,
      });
      const text = await res.text();
      let json;
      try { json = JSON.parse(text); } catch { json = { errors: [{ message: `Resposta não-JSON (HTTP ${res.status}): ${text.slice(0, 300)}` }] }; }
      json.__http = res.status;
      return json;
    } finally {
      clearTimeout(t);
    }
  }

  // Executa e, se a API reclamar de um campo inexistente, remove e repete.
  async query(query, { maxStrips = 25, variables } = {}) {
    const stripped = [];
    let q = query;
    for (let attempt = 0; attempt <= maxStrips; attempt++) {
      const json = await this.raw(q, variables);
      const errs = json.errors || [];
      if (!errs.length || !this.autoStrip) return { ...json, stripped, query: q };
      const bad = new Set();
      for (const e of errs) {
        const msg = `${e.message || ''} ${e.extensions?.message || ''}`;
        for (const m of msg.matchAll(/Cannot query field\s+"([A-Za-z0-9_]+)"/gi)) bad.add(m[1]);
        for (const m of msg.matchAll(/field\s+"?([A-Za-z0-9_]+)"?\s+(?:is not defined|not found|does not exist)/gi)) bad.add(m[1]);
      }
      const removable = [...bad].filter((f) => !stripped.includes(f) && !STRUCTURAL.has(f));
      if (!removable.length) return { ...json, stripped, query: q };
      for (const f of removable) { q = removeField(q, f); stripped.push(f); }
    }
    return { errors: [{ message: 'Campos demais rejeitados pela API' }], stripped, query: q };
  }

  /* ---------- consulta resiliente: se der "System Error", tenta contornar ---------- */
  // Regras: a palavra-chave nunca é descartada sozinha; nada de filtro é ignorado em
  // silêncio (sempre vem aviso); só campos de exibição são lembrados, e por 10 minutos.
  // A busca de produtos da Shopee às vezes responde "System Error" (10000) ao acaso.
  // Diagnóstico de 15/11/2026: mesma consulta ora passa, ora falha. Então a resposta certa
  // é repetir a MESMA busca com pausas crescentes, sem mudar filtros nem campos.
  async smartQuery(root, argObj, pageInfo = '', { budgetMs = 20000 } = {}) {
    const a = Object.fromEntries(Object.entries(argObj).filter(([, v]) => v !== undefined && v !== null && v !== ''));
    if ([3, 4, 5].includes(a.listType) && !a.matchId) {
      return { errors: [{ message: 'Falta o ID' }], diagnostic: [a.listType === 5 ? 'Para a lista "Loja", preencha o ID da loja.' : 'Para listas de categoria, preencha o ID da categoria.'] };
    }
    const q = `{ ${root}${gqlArgs(a)} { nodes { ${FIELDS[root]} } ${pageInfo} } }`;
    const waits = [0, 700, 1200, 2000, 3000, 4000, 5000];
    const t0 = Date.now();
    let r, attempts = 0;
    for (const w of waits) {
      if (w && Date.now() - t0 + w > budgetMs) break;
      if (w) await sleep(w + Math.floor(Math.random() * 300));
      attempts++;
      r = await this.query(q);
      if (!isSystemError(r)) break;
    }
    r.attempts = attempts;
    if (isSystemError(r)) {
      r.diagnostic = [`A Shopee está instável: respondeu "System Error" nas ${attempts} tentativas seguidas (${Math.round((Date.now() - t0) / 1000)} s). Não é problema da busca nem da conta; tente de novo em instantes.`];
    }
    return r;
  }

  // Bateria de testes para descobrir o que a conta aceita.
  async diagnose(keyword = 'garrafa') {
    const tests = [];
    const run = async (name, q, vars) => {
      const t0 = Date.now(); const r = await this.raw(q, vars);
      tests.push({ name, ok: !r.errors?.length, ms: Date.now() - t0, error: r.errors?.map((e) => e.message + (e.extensions?.code ? ` [${e.extensions.code}]` : '')).join(' · ') || '' });
      await sleep(200);
    };
    const kw = JSON.stringify(keyword);
    // Mesma consulta 8 vezes, com 1 s de intervalo: mede a instabilidade da Shopee.
    for (let i = 1; i <= 8; i++) { await run(`Repetição ${i}/8 (mesma busca)`, `{ productOfferV2(keyword: ${kw}, limit: 5) { nodes { itemId productName } } }`); await sleep(800); }
    await run('Mínima (itemId, productName)', `{ productOfferV2(keyword: ${kw}, limit: 1) { nodes { itemId productName } } }`);
    await run('Com pageInfo', `{ productOfferV2(keyword: ${kw}, limit: 1) { nodes { itemId } pageInfo { page limit hasNextPage } } }`);
    await run('Sem palavra-chave', `{ productOfferV2(limit: 1) { nodes { itemId } } }`);
    await run('Palavra com espaços', `{ productOfferV2(keyword: "garrafa termica", limit: 1) { nodes { itemId } } }`);
    await run('Palavra como variável', `query B($kw: String) { productOfferV2(keyword: $kw, limit: 1) { nodes { itemId } } }`, { kw: keyword });
    await run('Palavra + página 1', `{ productOfferV2(keyword: ${kw}, page: 1, limit: 1) { nodes { itemId } } }`);
    await run('limit 20', `{ productOfferV2(keyword: ${kw}, limit: 20) { nodes { itemId } } }`);
    await run('limit 50', `{ productOfferV2(keyword: ${kw}, limit: 50) { nodes { itemId } } }`);
    for (const st of [1, 2, 5]) await run(`sortType ${st}`, `{ productOfferV2(keyword: ${kw}, sortType: ${st}, limit: 1) { nodes { itemId } } }`);
    await run('page 2', `{ productOfferV2(keyword: ${kw}, page: 2, limit: 1) { nodes { itemId } } }`);
    for (const f of topLevel(FIELDS.productOfferV2)) await run('campo ' + fieldName(f), `{ productOfferV2(keyword: ${kw}, limit: 1) { nodes { itemId ${f} } } }`);
    await run('Lojas (shopOfferV2)', `{ shopOfferV2(limit: 1) { nodes { shopId shopName } } }`);
    await run('Campanhas (shopeeOfferV2)', `{ shopeeOfferV2(limit: 1) { nodes { offerName } } }`);
    const now = Math.floor(Date.now() / 1000);
    await run('Conversões 7 dias', `{ conversionReport(purchaseTimeStart: ${now - 7 * 86400}, purchaseTimeEnd: ${now}, limit: 1) { nodes { conversionId } } }`);
    return { tests, learned: Object.fromEntries(Object.entries(learned).map(([k, v]) => [k, [...v.badFields]])) };
  }

  /* ------------------------- consultas prontas ------------------------- */

  // Busca de produtos com comissão.
  // listType: 0 todos | 1 maior comissão | 2 mais vendidos | 3 categoria (landing) | 4 categoria | 5 loja
  // sortType: 1 relevância | 2 mais vendidos | 3 maior preço | 4 menor preço | 5 maior comissão
  productOffers(a = {}) {
    // Listas 3/4 (categoria) e 5 (loja) usam matchId; aproveita os campos do formulário.
    const lt = num(a.listType);
    let matchId = num(a.matchId);
    if (!matchId && (lt === 3 || lt === 4)) { matchId = num(a.productCatId); a = { ...a, productCatId: undefined }; }
    if (!matchId && lt === 5) { matchId = num(a.shopId); a = { ...a, shopId: undefined }; }
    a = { ...a, matchId };
    // Com uma lista escolhida, pede à Shopee só a lista; palavra-chave e ordem são aplicadas aqui.
    if ([1, 2, 3, 4, 5].includes(lt) && !a._listRaw) return this.listMode(a, lt);
    return this.smartQuery('productOfferV2', {
      keyword: a.keyword, shopId: num(a.shopId), itemId: num(a.itemId), productCatId: num(a.productCatId),
      listType: num(a.listType), matchId: num(a.matchId), sortType: num(a.sortType),
      isAMSOffer: bool(a.isAMSOffer), isKeySeller: bool(a.isKeySeller),
      page: num(a.page) ?? 1, limit: num(a.limit) ?? 50,
    }, PAGE_INFO_PAGED, { budgetMs: a._budgetMs });
  }

  // Listas da Shopee (Maior comissão, Top performance, categoria, loja) vêm na ordem delas e
  // não combinam com palavra-chave/ordenação: busca a lista pura, depois filtra e ordena aqui.
  async listMode(a, lt) {
    const NAMES = { 1: 'Maior comissão', 2: 'Top performance', 3: 'Categoria', 4: 'Categoria detalhada', 5: 'Loja' };
    const norm = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const words = norm(a.keyword).split(/\s+/).filter((w) => w.length > 1);
    const sort = num(a.sortType) || 1;
    const limit = num(a.limit) ?? 50;
    const startPage = num(a.page) ?? 1;
    const pages = words.length ? 3 : 1; // com palavra-chave, olha mais itens da lista para filtrar
    const base = { ...a, keyword: undefined, sortType: undefined, _listRaw: true, limit: words.length ? 50 : limit };
    let nodes = [], pageInfo = null, last, read = 0;
    for (let i = 0; i < pages; i++) {
      last = await this.productOffers({ ...base, page: startPage + i, _budgetMs: i ? 7000 : a._budgetMs });
      if (last.errors?.length) break;
      const root = last.data?.productOfferV2 || {};
      nodes.push(...(root.nodes || [])); pageInfo = root.pageInfo; read = i + 1;
      if (!root.pageInfo?.hasNextPage) break;
    }
    if (!nodes.length) return last;
    const total = nodes.length;
    if (words.length) nodes = nodes.filter((n) => { const t = norm(n.productName); return words.every((w) => t.includes(w)); });
    const by = {
      2: (x, y) => (+y.sales || 0) - (+x.sales || 0),
      3: (x, y) => (+y.priceMin || 0) - (+x.priceMin || 0),
      4: (x, y) => (+x.priceMin || 0) - (+y.priceMin || 0),
      5: (x, y) => (+y.commissionRate || 0) - (+x.commissionRate || 0) || (+y.commission || 0) - (+x.commission || 0),
    }[sort];
    if (by) nodes.sort(by);
    const notes = [];
    if (words.length) notes.push(`Lista "${NAMES[lt]}": a Shopee monta essa lista sem palavra-chave. Filtrei por "${a.keyword}" nos ${total} primeiros itens da lista e encontrei ${nodes.length}.`);
    if (by) notes.push(`Ordenado aqui por ${({ 2: 'mais vendidos', 3: 'maior preço', 4: 'menor preço', 5: 'maior comissão' })[sort]}. Para ver a ordem original da lista, use Ordenar = Relevância.`);
    const pi = pageInfo ? { ...pageInfo, page: startPage + read - 1, hasNextPage: words.length ? false : pageInfo.hasNextPage } : undefined;
    return { data: { productOfferV2: { nodes, pageInfo: pi } }, diagnostic: notes.length ? notes : undefined };
  }

  // Lojas com comissão. sortType: 1 mais recentes | 2 maior comissão | 3 lojas populares
  // shopType: [1] Mall, [2] Star, [4] Star+ (aceita lista)
  shopOffers(a = {}) {
    return this.smartQuery('shopOfferV2', {
      keyword: a.keyword, shopId: num(a.shopId), shopType: arr(a.shopType),
      isKeySeller: bool(a.isKeySeller), sortType: num(a.sortType), sellerCommCoveRatio: a.sellerCommCoveRatio,
      page: num(a.page) ?? 1, limit: num(a.limit) ?? 50,
    }, PAGE_INFO_PAGED);
  }

  // Campanhas/ofertas da Shopee. sortType: 1 mais recentes | 2 maior comissão
  shopeeOffers(a = {}) {
    return this.smartQuery('shopeeOfferV2', { keyword: a.keyword, sortType: num(a.sortType), page: num(a.page) ?? 1, limit: num(a.limit) ?? 50 }, PAGE_INFO_PAGED);
  }

  // Gera link curto de afiliado (até 5 subIds).
  shortLink({ originUrl, subIds = [] }) {
    const input = gqlValue({ originUrl, subIds: subIds.filter(Boolean).slice(0, 5) });
    return this.raw(`mutation { generateShortLink(input: ${input}) { shortLink } }`);
  }

  // Relatório de conversões (datas em unix segundos). Paginação por scrollId.
  conversionReport(a = {}) {
    return this.smartQuery('conversionReport', {
      purchaseTimeStart: num(a.purchaseTimeStart), purchaseTimeEnd: num(a.purchaseTimeEnd),
      completeTimeStart: num(a.completeTimeStart), completeTimeEnd: num(a.completeTimeEnd),
      shopName: a.shopName, shopId: num(a.shopId), orderId: a.orderId, productName: a.productName,
      productId: num(a.productId), conversionStatus: enumOf(a.conversionStatus), orderStatus: enumOf(a.orderStatus),
      buyerType: enumOf(a.buyerType), attributionType: enumOf(a.attributionType), device: enumOf(a.device),
      fraudStatus: enumOf(a.fraudStatus), limit: num(a.limit) ?? 500, scrollId: a.scrollId,
    }, PAGE_INFO_SCROLL);
  }

  // Relatório validado (precisa do validationId do painel de pagamentos).
  validatedReport(a = {}) {
    return this.smartQuery('validatedReport', { validationId: num(a.validationId), limit: num(a.limit) ?? 500, scrollId: a.scrollId }, PAGE_INFO_SCROLL);
  }

  // Lista os feeds de catálogo (FULL ou DELTA).
  /* ---------- descoberta da estrutura pela própria API (introspecção) ---------- */
  async describeType(name) {
    this._types ||= new Map();
    if (this._types.has(name)) return this._types.get(name);
    const T = 'kind name ofType { kind name ofType { kind name ofType { kind name } } }';
    const r = await this.raw(`{ __type(name: ${JSON.stringify(name)}) { name kind fields { name args { name type { ${T} } } type { ${T} } } enumValues { name } } }`);
    const t = r.data?.__type || null;
    if (t) this._types.set(name, t);
    else if (r.errors?.length) throw new Error('A Shopee não informou a estrutura da API: ' + r.errors[0].message);
    return t;
  }
  // Monta a seleção com todos os campos simples (e objetos até "depth" níveis) de um tipo.
  async selectionFor(typeName, depth = 2) {
    const t = await this.describeType(typeName);
    const unwrap = (x) => { while (x && (x.kind === 'NON_NULL' || x.kind === 'LIST')) x = x.ofType; return x; };
    const parts = [];
    for (const f of t?.fields || []) {
      if ((f.args || []).some((a) => a.type?.kind === 'NON_NULL')) continue; // exige argumento
      const base = unwrap(f.type);
      if (!base) continue;
      if (base.kind === 'SCALAR' || base.kind === 'ENUM') parts.push(f.name);
      else if (base.kind === 'OBJECT' && depth > 0) {
        const sub = await this.selectionFor(base.name, depth - 1);
        if (sub) parts.push(`${f.name} { ${sub} }`);
      }
    }
    return parts.join(' ');
  }
  // Descobre o tipo de retorno e os argumentos de uma consulta raiz (ex.: listItemFeeds).
  async rootField(name) {
    const q = await this.describeType('Query');
    const f = (q?.fields || []).find((x) => x.name === name);
    if (!f) throw new Error(`A consulta ${name} não existe para esta conta.`);
    let t = f.type; while (t && (t.kind === 'NON_NULL' || t.kind === 'LIST')) t = t.ofType;
    return { returnType: t?.name, args: f.args || [] };
  }
  // Primeira lista de objetos dentro da resposta (nodes, items, rows...).
  static firstList(obj) {
    if (!obj || typeof obj !== 'object') return null;
    for (const v of Object.values(obj)) {
      if (Array.isArray(v) && v.some((x) => x && typeof x === 'object')) return v;
    }
    for (const v of Object.values(obj)) { const l = ShopeeAffiliate.firstList(v); if (l) return l; }
    return null;
  }
  async dynamicRoot(name, wanted) {
    try {
      const { returnType, args } = await this.rootField(name);
      const sel = await this.selectionFor(returnType, 2);
      const given = {};
      for (const a of args) {
        if (wanted[a.name] === undefined || wanted[a.name] === '') continue;
        let t = a.type; while (t && (t.kind === 'NON_NULL' || t.kind === 'LIST')) t = t.ofType;
        given[a.name] = t?.kind === 'ENUM' ? enumOf(wanted[a.name]) : (t?.name === 'Int' || t?.name === 'Float' ? num(wanted[a.name]) : wanted[a.name]);
      }
      const missing = args.filter((a) => a.type?.kind === 'NON_NULL' && given[a.name] === undefined).map((a) => a.name);
      if (missing.length) return { errors: [{ message: `Faltam dados obrigatórios: ${missing.join(', ')}` }] };
      const r = await this.raw(`{ ${name}${gqlArgs(given)} { ${sel} } }`);
      const root = r.data?.[name];
      return { ...r, nodes: ShopeeAffiliate.firstList(root) || [], raw: root, argNames: args.map((a) => a.name) };
    } catch (e) {
      return { errors: [{ message: e.message }], nodes: [] };
    }
  }

  // Feeds de catálogo: campos descobertos na própria API.
  listItemFeeds(a = {}) {
    return this.dynamicRoot('listItemFeeds', { feedMode: a.feedMode || 'FULL' });
  }
  getItemFeedData(a = {}) {
    return this.dynamicRoot('getItemFeedData', { datafeedId: a.datafeedId, feedId: a.datafeedId, id: a.datafeedId, offset: a.offset ?? 0, limit: a.limit ?? 200 });
  }

  // Tenta descobrir o schema completo (pode estar bloqueado pela Shopee).
  introspect() {
    return this.raw(`{ __schema { queryType { name } mutationType { name }
      types { name kind description
        fields { name description args { name type { name kind ofType { name kind ofType { name kind } } } }
          type { name kind ofType { name kind ofType { name kind } } } }
        enumValues { name description }
        inputFields { name type { name kind ofType { name kind } } } } } }`);
  }

  /* ---------------------- paginação automática ---------------------- */

  // Percorre várias páginas (page=1,2,3...) até acabar ou chegar em maxPages.
  async allPages(method, args = {}, { maxPages = 10, delayMs = 400 } = {}) {
    const nodes = [];
    const stripped = new Set();
    const diagnostic = new Set();
    let page = num(args.page) ?? 1;
    let last;
    for (let i = 0; i < maxPages; i++) {
      // 1ª página pode insistir mais; as seguintes desistem antes (limite de 60 s do servidor)
      last = await this[method]({ ...args, page, _budgetMs: i === 0 ? 18000 : 7000 });
      (last.stripped || []).forEach((f) => stripped.add(f));
      if (last.errors?.length) {
        if (nodes.length) { diagnostic.add(`Parei na página ${page}: a Shopee não respondeu. Mostrando ${page - 1 === 1 ? 'a primeira página' : `as ${page - 1} primeiras páginas`}.`); last = { ...last, errors: undefined }; }
        else (last.diagnostic || []).forEach((d) => diagnostic.add(d));
        break;
      }
      (last.diagnostic || []).forEach((d) => diagnostic.add(d));
      const root = Object.values(last.data || {})[0] || {};
      nodes.push(...(root.nodes || []));
      if (!root.pageInfo?.hasNextPage) break;
      page++;
      await sleep(delayMs);
    }
    return { nodes, pages: page, stripped: [...stripped], diagnostic: [...diagnostic], errors: last?.errors };
  }

  // Percorre relatórios por scrollId.
  async allScroll(method, args = {}, { maxPages = 20, delayMs = 400 } = {}) {
    const nodes = [];
    const stripped = new Set();
    let scrollId;
    let last;
    let pages = 0;
    for (; pages < maxPages; pages++) {
      last = await this[method]({ ...args, scrollId });
      (last.stripped || []).forEach((f) => stripped.add(f));
      if (last.errors?.length) break;
      const root = Object.values(last.data || {})[0] || {};
      nodes.push(...(root.nodes || []));
      scrollId = root.pageInfo?.scrollId;
      if (!root.pageInfo?.hasNextPage || !scrollId) { pages++; break; }
      await sleep(delayMs);
    }
    return { nodes, pages, stripped: [...stripped], errors: last?.errors };
  }
}

function mapSets(o) { return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, [...v]])); }
function num(v) {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
function bool(v) {
  if (v === undefined || v === null || v === '') return undefined;
  return v === true || v === 'true' || v === 1 || v === '1';
}
function arr(v) {
  if (v === undefined || v === null || v === '') return undefined;
  return (Array.isArray(v) ? v : String(v).split(',')).map(Number).filter(Number.isFinite);
}
function enumOf(v) {
  if (!v) return undefined;
  return { __enum: String(v).toUpperCase().replace(/[^A-Z0-9_]/g, '') };
}
