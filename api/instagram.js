// Atendente do Instagram (Vercel).
//   Webhook da Meta:  GET/POST https://SEU-PROJETO.vercel.app/api/instagram
//   API do painel:    https://SEU-PROJETO.vercel.app/api/instagram?acao=...   (página em /instagram)
import crypto from 'node:crypto';
import { getConfig, saveConfig, configPublica, CAMPOS } from '../src/instagram/config.js';
import { pedeLink } from '../src/instagram/match.js';
import * as ig from '../src/instagram/instagram.js';
import { contar, registrar, marcarEnviado, marcarResposta, resumo } from '../src/instagram/stats.js';
import { estadoLogin, criarUsuario, entrar, sessao, trocarSenha } from '../src/instagram/auth.js';
import { storeEnabled } from '../src/store.js';

const sortear = (l) => l[Math.floor(Math.random() * l.length)];
const json = (dados, status = 200) =>
  new Response(JSON.stringify(dados), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });

const montarMensagem = (cfg, link, username) =>
  cfg.mensagem.replace(/\\n/g, '\n').replace('{link}', link).replace('{nome}', username ? ` @${username}` : '');

function assinaturaValida(cfg, corpo, assinatura) {
  if (!cfg.appSecret) return true; // sem segredo configurado não dá para validar
  if (!assinatura?.startsWith('sha256=')) return false;
  const esperado = 'sha256=' + crypto.createHmac('sha256', cfg.appSecret).update(corpo).digest('hex');
  const a = Buffer.from(assinatura), b = Buffer.from(esperado);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* ======================= WEBHOOK ======================= */

async function tratarComentario(cfg, v) {
  if (!v?.id || !v.text || !v.media?.id) return;
  if (cfg.igUserId && v.from?.id === cfg.igUserId) return; // respostas do próprio perfil
  const user = v.from?.username;

  if (!pedeLink(v.text, cfg.listaPalavras)) {
    await contar(['comentarios']);
    return;
  }
  await contar(['comentarios', 'pedidos']);

  try {
    const { link, permalink } = await ig.linkDoPost(cfg, v.media.id);
    const r = await ig.responderNoDirect(cfg, v.id, montarMensagem(cfg, link, user));
    await Promise.all([
      contar(['enviados']),
      marcarEnviado({ ids: [r.recipient_id, v.from?.id], mediaId: v.media.id, link, permalink }),
      registrar({ tipo: 'enviado', origem: 'comentário', user, texto: v.text, link, permalink }),
    ]);
    console.log(`[comentário] link enviado para @${user}: ${link}`);
  } catch (e) {
    await Promise.all([contar(['falhas']), registrar({ tipo: 'falha', origem: 'comentário', user, texto: v.text, erro: e.message })]);
    throw e;
  }

  if (cfg.respostasPublicas.length) {
    await ig.responderComentario(cfg, v.id, sortear(cfg.respostasPublicas)).catch((e) => console.warn('[comentário] resposta pública falhou:', e.message));
  }
}

async function tratarDirect(cfg, m) {
  const msg = m.message;
  if (!msg || msg.is_echo || !m.sender?.id) return;
  if (cfg.igUserId && m.sender.id === cfg.igUserId) return;
  const texto = msg.text || (msg.attachments?.length ? '[anexo]' : '');

  const campos = ['directs'];
  if (await marcarResposta(m.sender.id)) {
    campos.push('responderam');
    await registrar({ tipo: 'respondeu', origem: 'direct', user: m.sender.id, texto });
  }

  const pediu = cfg.direct && msg.text && pedeLink(msg.text, cfg.listaPalavras);
  if (pediu) campos.push('pedidos');
  await contar(campos);
  if (!pediu) return;

  try {
    const mediaId = msg.reply_to?.story?.id || (await ig.ultimoPost(cfg));
    if (!mediaId) return;
    const { link, permalink } = await ig.linkDoPost(cfg, mediaId);
    await ig.enviarDirect(cfg, m.sender.id, montarMensagem(cfg, link));
    await Promise.all([
      contar(['enviados']),
      marcarEnviado({ ids: [m.sender.id], mediaId, link, permalink }),
      registrar({ tipo: 'enviado', origem: 'direct', user: m.sender.id, texto: msg.text, link, permalink }),
    ]);
  } catch (e) {
    await Promise.all([contar(['falhas']), registrar({ tipo: 'falha', origem: 'direct', user: m.sender.id, texto: msg.text, erro: e.message })]);
    throw e;
  }
}

async function webhook(request) {
  const cfg = await getConfig();
  const corpo = await request.text();
  if (!assinaturaValida(cfg, corpo, request.headers.get('x-hub-signature-256'))) return new Response('assinatura inválida', { status: 401 });
  if (!cfg.token) return new Response('ok'); // ainda não configurado

  let payload;
  try { payload = JSON.parse(corpo); } catch { return new Response('ok'); }

  const tarefas = [];
  for (const entry of payload.entry || []) {
    for (const c of entry.changes || []) {
      if (c.field === 'comments' || c.field === 'live_comments') tarefas.push(tratarComentario(cfg, c.value));
    }
    for (const m of entry.messaging || []) tarefas.push(tratarDirect(cfg, m));
  }
  const res = await Promise.allSettled(tarefas);
  res.filter((r) => r.status === 'rejected').forEach((r) => console.error('[erro]', r.reason?.message));
  return new Response('ok'); // sempre 200 para a Meta não reenviar
}

/* ======================= PAINEL ======================= */

const DIAS_RENOVAR = 40;

async function renovarSePreciso(cfg, forcar = false) {
  if (!cfg.token || !storeEnabled()) return null;
  const idade = cfg.tokenSalvoEm ? (Date.now() - Number(cfg.tokenSalvoEm)) / 86400000 : Infinity;
  if (!forcar && idade < DIAS_RENOVAR) return null;
  const r = await ig.renovarToken(cfg.token);
  await saveConfig({ token: r.access_token, tokenSalvoEm: Date.now() });
  return r;
}

const acoes = {
  // Sem login
  async estado() { return { ...(await estadoLogin()) }; },
  async 'criar-usuario'(b) { return criarUsuario(b); },
  async entrar(b) { return entrar(b); },

  // Com login
  async painel(b, { url }) {
    let cfg = await getConfig({ fresco: true });
    let aviso = null;
    await renovarSePreciso(cfg).catch((e) => { aviso = 'Não consegui renovar o token: ' + e.message; });
    return {
      banco: storeEnabled(),
      webhookUrl: `${url.origin}/api/instagram`,
      config: await configPublica(),
      stats: storeEnabled() ? await resumo(Number(b.dias) || 30) : null,
      aviso,
    };
  },
  async 'salvar-config'(b) {
    const novo = {};
    for (const k of CAMPOS) if (k !== 'tokenSalvoEm' && k !== 'igUsername' && typeof b[k] === 'string') novo[k] = b[k];
    if (novo.token === '' ) delete novo.token;          // campo vazio = manter o atual
    if (novo.appSecret === '') delete novo.appSecret;
    if (novo.token) {
      novo.tokenSalvoEm = String(Date.now());
      // Descobre o ID da conta automaticamente pelo token
      const tmp = { ...(await getConfig({ fresco: true })), token: novo.token };
      const me = await ig.quemSou(tmp).catch(() => null);
      if (me?.user_id && !novo.igUserId) novo.igUserId = String(me.user_id);
      if (me?.username) novo.igUsername = me.username;
    }
    await saveConfig(novo);
    return { config: await configPublica() };
  },
  async testar() {
    const cfg = await getConfig({ fresco: true });
    if (!cfg.token) throw new Error('Cole o token de acesso primeiro.');
    const me = await ig.quemSou(cfg);
    await saveConfig({ igUsername: me.username || '', ...(me.user_id && !cfg.igUserId ? { igUserId: String(me.user_id) } : {}) });
    return { conta: me, idConfere: !cfg.igUserId || String(me.user_id) === cfg.igUserId };
  },
  async 'renovar-token'() {
    const r = await renovarSePreciso(await getConfig({ fresco: true }), true);
    return { ok: !!r, expiraEmDias: r ? Math.round(r.expires_in / 86400) : null, config: await configPublica() };
  },
  async 'trocar-senha'(b, { usuario }) { return trocarSenha({ ...b, usuario }); },
};

const PUBLICAS = new Set(['estado', 'criar-usuario', 'entrar']);

async function painel(request, url) {
  const acao = url.searchParams.get('acao');
  const fn = acoes[acao];
  if (!fn) return json({ erro: 'Ação desconhecida' }, 404);
  let corpo = {};
  if (request.method === 'POST') corpo = await request.json().catch(() => ({}));
  let usuario = null;
  if (!PUBLICAS.has(acao)) {
    usuario = await sessao((request.headers.get('authorization') || '').replace(/^Bearer\s+/i, ''));
    if (!usuario) return json({ erro: 'Faça login novamente', login: true }, 401);
  }
  try {
    return json(await fn(corpo, { url, usuario }));
  } catch (e) {
    return json({ erro: e.message }, 400);
  }
}

/* ======================= ROTAS ======================= */

export async function GET(request) {
  const url = new URL(request.url);
  if (url.searchParams.has('acao')) return painel(request, url);
  const p = url.searchParams;
  if (p.get('hub.mode') === 'subscribe') {
    const cfg = await getConfig({ fresco: true });
    return p.get('hub.verify_token') === cfg.verifyToken
      ? new Response(p.get('hub.challenge') || '')
      : new Response('token de verificação incorreto', { status: 403 });
  }
  return Response.redirect(`${url.origin}/instagram`, 302); // quem abrir no navegador vai para o painel
}

export async function POST(request) {
  const url = new URL(request.url);
  if (url.searchParams.has('acao')) return painel(request, url);
  return webhook(request);
}
