/* Analisador de anúncios: métricas do Gerenciador de Anúncios da Meta (Facebook/Instagram)
   cruzadas com as vendas e a comissão da Shopee, para ver quais vídeos/anúncios dão lucro. */

const AD = { period: '30', sort: 'profit', data: null, sales: null, ai: null, loadedKey: '' };
const AD_PERIODS = [['7', '7 dias'], ['14', '14 dias'], ['30', '30 dias'], ['90', '90 dias']];
const AD_SORTS = { profit: 'Lucro', roas: 'Retorno (ROAS)', commission: 'Comissão', spend: 'Gasto', linkClicks: 'Cliques no link', ctrL: 'Taxa de cliques', plays: 'Visualizações', hold: 'Assistiram até o fim' };
const AD_STATUS = { ACTIVE: 'Ativo', PAUSED: 'Pausado', CAMPAIGN_PAUSED: 'Campanha pausada', ADSET_PAUSED: 'Conjunto pausado', ARCHIVED: 'Arquivado', DELETED: 'Excluído', DISAPPROVED: 'Reprovado', PENDING_REVIEW: 'Em análise', WITH_ISSUES: 'Com problemas', IN_PROCESS: 'Processando' };
const pctAd = (x) => (isFinite(x) && x > 0 ? (x * 100).toFixed(x < 0.1 ? 2 : 1).replace('.', ',') + '%' : '—');
const roasTxt = (x) => (isFinite(x) && x > 0 ? x.toFixed(2).replace('.', ',') + 'x' : '—');
const adMapGet = () => { try { return JSON.parse(lsGet('adMap') || '{}'); } catch { return {}; } };
const metaConfigured = () => !!(lsGet('metaToken') && lsGet('metaAccount')) || !!window._metaServer;

/* ---------------- ligação anúncio → venda da Shopee ---------------- */
function adMatch(ad, sales) {
  const manual = adMapGet()[ad.adId];
  if (manual) return manual.startsWith('item:') ? { itemId: manual.slice(5), how: 'escolhido por você' } : { subId: manual, how: 'escolhido por você' };
  for (const x of FAV.values()) {
    if (x.shortLink && ad.links.some((l) => l.replace(/\/$/, '') === x.shortLink.replace(/\/$/, ''))) return x.subId ? { subId: x.subId, how: 'link do anúncio' } : { itemId: String(x.itemId), how: 'link do anúncio' };
  }
  for (const l of ad.links) { const m = l.match(/-i\.\d+\.(\d+)/) || l.match(/\/product\/\d+\/(\d+)/); if (m) return { itemId: m[1], how: 'link do anúncio' }; }
  const name = `${ad.adName} ${ad.adset} ${ad.campaign} ${ad.urlTags}`.toLowerCase();
  const subs = [...new Set(sales.map((s) => s.utmContent).filter(Boolean))].sort((a, b) => b.length - a.length);
  const sub = subs.find((u) => u.length >= 3 && name.includes(u.toLowerCase()));
  if (sub) return { subId: sub, how: 'nome do anúncio' };
  return null;
}
function adAttribute(ads, sales) {
  const rows = ads.map((a) => ({ ...a, match: adMatch(a, sales), orders: 0, commission: 0, gmv: 0, estimated: false }));
  const bySub = new Map(); const byItem = new Map();
  for (const r of rows) {
    if (r.match?.subId) { if (!bySub.has(r.match.subId)) bySub.set(r.match.subId, []); bySub.get(r.match.subId).push(r); }
    else if (r.match?.itemId) { if (!byItem.has(r.match.itemId)) byItem.set(r.match.itemId, []); byItem.get(r.match.itemId).push(r); }
  }
  // anúncios com o mesmo subId/produto dividem a venda pela proporção de cliques no link
  const give = (list, s, est) => {
    const tot = list.reduce((t, r) => t + (r.linkClicks || 0), 0);
    for (const r of list) { const k = tot ? (r.linkClicks || 0) / tot : 1 / list.length; r.orders += k; r.commission += k * (+s.itemTotalCommission || 0); r.gmv += k * (+s.actualAmount || 0); if (est || list.length > 1) r.estimated = true; }
  };
  let matched = 0;
  for (const s of sales) {
    if (s.utmContent && bySub.has(s.utmContent)) { give(bySub.get(s.utmContent), s, false); matched++; continue; }
    if (!s.utmContent && byItem.has(String(s.itemId))) { give(byItem.get(String(s.itemId)), s, true); matched++; }
  }
  for (const r of rows) {
    r.profit = r.commission - r.spend; r.roas = r.spend ? r.commission / r.spend : 0;
    r.ctrL = r.impressions ? r.linkClicks / r.impressions : 0; r.cpcL = r.linkClicks ? r.spend / r.linkClicks : 0;
    r.hold = r.plays ? (r.p100 || r.thruplays) / r.plays : 0; r.cpo = r.orders >= 0.5 ? r.spend / r.orders : 0;
  }
  return { rows, matched };
}

