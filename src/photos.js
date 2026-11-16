// Todas as fotos e cores (variações) de um produto.
// A API de afiliados só devolve a foto principal; as demais vêm da página pública do produto.
// Uma consulta por clique, sem login. Se a Shopee bloquear, devolve só a foto principal com um aviso.

const IMG = (hash) => (/^https?:/.test(hash) ? hash : `https://down-br.img.susercontent.com/file/${hash}`);

export function parseIds({ itemId, shopId, productLink, offerLink } = {}) {
  let item = itemId ? String(itemId) : '', shop = shopId ? String(shopId) : '';
  for (const link of [productLink, offerLink]) {
    if (!link || (item && shop)) continue;
    const m = String(link).match(/-i\.(\d+)\.(\d+)/) || String(link).match(/\/product\/(\d+)\/(\d+)/);
    if (m) { shop = shop || m[1]; item = item || m[2]; }
  }
  return { itemId: item, shopId: shop };
}

// Converte a resposta da Shopee (vários formatos possíveis) em fotos
export function extractPhotos(json) {
  const it = json?.data?.item || json?.item || json?.data || {};
  const photos = []; const seen = new Set();
  const add = (hash, label, group) => {
    if (!hash) return; const url = IMG(hash); if (seen.has(url)) return;
    seen.add(url); photos.push({ url, label, group });
  };
  const tiers = it.tier_variations || it.tierVariations || [];
  const colors = [];
  for (const t of tiers) {
    const opts = t.options || [];
    const imgs = t.images || [];
    if (!imgs.some(Boolean)) continue;
    opts.forEach((o, i) => { if (imgs[i]) { add(imgs[i], o, 'cor'); colors.push(o); } });
  }
  (it.images || []).forEach((h, i) => add(h, `Foto ${i + 1}`, 'foto'));
  if (it.image && !photos.length) add(it.image, 'Foto principal', 'foto');
  const tierInfo = tiers.map((t) => ({ name: t.name || '', options: t.options || [] })).filter((t) => t.options.length);
  return { photos, colors, tiers: tierInfo, name: it.name || it.title || '' };
}

const HEADERS = {
  'user-agent': 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36',
  accept: 'application/json', 'accept-language': 'pt-BR,pt;q=0.9', 'x-api-source': 'pc', 'x-shopee-language': 'pt-BR', 'x-requested-with': 'XMLHttpRequest',
};

async function tryJson(url, referer) {
  const r = await fetch(url, { headers: { ...HEADERS, referer }, signal: AbortSignal.timeout(7000) });
  const text = await r.text();
  let j; try { j = JSON.parse(text); } catch { throw new Error(`HTTP ${r.status} (resposta não é JSON: ${text.slice(0, 60).replace(/\s+/g, ' ')})`); }
  if (!r.ok || (j.error && j.error !== 0)) throw new Error(`HTTP ${r.status}${j.error ? ' erro ' + j.error : ''}`);
  return j;
}

export async function productPhotos(body = {}, { mock = false } = {}) {
  const { itemId, shopId } = parseIds(body);
  const main = body.imageUrl ? [{ url: body.imageUrl, label: 'Foto principal', group: 'foto' }] : [];
  if (mock) {
    const cores = ['Preto', 'Branco', 'Rosa', 'Azul marinho', 'Verde'];
    return {
      photos: [...cores.map((c, i) => ({ url: `https://picsum.photos/seed/${itemId || 'x'}c${i}/600/600`, label: c, group: 'cor' })),
        ...[1, 2, 3].map((i) => ({ url: `https://picsum.photos/seed/${itemId || 'x'}f${i}/600/600`, label: `Foto ${i}`, group: 'foto' }))],
      colors: cores, tiers: [{ name: 'Cor', options: cores }, { name: 'Tamanho', options: ['P', 'M', 'G', 'GG'] }], source: 'mock',
    };
  }
  if (!itemId || !shopId) return { photos: main, colors: [], tiers: [], blocked: true, note: 'Não deu para identificar a loja e o produto no link. Mostrando só a foto principal.' };
  const referer = `https://shopee.com.br/product/${shopId}/${itemId}`;
  const tries = [
    `https://shopee.com.br/api/v4/pdp/get_pc?item_id=${itemId}&shop_id=${shopId}&tz_offset_minutes=-180&detail_level=0`,
    `https://shopee.com.br/api/v4/item/get?itemid=${itemId}&shopid=${shopId}`,
    `https://shopee.com.br/api/v2/item/get?itemid=${itemId}&shopid=${shopId}`,
  ];
  // as três tentativas em paralelo: responde em poucos segundos mesmo se a Shopee bloquear
  const errors = [];
  const t0 = Date.now();
  const deadline = (ms) => new Promise((_, rej) => setTimeout(() => rej(new Error('tempo esgotado')), ms));
  const results = await Promise.allSettled(tries.map(async (url) => Promise.race([deadline(9000), (async () => {
    const r = extractPhotos(await tryJson(url, referer));
    if (!r.photos.length) throw new Error('sem fotos na resposta');
    return r;
  })()])));
  const best = results.filter((x) => x.status === 'fulfilled').map((x) => x.value).sort((a, b) => b.photos.length - a.photos.length)[0];
  results.forEach((x) => x.status === 'rejected' && errors.push(x.reason?.message || String(x.reason)));
  console.log('[fotos]', JSON.stringify({ itemId, shopId, ms: Date.now() - t0, ok: results.map((x) => x.status === 'fulfilled' ? x.value.photos.length : 0), errors }));
  if (best) {
    if (main.length && !best.photos.some((p) => p.url === main[0].url)) best.photos.push(main[0]);
    return { ...best, source: 'shopee' };
  }
  return {
    photos: main, colors: [], tiers: [], blocked: true, shopeeErrors: errors,
    note: errors.some((e) => /90309999/.test(e))
      ? 'A Shopee bloqueia a busca automática das outras fotos (proteção contra robôs). Mostrando só a foto principal. Salve as fotos das cores pelo app da Shopee e toque em "Importar fotos do celular".'
      : 'A Shopee não liberou as outras fotos agora. Mostrando só a foto principal. Salve as fotos das cores pelo app da Shopee e toque em "Importar fotos do celular".',
  };
}
