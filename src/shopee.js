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

  /* ------------------------- consultas prontas ------------------------- */

  // Busca de produtos com comissão.
  // listType: 0 todos | 1 maior comissão | 2 mais vendidos | 3 categoria (landing) | 4 categoria | 5 loja
  // sortType: 1 relevância | 2 mais vendidos | 3 maior preço | 4 menor preço | 5 maior comissão
  productOffers(a = {}) {
    const args = gqlArgs({
      keyword: a.keyword, shopId: num(a.shopId), itemId: num(a.itemId), productCatId: num(a.productCatId),
      listType: num(a.listType), matchId: num(a.matchId), sortType: num(a.sortType),
      isAMSOffer: bool(a.isAMSOffer), isKeySeller: bool(a.isKeySeller),
      page: num(a.page) ?? 1, limit: num(a.limit) ?? 50,
    });
    return this.query(`{ productOfferV2${args} { nodes { ${FIELDS.productOfferV2} } ${PAGE_INFO_PAGED} } }`);
  }

  // Lojas com comissão. sortType: 1 mais recentes | 2 maior comissão | 3 lojas populares
  // shopType: [1] Mall, [2] Star, [4] Star+ (aceita lista)
  shopOffers(a = {}) {
    const args = gqlArgs({
      keyword: a.keyword, shopId: num(a.shopId), shopType: arr(a.shopType),
      isKeySeller: bool(a.isKeySeller), sortType: num(a.sortType), sellerCommCoveRatio: a.sellerCommCoveRatio,
      page: num(a.page) ?? 1, limit: num(a.limit) ?? 50,
    });
    return this.query(`{ shopOfferV2${args} { nodes { ${FIELDS.shopOfferV2} } ${PAGE_INFO_PAGED} } }`);
  }

  // Campanhas/ofertas da Shopee. sortType: 1 mais recentes | 2 maior comissão
  shopeeOffers(a = {}) {
    const args = gqlArgs({ keyword: a.keyword, sortType: num(a.sortType), page: num(a.page) ?? 1, limit: num(a.limit) ?? 50 });
    return this.query(`{ shopeeOfferV2${args} { nodes { ${FIELDS.shopeeOfferV2} } ${PAGE_INFO_PAGED} } }`);
  }

  // Gera link curto de afiliado (até 5 subIds).
  shortLink({ originUrl, subIds = [] }) {
    const input = gqlValue({ originUrl, subIds: subIds.filter(Boolean).slice(0, 5) });
    return this.raw(`mutation { generateShortLink(input: ${input}) { shortLink } }`);
  }

  // Relatório de conversões (datas em unix segundos). Paginação por scrollId.
  conversionReport(a = {}) {
    const args = gqlArgs({
      purchaseTimeStart: num(a.purchaseTimeStart), purchaseTimeEnd: num(a.purchaseTimeEnd),
      completeTimeStart: num(a.completeTimeStart), completeTimeEnd: num(a.completeTimeEnd),
      shopName: a.shopName, shopId: num(a.shopId), orderId: a.orderId, productName: a.productName,
      productId: num(a.productId), conversionStatus: enumOf(a.conversionStatus), orderStatus: enumOf(a.orderStatus),
      buyerType: enumOf(a.buyerType), attributionType: enumOf(a.attributionType), device: enumOf(a.device),
      fraudStatus: enumOf(a.fraudStatus), limit: num(a.limit) ?? 500, scrollId: a.scrollId,
    });
    return this.query(`{ conversionReport${args} { nodes { ${FIELDS.conversionReport} } ${PAGE_INFO_SCROLL} } }`);
  }

  // Relatório validado (precisa do validationId do painel de pagamentos).
  validatedReport(a = {}) {
    const args = gqlArgs({ validationId: num(a.validationId), limit: num(a.limit) ?? 500, scrollId: a.scrollId });
    return this.query(`{ validatedReport${args} { nodes { ${FIELDS.validatedReport} } ${PAGE_INFO_SCROLL} } }`);
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
    let page = num(args.page) ?? 1;
    let last;
    for (let i = 0; i < maxPages; i++) {
      last = await this[method]({ ...args, page });
      (last.stripped || []).forEach((f) => stripped.add(f));
      if (last.errors?.length) break;
      const root = Object.values(last.data || {})[0] || {};
      nodes.push(...(root.nodes || []));
      if (!root.pageInfo?.hasNextPage) break;
      page++;
      await sleep(delayMs);
    }
    return { nodes, pages: page, stripped: [...stripped], errors: last?.errors };
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
