/* Analisador de vídeos: registra cada vídeo postado (Shopee Vídeo) com os números do painel do criador
   e cruza com as vendas da API de afiliados para mostrar o que dá mais resultado.
   Os vídeos ficam dentro do item da lista "Para gravar" (campo videos), então são salvos junto com a lista. */

const VD_FORMATS = { narracao: 'Narração', primeira_pessoa: 'Primeira pessoa', texto: 'Só texto', outro: 'Outro' };
const VD_NUMS = [['views', 'Visualizações'], ['likes', 'Curtidas'], ['comments', 'Comentários'], ['shares', 'Compartilhamentos'], ['clicks', 'Cliques no produto'], ['orders', 'Pedidos']];
const VD_WEEK = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const VD = { conv: null, convAt: 0, sort: 'commission', period: '90', ai: null, pending: [] };
let vdItemId = null;

const vdNum = (v) => { const n = +String(v ?? '').replace(/\./g, '').replace(',', '.'); return isFinite(n) && n > 0 ? n : 0; };
const vdTs = (v) => (v.postedAt ? new Date(v.postedAt).getTime() : 0);
const vdNowLocal = () => { const d = new Date(Date.now() - new Date().getTimezoneOffset() * 60000); return d.toISOString().slice(0, 16); };
const vdShortDate = (v) => (v.postedAt ? new Date(v.postedAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'sem data');
const vdPeriodOfDay = (h) => (h < 6 ? 'Madrugada (0h–6h)' : h < 12 ? 'Manhã (6h–12h)' : h < 18 ? 'Tarde (12h–18h)' : 'Noite (18h–24h)');
const pctTxt = (x) => (isFinite(x) && x > 0 ? (x * 100).toFixed(x < 0.1 ? 1 : 0).replace('.', ',') + '%' : '—');

/* ---------------- cadastro dos vídeos de um produto ---------------- */
function vdList(itemId) { return [...(FAV.get(String(itemId))?.videos || [])]; }
async function vdSave(itemId, videos) { await favUpsert({ itemId: String(itemId), videos }, true); }

function openVideos(itemId, addNew) {
  vdItemId = String(itemId);
  const x = FAV.get(vdItemId); if (!x) return;
  if (addNew || !vdList(vdItemId).length) vdAdd(true);
  $('#vdTitle').textContent = 'Vídeos · ' + (x.productName || '').slice(0, 40);
  $('#vdModal').classList.add('on'); $('#vdShade').classList.add('on');
  vdRenderModal();
}
function closeVideos() { $('#vdModal').classList.remove('on'); $('#vdShade').classList.remove('on'); if ($('#videos')?.classList.contains('on')) renderVideos(); }
function vdAdd(silent) {
  const x = FAV.get(vdItemId); const list = vdList(vdItemId);
  const sc = x.script || {};
  list.unshift({ id: 'v' + Date.now().toString(36), network: 'Shopee Vídeo', postedAt: vdNowLocal(), title: sc.gancho || '', format: sc._formato || 'narracao', duration: '', subId: x.subId || '', createdAt: Date.now() });
  const p = vdSave(vdItemId, list);
  if (!silent) p.then(vdRenderModal);
}
function vdSet(vid, field, value) {
  const list = vdList(vdItemId).map((v) => (v.id === vid ? { ...v, [field]: value, metricsAt: VD_NUMS.some(([k]) => k === field) ? Date.now() : v.metricsAt } : v));
  vdSave(vdItemId, list);
}
function vdDel(vid) {
  if (!confirm('Apagar este vídeo e os números dele?')) return;
  vdSave(vdItemId, vdList(vdItemId).filter((v) => v.id !== vid)).then(vdRenderModal);
}
function vdRenderModal() {
  const list = vdList(vdItemId);
  $('#vdOut').innerHTML = list.map((v, i) => `
    <div class="vdbox">
      <div class="bar" style="margin:0 0 6px"><b style="flex:1">Vídeo ${list.length - i}</b><button class="b sm" onclick="vdDel('${v.id}')">Apagar</button></div>
      <div class="vdgrid">
        <div class="f"><label>Postado em</label><input type="datetime-local" value="${esc(v.postedAt || '')}" onchange="vdSet('${v.id}','postedAt',this.value)"></div>
        <div class="f"><label>Tipo de vídeo</label><select onchange="vdSet('${v.id}','format',this.value)">${Object.entries(VD_FORMATS).map(([k, l]) => `<option value="${k}" ${v.format === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="f full"><label>Gancho / título</label><input value="${esc(v.title || '')}" placeholder="a frase dos primeiros segundos" onchange="vdSet('${v.id}','title',this.value)"></div>
        <div class="f"><label>Duração (seg)</label><input inputmode="numeric" value="${esc(v.duration || '')}" onchange="vdSet('${v.id}','duration',this.value)"></div>
        <div class="f"><label>subId do link (se usou)</label><input value="${esc(v.subId || '')}" onchange="vdSet('${v.id}','subId',this.value.trim())"></div>
      </div>
      <div class="meta" style="display:block;margin:8px 0 4px">Números do painel do Shopee Vídeo${v.metricsAt ? ` · atualizados em ${new Date(v.metricsAt).toLocaleDateString('pt-BR')}` : ''}</div>
      <div class="vdgrid">${VD_NUMS.map(([k, l]) => `<div class="f"><label>${l}</label><input inputmode="numeric" value="${esc(v[k] ?? '')}" onchange="vdSet('${v.id}','${k}',this.value)"></div>`).join('')}</div>
      <div class="f full" style="margin-top:6px"><label>Anotações</label><input value="${esc(v.notes || '')}" placeholder="ex: música em alta, postei com legenda curta" onchange="vdSet('${v.id}','notes',this.value)"></div>
    </div>`).join('') || '<div class="empty">Nenhum vídeo ainda.</div>';
}
// ao marcar "Postado", já abre o cadastro do vídeo
function vdOnStatus(itemId, status) {
  if (status !== 'postado' || vdList(itemId).length) return;
  setTimeout(async () => { vdItemId = String(itemId); vdAdd(true); toast('Vídeo registrado. Depois é só mandar o print dos números na aba Vídeos.'); }, 300);
}
// produtos já marcados como Postado antes desta versão ganham um vídeo automaticamente
async function vdAutoRegister() {
  for (const x of FAV.values()) {
    if (x.status !== 'postado' || x.videos?.length) continue;
    const d = new Date((x.updatedAt || Date.now()) - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    const sc = x.script || {};
    await favUpsert({ itemId: String(x.itemId), videos: [{ id: 'v' + Date.now().toString(36) + x.itemId.slice(-3), network: 'Shopee Vídeo', postedAt: d, title: sc.gancho || '', format: sc._formato || 'narracao', subId: x.subId || '', auto: true, createdAt: Date.now() }] }, true);
  }
}

/* ---------------- prints do Shopee Vídeo: a IA lê os números ---------------- */
const vdWords = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[^a-z0-9]+/).filter((w) => w.length > 3);
function vdGuess(res) {
  const all = vdAll();
  if (res.match_id) { const v = all.find((x) => x.id === res.match_id); if (v) return v; }
  const words = new Set(vdWords(`${res.titulo} ${res.produto}`)); if (!words.size) return null;
  let best = null, bestScore = 0;
  for (const v of all) {
    const w = vdWords(`${v.item.productName} ${v.title}`); const hit = w.filter((x) => words.has(x)).length;
    let sc = hit / Math.max(3, Math.min(words.size, w.length));
    if (res.data && v.postedAt && Math.abs(new Date(res.data) - new Date(v.postedAt.slice(0, 10))) < 2 * 86400000) sc += 0.2;
    if (sc > bestScore) { bestScore = sc; best = v; }
  }
  return bestScore >= 0.4 ? best : null;
}
async function vdApplyResult(res, video) {
  const map = { views: res.visualizacoes, likes: res.curtidas, comments: res.comentarios, shares: res.compartilhamentos, clicks: res.cliques, orders: res.pedidos };
  const patch = {}; for (const [k, val] of Object.entries(map)) if (val !== null && val !== undefined && val !== '') patch[k] = String(val);
  const list = vdList(video.itemId).map((v) => (v.id === video.id ? { ...v, ...patch, title: v.title || res.titulo || '', metricsAt: Date.now() } : v));
  await favUpsert({ itemId: video.itemId, videos: list }, true);
}
async function vdNewFromResult(res, itemId) {
  const x = FAV.get(String(itemId)); if (!x) return;
  const list = vdList(itemId);
  const empty = list.find((v) => !vdNum(v.views)); // usa o vídeo registrado que ainda não tem números
  if (empty) return vdApplyResult(res, { ...empty, itemId: String(itemId) });
  list.unshift({ id: 'v' + Date.now().toString(36), network: 'Shopee Vídeo', postedAt: res.data ? res.data + 'T12:00' : vdNowLocal(), title: res.titulo || '', format: x.script?._formato || 'narracao', subId: x.subId || '', createdAt: Date.now() });
  await favUpsert({ itemId: String(itemId), videos: list }, true);
  await vdApplyResult(res, { ...list[0], itemId: String(itemId) });
}
async function vdPrints(input) {
  const files = [...(input.files || [])].slice(0, 4); input.value = ''; if (!files.length) return;
  const st = { set innerHTML(h) { VD.status = h; const el = $('#vdPrintStatus'); if (el) el.innerHTML = h; } }; st.innerHTML = `<div class="note">Lendo ${files.length} print(s) com IA… leva uns 20 segundos.</div>`;
  let images;
  try { images = await Promise.all(files.map((f) => blobToSmallDataURL(f, 1600))); } catch { st.innerHTML = '<div class="note err">Não consegui abrir as imagens.</div>'; return; }
  const known = vdAll().map((v) => ({ id: v.id, produto: (v.item.productName || '').slice(0, 70), gancho: (v.title || '').slice(0, 70), postado: (v.postedAt || '').slice(0, 10) }));
  const r = await api('video-ocr', { images, known });
  if (r.errors) { st.innerHTML = `<div class="note err">${esc(r.errors[0].message)}</div>`; return; }
  let ok = 0; VD.pending = [];
  for (const res of r.videos || []) {
    const v = vdGuess(res);
    if (v) { await vdApplyResult(res, v); ok++; } else VD.pending.push(res);
  }
  st.innerHTML = `<div class="note">${ok} vídeo(s) atualizado(s) automaticamente${VD.pending.length ? `, ${VD.pending.length} para você confirmar abaixo` : ''}.${r.observacao ? ' ' + esc(r.observacao) : ''}</div>`;
  await renderVideos();
  if (ok && lsGet('aiKey')) vdAnalyze(); // análise automática depois de atualizar os números
}
function vdPendingHtml() {
  if (!VD.pending.length) return '';
  const opts = [...FAV.values()].map((x) => `<option value="${esc(x.itemId)}">${esc((x.productName || '').slice(0, 60))}</option>`).join('');
  return `<div class="panelbox"><h3>Não reconheci estes vídeos do print</h3><p class="meta" style="display:block">Escolha de qual produto é cada um.</p>
    ${VD.pending.map((res, i) => `<div class="vdbox"><b>${esc(res.titulo || res.produto || 'Vídeo')}</b><div class="meta" style="display:block">${res.visualizacoes ?? '—'} visualizações · ${res.curtidas ?? '—'} curtidas${res.data ? ' · ' + esc(res.data) : ''}</div>
      <div class="bar" style="margin:6px 0 0"><select id="vdPend${i}" style="flex:1;min-width:0"><option value="">Escolha o produto…</option>${opts}</select><button class="b sm p" onclick="vdPendSave(${i})">Salvar</button><button class="b sm" onclick="VD.pending.splice(${i},1);renderVideos()">Ignorar</button></div></div>`).join('')}</div>`;
}
async function vdPendSave(i) {
  const id = $('#vdPend' + i).value; if (!id) return toast('Escolha o produto');
  await vdNewFromResult(VD.pending[i], id); VD.pending.splice(i, 1); renderVideos();
}

/* ---------------- vendas (API de afiliados) ---------------- */
async function vdLoadConv(force) {
  if (VD.conv && !force && Date.now() - VD.convAt < 10 * 60000) return VD.conv;
  const all = vdAll(); const first = Math.min(...all.map(vdTs).filter(Boolean), Date.now() - 30 * 86400000);
  const start = Math.max(first - 86400000, Date.now() - 89 * 86400000); // a Shopee guarda até 90 dias
  const r = await api('conversions', { purchaseTimeStart: Math.floor(start / 1000), purchaseTimeEnd: Math.floor(Date.now() / 1000), allPages: true, maxPages: 40 });
  if (r.errors) throw new Error(r.errors[0].message);
  VD.conv = reportItems(r.nodes || []); VD.convAt = Date.now();
  return VD.conv;
}
function vdAll() {
  const out = [];
  for (const x of FAV.values()) for (const v of x.videos || []) out.push({ ...v, item: x, itemId: String(x.itemId) });
  return out;
}
// Liga cada venda a um vídeo: 1º pelo subId; senão, pelo produto (o vídeo mais recente postado antes da compra).
function vdAttribute(videos, sales) {
  const byId = new Map(videos.map((v) => [v.id, { ...v, sales: 0, apiOrders: 0, commission: 0, gmv: 0, direct: 0 }]));
  const unmatched = [];
  for (const s of sales) {
    const t = (+s.purchaseTime || 0) * 1000; const com = +s.itemTotalCommission || 0;
    let v = s.utmContent ? videos.find((x) => x.subId && x.subId === s.utmContent) : null;
    let direct = !!v;
    if (!v) v = videos.filter((x) => x.itemId === String(s.itemId) && vdTs(x) && vdTs(x) <= t).sort((a, b) => vdTs(b) - vdTs(a))[0];
    if (!v) { unmatched.push(s); continue; }
    const o = byId.get(v.id); o.sales += +s.qty || 1; o.apiOrders++; o.commission += com; o.gmv += +s.actualAmount || 0; if (direct) o.direct++;
  }
  return { videos: [...byId.values()], unmatched };
}
function vdMetrics(v) {
  const views = vdNum(v.views), likes = vdNum(v.likes), comments = vdNum(v.comments), shares = vdNum(v.shares), clicks = vdNum(v.clicks);
  const orders = vdNum(v.orders) || v.apiOrders || 0;
  return {
    views, likes, comments, shares, clicks, orders, commission: v.commission || 0,
    eng: views ? (likes + comments + shares) / views : 0,
    ctr: views ? clicks / views : 0,
    conv: clicks ? orders / clicks : 0,
    rpm: views ? (v.commission || 0) / views * 1000 : 0,
  };
}

/* ---------------- tela do analisador ---------------- */
const VD_SORTS = { commission: 'Comissão', views: 'Visualizações', eng: 'Engajamento', ctr: 'Cliques/visualização', orders: 'Pedidos', rpm: 'Comissão por mil visualizações', recent: 'Mais recentes' };
async function renderVideos(reload) {
  const out = $('#videos .out');
  await vdAutoRegister();
  let all = vdAll();
  const days = VD.period === 'tudo' ? 0 : +VD.period;
  if (days) all = all.filter((v) => !vdTs(v) || vdTs(v) >= Date.now() - days * 86400000);
  const printBtn = `<div class="panelbox vdprint"><label class="b p" style="cursor:pointer;display:block;text-align:center">📷 Enviar print do Shopee Vídeo<input type="file" accept="image/*" multiple hidden onchange="vdPrints(this)"></label>
      <p class="meta" style="display:block;margin:6px 0 0">Abra o painel do criador no Shopee Vídeo, tire print da lista de vídeos (pode mandar até 4) e envie aqui. A IA lê os números e atualiza tudo sozinha.</p><div id="vdPrintStatus">${VD.status || ''}</div></div>`;
  const head = printBtn + vdPendingHtml() + `<div class="bar">
      <div class="f"><label>Vídeos postados nos últimos</label><select onchange="VD.period=this.value;renderVideos()">${[['7', '7 dias'], ['30', '30 dias'], ['90', '90 dias'], ['tudo', 'Todos']].map(([k, l]) => `<option value="${k}" ${VD.period === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="f"><label>Ordenar por</label><select onchange="VD.sort=this.value;renderVideos()">${Object.entries(VD_SORTS).map(([k, l]) => `<option value="${k}" ${VD.sort === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <button class="b sm" style="align-self:flex-end" onclick="renderVideos(true)">Atualizar vendas</button></div>`;
  if (!vdAll().length) {
    out.innerHTML = printBtn + vdPendingHtml() + `<div class="empty">Nenhum vídeo registrado ainda.<br>Quando postar, marque o produto como <b>Postado</b> na aba <b>Para gravar</b>: o vídeo é registrado sozinho. Depois é só mandar o print dos números aqui.</div>`;
    return;
  }
  out.innerHTML = head + '<div class="note">Carregando vendas da Shopee…</div>';
  let sales = [], convErr = '';
  try { sales = await vdLoadConv(reload); } catch (e) { convErr = e.message; }
  const { videos, unmatched } = vdAttribute(all, sales);
  const rows = videos.map((v) => ({ ...v, m: vdMetrics(v) }));
  const key = VD.sort;
  rows.sort((a, b) => (key === 'recent' ? vdTs(b) - vdTs(a) : (b.m[key] - a.m[key]) || (b.m.views - a.m.views)));
  const tot = rows.reduce((s, r) => { for (const k of ['views', 'likes', 'comments', 'shares', 'clicks', 'orders', 'commission']) s[k] = (s[k] || 0) + r.m[k]; return s; }, {});
  const withViews = rows.filter((r) => r.m.views);
  const missing = rows.filter((r) => !r.m.views).length;

  // grupos: formato, dia da semana, horário, produto
  const group = (fn) => {
    const g = {};
    for (const r of rows) { const k = fn(r); if (!k) continue; g[k] ??= { n: 0, views: 0, eng: 0, engN: 0, commission: 0, orders: 0 }; const o = g[k]; o.n++; o.views += r.m.views; o.commission += r.m.commission; o.orders += r.m.orders; if (r.m.views) { o.eng += r.m.eng; o.engN++; } }
    return Object.entries(g).sort((a, b) => b[1].commission - a[1].commission || b[1].views / b[1].n - a[1].views / a[1].n);
  };
  const gTable = (title, entries) => entries.length ? `<div class="panelbox"><h3>${title}</h3><div class="tw"><table><thead><tr><th></th><th class="num">Vídeos</th><th class="num">Média vis.</th><th class="num">Engaj.</th><th class="num">Pedidos</th><th class="num">Comissão</th></tr></thead><tbody>${entries.map(([k, o]) => `<tr><td>${esc(k)}</td><td class="num">${o.n}</td><td class="num">${int(Math.round(o.views / o.n))}</td><td class="num">${o.engN ? pctTxt(o.eng / o.engN) : '—'}</td><td class="num">${int(o.orders)}</td><td class="num">${brl(o.commission)}</td></tr>`).join('')}</tbody></table></div></div>` : '';

  // de onde vieram as vendas (responde se ela usa subId)
  const bySub = {}; for (const s of sales) { const k = s.utmContent || '(sem subId)'; bySub[k] = (bySub[k] || 0) + 1; }
  const byCh = {}; for (const s of sales) { const k = s.channelType ? ptTerm(s.channelType) : '(não informado)'; byCh[k] = (byCh[k] || 0) + 1; }
  const subUsed = Object.keys(bySub).filter((k) => k !== '(sem subId)').length;
  const srcBox = sales.length ? `<details class="panelbox"><summary><b>De onde vieram as vendas</b> (${int(sales.length)} itens vendidos no período)</summary>
      <p class="meta" style="display:block">${subUsed ? `${subUsed} subId(s) diferentes encontrados: dá para saber exatamente qual vídeo vendeu.` : 'Nenhuma venda veio com subId. Por isso a comissão é ligada ao vídeo pelo <b>produto</b> e pela <b>data</b> (o vídeo mais recente daquele produto antes da compra). Se postar mais de um vídeo do mesmo produto, gere um link com subId diferente para cada um.'}</p>
      <div class="two"><div><h3>Por subId</h3>${Object.entries(bySub).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, n]) => `<div class="meta" style="display:flex;justify-content:space-between"><span>${esc(k)}</span><b>${n}</b></div>`).join('')}</div>
      <div><h3>Por canal</h3>${Object.entries(byCh).sort((a, b) => b[1] - a[1]).map(([k, n]) => `<div class="meta" style="display:flex;justify-content:space-between"><span>${esc(k)}</span><b>${n}</b></div>`).join('')}</div></div>
      ${unmatched.length ? `<p class="meta" style="display:block">${unmatched.length} venda(s) de produtos sem vídeo registrado (ou compradas antes da postagem).</p>` : ''}</details>` : '';

  const card = (r, i) => {
    const m = r.m;
    return `<div class="vdcard">
      <img loading="lazy" src="${esc(r.item.imageUrl || '')}" alt="" onclick="openVideos('${esc(r.itemId)}')">
      <div class="fc">
        <div class="t"><span class="rank">${i + 1}º</span> ${esc(r.title || r.item.productName || '')}</div>
        <div class="meta">${esc((r.item.productName || '').slice(0, 50))}</div>
        <div class="meta">${vdShortDate(r)} · ${VD_FORMATS[r.format] || 'Outro'}${r.duration ? ` · ${esc(r.duration)}s` : ''}${r.subId ? ` · subId ${esc(r.subId)}` : ''}</div>
        <div class="vdstats">
          <span><b>${m.views ? int(m.views) : '—'}</b>visualizações</span>
          <span><b>${pctTxt(m.eng)}</b>engajamento</span>
          <span><b>${pctTxt(m.ctr)}</b>cliques/vis.</span>
          <span><b>${m.orders ? int(m.orders) : '—'}</b>pedidos</span>
          <span><b>${m.commission ? brl(m.commission) : '—'}</b>comissão${r.apiOrders && !r.direct ? '*' : ''}</span>
          <span><b>${m.rpm ? brl(m.rpm) : '—'}</b>por mil vis.</span>
        </div>
        ${!m.views ? '<div class="meta warnline">Sem números ainda: mande o print do Shopee Vídeo</div>' : ''}
        <div class="acts"><button class="b sm" onclick="openVideos('${esc(r.itemId)}')">Editar à mão</button></div>
      </div></div>`;
  };

  out.innerHTML = head + (convErr ? `<div class="note err">Não consegui carregar as vendas: ${esc(convErr)}. Os números digitados aparecem normalmente.</div>` : '') + `
    <div class="kpis">
      <div class="kpi"><small>Vídeos</small><div>${int(rows.length)}</div></div>
      <div class="kpi"><small>Visualizações</small><div>${int(tot.views)}</div></div>
      <div class="kpi"><small>Média por vídeo</small><div>${withViews.length ? int(Math.round(tot.views / withViews.length)) : '—'}</div></div>
      <div class="kpi"><small>Engajamento médio</small><div>${tot.views ? pctTxt((tot.likes + tot.comments + tot.shares) / tot.views) : '—'}</div></div>
      <div class="kpi"><small>Pedidos</small><div>${int(tot.orders)}</div></div>
      <div class="kpi"><small>Comissão dos vídeos</small><div>${brl(tot.commission)}</div></div>
      <div class="kpi"><small>Comissão por mil vis.</small><div>${tot.views ? brl(tot.commission / tot.views * 1000) : '—'}</div></div>
    </div>
    ${missing ? `<div class="note warn">${missing} vídeo(s) ainda sem números. Mande o print do painel do criador do Shopee Vídeo (botão no topo).</div>` : ''}
    <div class="panelbox"><div class="bar" style="margin:0"><h3 style="flex:1;margin:0">Análise com IA</h3><button class="b sm p" id="vdAiBtn" onclick="vdAnalyze()">${VD.ai ? 'Analisar de novo' : 'Analisar meus vídeos'}</button></div><div id="vdAi">${VD.ai ? vdAiHtml(VD.ai) : '<p class="meta" style="display:block">A IA lê os números abaixo e diz o que está funcionando e o que testar nos próximos vídeos.</p>'}</div></div>
    <h3 class="gridtitle">Ranking: ${VD_SORTS[key]}</h3>
    <div class="vdlist">${rows.map(card).join('')}</div>
    <p class="meta" style="display:block">* Comissão estimada pelo produto e pela data (sem subId). Pedidos: o número digitado do Shopee Vídeo; se vazio, os pedidos encontrados pela API.</p>
    <div class="two">${gTable('Por tipo de vídeo', group((r) => VD_FORMATS[r.format] || 'Outro'))}${gTable('Por dia da semana', group((r) => (vdTs(r) ? VD_WEEK[new Date(vdTs(r)).getDay()] : '')))}</div>
    <div class="two">${gTable('Por horário da postagem', group((r) => (vdTs(r) ? vdPeriodOfDay(new Date(vdTs(r)).getHours()) : '')))}${gTable('Por produto', group((r) => (r.item.productName || '').slice(0, 40)))}</div>
    ${srcBox}
    <div class="bar"><button class="b sm" onclick="vdCSV()">Baixar planilha (CSV)</button></div>`;
  VD.rows = rows;
}
function vdCSV() {
  const rows = (VD.rows || []).map((r) => ({ produto: r.item.productName, postado: r.postedAt, tipo: VD_FORMATS[r.format] || '', gancho: r.title, duracao_s: r.duration, subId: r.subId,
    visualizacoes: r.m.views, curtidas: r.m.likes, comentarios: r.m.comments, compartilhamentos: r.m.shares, cliques: r.m.clicks, pedidos: r.m.orders,
    engajamento: +(r.m.eng * 100).toFixed(2), cliques_por_vis: +(r.m.ctr * 100).toFixed(2), comissao: +r.m.commission.toFixed(2), comissao_por_mil: +r.m.rpm.toFixed(2), anotacoes: r.notes || '' }));
  download('videos-metricas.csv', toCSV(rows), 'text/csv');
}

/* ---------------- análise com IA ---------------- */
function vdAiHtml(a) {
  const list = (t, arr) => (arr?.length ? `<h4>${t}</h4><ul>${arr.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '');
  return `<div class="vdai">${a.resumo ? `<p>${esc(a.resumo)}</p>` : ''}${list('O que funcionou', a.melhores)}${list('O que pode ter atrapalhado', a.piores)}${list('Padrões', a.padroes)}${list('Próximos vídeos', a.proximos_passos)}
    ${a.confianca ? `<p class="meta" style="display:block">Confiança: ${esc(a.confianca)}</p>` : ''}<p class="meta" style="display:block">${esc(a._ia || '')}</p></div>`;
}
async function vdAnalyze() {
  const rows = VD.rows || []; if (!rows.length) return toast('Registre vídeos primeiro');
  const btn = $('#vdAiBtn'); btn.disabled = true; btn.textContent = 'Analisando…';
  const summary = { videos: rows.slice(0, 60).map((r) => ({
    titulo_gancho: r.title, produto: (r.item.productName || '').slice(0, 80), preco: r.item.priceMin, comissao_pct: r.item.commissionRate,
    tipo: VD_FORMATS[r.format] || 'Outro', postado: r.postedAt, dia_semana: vdTs(r) ? VD_WEEK[new Date(vdTs(r)).getDay()] : null, duracao_s: r.duration || null,
    visualizacoes: r.m.views, curtidas: r.m.likes, comentarios: r.m.comments, compartilhamentos: r.m.shares, cliques_produto: r.m.clicks, pedidos: r.m.orders,
    comissao_estimada: +r.m.commission.toFixed(2), anotacoes: r.notes || undefined })) };
  const r = await api('video-insights', { summary });
  btn.disabled = false;
  if (r.errors) { btn.textContent = 'Analisar meus vídeos'; return toast(r.errors[0].message); }
  VD.ai = r.insights; $('#vdAi').innerHTML = vdAiHtml(VD.ai); btn.textContent = 'Analisar de novo';
}
