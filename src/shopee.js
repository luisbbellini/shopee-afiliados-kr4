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
export const learned = { badFields: {}, badArgs: {}, maxLimit: {} };

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ----------------------------- cliente ---------------------------- */

export class ShopeeAffiliate {
  constructor({ appId, secret, endpoint = ENDPOINT_BR, timeoutMs = 30000, autoStrip = true } = {}) {
    if (!appId || !secret) throw new Error('Defina SHOPEE_APP_ID e SHOPEE_SECRET no arquivo .env');
    this.appId = String(appId);
    this.secret = String(secret);
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
  async query(query, { maxStrips = 25 } = {}) {
    const stripped = [];
    let q = query;
    for (let attempt = 0; attempt <= maxStrips; attempt++) {
      const json = await this.raw(q);
      const errs = json.errors || [];
      if (!errs.length || !this.autoStrip) return { ...json, stripped, query: q };
      const bad = new Set();
      for (const e of errs) {
        const msg = `${e.message || ''} ${e.extensions?.message || ''}`;
        for (const m of msg.matchAll(/Cannot query field\s+"([A-Za-z0-9_]+)"/gi)) bad.add(m[1]);
        for (const m of msg.matchAll(/field\s+"?([A-Za-z0-9_]+)"?\s+(?:is not defined|not found|does not exist)/gi)) bad.add(m[1]);
      }
      const removable = [...bad].filter((f) => !stripped.includes(f));
      if (!removable.length) return { ...json, stripped, query: q };
      for (const f of removable) { q = removeField(q, f); stripped.push(f); }
    }
    return { errors: [{ message: 'Campos demais rejeitados pela API' }], stripped, query: q };
  }

  /* ---------- consulta resiliente: se der "System Error", descobre o culpado ---------- */
  async smartQuery(root, argObj, pageInfo = '') {
    const badF = (learned.badFields[root] ||= new Set());
    const badA = (learned.badArgs[root] ||= new Set());
    const clean = (a) => Object.fromEntries(Object.entries(a).filter(([k, v]) => !badA.has(k) && v !== undefined && v !== null && v !== ''));
    let a = clean(argObj);
    if (learned.maxLimit[root] && a.limit > learned.maxLimit[root]) a.limit = learned.maxLimit[root];
    const full = topLevel(FIELDS[root]).filter((f) => !badF.has(fieldName(f)));
    const build = (fields, args, pi = pageInfo) => `{ ${root}${gqlArgs(args)} { nodes { ${fields.join(' ')} } ${pi} } }`;
    const notes = [];

    let r = await this.query(build(full, a));
    if (!isSystemError(r)) return r;
    const original = r;

    // 1) limite menor
    if ((a.limit ?? 0) > 20) {
      const r2 = await this.query(build(full, { ...a, limit: 20 }));
      if (!r2.errors?.length) { learned.maxLimit[root] = 20; return { ...r2, diagnostic: [`A Shopee recusou limit=${a.limit}; usei 20 por página.`] }; }
    }
    // 2) só os campos essenciais
    const core = topLevel(CORE[root] || FIELDS[root]);
    const coreNames = new Set(core.map(fieldName));
    const rCore = await this.query(build(core, { ...a, limit: 1 }));
    if (!rCore.errors?.length) {
      // algum campo extra é o culpado: testa um por um
      for (const f of full.filter((f) => !coreNames.has(fieldName(f)))) {
        const t = await this.query(build([...core, f], { ...a, limit: 1 }));
        if (t.errors?.length) badF.add(fieldName(f));
        await sleep(150);
      }
      if (badF.size) notes.push('Campos que causam erro na Shopee e foram removidos: ' + [...badF].join(', '));
    } else {
      // 3) os argumentos: testa a consulta mínima e vai acrescentando um por um
      const base = { limit: 1 };
      if (a.keyword) base.keyword = a.keyword;
      let rBase = await this.query(build(core, base));
      if (rBase.errors?.length && base.keyword) { delete base.keyword; rBase = await this.query(build(core, base)); }
      if (rBase.errors?.length) {
        // sem pageInfo?
        const rNoPI = await this.query(build(core, base, ''));
        if (!rNoPI.errors?.length) { notes.push('A Shopee recusou o bloco pageInfo; consultando sem paginação.'); pageInfo = ''; }
        else return { ...original, diagnostic: ['Até a consulta mínima falhou: o problema é na conta/credencial ou fora do ar na Shopee.', 'Erro: ' + (rNoPI.errors?.[0]?.message || '')] };
      }
      for (const k of Object.keys(a).filter((k) => !(k in base) && k !== 'limit')) {
        const t = await this.query(build(core, { ...base, [k]: a[k] }, pageInfo));
        if (t.errors?.length) badA.add(k);
        await sleep(150);
      }
      if (badA.size) notes.push('Filtros que a Shopee recusou e foram ignorados: ' + [...badA].join(', '));
    }
    a = clean(argObj);
    if (learned.maxLimit[root] && a.limit > learned.maxLimit[root]) a.limit = learned.maxLimit[root];
    const fields = topLevel(FIELDS[root]).filter((f) => !badF.has(fieldName(f)));
    let rFinal = await this.query(build(fields, a, pageInfo));
    if (isSystemError(rFinal) && (a.limit ?? 0) > 20) {
      rFinal = await this.query(build(fields, { ...a, limit: 20 }, pageInfo));
      if (!rFinal.errors?.length) { learned.maxLimit[root] = 20; notes.push('Limite por página reduzido para 20.'); }
    }
    return { ...rFinal, diagnostic: notes.length ? notes : ['Não consegui isolar a causa do erro.'] };
  }

  // Bateria de testes para descobrir o que a conta aceita.
  async diagnose(keyword = 'garrafa') {
    const tests = [];
    const run = async (name, q) => {
      const t0 = Date.now(); const r = await this.raw(q);
      tests.push({ name, ok: !r.errors?.length, ms: Date.now() - t0, error: r.errors?.map((e) => e.message + (e.extensions?.code ? ` [${e.extensions.code}]` : '')).join(' · ') || '' });
      await sleep(200);
    };
    const kw = JSON.stringify(keyword);
    await run('Mínima (itemId, productName)', `{ productOfferV2(keyword: ${kw}, limit: 1) { nodes { itemId productName } } }`);
    await run('Com pageInfo', `{ productOfferV2(keyword: ${kw}, limit: 1) { nodes { itemId } pageInfo { page limit hasNextPage } } }`);
    await run('Sem palavra-chave', `{ productOfferV2(limit: 1) { nodes { itemId } } }`);
    await run('limit 20', `{ productOfferV2(keyword: ${kw}, limit: 20) { nodes { itemId } } }`);
    await run('limit 50', `{ productOfferV2(keyword: ${kw}, limit: 50) { nodes { itemId } } }`);
    for (const st of [1, 2, 5]) await run(`sortType ${st}`, `{ productOfferV2(keyword: ${kw}, sortType: ${st}, limit: 1) { nodes { itemId } } }`);
    await run('page 2', `{ productOfferV2(keyword: ${kw}, page: 2, limit: 1) { nodes { itemId } } }`);
    for (const f of topLevel(FIELDS.productOfferV2)) await run('campo ' + fieldName(f), `{ productOfferV2(keyword: ${kw}, limit: 1) { nodes { itemId ${f} } } }`);
    await run('Lojas (shopOfferV2)', `{ shopOfferV2(limit: 1) { nodes { shopId shopName } } }`);
    await run('Campanhas (shopeeOfferV2)', `{ shopeeOfferV2(limit: 1) { nodes { offerName } } }`);
    const now = Math.floor(Date.now() / 1000);
    await run('Conversões 7 dias', `{ conversionReport(purchaseTimeStart: ${now - 7 * 86400}, purchaseTimeEnd: ${now}, limit: 1) { nodes { conversionId } } }`);
    return { tests, learned: { badFields: mapSets(learned.badFields), badArgs: mapSets(learned.badArgs), maxLimit: learned.maxLimit } };
  }

  /* ------------------------- consultas prontas ------------------------- */

  // Busca de produtos com comissão.
  // listType: 0 todos | 1 maior comissão | 2 mais vendidos | 3 categoria (landing) | 4 categoria | 5 loja
  // sortType: 1 relevância | 2 mais vendidos | 3 maior preço | 4 menor preço | 5 maior comissão
  productOffers(a = {}) {
    return this.smartQuery('productOfferV2', {
      keyword: a.keyword, shopId: num(a.shopId), itemId: num(a.itemId), productCatId: num(a.productCatId),
      listType: num(a.listType), matchId: num(a.matchId), sortType: num(a.sortType),
      isAMSOffer: bool(a.isAMSOffer), isKeySeller: bool(a.isKeySeller),
      page: num(a.page) ?? 1, limit: num(a.limit) ?? 50,
    }, PAGE_INFO_PAGED);
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
  listItemFeeds(a = {}) {
    const args = gqlArgs({ feedMode: enumOf(a.feedMode || 'FULL') });
    return this.query(`{ listItemFeeds${args} { nodes { ${FIELDS.listItemFeeds} } } }`);
  }

  getItemFeedData(a = {}) {
    const args = gqlArgs({ datafeedId: a.datafeedId, offset: num(a.offset) ?? 0, limit: num(a.limit) ?? 500 });
    return this.query(`{ getItemFeedData${args} { rows { columns } } }`);
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
      last = await this[method]({ ...args, page });
      (last.stripped || []).forEach((f) => stripped.add(f));
      (last.diagnostic || []).forEach((d) => diagnostic.add(d));
      if (last.errors?.length) break;
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