/* ---------------- tela ---------------- */
const ymdSP = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d);
async function loadAds(force) {
  const days = +AD.period; const key = AD.period + (lsGet('metaAccount') || '');
  if (!force && AD.data && AD.loadedKey === key) return;
  const since = ymdSP(new Date(Date.now() - (days - 1) * 86400000)), until = ymdSP(new Date());
  const [meta, conv] = await Promise.all([
    api('meta/insights', { since, until }),
    api('conversions', { purchaseTimeStart: Math.floor(new Date(since + 'T00:00:00-03:00') / 1000), purchaseTimeEnd: Math.floor(Date.now() / 1000), allPages: true, maxPages: 40 }),
  ]);
  if (meta.errors) throw new Error(meta.errors[0].message);
  AD.data = meta; AD.sales = conv.errors ? [] : reportItems(conv.nodes || []); AD.salesErr = conv.errors?.[0]?.message || ''; AD.loadedKey = key; AD.ai = null;
}
function adSetupHtml() {
  return `<div class="panelbox"><h3>Conecte o Gerenciador de Anúncios da Meta</h3>
    <p class="meta" style="display:block">Precisa de um <b>token de acesso</b> com a permissão <b>ads_read</b>. É só leitura: o painel nunca altera os anúncios.</p>
    <ol class="meta" style="display:block;padding-left:18px">
      <li>Gere o token seguindo o <b>Manual → 13. Anúncios da Meta</b>.</li>
      <li>Toque em <b>⚙ Configurações</b>, cole o token em <b>Anúncios da Meta</b> e toque em <b>Conectar</b>.</li>
      <li>Escolha a conta de anúncios dela e salve.</li>
    </ol>
    <button class="b p" onclick="openCreds()">Abrir Configurações</button></div>`;
}
async function renderVideos(force) {
  const out = $('#videos .out');
  if (!metaConfigured()) { out.innerHTML = adSetupHtml(); return; }
  const head = `<div class="bar">
      <div class="f"><label>Período</label><select onchange="AD.period=this.value;renderVideos()">${AD_PERIODS.map(([k, l]) => `<option value="${k}" ${AD.period === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="f"><label>Ordenar por</label><select onchange="AD.sort=this.value;drawAds()">${Object.entries(AD_SORTS).map(([k, l]) => `<option value="${k}" ${AD.sort === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <button class="b sm" style="align-self:flex-end" onclick="renderVideos(true)">Atualizar</button></div>`;
  out.innerHTML = head + '<div class="note">Buscando os anúncios na Meta e as vendas na Shopee…</div>';
  try { await loadAds(force); } catch (e) { out.innerHTML = head + `<div class="note err">${esc(e.message)}</div>`; return; }
  out.innerHTML = head + '<div id="adBody"></div>';
  drawAds();
}
function drawAds() {
  const body = $('#adBody'); if (!body || !AD.data) return;
  const sales = AD.sales || [];
  const { rows: all, matched } = adAttribute((AD.data.ads || []).filter((a) => a.spend > 0 || a.impressions > 0), sales);
  const k = AD.sort; const rows = [...all].sort((a, b) => (b[k] || 0) - (a[k] || 0) || b.spend - a.spend);
  const sum = (f) => rows.reduce((s, r) => s + (r[f] || 0), 0);
  const spend = sum('spend'), com = sum('commission'), orders = sum('orders'), clicks = sum('linkClicks'), imp = sum('impressions');
  const unmatched = rows.filter((r) => !r.match).length;
  const allCom = sales.reduce((s, x) => s + (+x.itemTotalCommission || 0), 0);
  const subOpts = [...new Set([...sales.map((s) => s.utmContent).filter(Boolean), ...[...FAV.values()].map((x) => x.subId).filter(Boolean)])];
  const favOpts = [...FAV.values()];
  const card = (r, i) => {
    const tag = !r.match ? '<span class="adtag gray">Sem ligação com a Shopee</span>' : r.profit > 0 ? '<span class="adtag ok">Dando lucro</span>' : r.commission > 0 ? '<span class="adtag warn">Vende, mas no prejuízo</span>' : '<span class="adtag err">Sem vendas</span>';
    const sel = `<select aria-label="Ligar anúncio às vendas" onchange="adLink('${esc(r.adId)}',this.value)" style="width:100%;min-width:0;margin-top:6px"><option value="">${r.match ? `Ligado por ${esc(r.match.how)}${r.match.subId ? ' · subId ' + esc(r.match.subId) : ''} (trocar…)` : 'Ligar a um subId ou produto…'}</option>
      ${subOpts.length ? `<optgroup label="subId">${subOpts.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join('')}</optgroup>` : ''}
      ${favOpts.length ? `<optgroup label="Produto (Para gravar)">${favOpts.map((x) => `<option value="item:${esc(x.itemId)}">${esc((x.productName || '').slice(0, 50))}</option>`).join('')}</optgroup>` : ''}
      ${r.match?.how === 'escolhido por você' ? '<option value="-">Desfazer ligação</option>' : ''}</select>`;
    return `<div class="vdcard">
      ${r.thumb ? `<img loading="lazy" src="${esc(r.thumb)}" alt="">` : '<div class="adnothumb"></div>'}
      <div class="fc">
        <div class="t"><span class="rank">${i + 1}º</span> ${esc(r.adName)}</div>
        <div class="meta">${esc(r.campaign)} · ${AD_STATUS[r.status] || esc(r.status || '')}</div>
        <div>${tag}</div>
        <div class="vdstats">
          <span><b>${brl(r.spend)}</b>gasto</span>
          <span><b>${r.commission ? brl(r.commission) : '—'}</b>comissão${r.estimated ? '*' : ''}</span>
          <span><b class="${r.profit >= 0 ? 'pos' : 'neg'}">${r.match ? brl(r.profit) : '—'}</b>lucro</span>
          <span><b>${roasTxt(r.roas)}</b>retorno</span>
          <span><b>${r.orders ? r.orders.toFixed(r.orders % 1 ? 1 : 0).replace('.', ',') : '—'}</b>pedidos</span>
          <span><b>${r.cpo ? brl(r.cpo) : '—'}</b>custo/pedido</span>
          <span><b>${int(r.plays)}</b>visualizações</span>
          <span><b>${pctAd(r.hold)}</b>assistiram até o fim</span>
          <span><b>${int(r.linkClicks)}</b>cliques no link</span>
          <span><b>${pctAd(r.ctrL)}</b>taxa de cliques</span>
          <span><b>${r.cpcL ? brl(r.cpcL) : '—'}</b>custo/clique</span>
          <span><b>${int(r.impressions)}</b>impressões</span>
        </div>${sel}
      </div></div>`;
  };
  body.innerHTML = (AD.salesErr ? `<div class="note err">Vendas da Shopee indisponíveis: ${esc(AD.salesErr)}. As métricas da Meta aparecem normalmente.</div>` : '') + `
    <div class="kpis">
      <div class="kpi"><small>Gasto com anúncios</small><div>${brl(spend)}</div></div>
      <div class="kpi"><small>Comissão dos anúncios</small><div>${brl(com)}</div></div>
      <div class="kpi"><small>Lucro</small><div class="${com - spend >= 0 ? 'pos' : 'neg'}">${brl(com - spend)}</div></div>
      <div class="kpi"><small>Retorno (ROAS)</small><div>${roasTxt(spend ? com / spend : 0)}</div></div>
      <div class="kpi"><small>Pedidos</small><div>${int(Math.round(orders))}</div></div>
      <div class="kpi"><small>Custo por clique</small><div>${clicks ? brl(spend / clicks) : '—'}</div></div>
      <div class="kpi"><small>Taxa de cliques</small><div>${pctAd(imp ? clicks / imp : 0)}</div></div>
      <div class="kpi"><small>Comissão total na Shopee</small><div>${brl(allCom)}</div></div>
    </div>
    ${unmatched ? `<div class="note warn">${unmatched} anúncio(s) sem ligação com as vendas da Shopee. Use nos anúncios os links gerados pelo painel (com subId), ou ligue cada um no seletor do card.</div>` : ''}
    <div class="panelbox"><div class="bar" style="margin:0"><h3 style="flex:1;margin:0">Análise com IA</h3><button class="b sm p" id="vdAiBtn" onclick="adAnalyze()">${AD.ai ? 'Analisar de novo' : 'Analisar meus anúncios'}</button></div>
      <div id="vdAi">${AD.ai ? adAiHtml(AD.ai) : '<p class="meta" style="display:block">A IA lê os números e diz quais anúncios manter, escalar ou pausar e o que testar nos próximos vídeos.</p>'}</div></div>
    <h3 class="gridtitle">Anúncios por ${AD_SORTS[AD.sort]} (${rows.length})</h3>
    <div class="vdlist">${rows.map(card).join('') || '<div class="empty">Nenhum anúncio com gasto no período.</div>'}</div>
    <p class="meta" style="display:block">Retorno (ROAS) = comissão ÷ gasto (acima de 1x dá lucro). * Estimado: venda ligada pelo produto, ou dividida entre anúncios do mesmo subId pela proporção de cliques. ${matched} de ${sales.length} itens vendidos no período foram ligados a anúncios.</p>
    <div class="bar"><button class="b sm" onclick="adCSV()">Baixar planilha (CSV)</button></div>`;
  AD.rows = rows;
}
function adLink(adId, val) {
  if (!val) return;
  const m = adMapGet(); if (val === '-') delete m[adId]; else m[adId] = val;
  lsSet('adMap', JSON.stringify(m)); drawAds(); toast('Ligação salva');
}
function adCSV() {
  download('anuncios-meta.csv', toCSV((AD.rows || []).map((r) => ({ anuncio: r.adName, campanha: r.campaign, conjunto: r.adset, status: AD_STATUS[r.status] || r.status, gasto: +r.spend.toFixed(2), impressoes: r.impressions, alcance: r.reach,
    visualizacoes: r.plays, thruplays: r.thruplays, assistiram_fim_pct: +(r.hold * 100).toFixed(1), cliques_link: r.linkClicks, taxa_cliques_pct: +(r.ctrL * 100).toFixed(2), custo_clique: +r.cpcL.toFixed(2),
    pedidos: +r.orders.toFixed(1), comissao: +r.commission.toFixed(2), lucro: +r.profit.toFixed(2), roas: +r.roas.toFixed(2), ligacao: r.match ? `${r.match.how} ${r.match.subId || r.match.itemId || ''}` : '' }))), 'text/csv');
}

/* ---------------- análise com IA ---------------- */
function adAiHtml(a) {
  const list = (t, arr) => (arr?.length ? `<h4>${t}</h4><ul>${arr.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '');
  return `<div class="vdai">${a.resumo ? `<p>${esc(a.resumo)}</p>` : ''}${list('Manter ou escalar', a.melhores)}${list('Pausar ou ajustar', a.piores)}${list('Padrões', a.padroes)}${list('Próximos passos', a.proximos_passos)}
    ${a.confianca ? `<p class="meta" style="display:block">Confiança: ${esc(a.confianca)}</p>` : ''}<p class="meta" style="display:block">${esc(a._ia || '')}</p></div>`;
}
async function adAnalyze() {
  const rows = AD.rows || []; if (!rows.length) return toast('Nenhum anúncio no período');
  const btn = $('#vdAiBtn'); btn.disabled = true; btn.textContent = 'Analisando…';
  const summary = { periodo_dias: +AD.period, anuncios: rows.slice(0, 50).map((r) => ({ anuncio: r.adName, campanha: r.campaign, status: AD_STATUS[r.status] || r.status,
    gasto: +r.spend.toFixed(2), impressoes: r.impressions, visualizacoes: r.plays, assistiram_ate_o_fim_pct: +(r.hold * 100).toFixed(1), cliques_link: r.linkClicks,
    taxa_cliques_pct: +(r.ctrL * 100).toFixed(2), custo_por_clique: +r.cpcL.toFixed(2), pedidos: +r.orders.toFixed(1), comissao: +r.commission.toFixed(2), lucro: +r.profit.toFixed(2), roas: +r.roas.toFixed(2), ligado_a_vendas: !!r.match })) };
  const r = await api('video-insights', { summary, kind: 'ads' });
  btn.disabled = false;
  if (r.errors) { btn.textContent = 'Analisar meus anúncios'; return toast(r.errors[0].message); }
  AD.ai = r.insights; $('#vdAi').innerHTML = adAiHtml(AD.ai); btn.textContent = 'Analisar de novo';
}

/* ---------------- conexão (⚙ Configurações) ---------------- */
async function metaConnect() {
  const tok = $('#metaToken').value.trim(); const msg = $('#metaMsg'); msg.hidden = false;
  if (!tok) { msg.className = 'note err'; msg.textContent = 'Cole o token.'; return; }
  lsSet('metaToken', tok); msg.className = 'note'; msg.textContent = 'Conectando…';
  const r = await api('meta/accounts', {});
  if (r.errors) { msg.className = 'note err'; msg.textContent = r.errors[0].message; return; }
  const sel = $('#metaAccount'); const cur = lsGet('metaAccount');
  sel.innerHTML = r.accounts.map((a) => `<option value="${esc(a.id)}" ${a.id === cur ? 'selected' : ''}>${esc(a.name)} (${esc(a.id.replace('act_', ''))}) · ${a.status}${a.business ? ' · ' + esc(a.business) : ''}</option>`).join('');
  $('#metaAccBox').hidden = !r.accounts.length;
  msg.className = 'note ok'; msg.textContent = r.accounts.length ? `Conectado como ${r.user}. Confira a conta e toque em Salvar conta.` : `Conectado como ${r.user}, mas o token não vê nenhuma conta de anúncios. Confira se ela é administradora da conta e se o token tem ads_read.`;
  if (r.accounts.length === 1) metaSaveAccount();
}
function metaSaveAccount() { lsSet('metaAccount', $('#metaAccount').value); AD.data = null; const m = $('#metaMsg'); m.hidden = false; m.className = 'note ok'; m.textContent = 'Conta salva. Abra a aba Anúncios.'; }
function metaClear() { lsSet('metaToken', ''); lsSet('metaAccount', ''); AD.data = null; $('#metaToken').value = ''; $('#metaAccBox').hidden = true; const m = $('#metaMsg'); m.hidden = false; m.className = 'note'; m.textContent = 'Desconectado.'; }
function metaLoadUI() {
  if (!$('#metaToken')) return;
  $('#metaToken').value = lsGet('metaToken');
  const a = lsGet('metaAccount'); $('#metaAccBox').hidden = !a;
  if (a) $('#metaAccount').innerHTML = `<option value="${esc(a)}">${esc(a.replace('act_', ''))}</option>`;
}
