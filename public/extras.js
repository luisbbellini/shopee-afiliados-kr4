/* Funcionalidades extras do painel: Para gravar, Em alta, Ganhos, Roteiro com IA,
   fotos, configurações de alertas e instalação como app.
   Usa as funções globais do index.html ($, api, esc, brl, pct, int, toast, copy, state...). */

let STORE = false;          // banco de dados ligado no servidor?
let FAV = new Map();        // itemId -> item da lista "Para gravar"
const brDate = (d) => d ? String(d).split('-').reverse().join('/') : '';
const STATUS_LABEL = { a_gravar: 'A gravar', gravado: 'Gravado', postado: 'Postado' };

/* ---------------- arquivos (fotos/zip) ---------------- */
async function apiBlob(path, body) {
  const r = await fetch('/api/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-panel-key': getKey(), ...credHeaders() }, body: JSON.stringify(body) });
  const type = r.headers.get('content-type') || '';
  if (type.includes('application/json')) { const j = await r.json(); throw new Error(j.errors?.[0]?.message || 'Erro'); }
  const name = (r.headers.get('content-disposition') || '').match(/filename="([^"]+)"/)?.[1] || 'arquivo';
  return { blob: await r.blob(), name };
}
function saveBlob({ blob, name }) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); }
async function downloadPhoto(url, name) {
  try { toast('Baixando foto…'); saveBlob(await apiBlob('image', { url, name })); } catch (e) { toast(e.message); }
}
async function downloadAllPhotos() {
  const items = favFiltered().filter((x) => x.imageUrl).map((x) => ({ url: x.imageUrl, name: x.productName }));
  if (!items.length) return toast('Nenhuma foto na lista');
  const btn = $('#zipBtn'); btn.disabled = true; btn.textContent = `Baixando ${items.length} fotos…`;
  try { saveBlob(await apiBlob('images-zip', { items })); } catch (e) { toast(e.message); }
  btn.disabled = false; btn.textContent = 'Baixar fotos (zip)';
}

