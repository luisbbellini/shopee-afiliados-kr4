// Funcionalidades extras: lista "Para gravar", configurações, alertas, roteiro com IA, fotos em zip.
import { cmd, pipeline, hgetallJSON, getJSON, setJSON, storeEnabled, recordSnapshot, trending, today } from './store.js';
import { findOpportunities } from './opportunities.js';

/* ---------------- lista "Para gravar" ---------------- */
export const STATUS = ['a_gravar', 'gravado', 'postado'];
const FAV_FIELDS = ['itemId', 'productName', 'imageUrl', 'productLink', 'offerLink', 'shopName', 'shopId', 'priceMin', 'commissionRate', 'commission', 'sales', 'ratingStar', 'score'];

export async function favList() {
  const all = await hgetallJSON('fav');
  return Object.values(all).sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
}
export async function favSave(item = {}) {
  if (!item.itemId) throw new Error('Produto sem itemId');
  const id = String(item.itemId);
  const old = JSON.parse((await cmd('HGET', 'fav', id)) || 'null') || {};
  const base = {};
  for (const k of FAV_FIELDS) if (item[k] !== undefined) base[k] = item[k];
  const merged = { ...old, ...base, itemId: id };
  for (const k of ['status', 'notes', 'shortLink', 'subId', 'script']) if (item[k] !== undefined) merged[k] = item[k];
  merged.status = STATUS.includes(merged.status) ? merged.status : 'a_gravar';
  merged.addedAt = old.addedAt || Date.now();
  merged.updatedAt = Date.now();
  if (merged.watchRate === undefined && merged.commissionRate !== undefined) merged.watchRate = merged.commissionRate;
  await cmd('HSET', 'fav', id, JSON.stringify(merged));
  return merged;
}
export const favRemove = (itemId) => cmd('HDEL', 'fav', String(itemId));

/* ---------------- configurações ---------------- */
const DEFAULTS = { niches: [], minScore: 70, minSales: 100, ntfyTopic: '', telegramToken: '', telegramChatId: '', goal: 0 };
export async function getSettings() { return { ...DEFAULTS, ...(await getJSON('settings', {})) }; }
const maskTok = (t) => (t ? t.slice(0, 6) + '…' + t.slice(-4) : '');
export async function getSettingsPublic() { const s = await getSettings(); return { ...s, telegramToken: maskTok(s.telegramToken), hasTelegramToken: !!s.telegramToken }; }
export async function saveSettings(b = {}) {
  const s = await getSettings();
  const next = { ...s };
  if (Array.isArray(b.niches)) next.niches = b.niches.map((x) => String(x).trim()).filter(Boolean).slice(0, 5);
  for (const k of ['minScore', 'minSales', 'goal']) if (b[k] !== undefined && b[k] !== '') next[k] = Number(b[k]) || 0;
  for (const k of ['ntfyTopic', 'telegramChatId']) if (b[k] !== undefined) next[k] = String(b[k]).trim();
  if (b.telegramToken !== undefined && !String(b.telegramToken).includes('…')) next.telegramToken = String(b.telegramToken).trim();
  await setJSON('settings', next);
  return next;
}

