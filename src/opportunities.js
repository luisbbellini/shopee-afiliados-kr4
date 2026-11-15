// Oportunidades: produtos que vendem bem mas provavelmente têm pouca concorrência de afiliados.
// A API da Shopee NÃO informa quantos afiliados divulgam um produto; a nota é uma estimativa
// feita com sinais indiretos (vendas, nota, comissão, ausência nas listas de destaque, oferta nova).

const DAY = 86400;
const radarCache = new Map(); // listas de destaque mudam pouco: guarda 30 min por credencial
const RADAR_MS = 30 * 60 * 1000;

// Itens que a Shopee mostra em destaque para todos os afiliados (mais disputados).
async function radar(client, key, pages) {
  const hit = radarCache.get(key);
  if (hit && Date.now() - hit.t < RADAR_MS) return hit.v;
  const lists = { top: new Set(), commission: new Set() };
  const notes = [];
  for (const [name, listType] of [['top', 2], ['commission', 1]]) {
    const r = await client.allPages('productOffers', { listType, limit: 50 }, { maxPages: pages, delayMs: 300 });
    if (r.errors?.length) notes.push(`Não consegui ler a lista "${name === 'top' ? 'Top performance' : 'Maior comissão'}": ${r.errors[0].message}`);
    for (const n of r.nodes || []) lists[name].add(String(n.itemId));
  }
  const v = { ...lists, notes };
  if (!notes.length) radarCache.set(key, { t: Date.now(), v });
  return v;
}

const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const n = (v) => (v === undefined || v === null || v === '' || isNaN(+v) ? 0 : +v);

export async function findOpportunities(client, key, b = {}) {
  const pages = Math.min(Math.max(Number(b.pages) || 3, 1), 6);
  const minSales = n(b.minSales);
  const minRating = n(b.minRating);
  const minRate = n(b.minCommission) / 100;

  // 1) candidatos: os mais vendidos da busca
  const args = { keyword: b.keyword, productCatId: b.productCatId, sortType: 2, limit: 50 };
  const cand = await client.allPages('productOffers', args, { maxPages: pages, delayMs: 300 });
  if (!cand.nodes?.length) return { nodes: [], errors: cand.errors, diagnostic: cand.diagnostic };

  // 2) listas de destaque
  const rd = await radar(client, key, Math.min(pages, 3));

  // 3) nota
  const now = Math.floor(Date.now() / 1000);
  const uniq = new Map(cand.nodes.map((x) => [String(x.itemId), x]));
  const items = [...uniq.values()];
  const maxLogSales = Math.max(...items.map((x) => Math.log10(n(x.sales) + 1)), 1);
  const maxLogCom = Math.max(...items.map((x) => Math.log10(n(x.commission) + 1)), 1);

  const scored = items.map((x) => {
    const id = String(x.itemId);
    const sales = n(x.sales), rating = n(x.ratingStar), rate = n(x.commissionRate), com = n(x.commission);
    const inTop = rd.top.has(id), inCom = rd.commission.has(id);
    const ageDays = n(x.periodStartTime) ? (now - n(x.periodStartTime)) / DAY : null;
    const seller = n(x.sellerCommissionRate);

    const p = {
      vendas: 30 * Math.log10(sales + 1) / maxLogSales,
      nota: rating ? 10 * clamp((rating - 4) / 1) : 0,
      comissao: 15 * clamp(rate / 0.2) + 10 * Math.log10(com + 1) / maxLogCom,
      foraDoRadar: inTop && inCom ? 0 : inTop || inCom ? 8 : 20,
      ofertaNova: ageDays !== null && ageDays >= 0 ? 10 * clamp(1 - ageDays / 21) : 0,
      vendedorPagaExtra: seller > 0 ? 5 : 0,
    };
    const score = Math.round(Object.values(p).reduce((a, v) => a + v, 0));

    const why = [];
    if (sales >= 1000) why.push(`Vende muito (${sales.toLocaleString('pt-BR')})`);
    else if (sales >= 100) why.push(`Vende bem (${sales.toLocaleString('pt-BR')})`);
    if (rating >= 4.7) why.push(`Nota ${rating.toFixed(1)}`);
    if (!inTop && !inCom) why.push('Fora das listas de destaque');
    else why.push(inTop ? 'Está no Top performance (mais disputado)' : 'Está em Maior comissão (mais disputado)');
    if (ageDays !== null && ageDays <= 14) why.push(ageDays < 1 ? 'Oferta começou hoje' : `Oferta nova (${Math.floor(ageDays)} dia${Math.floor(ageDays) === 1 ? '' : 's'})`);
    if (seller > 0) why.push(`Vendedor paga extra (${(seller * 100).toFixed(1).replace('.0', '')}%)`);
    if (rate >= 0.12) why.push(`Comissão alta (${(rate * 100).toFixed(0)}%)`);

    return { ...x, score, parts: Object.fromEntries(Object.entries(p).map(([k, v]) => [k, Math.round(v)])), why, inTop, inCommissionList: inCom, offerAgeDays: ageDays === null ? null : Math.floor(ageDays) };
  });

  const filtered = scored
    .filter((x) => n(x.sales) >= minSales && (!minRating || n(x.ratingStar) >= minRating) && n(x.commissionRate) >= minRate)
    .sort((a, b2) => b2.score - a.score);

  return {
    nodes: filtered,
    all: scored, // usado para o histórico diário (removido antes de responder ao painel)
    analyzed: items.length,
    radarSize: { top: rd.top.size, commission: rd.commission.size },
    diagnostic: [...(cand.diagnostic || []), ...rd.notes],
    errors: cand.errors,
  };
}