/* ---------------- lista "Para gravar" ---------------- */
const FAV_KEYS = ['itemId', 'productName', 'imageUrl', 'productLink', 'offerLink', 'shopName', 'shopId', 'priceMin', 'priceMax', 'priceDiscountRate', 'commissionRate', 'commission', 'sales', 'ratingStar', 'score'];
const pickFav = (o) => Object.fromEntries(FAV_KEYS.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));
function favLocalSave() { lsSet('favs', JSON.stringify([...FAV.values()])); }
async function favLoad() {
  if (STORE) {
    const r = await api('fav/list', {});
    if (!r.errors) {
      FAV = new Map(r.items.map((i) => [String(i.itemId), i]));
      // leva para o banco o que estava só no aparelho
      const local = JSON.parse(lsGet('favs') || '[]');
      for (const it of local) if (!FAV.has(String(it.itemId))) await favUpsert(it, true);
      if (local.length) lsSet('favs', '');
    }
  } else {
    FAV = new Map(JSON.parse(lsGet('favs') || '[]').map((i) => [String(i.itemId), i]));
  }
  refreshStars(); if ($('#favs').classList.contains('on')) renderFavs();
}
async function favUpsert(item, quiet) {
  const id = String(item.itemId);
  const merged = { ...(FAV.get(id) || { status: 'a_gravar', addedAt: Date.now() }), ...item, itemId: id, updatedAt: Date.now() };
  FAV.set(id, merged);
  if (STORE) { const r = await api('fav/save', { item: merged }); if (r.item) FAV.set(id, r.item); else if (!quiet) toast(r.errors?.[0]?.message || 'Erro ao salvar'); }
  else favLocalSave();
  refreshStars(); if ($('#favs').classList.contains('on')) renderFavs();
}
async function favDelete(id) {
  FAV.delete(String(id));
  if (STORE) await api('fav/remove', { itemId: id }); else favLocalSave();
  refreshStars(); renderFavs();
}
function toggleFav(o) {
  if (!o?.itemId) return;
  const id = String(o.itemId);
  if (FAV.has(id)) { favDelete(id); toast('Removido da lista'); }
  else { favUpsert(pickFav(o)); toast('★ Adicionado em Para gravar'); }
}
function toggleFavFrom(tab, i) { toggleFav(state[tab].nodes[i]); }
const starBtn = (o, tab, i) => o?.itemId ? `<button class="star ${FAV.has(String(o.itemId)) ? 'on' : ''}" data-star="${esc(o.itemId)}" title="Para gravar" aria-label="Adicionar à lista Para gravar" onclick="event.stopPropagation();toggleFavFrom('${tab}',${i})">★</button>` : '';
function refreshStars() {
  $$('[data-star]').forEach((b) => b.classList.toggle('on', FAV.has(String(b.dataset.star))));
  const n = FAV.size; const t = $('nav button[data-t=favs]'); if (t) t.textContent = n ? `Para gravar (${n})` : 'Para gravar';
}
let favFilter = 'todos';
const favFiltered = () => [...FAV.values()].filter((x) => favFilter === 'todos' || x.status === favFilter).sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
function renderFavs() {
  const out = $('#favs .out'); const all = [...FAV.values()];
  const count = (s) => all.filter((x) => s === 'todos' || x.status === s).length;
  const rows = favFiltered();
  out.innerHTML = (STORE ? '' : `<div class="note warn">A lista está salva só neste aparelho. Ative o banco de dados para usar em vários aparelhos e receber alertas (Manual → Ativar banco de dados).</div>`) +
    `<div class="bar chips">${['todos', 'a_gravar', 'gravado', 'postado'].map((s) => `<button class="chip ${favFilter === s ? 'on' : ''}" onclick="favFilter='${s}';renderFavs()">${s === 'todos' ? 'Todos' : STATUS_LABEL[s]} <b>${count(s)}</b></button>`).join('')}</div>
    <div class="bar"><button class="b sm" id="zipBtn" onclick="downloadAllPhotos()">Baixar fotos (zip)</button>
      <button class="b sm" onclick="download('para-gravar.csv',toCSV(favFiltered().map(({script,...x})=>x)),'text/csv')">CSV</button></div>` +
    (rows.length ? '<div class="favlist">' + rows.map((x) => `
    <div class="fav">
      <img loading="lazy" src="${esc(x.imageUrl)}" alt="" onclick="openObj(FAV.get('${esc(x.itemId)}'))">
      <div class="fc">
        <div class="t" onclick="openObj(FAV.get('${esc(x.itemId)}'))">${esc(x.productName)}</div>
        <div class="meta"><span>${brl(x.priceMin)}</span><span>Comissão ${pct(x.commissionRate)} · ${brl(x.commission)}</span>${x.score ? `<span class="score ${scoreCls(x.score)}">${x.score}</span>` : ''}</div>
        <div class="row2">
          <select aria-label="Etapa" onchange="favUpsert({itemId:'${esc(x.itemId)}',status:this.value})">${Object.entries(STATUS_LABEL).map(([k, l]) => `<option value="${k}" ${x.status === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
          <input aria-label="Anotações" placeholder="Anotações…" value="${esc(x.notes || '')}" onchange="favUpsert({itemId:'${esc(x.itemId)}',notes:this.value})">
        </div>
        ${x.shortLink ? `<div class="meta">Link: <a href="${esc(x.shortLink)}" target="_blank" rel="noopener">${esc(x.shortLink)}</a>${x.subId ? ` · subId <b>${esc(x.subId)}</b>` : ''} <button class="b sm" onclick="copy('${esc(x.shortLink)}')">Copiar</button></div>` : ''}
        <div class="acts wrap">
          <button class="b sm p" onclick="openScript('${esc(x.itemId)}')">${x.script ? 'Ver roteiro' : 'Roteiro IA'}</button>
          <button class="b sm" onclick="favLink('${esc(x.itemId)}')">${x.shortLink ? 'Novo link' : 'Gerar link'}</button>
          <button class="b sm" onclick="openImgEdit(FAV.get('${esc(x.itemId)}'))">Editar foto</button>
          <button class="b sm" onclick="downloadPhoto('${esc(x.imageUrl)}','${esc(x.productName)}')">Foto</button>
          ${linkBtn(shopeeApp(x.productLink), 'Shopee')}${linkBtn(tiktokApp(x.productName), 'TikTok')}
          <button class="b sm" aria-label="Remover" onclick="if(confirm('Remover da lista?'))favDelete('${esc(x.itemId)}')">Remover</button>
        </div>
      </div>
    </div>`).join('') + '</div>' : `<div class="empty">${all.length ? 'Nada nesta etapa.' : 'Lista vazia. Toque na ★ de um produto (em Produtos, Oportunidades ou Em alta) para guardar aqui.'}</div>`);
}
async function favLink(id) {
  const x = FAV.get(String(id)); if (!x) return;
  const sub = prompt('subId para este link (ex.: vestido01-tiktok):', x.subId || '') ?? null;
  if (sub === null) return;
  const r = await api('shortlink', { originUrl: x.productLink, subIds: sub ? [sub] : [] });
  const link = r.data?.generateShortLink?.shortLink;
  if (!link) return toast(r.errors?.[0]?.message || 'Erro ao gerar link');
  await favUpsert({ itemId: id, shortLink: link, subId: sub }); copy(link);
}

/* ---------------- Em alta ---------------- */
async function loadTrending(e) {
  e?.preventDefault();
  const f = $('#trending form'); const out = $('#trending .out');
  const btn = $('button.p', f); btn.disabled = true; btn.textContent = 'Carregando…';
  const r = await api('trending', { days: f.days.value, minDelta: f.minDelta.value });
  btn.disabled = false; btn.textContent = 'Atualizar';
  if (r.noStore) { out.innerHTML = `<div class="note warn">Esta aba precisa do banco de dados ligado. Veja <b>Manual → Ativar banco de dados</b>.</div>`; return; }
  state.trending = { nodes: r.items || [] };
  if (!r.items?.length) {
    out.innerHTML = notes(r) + `<div class="empty">${r.daysAvailable < 2 ? `O histórico começou ${r.from ? 'em ' + brDate(r.from) : 'hoje'}. Com pelo menos 2 dias de fotos dá para comparar; com 7 dias fica bem melhor.<br><br>O histórico é alimentado pelas suas buscas em Produtos/Oportunidades e pela tarefa diária dos nichos (⚙ Configurações → Alertas).` : 'Nenhum produto cresceu acima do mínimo no período.'}</div>`;
    return;
  }
  out.innerHTML = `<div class="bar"><span class="info">Comparando ${brDate(r.from)} → ${brDate(r.to)} (${r.spanDays} dia${r.spanDays > 1 ? 's' : ''}) · ${int(r.compared)} produtos acompanhados · ${int(r.items.length)} cresceram</span></div>` +
    '<div class="grid">' + r.items.map((n, i) => `
    <div class="card" onclick="openItem('trending',${i})">
      ${starBtn(n, 'trending', i)}
      <span class="score rank hi">+${int(n.delta)}</span>
      <img loading="lazy" src="${esc(n.imageUrl)}" alt="">
      <div class="c">
        <div class="t">${esc(n.productName || 'Produto ' + n.itemId)}</div>
        <div class="price">${brl(n.priceMin)}</div>
        <div class="meta"><span><b>${n.perDay >= 10 ? int(Math.round(n.perDay)) : n.perDay.toFixed(1).replace('.', ',')}</b> vendas/dia</span>${n.growth !== null ? `<span>+${(n.growth * 100).toFixed(n.growth < 0.1 ? 1 : 0).replace('.', ',')}%</span>` : ''}</div>
        <div class="meta"><span>${int(n.from)} → ${int(n.to)} vendidos</span></div>
        <div class="com"><span>Comissão ${pct(n.commissionRate)}</span><b>${brl(n.commission)}</b></div>
        <div class="acts" onclick="event.stopPropagation()">${linkBtn(shopeeApp(n.productLink), 'Shopee')}${linkBtn(tiktokApp(n.productName), 'TikTok')}</div>
      </div>
    </div>`).join('') + '</div>';
}

/* ---------------- histórico no detalhe do produto ---------------- */
async function drawHistory(itemId) {
  const box = $('#histBox'); if (!box || !STORE) return;
  const r = await api('history', { itemId });
  const pts = r.points || [];
  if (pts.length < 2) { box.innerHTML = `<div class="meta">Histórico de vendas: ${pts.length ? 'começou hoje' : 'ainda sem dados'}. Aparece um gráfico a partir do 2º dia.</div>`; return; }
  const W = 320, H = 90, P = 6;
  const xs = pts.map((p) => new Date(p.day).getTime()), ys = pts.map((p) => p.sales);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys) || 1;
  const X = (v) => P + ((v - x0) / (x1 - x0 || 1)) * (W - 2 * P), Y = (v) => H - P - ((v - y0) / (y1 - y0 || 1)) * (H - 2 * P);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${X(xs[i]).toFixed(1)},${Y(p.sales).toFixed(1)}`).join(' ');
  const last = pts[pts.length - 1], first = pts[0];
  box.innerHTML = `<h3>Vendas acumuladas (${pts.length} dias): +${int(last.sales - first.sales)}</h3>
    <svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="Vendas de ${first.day} a ${last.day}: de ${first.sales} para ${last.sales}">
      <line x1="${P}" x2="${W - P}" y1="${H - P}" y2="${H - P}" stroke="var(--line)"/>
      <path d="${d}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
      ${pts.map((p, i) => `<circle cx="${X(xs[i])}" cy="${Y(p.sales)}" r="4" fill="var(--accent)" stroke="var(--panel)" stroke-width="2"><title>${brDate(p.day)}: ${int(p.sales)} vendidos · comissão ${pct(p.rate)}</title></circle>`).join('')}
    </svg><div class="meta"><span>${brDate(first.day)}: ${int(first.sales)}</span><span>${brDate(last.day)}: ${int(last.sales)}</span></div>`;
}

/* ---------------- roteiro com IA ---------------- */
let scriptItem = null;
const FORMAT_LABEL = { narracao: 'Narração (voz em off)', primeira_pessoa: 'Falando para a câmera', texto: 'Só texto na tela' };
function openScript(idOrObj) {
  scriptItem = typeof idOrObj === 'object' ? idOrObj : FAV.get(String(idOrObj));
  if (!scriptItem) return;
  $('#scTitle').textContent = scriptItem.productName || 'Roteiro';
  $('#scFormat').value = lsGet('scFormat') || 'narracao'; $('#scUsedRow').hidden = $('#scFormat').value !== 'primeira_pessoa';
  $('#scOut').innerHTML = scriptItem.script ? renderScript(scriptItem.script) : '';
  $('#scModal').classList.add('on'); $('#scShade').classList.add('on');
}
function closeScript() { $('#scModal').classList.remove('on'); $('#scShade').classList.remove('on'); }
function scriptText(s) {
  if (s.texto) return s.texto;
  return [`${FORMAT_LABEL[s._formato] ? 'TIPO: ' + FORMAT_LABEL[s._formato] + '\n' : ''}GANCHO: ${s.gancho || ''}`, '', ...(s.cenas || []).map((c) => `[${c.tempo}]${c.fala ? ' ' + c.fala : ''}${c.texto_tela ? `  [tela: ${c.texto_tela}]` : ''}${c.imagem ? `  (${c.imagem})` : ''}`), '', `CTA: ${s.cta || ''}`, s.musica ? `MÚSICA: ${s.musica}` : '', '', `LEGENDA: ${s.legenda || ''}`, (s.hashtags || []).join(' ')].filter((x, i, a) => !(x === '' && a[i - 1] === '')).join('\n');
}
function renderScript(s) {
  if (s.texto) return `<pre>${esc(s.texto)}</pre>`;
  window._lastScript = s;
  return `<div class="bar"><button class="b sm p" onclick="copy(scriptText(window._lastScript))">Copiar roteiro inteiro</button>${s._ia ? `<span class="meta">Gerado por ${esc(s._ia)}</span>` : ''}</div>
    <div class="scb"><h3>Gancho (3 primeiros segundos)</h3><p class="big">${esc(s.gancho)}</p><button class="b sm" onclick="copy(window._lastScript.gancho)">Copiar</button></div>
    <div class="scb"><h3>Cenas · ${esc(FORMAT_LABEL[s._formato] || 'roteiro')}</h3><ol class="cenas">${(s.cenas || []).map((c) => `<li><b>${esc(c.tempo)}</b>${c.fala ? ` <span class="lbl">${s._formato === 'primeira_pessoa' ? 'Fala' : 'Narração'}:</span> ${esc(c.fala)}` : ''}${c.texto_tela ? `<div><span class="lbl">Texto na tela:</span> ${esc(c.texto_tela)}</div>` : ''}${c.imagem ? `<div class="meta">${s._formato === 'primeira_pessoa' ? 'O que fazer' : 'Mostrar'}: ${esc(c.imagem)}</div>` : ''}</li>`).join('')}</ol></div>
    ${s.musica ? `<div class="scb"><h3>Música de fundo</h3><p>${esc(s.musica)}</p></div>` : ''}
    <div class="scb"><h3>Chamada para comprar</h3><p>${esc(s.cta)}</p></div>
    <div class="scb"><h3>Legenda</h3><p>${esc(s.legenda)}</p><p class="meta">${esc((s.hashtags || []).join(' '))}</p><button class="b sm" onclick="copy(window._lastScript.legenda + '\\n\\n' + (window._lastScript.hashtags||[]).join(' '))">Copiar legenda + hashtags</button></div>
    ${(s.ideias_extra || []).length ? `<div class="scb"><h3>Outros ganchos</h3><ul>${s.ideias_extra.map((i) => `<li>${esc(i)}</li>`).join('')}</ul></div>` : ''}`;
}
async function genScript() {
  const btn = $('#scGo'); btn.disabled = true; btn.textContent = 'Escrevendo roteiro…';
  $('#scOut').innerHTML = '<div class="note">A IA está escrevendo (10 a 20 segundos)…</div>';
  lsSet('scFormat', $('#scFormat').value);
  const r = await api('script', { product: scriptItem, tone: $('#scTone').value, duration: +$('#scDur').value, extra: $('#scExtra').value, format: $('#scFormat').value, used: $('#scUsed').checked });
  btn.disabled = false; btn.textContent = 'Gerar roteiro';
  if (r.errors) { $('#scOut').innerHTML = `<div class="note err">${esc(r.errors[0].message)}</div>`; return; }
  $('#scOut').innerHTML = renderScript(r.script);
  if (FAV.has(String(scriptItem.itemId))) { await favUpsert({ itemId: scriptItem.itemId, script: r.script }); toast('Roteiro salvo na lista'); }
}

/* ---------------- editar foto com IA ---------------- */
let imgItem = null, imgSource = null; // imgSource: { url } da Shopee ou { b64 } de uma imagem já editada
function openImgEdit(item) {
  if (!item?.imageUrl) return toast('Produto sem foto');
  imgItem = item; imgSource = { url: item.imageUrl };
  $('#imgSrc').src = item.imageUrl; $('#imgSrcLabel').textContent = 'Foto original do produto';
  $('#imgTitle').textContent = 'Editar foto · ' + (item.productName || '').slice(0, 40);
  $('#imgOut').innerHTML = ''; $$('#imgModal .presets .chip').forEach((c) => c.classList.remove('on'));
  $('#imgModal').classList.add('on'); $('#imgShade').classList.add('on');
}
function closeImgEdit() { $('#imgModal').classList.remove('on'); $('#imgShade').classList.remove('on'); }
// sugestões: toca para acrescentar ao pedido (um por grupo)
document.addEventListener('click', (e) => {
  const c = e.target.closest('#imgModal .presets .chip'); if (!c) return;
  const group = c.parentElement; const ta = $('#imgPrompt');
  const prev = group.querySelector('.chip.on');
  let parts = ta.value.split(/\s*;\s*/).filter(Boolean);
  if (prev) { parts = parts.filter((p) => p !== prev.dataset.p); prev.classList.remove('on'); }
  if (prev !== c) { parts.push(c.dataset.p); c.classList.add('on'); }
  ta.value = parts.join('; ');
});
// reduz a imagem antes de mandar de novo (economiza dados e cabe no limite do servidor)
async function blobToSmallDataURL(blob, max = 1536) {
  const img = await createImageBitmap(blob);
  const k = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.9);
}
async function genImages() {
  const prompt = $('#imgPrompt').value.trim(); if (!prompt) return toast('Escolha uma sugestão ou escreva o que mudar');
  const n = +$('#imgN').value, aspect = $('#imgAspect').value;
  const btn = $('#imgGo'); btn.disabled = true;
  const out = $('#imgOut');
  for (let i = 0; i < n; i++) {
    btn.textContent = `Gerando ${i + 1} de ${n}… (até 1 minuto)`;
    const box = document.createElement('div'); box.className = 'imgres loading'; box.textContent = 'A IA está criando a imagem…';
    out.prepend(box);
    try {
      const body = { prompt, aspect, ...(imgSource.b64 ? { imageB64: imgSource.b64 } : { url: imgSource.url }) };
      const r = await fetch('/api/image-edit', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-panel-key': getKey(), ...credHeaders() }, body: JSON.stringify(body) });
      if ((r.headers.get('content-type') || '').includes('application/json')) { const j = await r.json(); throw new Error(j.errors?.[0]?.message || 'Erro'); }
      const blob = await r.blob(); const info = decodeURIComponent(r.headers.get('x-info') || '');
      const url = URL.createObjectURL(blob);
      const name = `${slugify(imgItem.productName)}-ia-${Date.now()}.${blob.type.includes('png') ? 'png' : 'jpg'}`;
      box.className = 'imgres';
      box.innerHTML = `<img src="${url}" alt="Imagem editada: ${esc(prompt)}"><div class="acts"><a class="b sm" href="${url}" download="${name}" style="text-decoration:none;color:inherit;text-align:center">Baixar</a><button class="b sm">Editar esta</button></div><div class="meta">${esc(info)}</div>`;
      box.querySelector('button').onclick = async () => {
        imgSource = { b64: await blobToSmallDataURL(blob) };
        $('#imgSrc').src = url; $('#imgSrcLabel').textContent = 'Editando a imagem gerada'; $('#imgPrompt').value = ''; $$('#imgModal .presets .chip').forEach((c) => c.classList.remove('on'));
        $('#imgModal').scrollTop = 0; toast('Agora as mudanças valem sobre esta imagem');
      };
    } catch (e) {
      box.className = 'imgres loading'; box.style.color = 'var(--err)'; box.textContent = e.message;
      break; // não insiste se deu erro (evita cobrança repetida)
    }
  }
  btn.disabled = false; btn.textContent = 'Gerar imagens';
}
const slugify = (s) => String(s || 'produto').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40).toLowerCase() || 'produto';

/* ---------------- Ganhos ---------------- */
const dayKey = (ts) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(ts * 1000));
async function loadEarnings(e) {
  e?.preventDefault();
  const f = $('#earnings form'); const out = $('#earnings .out');
  const days = +f.period.value; const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const periodStart = new Date(Date.now() - (days - 1) * 86400000); periodStart.setHours(0, 0, 0, 0);
  const start = new Date(Math.min(monthStart, periodStart));
  const btn = $('button.p', f); btn.disabled = true; btn.textContent = 'Carregando…';
  const r = await api('conversions', { purchaseTimeStart: Math.floor(start / 1000), purchaseTimeEnd: Math.floor(Date.now() / 1000), allPages: true, maxPages: 40 });
  btn.disabled = false; btn.textContent = 'Atualizar';
  const items = reportItems(r.nodes || []);
  const com = (i) => +i.itemTotalCommission || 0;
  const inPeriod = items.filter((i) => i.purchaseTime * 1000 >= +periodStart);
  const inMonth = items.filter((i) => i.purchaseTime * 1000 >= +monthStart);
  const sum = (a, f2) => a.reduce((s, x) => s + f2(x), 0);
  const totalP = sum(inPeriod, com), totalM = sum(inMonth, com);
  const avgPerSale = inPeriod.length ? totalP / inPeriod.length : 0;
  // por dia
  const byDay = new Map();
  for (let d = new Date(periodStart); d <= now; d = new Date(+d + 86400000)) byDay.set(dayKey(d / 1000), 0);
  for (const i of inPeriod) { const k = dayKey(i.purchaseTime); byDay.set(k, (byDay.get(k) || 0) + com(i)); }
  // por subId
  const bySub = {}; for (const i of inPeriod) { const k = i.utmContent || '(sem subId)'; bySub[k] ??= { n: 0, v: 0 }; bySub[k].n++; bySub[k].v += com(i); }
  const subs = Object.entries(bySub).sort((a, b) => b[1].v - a[1].v).slice(0, 10);
  // meta
  const goal = +(lsGet('goal') || 0) || (window._settings?.goal || 0);
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysLeft = daysInMonth - now.getDate() + 1;
  const missing = Math.max(0, goal - totalM);
  const favAvg = (() => { const a = [...FAV.values()].map((x) => +x.commission).filter((x) => x > 0); return a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0; })();
  const needSales = avgPerSale ? Math.ceil(missing / avgPerSale) : null;
  const needFav = favAvg ? Math.ceil(missing / favAvg) : null;

  out.innerHTML = notes(r) + `
    <div class="kpis">
      <div class="kpi"><small>Comissão em ${days} dias</small><div>${brl(totalP)}</div></div>
      <div class="kpi"><small>Vendas (itens)</small><div>${int(inPeriod.length)}</div></div>
      <div class="kpi"><small>Média por venda</small><div>${brl(avgPerSale)}</div></div>
      <div class="kpi"><small>Comissão no mês</small><div>${brl(totalM)}</div></div>
    </div>
    <div class="panelbox"><h3>Comissão por dia</h3>${barChart([...byDay.entries()])}</div>
    <div class="panelbox goalbox">
      <h3>Meta do mês</h3>
      <div class="bar" style="margin:0 0 10px"><label for="goalIn" class="meta">Quero ganhar (R$)</label><input id="goalIn" type="number" min="0" step="50" value="${goal || ''}" placeholder="ex: 2000" style="width:130px"><button class="b sm" onclick="saveGoal()">Salvar meta</button></div>
      ${goal ? `<div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="${goal}" aria-valuenow="${totalM.toFixed(2)}"><span style="width:${Math.min(100, totalM / goal * 100).toFixed(1)}%"></span></div>
      <p class="meta" style="display:block;margin-top:6px"><b style="color:var(--ink)">${brl(totalM)}</b> de ${brl(goal)} (${(totalM / goal * 100).toFixed(0)}%) · faltam <b style="color:var(--ink)">${brl(missing)}</b> em ${daysLeft} dia${daysLeft > 1 ? 's' : ''}</p>
      <div class="calc">${missing <= 0 ? '<p>🎉 Meta batida!</p>' : `
        ${needSales ? `<p>Com a sua média atual (<b>${brl(avgPerSale)}</b> por venda): faltam <b>${int(needSales)} vendas</b> ≈ <b>${(needSales / daysLeft).toFixed(1).replace('.', ',')} por dia</b>.</p>` : '<p>Ainda não há vendas no período para calcular a média.</p>'}
        ${needFav ? `<p>Com os produtos da lista Para gravar (média <b>${brl(favAvg)}</b> de comissão): faltam <b>${int(needFav)} vendas</b> ≈ <b>${(needFav / daysLeft).toFixed(1).replace('.', ',')} por dia</b>.</p>` : ''}`}</div>` : '<p class="meta" style="display:block">Defina uma meta para ver o progresso e quantas vendas faltam.</p>'}
    </div>
    <div class="panelbox"><h3>Vídeos que mais venderam (por subId)</h3>${subs.length ? hbar(subs) : '<p class="meta" style="display:block">Sem vendas no período.</p>'}</div>`;
}
function saveGoal() {
  const v = $('#goalIn').value; lsSet('goal', v);
  if (STORE) api('settings/save', { goal: v });
  loadEarnings();
}
// Barras verticais finas, um único tom, valores no tooltip (toque/hover)
function barChart(entries) {
  if (!entries.length) return '';
  const W = Math.max(320, entries.length * 14), H = 150, P = { l: 44, r: 6, t: 8, b: 22 };
  const max = Math.max(...entries.map((e) => e[1]), 1);
  const nice = (() => { const p = Math.pow(10, Math.floor(Math.log10(max))); return Math.ceil(max / p) * p; })();
  const bw = (W - P.l - P.r) / entries.length; const barW = Math.max(3, Math.min(18, bw - 2));
  const Y = (v) => P.t + (H - P.t - P.b) * (1 - v / nice);
  const ticks = [0, nice / 2, nice];
  const labelEvery = Math.ceil(entries.length / 6);
  return `<div class="chartwrap"><svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="Comissão por dia">
    ${ticks.map((t) => `<line x1="${P.l}" x2="${W - P.r}" y1="${Y(t)}" y2="${Y(t)}" stroke="var(--line)" stroke-width="1"/><text x="${P.l - 6}" y="${Y(t) + 4}" text-anchor="end" font-size="10" fill="var(--muted)">${t >= 1000 ? (t / 1000).toFixed(1).replace('.', ',') + 'k' : t.toFixed(0)}</text>`).join('')}
    ${entries.map(([d, v], i) => { const x = P.l + i * bw + (bw - barW) / 2; const h = Math.max(v > 0 ? 2 : 0, H - P.b - Y(v)); const y = H - P.b - h;
      return `<g class="bar-g"><rect x="${P.l + i * bw}" y="${P.t}" width="${bw}" height="${H - P.t - P.b}" fill="transparent"><title>${d.split('-').reverse().slice(0, 2).join('/')}: ${brl(v)}</title></rect>
      ${h ? `<path d="M${x},${y + h} V${y + Math.min(4, h)} Q${x},${y} ${x + Math.min(4, barW / 2)},${y} H${x + barW - Math.min(4, barW / 2)} Q${x + barW},${y} ${x + barW},${y + Math.min(4, h)} V${y + h} Z" fill="var(--accent)"><title>${d.split('-').reverse().slice(0, 2).join('/')}: ${brl(v)}</title></path>` : ''}
      ${i % labelEvery === 0 ? `<text x="${P.l + i * bw + bw / 2}" y="${H - 6}" text-anchor="middle" font-size="10" fill="var(--muted)">${d.slice(8)}/${d.slice(5, 7)}</text>` : ''}</g>`; }).join('')}
  </svg></div>`;
}
// Barras horizontais para ranking (rótulo e valor em texto, barra só como apoio)
function hbar(rows) {
  const max = Math.max(...rows.map((r) => r[1].v), 1);
  return `<div class="hbars">${rows.map(([k, v]) => `<div class="hb"><div class="hl"><span>${esc(k)}</span><b>${brl(v.v)}</b></div><div class="track"><span style="width:${(v.v / max * 100).toFixed(1)}%"></span></div><div class="meta">${v.n} venda${v.n > 1 ? 's' : ''}</div></div>`).join('')}</div>`;
}