/* ---------------- envio de alertas ---------------- */
export async function notify(s, title, message, url) {
  const sent = [], errors = [];
  if (s.ntfyTopic) {
    try {
      const r = await fetch('https://ntfy.sh/' + encodeURIComponent(s.ntfyTopic), {
        method: 'POST', body: message,
        headers: { Title: encodeURIComponent(title).length === title.length ? title : 'Shopee Afiliados', Tags: 'shopping_cart', ...(url ? { Click: url } : {}), 'Content-Type': 'text/plain; charset=utf-8' },
      });
      r.ok ? sent.push('ntfy') : errors.push('ntfy: HTTP ' + r.status);
    } catch (e) { errors.push('ntfy: ' + e.message); }
  }
  if (s.telegramToken && s.telegramChatId) {
    try {
      const r = await fetch(`https://api.telegram.org/bot${s.telegramToken}/sendMessage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: s.telegramChatId, text: `${title}\n\n${message}${url ? '\n\n' + url : ''}`, disable_web_page_preview: true }),
      });
      const j = await r.json().catch(() => ({}));
      j.ok ? sent.push('telegram') : errors.push('telegram: ' + (j.description || r.status));
    } catch (e) { errors.push('telegram: ' + e.message); }
  }
  if (!s.ntfyTopic && !(s.telegramToken && s.telegramChatId)) errors.push('Nenhum canal de alerta configurado');
  return { sent, errors };
}

/* ---------------- tarefa diária ---------------- */
const brl = (v) => 'R$ ' + (+v || 0).toFixed(2).replace('.', ',');
const pct = (v) => ((+v || 0) * 100).toFixed(0) + '%';
const short = (s, n = 48) => (s && s.length > n ? s.slice(0, n - 1) + '…' : s || '');

export async function dailyJob(client, key, { panelUrl, budgetMs = 45000 } = {}) {
  const t0 = Date.now();
  const s = await getSettings();
  const lines = [], log = [];
  const newOpps = [];

  // 1) nichos salvos: roda Oportunidades (1 página) e guarda a foto do dia
  for (const kw of s.niches.slice(0, 3)) {
    if (Date.now() - t0 > budgetMs - 15000) { log.push(`sem tempo para "${kw}"`); break; }
    const r = await findOpportunities(client, key, { keyword: kw, pages: 1, minSales: s.minSales, minRating: 4.5 });
    log.push(`"${kw}": ${r.nodes?.length || 0} oportunidades${r.errors?.length ? ' (erro: ' + r.errors[0].message + ')' : ''}`);
    await recordSnapshot(r.all || r.nodes || []).catch(() => {});
    for (const n of r.nodes || []) if (n.score >= s.minScore) newOpps.push({ ...n, niche: kw });
  }
  // avisa só o que ainda não foi avisado
  const fresh = [];
  for (const n of newOpps.sort((a, b) => b.score - a.score)) {
    if (fresh.length >= 5) break;
    if (+(await cmd('SISMEMBER', 'alerted', String(n.itemId)))) continue;
    fresh.push(n);
  }
  if (fresh.length) {
    await cmd('SADD', 'alerted', ...fresh.map((n) => String(n.itemId)));
    lines.push('🔥 Novas oportunidades:');
    for (const n of fresh) lines.push(`• [${n.score}] ${short(n.productName)} — ${brl(n.priceMin)}, comissão ${pct(n.commissionRate)} (${n.niche})`);
  }

  // 2) lista "Para gravar": mudança de comissão (com base na foto de hoje)
  const favs = await favList();
  if (favs.length) {
    const vals = await cmd('HMGET', `snap:${today()}`, ...favs.map((f) => String(f.itemId)));
    const ups = [];
    favs.forEach((f, i) => {
      if (!vals[i]) return;
      const rate = +String(vals[i]).split('|')[2];
      const was = +f.watchRate || 0;
      if (rate && was && Math.abs(rate - was) >= 0.005) ups.push({ f, was, rate });
    });
    if (ups.length) {
      lines.push('', '⭐ Comissão mudou na sua lista:');
      for (const u of ups) {
        lines.push(`• ${short(u.f.productName)}: ${pct(u.was)} → ${pct(u.rate)}${u.rate > u.was ? ' ⬆️' : ' ⬇️'}`);
        await cmd('HSET', 'fav', String(u.f.itemId), JSON.stringify({ ...u.f, watchRate: u.rate, commissionRate: u.rate }));
      }
    }
  }

  // 3) em alta (precisa de pelo menos 2 dias de histórico)
  try {
    const tr = await trending({ days: 7, minDelta: 20, limit: 3 });
    if (tr.items.length) {
      lines.push('', `📈 Em alta (${tr.spanDays} dia${tr.spanDays > 1 ? 's' : ''}):`);
      for (const t of tr.items) lines.push(`• ${short(t.productName)}: +${t.delta.toLocaleString('pt-BR')} vendas`);
    }
  } catch {}

  let delivery = { sent: [], errors: [] };
  if (lines.length) delivery = await notify(s, 'Shopee Afiliados — resumo do dia', lines.join('\n'), panelUrl);
  const summary = { at: new Date().toISOString(), lines, log, delivery, ms: Date.now() - t0 };
  await setJSON('lastCron', summary);
  return summary;
}

/* ---------------- roteiro com IA (ChatGPT, Claude ou Gemini) ---------------- */
// Tipos de vídeo
const FORMATS = {
  narracao: 'NARRAÇÃO (voz em off): ninguém aparece falando; uma voz narra por cima de imagens do produto (mãos, detalhes, peça vestida). Texto em terceira pessoa ou falando direto com quem assiste ("você"), nunca "eu".',
  primeira_pessoa: 'FALANDO PARA A CÂMERA (1ª pessoa): a criadora aparece e fala olhando para a câmera, em primeira pessoa ("eu", "olha isso"), como uma conversa com uma amiga. Inclua o que ela faz em cada cena (mostrar, vestir, apontar detalhe).',
  texto: 'SÓ TEXTO NA TELA (sem fala): vídeo com música de fundo e frases curtas escritas na tela, sem ninguém falando. Cada cena tem um texto curto e o que filmar.',
};
// Descobre a empresa pela chave: sk-ant-… = Anthropic, AIza… = Google, sk-… = OpenAI.
export function detectProvider(key = '') {
  const k = String(key).trim();
  if (k.startsWith('sk-ant-')) return 'anthropic';
  if (k.startsWith('AIza')) return 'gemini';
  if (k.startsWith('sk-')) return 'openai';
  return '';
}
// Modelos tentados em ordem (se um não existir na conta, tenta o próximo).
const MODELS = {
  openai: ['gpt-5-mini', 'gpt-5-nano', 'gpt-4.1-mini', 'gpt-4o-mini'],
  anthropic: ['claude-haiku-5-5', 'claude-sonnet-5-5'],
  gemini: ['gemini-flash-latest', 'gemini-3.5-flash-lite'],
};
const NAMES = { openai: 'ChatGPT (OpenAI)', anthropic: 'Claude (Anthropic)', gemini: 'Gemini (Google)' };
const modelMissing = (status, msg) => status === 404 || /model.*(not.?found|does not exist|not supported|invalid)|unknown model|model_not_found/i.test(msg || '');

async function callAI(provider, apiKey, model, prompt) {
  try { return await callAIRaw(provider, apiKey, model, prompt); }
  catch (e) { throw new Error(`${NAMES[provider]}: não consegui conectar à IA (${e.message}). Tente de novo em instantes.`); }
}
async function callAIRaw(provider, apiKey, model, prompt) {
  if (provider === 'openai') {
    const body = { model, messages: [{ role: 'system', content: 'Responda somente com JSON válido.' }, { role: 'user', content: prompt }], response_format: { type: 'json_object' } };
    let r = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    let j = await r.json().catch(() => ({}));
    if (r.status === 400 && /response_format/i.test(j.error?.message || '')) { // modelo sem modo JSON
      delete body.response_format;
      r = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      j = await r.json().catch(() => ({}));
    }
    return { ok: r.ok, status: r.status, error: j.error?.message, text: j.choices?.[0]?.message?.content || '' };
  }
  if (provider === 'anthropic') {
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify({ model, max_tokens: 1500, messages: [{ role: 'user', content: prompt }] }) });
    const j = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, error: j.error?.message, text: (j.content || []).map((c) => c.text || '').join('') };
  }
  if (provider === 'gemini') {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, { method: 'POST', headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json' } }) });
    const j = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, error: j.error?.message, text: (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('') };
  }
  throw new Error('Empresa de IA desconhecida');
}

export async function videoScript({ product = {}, tone = 'animado', duration = 30, extra = '', format = 'narracao', used = false }, ai = {}) {
  const apiKey = String(ai.key || '').trim();
  if (!apiKey) throw new Error('Configure a chave da IA em ⚙ Configurações (ChatGPT, Claude ou Gemini).');
  const provider = ai.provider && ai.provider !== 'auto' ? ai.provider : detectProvider(apiKey);
  if (!provider) throw new Error('Não reconheci a chave. Escolha a empresa da IA em ⚙ Configurações.');
  const p = product;
  const prompt = `Você é roteirista de vídeos curtos para afiliados da Shopee no Brasil (TikTok, Reels, Shopee Vídeo).
Crie um roteiro de ${duration} segundos, tom ${tone}, em português do Brasil, para o produto abaixo. Não invente características técnicas que não estejam nos dados; quando faltar informação, fale de uso e benefício de forma genérica. Não prometa preço fixo (pode mudar).

TIPO DE VÍDEO: ${FORMATS[format] || FORMATS.narracao}
${format === 'primeira_pessoa' ? (used
    ? 'A criadora já tem/usou o produto: pode falar da experiência dela de forma natural, sem exagerar nem inventar resultados específicos.'
    : 'A criadora AINDA NÃO usou o produto: ela está mostrando/apresentando o que encontrou. Não escreva frases como "eu uso há meses", "mudou minha vida" ou resultados pessoais; use "olha o que eu achei", "repara nesse detalhe", "fiquei de olho nesse".') : ''}

Produto: ${p.productName || ''}
Preço: R$ ${p.priceMin || '?'}${p.priceMax && p.priceMax !== p.priceMin ? ' até R$ ' + p.priceMax : ''}
Vendidos: ${p.sales ?? '?'} | Nota: ${p.ratingStar ?? '?'} | Desconto: ${p.priceDiscountRate ? p.priceDiscountRate + '%' : 'não informado'}
Loja: ${p.shopName || '?'}
${extra ? 'Observações da criadora: ' + extra : ''}

Responda SOMENTE com JSON válido neste formato:
{"gancho":"frase dos 3 primeiros segundos","cenas":[{"tempo":"0-3s","fala":"${format === 'texto' ? '' : (format === 'narracao' ? 'texto da narração (voz em off)' : 'o que a criadora fala olhando para a câmera')}","texto_tela":"texto curto que aparece escrito na tela","imagem":"o que mostrar / como filmar"}],"cta":"chamada para comprar no link","legenda":"legenda do post","hashtags":["#..."],"musica":"sugestão de estilo de música de fundo","ideias_extra":["variação de gancho 1","variação de gancho 2"]}${format === 'texto' ? '\nNeste tipo o campo "fala" fica vazio: tudo é comunicado pelo "texto_tela" (frases curtas, fáceis de ler em 2 segundos).' : ''}`;

  const models = ai.model ? [ai.model] : MODELS[provider];
  let last;
  for (const model of models) {
    last = await callAI(provider, apiKey, model, prompt);
    if (last.ok) {
      const m = last.text.match(/\{[\s\S]*\}/);
      let script; try { script = JSON.parse(m ? m[0] : last.text); } catch { script = { texto: last.text }; }
      return { ...script, _ia: `${NAMES[provider]} · ${model}`, _formato: format };
    }
    if (!modelMissing(last.status, last.error) || ai.model) break;
  }
  const hint = last.status === 401 ? ' (chave inválida)' : last.status === 429 ? ' (sem créditos ou limite atingido)' : '';
  throw new Error(`${NAMES[provider]}: ${last.error || 'HTTP ' + last.status}${hint}`);
}

// Teste rápido da chave (resposta mínima, custo desprezível)
export async function aiTest(ai = {}) {
  const apiKey = String(ai.key || '').trim();
  if (!apiKey) throw new Error('Nenhuma chave de IA configurada.');
  const provider = ai.provider && ai.provider !== 'auto' ? ai.provider : detectProvider(apiKey);
  if (!provider) throw new Error('Não reconheci a chave. Escolha a empresa da IA.');
  const models = ai.model ? [ai.model] : MODELS[provider];
  let last;
  for (const model of models) {
    last = await callAI(provider, apiKey, model, 'Responda exatamente com este JSON: {"ok":true}');
    if (last.ok) return { ok: true, provider: NAMES[provider], model };
    if (!modelMissing(last.status, last.error) || ai.model) break;
  }
  const hint = last.status === 401 ? ' (chave inválida)' : last.status === 429 ? ' (sem créditos ou limite atingido)' : '';
  throw new Error(`${NAMES[provider]}: ${last.error || 'HTTP ' + last.status}${hint}`);
}

/* ---------------- editar foto com IA (ChatGPT ou Gemini) ---------------- */
const IMG_MODELS = {
  openai: ['gpt-image-2.5-flare', 'gpt-image-2', 'gpt-image-1.5', 'gpt-image-1-mini'],
  gemini: ['gemini-nano-banana-2.1', 'gemini-3.1-flash-image'],
};
// Regras fixas: o produto não pode mudar; pessoa nova é sempre fictícia.
const IMG_RULES = `REGRAS OBRIGATÓRIAS:
- Mantenha o produto (roupa, calçado ou objeto) EXATAMENTE igual ao da foto original: mesma cor, modelagem, comprimento, estampa, tecido, textura, botões, costuras, detalhes e logotipos. Não invente nem remova detalhes do produto.
- Se o pedido envolver trocar a pessoa/modelo, crie uma pessoa nova e fictícia, que não se pareça com a pessoa original nem com nenhuma pessoa real conhecida, vestindo/usando o mesmo produto, com o mesmo caimento.
- Fotografia realista de catálogo/e-commerce, iluminação profissional, nítida, sem texto, sem marca d'água, sem bordas.`;
const ASPECT = { '9:16': { openai: '1024x1536', label: 'vertical 9:16 (stories/TikTok)' }, '4:5': { openai: '1024x1536', label: 'vertical 4:5 (feed)' }, '1:1': { openai: '1024x1024', label: 'quadrado 1:1' } };

export async function editImage({ url, imageB64, prompt = '', aspect = '4:5' }, ai = {}) {
  const apiKey = String(ai.key || '').trim();
  if (!apiKey) throw new Error('Configure a chave da IA em ⚙ Configurações (ChatGPT ou Gemini).');
  const provider = ai.provider && ai.provider !== 'auto' ? ai.provider : detectProvider(apiKey);
  if (provider === 'anthropic') throw new Error('O Claude não gera imagens. Para editar fotos, use uma chave do ChatGPT (OpenAI) ou do Gemini (Google).');
  if (!IMG_MODELS[provider]) throw new Error('Não reconheci a chave da IA. Escolha a empresa em ⚙ Configurações.');
  if (!String(prompt).trim()) throw new Error('Escreva ou escolha o que mudar na foto.');

  // imagem de origem: foto do produto (Shopee) ou a imagem já editada que o painel mandou
  let buf, type;
  if (imageB64) {
    const m = String(imageB64).match(/^data:(image\/[a-z+]+);base64,(.*)$/);
    buf = Buffer.from(m ? m[2] : imageB64, 'base64'); type = m ? m[1] : 'image/jpeg';
    if (buf.length > 8 * 1024 * 1024) throw new Error('Imagem grande demais (máx. 8 MB).');
  } else ({ buf, type } = await fetchImage(url));

  const ar = ASPECT[aspect] ? aspect : '4:5';
  const fullPrompt = `Edite esta foto de produto: ${prompt.trim()}\nFormato final: ${ASPECT[ar].label}.\n\n${IMG_RULES}`;
  const models = ai.imageModel ? [ai.imageModel] : IMG_MODELS[provider];
  let last;
  for (const model of models) {
    try { last = provider === 'openai' ? await openaiEdit(apiKey, model, buf, type, fullPrompt, ASPECT[ar].openai) : await geminiEdit(apiKey, model, buf, type, fullPrompt, ar); }
    catch (e) { throw new Error(`${NAMES[provider]}: não consegui conectar (${e.message}).`); }
    if (last.ok) return { buf: last.buf, type: last.type, model: `${NAMES[provider]} · ${model}` };
    if (!modelMissing(last.status, last.error) || ai.imageModel) break;
  }
  const e = last.error || 'HTTP ' + last.status;
  const hint = last.status === 401 ? ' (chave inválida)' : last.status === 429 ? ' (sem créditos ou limite atingido)'
    : /verif/i.test(e) ? ' — a OpenAI pede verificar a organização para gerar imagens: platform.openai.com → Settings → Organization → Verify.'
    : /safety|policy|moderat|blocked/i.test(e) ? ' — a IA recusou o pedido; tente descrever de outro jeito.' : '';
  throw new Error(`${NAMES[provider]}: ${e}${hint}`);
}

async function openaiEdit(apiKey, model, buf, type, prompt, size) {
  const send = async (withFidelity) => {
    const fd = new FormData();
    fd.append('model', model);
    fd.append('prompt', prompt);
    fd.append('image', new Blob([buf], { type }), 'produto.' + (/png/.test(type) ? 'png' : /webp/.test(type) ? 'webp' : 'jpg'));
    fd.append('size', size);
    fd.append('quality', 'medium');
    fd.append('n', '1');
    if (withFidelity) fd.append('input_fidelity', 'high'); // preserva melhor os detalhes do produto
    const r = await fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, body: fd });
    const j = await r.json().catch(() => ({}));
    return { r, j };
  };
  let { r, j } = await send(true);
  if (r.status === 400 && /input_fidelity/i.test(j.error?.message || '')) ({ r, j } = await send(false));
  const b64 = j.data?.[0]?.b64_json;
  if (!r.ok || !b64) return { ok: false, status: r.status, error: j.error?.message || 'a IA não devolveu imagem' };
  return { ok: true, buf: Buffer.from(b64, 'base64'), type: 'image/png' };
}

async function geminiEdit(apiKey, model, buf, type, prompt, aspect) {
  const send = async (withAspect) => {
    const body = { contents: [{ role: 'user', parts: [{ text: prompt }, { inlineData: { mimeType: type, data: buf.toString('base64') } }] }], generationConfig: { responseModalities: ['IMAGE'], ...(withAspect ? { imageConfig: { aspectRatio: aspect } } : {}) } };
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, { method: 'POST', headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    return { r, j };
  };
  let { r, j } = await send(true);
  if (r.status === 400 && /imageConfig|aspect/i.test(j.error?.message || '')) ({ r, j } = await send(false));
  const part = (j.candidates?.[0]?.content?.parts || []).find((p) => p.inlineData || p.inline_data);
  const d = part?.inlineData || part?.inline_data;
  if (!r.ok || !d?.data) {
    const why = j.error?.message || j.promptFeedback?.blockReason || j.candidates?.[0]?.finishReason || 'a IA não devolveu imagem';
    return { ok: false, status: r.ok ? 422 : r.status, error: why };
  }
  return { ok: true, buf: Buffer.from(d.data, 'base64'), type: d.mimeType || d.mime_type || 'image/png' };
}

/* ---------------- fotos ---------------- */
const IMG_HOSTS = [/(^|\.)susercontent\.com$/, /(^|\.)shopee\.com\.br$/, /(^|\.)shopee\.[a-z.]+$/, /(^|\.)shopeemobile\.com$/, /^picsum\.photos$/, /(^|\.)fastly\.picsum\.photos$/];
function safeImageUrl(u) {
  let url; try { url = new URL(u); } catch { return null; }
  if (url.protocol !== 'https:') return null;
  return IMG_HOSTS.some((re) => re.test(url.hostname)) ? url.toString() : null;
}
export async function fetchImage(u) {
  const url = safeImageUrl(u);
  if (!url) throw new Error('Endereço de imagem não permitido');
  const r = await fetch(url, { redirect: 'follow' });
  if (!r.ok) throw new Error('Imagem: HTTP ' + r.status);
  const type = r.headers.get('content-type') || 'image/jpeg';
  return { buf: Buffer.from(await r.arrayBuffer()), type };
}
const extOf = (type) => (/png/.test(type) ? 'png' : /webp/.test(type) ? 'webp' : 'jpg');
export const slug = (s) => String(s || 'produto').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60).toLowerCase() || 'produto';

// ZIP sem compressão (as fotos já são comprimidas)
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
export function makeZip(files) {
  const parts = [], central = []; let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8'); const data = f.data; const crc = crc32(data);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(0, 8);
    lh.writeUInt32LE(0, 10); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
    parts.push(lh, name, data);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(0, 10);
    ch.writeUInt32LE(0, 12); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(offset, 42); central.push(ch, name);
    offset += 30 + name.length + data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}
export async function imagesZip(items = []) {
  const files = []; const errors = []; const used = new Set();
  for (const it of items.slice(0, 60)) {
    try {
      const { buf, type } = await fetchImage(it.url);
      let name = slug(it.name) + '.' + extOf(type); let i = 2;
      while (used.has(name)) name = slug(it.name) + '-' + i++ + '.' + extOf(type);
      used.add(name); files.push({ name, data: buf });
    } catch (e) { errors.push(`${it.name}: ${e.message}`); }
  }
  if (errors.length) files.push({ name: 'erros.txt', data: Buffer.from(errors.join('\n'), 'utf8') });
  return makeZip(files);
}
export { storeEnabled, trending, recordSnapshot, extOf };
