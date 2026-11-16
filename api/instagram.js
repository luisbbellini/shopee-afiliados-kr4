// Webhook do Instagram (Vercel). URL: https://SEU-PROJETO.vercel.app/api/instagram
import crypto from 'node:crypto';
import { config } from '../src/instagram/config.js';
import { pedeLink } from '../src/instagram/match.js';
import { linkDoPost, ultimoPost, responderNoDirect, enviarDirect, responderComentario } from '../src/instagram/instagram.js';

const sortear = (lista) => lista[Math.floor(Math.random() * lista.length)];

function montarMensagem(link, username) {
  return config.mensagem.replace('{link}', link).replace('{nome}', username ? ` @${username}` : '');
}

function assinaturaValida(corpo, assinatura) {
  if (!config.appSecret) return true; // sem segredo configurado, não valida (só para testes)
  if (!assinatura?.startsWith('sha256=')) return false;
  const esperado = 'sha256=' + crypto.createHmac('sha256', config.appSecret).update(corpo).digest('hex');
  const a = Buffer.from(assinatura);
  const b = Buffer.from(esperado);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---------- Comentários ----------
async function tratarComentario(v) {
  if (!v?.id || !v.text || !v.media?.id) return;
  if (v.from?.id === config.igUserId) return;          // ignora as próprias respostas
  if (!pedeLink(v.text, config.palavras)) return;

  const link = await linkDoPost(v.media.id);
  await responderNoDirect(v.id, montarMensagem(link, v.from?.username));
  console.log(`[comentário] link enviado para @${v.from?.username}: ${link}`);

  if (config.respostaPublica.toLowerCase() !== 'off') {
    await responderComentario(v.id, sortear(config.respostaPublica.split('|'))).catch((e) =>
      console.warn('[comentário] resposta pública falhou:', e.message));
  }
}

// ---------- Direct ----------
async function tratarDirect(m) {
  const msg = m.message;
  if (!config.responderDirect || !msg?.text || msg.is_echo) return;
  if (m.sender?.id === config.igUserId) return;
  if (!pedeLink(msg.text, config.palavras)) return;

  // Se a pessoa respondeu a um story/post, usa ele; senão, o último post do perfil.
  const mediaId = msg.reply_to?.story?.id || (await ultimoPost());
  if (!mediaId) return;
  const link = await linkDoPost(mediaId);
  await enviarDirect(m.sender.id, montarMensagem(link));
  console.log(`[direct] link enviado para ${m.sender.id}: ${link}`);
}

// ---------- Rotas ----------

// Verificação do webhook pela Meta
export function GET(request) {
  const p = new URL(request.url).searchParams;
  if (p.get('hub.mode') === 'subscribe' && p.get('hub.verify_token') === config.verifyToken) {
    return new Response(p.get('hub.challenge') || '', { status: 200 });
  }
  return new Response('Atendente KR4 no ar ✅', { status: p.has('hub.mode') ? 403 : 200 });
}

// Eventos (comentários e mensagens)
export async function POST(request) {
  const corpo = await request.text();
  if (!assinaturaValida(corpo, request.headers.get('x-hub-signature-256'))) {
    return new Response('assinatura inválida', { status: 401 });
  }

  let payload;
  try { payload = JSON.parse(corpo); } catch { return new Response('ok'); }

  const tarefas = [];
  for (const entry of payload.entry || []) {
    for (const c of entry.changes || []) {
      if (c.field === 'comments' || c.field === 'live_comments') tarefas.push(tratarComentario(c.value));
    }
    for (const m of entry.messaging || []) tarefas.push(tratarDirect(m));
  }

  const resultados = await Promise.allSettled(tarefas);
  resultados.filter((r) => r.status === 'rejected').forEach((r) => console.error('[erro]', r.reason?.message));

  return new Response('ok', { status: 200 }); // sempre 200 para a Meta não reenviar
}
