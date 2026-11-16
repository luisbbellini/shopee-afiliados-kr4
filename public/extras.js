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
          <button class="b sm" data-imgcount="${esc(x.itemId)}" onclick="openImgEdit(FAV.get('${esc(x.itemId)}'))">Editar foto</button>
          <button class="b sm" onclick="openPhotos(FAV.get('${esc(x.itemId)}'))">Fotos e cores</button>
          ${linkBtn(shopeeApp(x.productLink), 'Shopee')}${linkBtn(tiktokApp(x.productName), 'TikTok')}
          <button class="b sm" aria-label="Remover" onclick="if(confirm('Remover da lista?'))favDelete('${esc(x.itemId)}')">Remover</button>
        </div>
      </div>
    </div>`).join('') + '</div>' : `<div class="empty">${all.length ? 'Nada nesta etapa.' : 'Lista vazia. Toque na ★ de um produto (em Produtos, Oportunidades ou Em alta) para guardar aqui.'}</div>`);
}
const _renderFavs = renderFavs;
renderFavs = function () { _renderFavs(); refreshGalleryCounts(); };
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
  window._lastScript = null; $('#scGo').textContent = scriptItem.script ? 'Gerar outro roteiro' : 'Gerar roteiro';
  $('#scOut').innerHTML = scriptItem.script ? renderScript(structuredClone(scriptItem.script)) : '';
  $('#scModal').classList.add('on'); $('#scShade').classList.add('on');
  $$('#scOut textarea.ed').forEach(scAutoGrow); refreshNarration();
}
function closeScript() { $('#scModal').classList.remove('on'); $('#scShade').classList.remove('on'); }
function scriptText(s) {
  if (s.texto && !s.cenas) return s.texto;
  return [`${FORMAT_LABEL[s._formato] ? 'TIPO: ' + FORMAT_LABEL[s._formato] + '\n' : ''}GANCHO: ${s.gancho || ''}`, '', ...(s.cenas || []).map((c) => `[${c.tempo}]${c.fala ? ' ' + c.fala : ''}${c.texto_tela ? `  [tela: ${c.texto_tela}]` : ''}${c.imagem ? `  (${c.imagem})` : ''}${c.prompt_grok ? `\n   Grok: ${c.prompt_grok}` : ''}`), '', `CTA: ${s.cta || ''}`, s.musica ? `MÚSICA: ${s.musica}` : '', '', `LEGENDA: ${s.legenda || ''}`, (s.hashtags || []).join(' ')].filter((x, i, a) => !(x === '' && a[i - 1] === '')).join('\n');
}
// Roteiro editável: cada parte é um campo de texto; as mudanças ficam salvas no produto da lista.
function renderScript(s) {
  if (s.texto && !s.cenas) s = { gancho: '', cenas: [{ tempo: '', fala: s.texto, texto_tela: '', imagem: '' }], cta: '', legenda: '', hashtags: [], _formato: s._formato, _ia: s._ia };
  s.cenas ||= []; s.hashtags ||= []; if (!s.grok_regras) s.grok_regras = GROK_RULES_DEFAULT;
  window._lastScript = s;
  const fmt = s._formato;
  const falaLbl = fmt === 'primeira_pessoa' ? 'Fala' : fmt === 'texto' ? 'Fala (opcional)' : 'Narração';
  const fazerLbl = fmt === 'primeira_pessoa' ? 'O que fazer' : 'O que mostrar';
  const ta = (path, val, rows = 2, ph = '') => `<textarea class="ed" rows="${rows}" data-path="${path}" placeholder="${esc(ph)}" oninput="scEdit(this)">${esc(val ?? '')}</textarea>`;
  const inFav = FAV.has(String(scriptItem?.itemId));
  return `<div class="bar"><button class="b sm p" onclick="copy(scriptText(window._lastScript))">Copiar roteiro inteiro</button>
      <span class="meta" id="scSaved">${inFav ? 'Edite à vontade: salva sozinho na lista' : 'Edite à vontade'}</span>
      ${inFav ? '' : `<button class="b sm" onclick="scSaveToList()">★ Salvar na lista Para gravar</button>`}</div>
    ${s._ia ? `<p class="meta" style="display:block;margin:0">Gerado por ${esc(s._ia)}${s._editado ? ' · editado por você' : ''}</p>` : ''}
    ${fmt !== 'texto' || (s.cenas || []).some((c) => (c.fala || '').trim()) ? `<div class="scb narr"><h3>${fmt === 'primeira_pessoa' ? 'Fala completa' : 'Narração completa'} (para o CapCut)</h3>
      <p class="meta" style="display:block;margin:0 0 6px">Todo o texto falado em ordem, separado das cenas. Cole no CapCut em <b>Texto → Texto para fala</b> ou use como guia para gravar sua voz. Atualiza sozinho quando você edita as cenas.</p>
      <div id="narrPreview" class="narr-text"></div><div class="meta" id="narrInfo"></div>
      <div class="acts wrap"><button class="b sm p" onclick="copyNarration(false)">Copiar narração</button><button class="b sm" onclick="copyNarration(true)">Copiar com tempos</button></div></div>` : ''}
    <div class="scb"><h3>Gancho (3 primeiros segundos)</h3>${ta('gancho', s.gancho, 2, 'Frase que prende a atenção')}<button class="b sm" onclick="copy(window._lastScript.gancho)">Copiar</button></div>
    <div class="scb"><h3>Cenas · ${esc(FORMAT_LABEL[fmt] || 'roteiro')}</h3>
      <ol class="cenas ed-cenas">${s.cenas.map((c, i) => `<li>
        <div class="scene-top"><input class="ed tempo" data-path="cenas.${i}.tempo" value="${esc(c.tempo || '')}" placeholder="0-3s" aria-label="Tempo da cena ${i + 1}" oninput="scEdit(this)">
          <span class="spacer" style="flex:1"></span>
          ${i > 0 ? `<button class="b sm" title="Subir" aria-label="Subir cena" onclick="scMove(${i},-1)">↑</button>` : ''}
          ${i < s.cenas.length - 1 ? `<button class="b sm" title="Descer" aria-label="Descer cena" onclick="scMove(${i},1)">↓</button>` : ''}
          <button class="b sm" aria-label="Apagar cena" onclick="scDelScene(${i})">Apagar</button></div>
        <span class="lbl">${falaLbl}</span>${ta(`cenas.${i}.fala`, c.fala, 2)}
        <span class="lbl">Texto na tela</span>${ta(`cenas.${i}.texto_tela`, c.texto_tela, 1)}
        <span class="lbl">${fazerLbl}</span>${ta(`cenas.${i}.imagem`, c.imagem, 1)}
        <span class="lbl grok">Prompt para o Grok (vídeo a partir da foto)</span>${ta(`cenas.${i}.prompt_grok`, c.prompt_grok, 2, fmt === 'primeira_pessoa' ? 'Vazio = cena filmada por você' : 'ex: câmera se aproxima devagar enquanto o tecido balança')}
        ${c.prompt_grok ? `<button class="b sm" onclick="copyGrok(${i})">Copiar para o Grok</button>` : ''}
      </li>`).join('')}</ol>
      <button class="b sm" onclick="scAddScene()">+ Adicionar cena</button></div>
    <div class="scb grokbox"><h3>Regras para o Grok</h3>
      <p class="meta" style="display:block;margin:0 0 6px">Vão automaticamente no fim de <b>todo</b> prompt copiado para o Grok, para ele não criar nada na imagem nem inventar detalhes. Envie ao Grok a <b>foto do produto</b> (ou uma da Galeria) junto com o prompt.</p>
      ${ta('grok_regras', s.grok_regras, 6)}
      <div class="acts wrap"><button class="b sm p" onclick="copyGrokAll()">Copiar todos os prompts do Grok</button><button class="b sm" onclick="resetGrokRules()">Restaurar regras padrão</button></div></div>
    <div class="scb"><h3>Música de fundo</h3>${ta('musica', s.musica, 1, 'ex: pop animado')}</div>
    <div class="scb"><h3>Chamada para comprar</h3>${ta('cta', s.cta, 2)}</div>
    <div class="scb"><h3>Legenda</h3>${ta('legenda', s.legenda, 3)}
      <span class="lbl">Hashtags</span>${ta('hashtags', (s.hashtags || []).join(' '), 2, '#exemplo #outra')}
      <button class="b sm" onclick="copy(window._lastScript.legenda + '\\n\\n' + (window._lastScript.hashtags||[]).join(' '))">Copiar legenda + hashtags</button></div>
    ${(s.ideias_extra || []).length ? `<div class="scb"><h3>Outros ganchos (toque para usar)</h3><ul class="alts">${s.ideias_extra.map((g, i) => `<li><button class="linklike" onclick="scUseHook(${i})">${esc(g)}</button></li>`).join('')}</ul></div>` : ''}`;
}
const GROK_RULES_DEFAULT = `REGRAS OBRIGATÓRIAS (não desrespeite nenhuma):
- Use SOMENTE a imagem enviada como base. Não crie uma cena nova.
- NÃO adicione nem remova pessoas, objetos, acessórios, animais, textos, legendas, logotipos, marcas d'água ou efeitos.
- NÃO altere o produto: mantenha exatamente a mesma cor, modelagem, comprimento, estampa, tecido, textura, botões, costuras e detalhes.
- NÃO invente características, partes ou detalhes que não aparecem na foto (bolsos, zíper, brilho, renda, etc.).
- NÃO mude o rosto, o corpo, o cabelo ou a maquiagem da pessoa, nem o cenário ou o fundo.
- Apenas dê movimento sutil e realista ao que já existe: câmera lenta e suave, leve movimento da pessoa e do tecido, luz natural.
- Sem fala, sem música e sem nenhum texto na tela.`;
const grokRules = () => (window._lastScript?.grok_regras || '').trim() || GROK_RULES_DEFAULT;
const grokPrompt = (c) => `${c.prompt_grok.trim()}\n\n${grokRules()}`;
function copyGrok(i) { const c = window._lastScript.cenas[i]; if (!c?.prompt_grok) return; copy(grokPrompt(c)); }
function copyGrokAll() {
  const cs = (window._lastScript.cenas || []).filter((c) => (c.prompt_grok || '').trim());
  if (!cs.length) return toast('Nenhuma cena tem prompt para o Grok');
  copy(cs.map((c, i) => `CENA ${i + 1} (${c.tempo || ''})\n${grokPrompt(c)}`).join('\n\n-----\n\n'));
}
function resetGrokRules() { window._lastScript.grok_regras = GROK_RULES_DEFAULT; window._lastScript._editado = true; scRerender(); scScheduleSave(); toast('Regras padrão restauradas'); }
// Narração completa: gancho + falas das cenas + chamada final, em ordem (para o CapCut)
const _norm = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
function narrationParts(s) {
  const out = [];
  const add = (tempo, txt) => { txt = String(txt || '').trim(); if (!txt) return; if (out.some((o) => _norm(o.txt) === _norm(txt) || _norm(o.txt).includes(_norm(txt)))) return; out.push({ tempo, txt }); };
  const falas = (s.cenas || []).filter((c) => (c.fala || '').trim());
  // o gancho só entra se a 1ª fala não for ele mesmo
  if (s.gancho && !(falas[0] && (_norm(falas[0].fala).includes(_norm(s.gancho)) || _norm(s.gancho).includes(_norm(falas[0].fala))))) add('início', s.gancho);
  falas.forEach((c) => add(c.tempo, c.fala));
  add('final', s.cta);
  return out;
}
const narrationText = (s) => narrationParts(s).map((p) => p.txt).join('\n\n');
const narrationTimed = (s) => narrationParts(s).map((p) => `[${p.tempo || '—'}] ${p.txt}`).join('\n');
function copyNarration(timed) { const t = timed ? narrationTimed(window._lastScript) : narrationText(window._lastScript); if (!t) return toast('Ainda não há fala/narração neste roteiro'); copy(t); }
function refreshNarration() {
  const el = $('#narrPreview'); if (!el) return;
  const t = narrationText(window._lastScript);
  el.textContent = t || 'Sem falas ainda. Escreva a fala/narração nas cenas.';
  const w = t ? t.split(/\s+/).filter(Boolean).length : 0;
  $('#narrInfo').textContent = w ? `${w} palavras · cerca de ${Math.max(1, Math.round(w / 2.5))} s de fala` : '';
}
function scAutoGrow(el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 2 + 'px'; }
function scEdit(el) {
  const s = window._lastScript; const path = el.dataset.path.split('.');
  if (path[0] === 'hashtags') s.hashtags = el.value.split(/\s+/).filter(Boolean).map((h) => (h.startsWith('#') ? h : '#' + h));
  else { let o = s; for (let i = 0; i < path.length - 1; i++) o = o[path[i]]; o[path.at(-1)] = el.value; }
  s._editado = true;
  if (el.tagName === 'TEXTAREA') scAutoGrow(el);
  refreshNarration();
  scScheduleSave();
}
let scTimer = null;
function scScheduleSave() {
  if (!FAV.has(String(scriptItem?.itemId))) return;
  const lbl = $('#scSaved'); if (lbl) lbl.textContent = 'Salvando…';
  clearTimeout(scTimer);
  scTimer = setTimeout(async () => {
    await favUpsert({ itemId: scriptItem.itemId, script: window._lastScript }, true);
    const l = $('#scSaved'); if (l) l.textContent = '✓ Salvo na lista';
  }, 800);
}
function scRerender() { $('#scOut').innerHTML = renderScript(window._lastScript); $$('#scOut textarea.ed').forEach(scAutoGrow); refreshNarration(); }
function scAddScene() { window._lastScript.cenas.push({ tempo: '', fala: '', texto_tela: '', imagem: '' }); window._lastScript._editado = true; scRerender(); scScheduleSave(); $$('#scOut .ed-cenas li').at(-1)?.querySelector('textarea')?.focus(); }
function scDelScene(i) { if (!confirm('Apagar esta cena?')) return; window._lastScript.cenas.splice(i, 1); window._lastScript._editado = true; scRerender(); scScheduleSave(); }
function scMove(i, d) { const c = window._lastScript.cenas; [c[i], c[i + d]] = [c[i + d], c[i]]; window._lastScript._editado = true; scRerender(); scScheduleSave(); }
function scUseHook(i) { const s = window._lastScript; const old = s.gancho; s.gancho = s.ideias_extra[i]; s.ideias_extra[i] = old; s._editado = true; scRerender(); scScheduleSave(); toast('Gancho trocado'); }
async function scSaveToList() { await favUpsert({ ...pickFav(scriptItem), script: window._lastScript }); scRerender(); toast('★ Salvo em Para gravar com o roteiro'); }
async function genScript() {
  if (window._lastScript?._editado && $('#scOut').innerHTML && !confirm('Gerar um roteiro novo substitui o atual, incluindo suas edições. Continuar?')) return;
  const btn = $('#scGo'); btn.disabled = true; btn.textContent = 'Escrevendo roteiro…';
  $('#scOut').innerHTML = '<div class="note">A IA está escrevendo (10 a 20 segundos)…</div>';
  lsSet('scFormat', $('#scFormat').value);
  const r = await api('script', { product: scriptItem, tone: $('#scTone').value, duration: +$('#scDur').value, extra: $('#scExtra').value, format: $('#scFormat').value, used: $('#scUsed').checked });
  btn.disabled = false; btn.textContent = r.errors ? 'Gerar roteiro' : 'Gerar outro roteiro';
  if (r.errors) { $('#scOut').innerHTML = `<div class="note err">${esc(r.errors[0].message)}</div>`; return; }
  $('#scOut').innerHTML = renderScript(r.script); $$('#scOut textarea.ed').forEach(scAutoGrow); refreshNarration();
  if (FAV.has(String(scriptItem.itemId))) { await favUpsert({ itemId: scriptItem.itemId, script: r.script }, true); toast('Roteiro salvo na lista'); }
}

/* ---------------- fotos e cores do produto ---------------- */
async function apiSignal(path, signal, body) {
  const r = await fetch('/api/' + path, { method: 'POST', signal, headers: { 'Content-Type': 'application/json', 'x-panel-key': getKey(), ...credHeaders() }, body: JSON.stringify(body) });
  const txt = await r.text();
  try { return JSON.parse(txt); } catch { return { errors: [{ message: `Servidor respondeu ${r.status}: ${txt.slice(0, 80)}` }] }; }
}
let phItem = null, phList = [];
const PH_CACHE = new Map();
async function openPhotos(item) {
  if (!item) return;
  if ($('#imgModal').classList.contains('on')) closeImgEdit();
  phItem = item; $('#phTitle').textContent = 'Fotos e cores · ' + (item.productName || '').slice(0, 40);
  $('#phOut').innerHTML = '<div class="note">Buscando as fotos e cores na Shopee… pode levar alguns segundos.</div>'; $('#phActs').innerHTML = ''; $('#phInfo').textContent = '';
  $('#phModal').classList.add('on'); $('#phShade').classList.add('on');
  const key = String(item.itemId || item.productLink || '');
  let r = PH_CACHE.get(key);
  if (!r) {
    const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 25000);
    try { r = await apiSignal('product-photos', ctl.signal, { itemId: item.itemId, shopId: item.shopId, productLink: item.productLink, offerLink: item.offerLink, imageUrl: item.imageUrl }); }
    catch (e) { r = { errors: [{ message: (e.name === 'AbortError' ? 'A busca passou de 25 segundos. ' : 'Falha na busca (' + e.message + '). ') + 'A busca demorou demais ou falhou. Tente de novo; se continuar, salve as fotos pelo app da Shopee e use "Usar foto do celular" na edição.' }] }; }
    clearTimeout(tm);
    if (phItem !== item) return;
    if (r.errors) { $('#phOut').innerHTML = `<p style="color:var(--err);font-size:14px;margin:0 0 10px">${esc(r.errors[0].message || JSON.stringify(r.errors[0]))}</p>${item.imageUrl ? `<button class="b sm" onclick="downloadPhoto('${esc(item.imageUrl)}','${esc(item.productName || 'produto')}')">Baixar a foto principal</button>` : ''}`; return; }
    if (!r.blocked) PH_CACHE.set(key, r);
  }
  phList = r.photos || [];
  const cores = phList.filter((p) => p.group === 'cor'), fotos = phList.filter((p) => p.group !== 'cor');
  const tiers = (r.tiers || []).map((t) => `<b>${esc(t.name || 'Opções')}:</b> ${esc(t.options.join(', '))}`).join(' · ');
  $('#phInfo').innerHTML = (r.blocked && r.shopeeErrors?.length ? `<div style="font-size:13px;margin-bottom:6px">Resposta da Shopee: ${esc(r.shopeeErrors.join(' | '))}</div>` : '') + (r.note ? `<div class="note">${esc(r.note)}</div>` : '') +
    `${cores.length ? `${cores.length} cor(es) com foto` : 'Nenhuma cor com foto própria'} · ${fotos.length} foto(s) do anúncio${tiers ? `<br>${tiers}` : ''}`;
  $('#phActs').innerHTML = (phList.length > 1 ? `<button class="b sm p" id="phAll" onclick="photosDownloadAll()">Baixar todas (${phList.length})</button><button class="b sm" onclick="photosDownloadEach()">Baixar uma por uma</button>` : '')
    + `<div class="f" style="flex:1;min-width:140px"><label for="phColor">Cor das fotos (opcional)</label><input id="phColor" placeholder="ex: Azul"></div>
       <label class="b sm ${phList.length > 1 ? '' : 'p'}" style="cursor:pointer;align-self:flex-end">Importar fotos do celular<input type="file" accept="image/*" multiple hidden onchange="photosImport(this)"></label>`;
  const grid = (title, arr) => arr.length ? `<h3 class="gridtitle">${title}</h3><div class="imggrid">${arr.map((p) => {
    const i = phList.indexOf(p);
    return `<div class="phcard"><img src="${esc(p.url)}" alt="${esc(p.label)}" loading="lazy"><div class="lb">${esc(p.label)}</div>
      <div class="acts"><button class="b sm" onclick="photoDownload(${i})">Baixar</button><button class="b sm" onclick="photoEdit(${i})">Editar (IA)</button></div></div>`;
  }).join('')}</div>` : '';
  $('#phOut').innerHTML = (grid('Cores', cores) + grid('Fotos do anúncio', fotos) || '<div class="meta">Nenhuma foto encontrada.</div>') + '<div id="phImported"></div>';
  showImported();
}
// fotos que ela salvou do app da Shopee e importou: ficam no aparelho junto com o produto
async function showImported() {
  const box = $('#phImported'); if (!box || !phItem) return;
  const list = (await imgDbList(String(phItem.itemId || ''))).filter((x) => x.model === 'importada');
  box.innerHTML = '';
  if (!list.length) return;
  const h = document.createElement('h3'); h.className = 'gridtitle'; h.textContent = `Importadas do celular (${list.length})`;
  const g = document.createElement('div'); g.className = 'imggrid';
  g.append(...list.map((rec) => imgCard(rec)));
  box.append(h, g);
}
async function photosImport(input) {
  const files = [...(input.files || [])]; input.value = ''; if (!files.length) return;
  const cor = ($('#phColor')?.value || '').trim();
  let n = 0;
  for (const f of files) {
    try {
      await imgDbAdd({ itemId: String(phItem.itemId || ''), productName: phItem.productName || '', productLink: phItem.productLink || '',
        prompt: cor ? `Foto importada · cor ${cor}` : 'Foto importada', aspect: '', model: 'importada', createdAt: Date.now() + n, blob: f });
      n++;
    } catch {}
  }
  toast(`${n} foto(s) guardada(s) no app`);
  if (typeof refreshGalleryCounts === 'function') refreshGalleryCounts();
  showImported();
}
function closePhotos() { $('#phModal').classList.remove('on'); $('#phShade').classList.remove('on'); }
const photoName = (p) => `${phItem?.productName || 'produto'} ${p.group === 'cor' ? 'cor ' : ''}${p.label}`;
function photoDownload(i) { const p = phList[i]; if (p) downloadPhoto(p.url, photoName(p)); }
async function photosDownloadAll() {
  const btn = $('#phAll'); btn.disabled = true; btn.textContent = `Baixando ${phList.length} fotos…`;
  try { saveBlob(await apiBlob('images-zip', { items: phList.map((p) => ({ url: p.url, name: photoName(p) })), filename: (phItem?.productName || 'produto').slice(0, 40) + ' fotos' })); } catch (e) { toast(e.message); }
  btn.disabled = false; btn.textContent = `Baixar todas (${phList.length})`;
}
// no celular é mais prático: cada foto vai direto para Downloads/Galeria
async function photosDownloadEach() {
  for (let i = 0; i < phList.length; i++) {
    toast(`Baixando ${i + 1} de ${phList.length}…`);
    try { saveBlob(await apiBlob('image', { url: phList[i].url, name: photoName(phList[i]) })); } catch (e) { toast(e.message); }
    await new Promise((r) => setTimeout(r, 600));
  }
  toast('Fotos baixadas');
}
function photoEdit(i) {
  const p = phList[i]; if (!p) return;
  closePhotos();
  openImgEdit({ ...phItem, imageUrl: p.url });
  $('#imgSrcLabel').textContent = p.group === 'cor' ? `Cor: ${p.label}` : p.label;
}
async function imgUseLocal(input) {
  const f = input.files?.[0]; input.value = ''; if (!f) return;
  try {
    imgSource = { b64: await blobToSmallDataURL(f) };
    $('#imgSrc').src = imgSource.b64; $('#imgSrcLabel').textContent = 'Foto do celular: ' + f.name;
    toast('As mudanças vão valer sobre esta foto');
  } catch { toast('Não consegui abrir essa imagem'); }
}

/* ---------------- editar foto com IA ---------------- */
let imgItem = null, imgSource = null; // imgSource: { url } da Shopee ou { b64 } de uma imagem já editada
function openImgEdit(item) {
  if (!item?.imageUrl) return toast('Produto sem foto');
  if ($('#phModal')?.classList.contains('on')) closePhotos();
  buildImgPresets();
  imgItem = item; imgSource = { url: item.imageUrl };
  $('#imgSrc').src = item.imageUrl; $('#imgSrcLabel').textContent = 'Foto original do produto';
  $('#imgTitle').textContent = 'Editar foto · ' + (item.productName || '').slice(0, 40);
  $('#imgOut').innerHTML = ''; resetImgPresets();
  $('#imgModal').classList.add('on'); $('#imgShade').classList.add('on');
  showSavedInModal();
}
async function showSavedInModal() {
  const list = await imgDbList(String(imgItem.itemId || ''));
  const out = $('#imgOut'); revokeUrls('modal');
  if (!list.length) return;
  const h = document.createElement('h3'); h.className = 'gridtitle'; h.textContent = `Salvas no aparelho deste produto (${list.length})`;
  out.innerHTML = '';
  out.append(h, ...list.map((rec) => imgCard(rec, { inModal: true })));
}
function closeImgEdit() { $('#imgModal').classList.remove('on'); $('#imgShade').classList.remove('on'); }
// Sugestões da edição de foto: um item por grupo, mais um campo para digitar a sua opção.
const IMG_GROUPS = [
  { id: 'fundo', title: 'Fundo', open: true, tpl: (t) => `trocar o fundo por ${t}`, ph: 'ex: um jardim com flores', items: [
    ['Estúdio branco', 'um estúdio branco liso, iluminação suave'], ['Estúdio colorido', 'um estúdio com fundo liso rosa claro'], ['Parede de tijolos', 'uma parede de tijolos aparentes'],
    ['Praia', 'uma praia ao pôr do sol'], ['Piscina', 'a beira de uma piscina em dia de sol'], ['Cidade', 'uma rua urbana charmosa durante o dia'], ['Cidade à noite', 'uma rua da cidade à noite com luzes desfocadas'],
    ['Shopping', 'um corredor de shopping moderno'], ['Sala', 'uma sala de estar aconchegante e bem decorada'], ['Quarto', 'um quarto claro e organizado'], ['Cozinha', 'uma cozinha moderna e clara'],
    ['Jardim', 'um jardim florido'], ['Parque', 'um parque arborizado'], ['Campo', 'um campo aberto com luz de fim de tarde'], ['Cafeteria', 'uma cafeteria moderna'], ['Restaurante', 'um restaurante elegante'],
    ['Escritório', 'um escritório moderno'], ['Academia', 'uma academia bem iluminada'], ['Festa', 'uma festa com luzes coloridas desfocadas'], ['Casamento', 'uma decoração de casamento elegante'],
    ['Natal', 'uma decoração de Natal elegante'], ['Ano Novo', 'uma festa de Ano Novo com luzes douradas'], ['Viagem', 'um ponto turístico desfocado ao fundo'] ] },
  { id: 'modelo', title: 'Modelo (pessoa fictícia)', open: true, tpl: (t) => `trocar a modelo por ${t}`, ph: 'ex: uma mulher ruiva de óculos', items: [
    ['Plus size', 'uma modelo plus size'], ['Magra', 'uma modelo magra'], ['Curvilínea', 'uma modelo curvilínea'], ['Negra', 'uma modelo negra'], ['Morena', 'uma modelo morena'],
    ['Loira', 'uma modelo loira'], ['Ruiva', 'uma modelo ruiva'], ['Asiática', 'uma modelo asiática'], ['Cacheada', 'uma modelo de cabelos cacheados'], ['Cabelo curto', 'uma modelo de cabelo curto'],
    ['20 e poucos', 'uma mulher jovem de cerca de 22 anos'], ['30+', 'uma mulher de cerca de 32 anos'], ['40+', 'uma mulher elegante de cerca de 45 anos'], ['60+', 'uma mulher elegante de cerca de 62 anos'],
    ['Gestante', 'uma modelo gestante'], ['Alta', 'uma modelo alta'], ['Baixinha', 'uma modelo de baixa estatura'], ['Masculino', 'um modelo masculino'], ['Masculino plus size', 'um modelo masculino plus size'],
    ['Sem pessoa', 'nenhuma pessoa: mostrar só a peça'] ] },
  { id: 'pose', title: 'Pose e enquadramento', tpl: (t) => `pose/enquadramento: ${t}`, ph: 'ex: segurando uma bolsa no ombro', items: [
    ['Corpo inteiro', 'corpo inteiro, de frente'], ['Meio corpo', 'meio corpo'], ['Andando', 'caminhando em direção à câmera'], ['Sentada', 'sentada de forma natural'],
    ['De lado', 'de lado, mostrando o perfil da peça'], ['De costas', 'de costas, mostrando a parte de trás da peça'], ['Girando', 'girando, com o tecido em movimento'], ['Sorrindo', 'sorrindo, expressão natural'],
    ['Olhando para longe', 'olhando para o lado, pose espontânea'], ['Close no detalhe', 'close-up no detalhe do tecido e acabamento'] ] },
  { id: 'luz', title: 'Luz e clima', tpl: (t) => `iluminação/clima: ${t}`, ph: 'ex: luz neon azul', items: [
    ['Luz natural', 'luz natural de janela, clima de manhã'], ['Pôr do sol', 'luz dourada de fim de tarde (golden hour)'], ['Dia de sol', 'dia ensolarado, céu azul'], ['Nublado suave', 'luz suave de dia nublado'],
    ['Noite', 'noite, com luzes da cidade'], ['Estúdio', 'luz de estúdio profissional'], ['Verão', 'clima de verão, cores vivas'], ['Inverno', 'clima de inverno, tons frios'], ['Outono', 'clima de outono, folhas secas'] ] },
  { id: 'estilo', title: 'Estilo da foto', tpl: (t) => `estilo da foto: ${t}`, ph: 'ex: foto preto e branco', items: [
    ['Catálogo', 'foto de catálogo de e-commerce, limpa'], ['Editorial', 'editorial de revista de moda'], ['Minimalista', 'minimalista, poucos elementos'], ['Flat lay', 'a peça em flat lay, estendida sobre uma superfície clara, vista de cima, sem pessoa'],
    ['Cabide / arara', 'a peça pendurada num cabide em uma arara, sem pessoa'], ['Vintage', 'estética vintage, tons de filme analógico'], ['Cores vibrantes', 'cores vibrantes e alegres'], ['Tons neutros', 'paleta de tons neutros e bege'] ] },
];
function buildImgPresets() {
  const box = $('#imgPresets'); if (!box || box.dataset.built) return;
  box.innerHTML = IMG_GROUPS.map((g) => `<details data-group="${g.id}" ${g.open ? 'open' : ''}>
      <summary><span>${g.title}</span><span class="cur"></span></summary>
      <div class="chips">${g.items.map(([label, val]) => `<button type="button" class="chip" data-v="${esc(val)}">${esc(label)}</button>`).join('')}</div>
      <div class="custom"><input placeholder="Ou digite: ${esc(g.ph)}" aria-label="${esc(g.title)}: opção digitada" onkeydown="if(event.key==='Enter'){event.preventDefault();imgCustom(this)}"><button type="button" class="b sm" onclick="imgCustom(this.previousElementSibling)">Usar</button></div>
    </details>`).join('');
  box.dataset.built = '1';
}
// troca a frase do grupo dentro do pedido, sem mexer no que foi digitado no campo grande
function setGroupPhrase(det, phrase, label) {
  const ta = $('#imgPrompt'); const old = det.dataset.cur || '';
  let parts = ta.value.split(/\s*;\s*/).filter(Boolean);
  if (old) parts = parts.filter((p) => p !== old);
  if (phrase) parts.push(phrase);
  ta.value = parts.join('; ');
  det.dataset.cur = phrase || '';
  det.querySelector('.cur').textContent = label || '';
  det.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', !!phrase && c.dataset.v && phrase === IMG_GROUPS.find((g) => g.id === det.dataset.group).tpl(c.dataset.v)));
}
function imgCustom(input) {
  const det = input.closest('details'); const g = IMG_GROUPS.find((x) => x.id === det.dataset.group);
  const t = input.value.trim(); if (!t) return;
  setGroupPhrase(det, g.tpl(t), t); input.value = ''; toast(`${g.title}: "${t}"`);
}
function resetImgPresets() { $$('#imgPresets details').forEach((d) => { d.dataset.cur = ''; d.querySelector('.cur').textContent = ''; d.querySelectorAll('.chip').forEach((c) => c.classList.remove('on')); }); }
document.addEventListener('click', (e) => {
  const c = e.target.closest('#imgPresets .chip'); if (!c) return;
  const det = c.closest('details'); const g = IMG_GROUPS.find((x) => x.id === det.dataset.group);
  const phrase = g.tpl(c.dataset.v);
  if (det.dataset.cur === phrase) setGroupPhrase(det, '', ''); // tocar de novo desmarca
  else setGroupPhrase(det, phrase, c.textContent);
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
      const rec = await imgDbAdd({ itemId: String(imgItem.itemId || ''), productName: imgItem.productName || '', productLink: imgItem.productLink || '', prompt, aspect, model: info, createdAt: Date.now(), blob });
      box.replaceWith(imgCard(rec, { inModal: true }));
      refreshGalleryCounts();
    } catch (e) {
      box.className = 'imgres loading'; box.style.color = 'var(--err)'; box.textContent = e.message;
      break; // não insiste se deu erro (evita cobrança repetida)
    }
  }
  btn.disabled = false; btn.textContent = 'Gerar imagens';
}
const slugify = (s) => String(s || 'produto').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40).toLowerCase() || 'produto';

/* ---------------- imagens salvas no aparelho (IndexedDB) ---------------- */
// Ficam no armazenamento interno do celular (navegador / app instalado), sem servidor.
let _db = null;
function imgDb() {
  if (_db) return _db;
  _db = new Promise((res, rej) => {
    const req = indexedDB.open('painel-afiliados', 1);
    req.onupgradeneeded = () => { const st = req.result.createObjectStore('images', { keyPath: 'id', autoIncrement: true }); st.createIndex('itemId', 'itemId'); st.createIndex('createdAt', 'createdAt'); };
    req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error);
  });
  return _db;
}
const tx = async (mode, fn) => { const db = await imgDb(); return new Promise((res, rej) => { const t = db.transaction('images', mode); const st = t.objectStore('images'); let out; Promise.resolve(fn(st)).then((v) => { out = v; }); t.oncomplete = () => res(out); t.onerror = () => rej(t.error); }); };
const reqP = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
async function imgDbAdd(rec) {
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {}); // pede para o celular não apagar sozinho
  const id = await tx('readwrite', (st) => reqP(st.add(rec)));
  return { ...rec, id };
}
async function imgDbList(itemId) {
  const all = await tx('readonly', (st) => reqP(itemId ? st.index('itemId').getAll(itemId) : st.getAll()));
  return (all || []).sort((a, b) => b.createdAt - a.createdAt);
}
const imgDbDelete = (id) => tx('readwrite', (st) => reqP(st.delete(id)));
const imgDbCount = () => tx('readonly', (st) => reqP(st.count()));

const _urls = { modal: [], gallery: [] };
function revokeUrls(k) { (_urls[k] || []).forEach((u) => URL.revokeObjectURL(u)); _urls[k] = []; }
function blobUrl(blob, k) { const u = URL.createObjectURL(blob); (_urls[k] ||= []).push(u); return u; }
const imgName = (rec) => `${slugify(rec.productName)}-ia-${rec.id}.${(rec.blob.type || '').includes('png') ? 'png' : 'jpg'}`;

function imgCard(rec, { inModal = false } = {}) {
  const url = blobUrl(rec.blob, inModal ? 'modal' : 'gallery');
  const el = document.createElement('div'); el.className = 'imgres';
  const when = new Date(rec.createdAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  const canShare = !!(navigator.canShare && navigator.canShare({ files: [new File([rec.blob], 'x.png', { type: rec.blob.type || 'image/png' })] }));
  el.innerHTML = `<img src="${url}" alt="Imagem editada: ${esc(rec.prompt)}" loading="lazy">
    <div class="acts wrap">
      ${canShare ? '<button class="b sm" data-a="share">Compartilhar</button>' : ''}
      <a class="b sm" href="${url}" download="${esc(imgName(rec))}" style="text-decoration:none;color:inherit;text-align:center">Baixar</a>
      <button class="b sm" data-a="edit">Editar esta</button>
      <button class="b sm" data-a="del" aria-label="Apagar imagem">Apagar</button>
    </div>
    <div class="meta">${esc(rec.prompt)}</div><div class="meta">${when}${rec.model ? ' · ' + esc(rec.model) : ''}</div>`;
  el.querySelector('[data-a=share]')?.addEventListener('click', async () => {
    try { await navigator.share({ files: [new File([rec.blob], imgName(rec), { type: rec.blob.type || 'image/png' })], title: rec.productName }); } catch {}
  });
  el.querySelector('[data-a=edit]').addEventListener('click', async () => {
    if (!inModal) { const prod = FAV.get(rec.itemId) || { itemId: rec.itemId, productName: rec.productName, productLink: rec.productLink, imageUrl: 'x' }; openImgEdit(prod); }
    imgSource = { b64: await blobToSmallDataURL(rec.blob) };
    $('#imgSrc').src = url; $('#imgSrcLabel').textContent = rec.model === 'importada' ? rec.prompt : 'Editando a imagem gerada'; $('#imgPrompt').value = ''; resetImgPresets();
    $('#imgModal').scrollTop = 0; toast('Agora as mudanças valem sobre esta imagem');
  });
  el.querySelector('[data-a=del]').addEventListener('click', async () => {
    if (!confirm('Apagar esta imagem do aparelho?')) return;
    await imgDbDelete(rec.id); el.remove(); refreshGalleryCounts(); toast('Imagem apagada');
  });
  return el;
}

// Galeria: todas as imagens salvas, agrupadas por produto
async function renderGallery() {
  const out = $('#gallery .out'); revokeUrls('gallery');
  const list = await imgDbList();
  const est = navigator.storage?.estimate ? await navigator.storage.estimate() : null;
  const persisted = navigator.storage?.persisted ? await navigator.storage.persisted() : null;
  const used = list.reduce((s2, r) => s2 + (r.blob?.size || 0), 0);
  out.innerHTML = `<div class="bar"><span class="info">${list.length} ${list.length === 1 ? 'imagem' : 'imagens'} · ${used < 1048576 ? Math.max(1, Math.round(used / 1024)) + ' KB' : (used / 1048576).toFixed(1).replace('.', ',') + ' MB'}${est?.quota ? ` · espaço livre ≈ ${(Math.max(0, est.quota - est.usage) / 1073741824).toFixed(1).replace('.', ',')} GB` : ''}</span>
    ${list.length ? '<button class="b sm" onclick="zipGallery()">Baixar todas (zip)</button>' : ''}</div>
    ${persisted === false && list.length ? '<div class="note warn">O celular pode apagar estes dados se faltar espaço. Para garantir, <b>instale o painel como app</b> (Manual → Instalar como aplicativo) e baixe as imagens importantes.</div>' : ''}
    ${list.length ? '' : '<div class="empty">Nenhuma imagem ainda. Edite uma foto com IA (no detalhe do produto ou em Para gravar) e ela aparece aqui automaticamente.</div>'}`;
  const groups = new Map();
  for (const r of list) { const k = r.itemId || r.productName; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }
  for (const [, recs] of groups) {
    const h = document.createElement('h3'); h.className = 'gridtitle'; h.textContent = `${recs[0].productName || 'Produto'} (${recs.length})`;
    const grid = document.createElement('div'); grid.className = 'imggrid';
    recs.forEach((r) => grid.append(imgCard(r)));
    out.append(h, grid);
  }
}
async function zipGallery() {
  const list = await imgDbList(); if (!list.length) return;
  const files = await Promise.all(list.map(async (r) => ({ name: imgName(r), data: new Uint8Array(await r.blob.arrayBuffer()) })));
  saveBlob({ blob: makeZipJS(files), name: 'imagens-ia.zip' });
}
// ZIP simples (sem compressão) feito no próprio celular
const _crcT = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function makeZipJS(files) {
  const enc = new TextEncoder(); const parts = []; const central = []; let off = 0;
  for (const f of files) {
    let c = 0xffffffff; for (const x of f.data) c = _crcT[(c ^ x) & 0xff] ^ (c >>> 8); const crc = (c ^ 0xffffffff) >>> 0;
    const nm = enc.encode(f.name); const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint32(14, crc, true); lh.setUint32(18, f.data.length, true); lh.setUint32(22, f.data.length, true); lh.setUint16(26, nm.length, true);
    parts.push(lh, nm, f.data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint32(16, crc, true); ch.setUint32(20, f.data.length, true); ch.setUint32(24, f.data.length, true); ch.setUint16(28, nm.length, true); ch.setUint32(42, off, true);
    central.push(ch, nm); off += 30 + nm.length + f.data.length;
  }
  const cdSize = central.reduce((s2, x) => s2 + x.byteLength, 0);
  const end = new DataView(new ArrayBuffer(22)); end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, cdSize, true); end.setUint32(16, off, true);
  return new Blob([...parts, ...central, end], { type: 'application/zip' });
}
// contadores: aba Galeria e botão "Fotos IA (n)" em cada produto da lista
async function refreshGalleryCounts() {
  try {
    const all = await imgDbList(); const t = $('nav button[data-t=gallery]'); if (t) t.textContent = all.length ? `Galeria (${all.length})` : 'Galeria';
    const by = {}; all.forEach((r) => { by[r.itemId] = (by[r.itemId] || 0) + 1; });
    $$('[data-imgcount]').forEach((b) => { const n = by[b.dataset.imgcount] || 0; b.textContent = n ? `Fotos IA (${n})` : 'Editar foto'; });
    if ($('#gallery')?.classList.contains('on')) renderGallery();
  } catch {}
}

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
  refreshGalleryCounts();
  if (STORE) api('settings/get', {}).then((r) => { window._settings = r.settings; if (r.settings?.goal && !lsGet('goal')) lsSet('goal', r.settings.goal); });
}
initExtras();