/* ---------------- configurações (IA e alertas) ---------------- */
async function loadSettingsUI() {
  $('#aiKey').value = lsGet('aiKey'); $('#aiProv').value = lsGet('aiProvider') || 'auto'; $('#aiModel').value = lsGet('aiModel');
  $('#aiNote').textContent = 'Aceita chave do ChatGPT (OpenAI), Claude (Anthropic) ou Gemini (Google). ' + (window._aiServer ? 'Há uma chave configurada na Vercel; esta, se preenchida, tem prioridade.' : 'Fica salva só neste aparelho.');
  aiDetectLabel();
  const box = $('#alertBox');
  if (!STORE) { box.innerHTML = '<div class="note warn" style="margin:0">Alertas e histórico precisam do banco de dados. Veja <b>Manual → Ativar banco de dados</b>.</div>'; return; }
  const r = await api('settings/get', {});
  const s = r.settings || {}; window._settings = s;
  box.innerHTML = `
    <div class="f"><label for="stNiches">Nichos para acompanhar (um por linha, até 3)</label><textarea id="stNiches" rows="3" style="font-family:inherit;font-size:14px">${esc((s.niches || []).join('\n'))}</textarea></div>
    <div class="bar" style="margin:0"><div class="f"><label for="stScore">Nota mínima</label><input id="stScore" type="number" value="${s.minScore}" style="width:80px"></div>
      <div class="f"><label for="stSales">Vendas mínimas</label><input id="stSales" type="number" value="${s.minSales}" style="width:100px"></div></div>
    <div class="f"><label for="stNtfy">Tópico do ntfy (app de notificações)</label><input id="stNtfy" value="${esc(s.ntfyTopic)}" placeholder="ex: kr4-afiliados-${Math.random().toString(36).slice(2, 7)}" autocomplete="off"></div>
    <details><summary class="meta" style="cursor:pointer">Ou receber pelo Telegram</summary>
      <div class="f" style="margin-top:8px"><label for="stTgTok">Token do bot</label><input id="stTgTok" value="${esc(s.telegramToken)}" autocomplete="off" placeholder="123456:ABC…"></div>
      <div class="f"><label for="stTgChat">Chat ID</label><input id="stTgChat" value="${esc(s.telegramChatId)}" inputmode="numeric" autocomplete="off"></div></details>
    <div class="bar" style="margin:0"><button class="b p" onclick="saveAlerts()">Salvar alertas</button><button class="b" onclick="testAlert()">Enviar teste</button><button class="b" onclick="runNow()">Rodar agora</button></div>
    <div id="alertMsg" class="note" style="margin:0">${r.lastCron ? `Última execução: ${new Date(r.lastCron.at).toLocaleString('pt-BR')} · ${esc((r.lastCron.log || []).join(' · ') || 'sem nichos')}${r.lastCron.delivery?.errors?.length ? ' · ' + esc(r.lastCron.delivery.errors.join(', ')) : ''}` : 'A tarefa roda todo dia por volta das 7h.'}</div>`;
}
const AI_NAMES = { openai: 'ChatGPT (OpenAI)', anthropic: 'Claude (Anthropic)', gemini: 'Gemini (Google)' };
function detectAI(k) { k = (k || '').trim(); return k.startsWith('sk-ant-') ? 'anthropic' : k.startsWith('AIza') ? 'gemini' : k.startsWith('sk-') ? 'openai' : ''; }
function aiDetectLabel() {
  const k = $('#aiKey').value, sel = $('#aiProv').value, d = detectAI(k);
  $('#aiDetected').textContent = !k ? '' : sel !== 'auto' ? `Usando: ${AI_NAMES[sel]}` : d ? `Chave reconhecida: ${AI_NAMES[d]}` : 'Não reconheci a chave: escolha a empresa acima.';
}
async function saveAiKey() {
  lsSet('aiKey', $('#aiKey').value.trim()); lsSet('aiProvider', $('#aiProv').value); lsSet('aiModel', $('#aiModel').value.trim());
  const m = $('#aiMsg'); m.hidden = false; m.className = 'note'; m.style.color = ''; m.textContent = 'Testando a chave…';
  const r = await api('ai/test', {});
  if (r.ok) { m.style.color = 'var(--ok)'; m.textContent = `✓ Funcionou: ${r.provider} · ${r.model}`; }
  else { m.className = 'note err'; m.textContent = '✗ ' + (r.errors?.[0]?.message || 'erro'); }
}
function clearAiKey() { lsSet('aiKey', ''); lsSet('aiModel', ''); $('#aiKey').value = ''; $('#aiModel').value = ''; aiDetectLabel(); toast('Chave da IA apagada deste aparelho'); }
async function saveAlerts() {
  const r = await api('settings/save', { niches: $('#stNiches').value.split('\n'), minScore: $('#stScore').value, minSales: $('#stSales').value, ntfyTopic: $('#stNtfy').value, telegramToken: $('#stTgTok').value, telegramChatId: $('#stTgChat').value });
  $('#alertMsg').textContent = r.errors ? '✗ ' + r.errors[0].message : '✓ Alertas salvos.';
}
async function testAlert() {
  await saveAlerts();
  const r = await api('alerts/test', {});
  $('#alertMsg').textContent = r.sent?.length ? `✓ Teste enviado por ${r.sent.join(' e ')}.` : '✗ ' + (r.errors || []).map((e) => e.message || e).join(', ');
}
async function runNow() {
  await saveAlerts();
  $('#alertMsg').textContent = 'Rodando a tarefa diária (até 1 minuto)…';
  const r = await api('cron/run', {});
  $('#alertMsg').textContent = r.errors ? '✗ ' + r.errors[0].message : `✓ ${(r.log || []).join(' · ') || 'sem nichos'} · ${r.lines?.length ? 'alerta ' + (r.delivery?.sent?.length ? 'enviado' : 'não enviado: ' + (r.delivery?.errors || []).join(', ')) : 'nada novo para avisar'}`;
}

/* ---------------- instalar como app ---------------- */
let installEvt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; $('#installBtn')?.removeAttribute('hidden'); });
async function installApp() {
  if (installEvt) { installEvt.prompt(); await installEvt.userChoice; installEvt = null; $('#installBtn').setAttribute('hidden', ''); }
  else toast('No Chrome: menu ⋮ → "Adicionar à tela inicial"');
}
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

/* ---------------- início ---------------- */
async function initExtras() {
  try {
    const s = await api('status');
    STORE = !!s.store; window._aiServer = !!s.aiServer;
  } catch {}
  await favLoad();
  if (STORE) api('settings/get', {}).then((r) => { window._settings = r.settings; if (r.settings?.goal && !lsGet('goal')) lsSet('goal', r.settings.goal); });
}
initExtras();
