// Dados falsos para testar o painel sem chamar a Shopee (SHOPEE_MOCK=1).
const nomes = ['Fone Bluetooth TWS', 'Garrafa Térmica 1L', 'Luminária LED de Mesa', 'Mini Processador Elétrico',
  'Organizador de Maquiagem', 'Tênis Casual Masculino', 'Smartwatch Esportivo', 'Kit Pincéis Maquiagem',
  'Mop Giratório', 'Capinha iPhone Magsafe', 'Umidificador Aromatizador', 'Ring Light 26cm'];
const lojas = ['Loja Oficial XYZ', 'Casa & Cia', 'TechStore BR', 'Beleza Express', 'Mega Utilidades'];
const r = (a, b) => Math.round((a + Math.random() * (b - a)) * 100) / 100;
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const now = () => Math.floor(Date.now() / 1000);
const img = (i) => `https://picsum.photos/seed/shp${i}/300/300`;

export function mockResponse(query) {
  const limit = Number((query.match(/limit:\s*(\d+)/) || [])[1] || 20);
  const sc = (query.match(/scrollId:\s*"mock-(\d+)"/) || [])[1];
  const page = sc ? Number(sc) + 1 : Number((query.match(/page:\s*(\d+)/) || [])[1] || 1);
  const n = Math.min(limit, 20);
  const pageInfo = { page, limit, hasNextPage: page < 3, scrollId: page < 3 ? 'mock-' + page : null };

  if (query.includes('generateShortLink')) {
    return { data: { generateShortLink: { shortLink: 'https://s.shopee.com.br/MOCK' + Math.random().toString(36).slice(2, 8) } } };
  }
  if (query.includes('productOfferV2')) {
    return { data: { productOfferV2: { pageInfo, nodes: Array.from({ length: n }, (_, i) => {
      const id = page * 100 + i; const p = r(19, 299); const rate = r(0.02, 0.2);
      return { itemId: 2e10 + id, productName: pick(nomes) + ' ' + id, productLink: 'https://shopee.com.br/product/1/' + id,
        offerLink: 'https://s.shopee.com.br/mock' + id, imageUrl: img(id), priceMin: String(p), priceMax: String(r(p, p * 1.4)),
        priceDiscountRate: Math.floor(r(0, 60)), sales: Math.floor(r(10, 50000)), ratingStar: String(r(3.8, 5)),
        commissionRate: String(rate), sellerCommissionRate: String(r(0, rate)), shopeeCommissionRate: String(r(0, 0.05)),
        commission: String((p * rate).toFixed(2)), shopId: 1000 + (id % 5), shopName: pick(lojas), shopType: [1],
        productCatIds: [100001, 100010, 100100 + (id % 7)], periodStartTime: now() - 86400, periodEndTime: now() + 86400 * 30 };
    }) } } };
  }
  if (query.includes('shopOfferV2')) {
    return { data: { shopOfferV2: { pageInfo, nodes: Array.from({ length: n }, (_, i) => ({
      shopId: 5000 + i, shopName: pick(lojas) + ' ' + i, shopType: [pick([1, 2, 4])], imageUrl: img('s' + i),
      ratingStar: String(r(4, 5)), commissionRate: String(r(0.03, 0.25)), sellerCommCoveRatio: String(r(0.2, 1)),
      remainingBudget: Math.floor(r(0, 3)), offerLink: 'https://s.shopee.com.br/shop' + i, originalLink: 'https://shopee.com.br/shop/' + i,
      periodStartTime: now() - 86400, periodEndTime: now() + 86400 * 20, bannerInfo: { count: 1, banners: [{ fileName: 'b.jpg', imageUrl: img('b' + i), imageSize: 1000, imageWidth: 800, imageHeight: 400 }] },
    })) } } };
  }
  if (query.includes('shopeeOfferV2')) {
    return { data: { shopeeOfferV2: { pageInfo, nodes: Array.from({ length: n }, (_, i) => ({
      offerName: pick(['11.11 Super Liquidação', 'Frete Grátis', 'Beleza em Oferta', 'Casa Mais Barata']) + ' ' + i,
      offerType: pick([1, 2]), imageUrl: img('o' + i), commissionRate: String(r(0.02, 0.15)),
      offerLink: 'https://s.shopee.com.br/off' + i, originalLink: 'https://shopee.com.br/m/' + i,
      categoryId: 100000 + i, collectionId: 9000 + i, periodStartTime: now() - 86400, periodEndTime: now() + 86400 * 10,
    })) } } };
  }
  if (query.includes('conversionReport') || query.includes('validatedReport')) {
    const root = query.includes('conversionReport') ? 'conversionReport' : 'validatedReport';
    return { data: { [root]: { pageInfo, nodes: Array.from({ length: n }, (_, i) => {
      const price = r(20, 200); const com = r(1, 25);
      return { purchaseTime: now() - Math.floor(r(0, 30 * 86400)), clickTime: now() - Math.floor(r(0, 31 * 86400)),
        conversionId: 7e9 + i, checkoutId: 8e9 + i, grossCommission: String(com), cappedCommission: String(com),
        totalBrandCommission: '0', estimatedTotalCommission: String(com), shopeeCommissionCapped: String(com / 2),
        sellerCommission: String(com / 2), totalCommission: String(com), netCommission: String(com * 0.9),
        buyerType: pick(['NEW', 'EXISTING']), utmContent: pick(['video01-tiktok', 'video02-reels', 'bio']), device: pick(['APP', 'WEB']), referrer: 'tiktok.com',
        orders: [{ orderId: 'MOCK' + i, orderStatus: pick(['PENDING', 'COMPLETED', 'CANCELLED']), shopType: 'MALL',
          items: [{ shopId: 1000, shopName: pick(lojas), completeTime: now(), itemId: 2e10 + i, itemName: pick(nomes), itemPrice: String(price),
            actualAmount: String(price), refundAmount: '0', qty: 1, imageUrl: img('c' + i), itemTotalCommission: String(com),
            itemSellerCommission: String(com / 2), itemShopeeCommissionCapped: String(com / 2), displayItemStatus: 'Pendente',
            fraudStatus: 'UNVERIFIED', attributionType: pick(['ORDERED_IN_SAME_SHOP', 'ORDERED_IN_DIFFERENT_SHOP']), channelType: 'Social' }] }] };
    }) } } };
  }
  if (query.includes('listItemFeeds')) {
    return { data: { listItemFeeds: { nodes: [{ datafeedId: 'feed-1', datafeedName: 'Catálogo completo', description: 'Mock', date: '2026-11-14', feedMode: 'FULL', totalCount: 120000 }] } } };
  }
  if (query.includes('getItemFeedData')) {
    return { data: { getItemFeedData: { rows: Array.from({ length: n }, (_, i) => ({ columns: JSON.stringify({ itemId: i, title: pick(nomes), price: r(10, 99) }) })) } } };
  }
  if (query.includes('__schema')) return { errors: [{ message: 'Introspecção indisponível no modo de teste' }] };
  return { errors: [{ message: 'Consulta não suportada no modo de teste' }] };
}
