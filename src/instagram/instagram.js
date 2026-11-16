// Chamadas à API do Instagram (login do Instagram, host graph.instagram.com).
import links from './links.js';

async function chamar(cfg, caminho, { method = 'GET', body } = {}) {
  const res = await fetch(`https://graph.instagram.com/${cfg.apiVersion}${caminho}`, {
    method,
    headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const dados = await res.json().catch(() => ({}));
  if (!res.ok || dados.error) throw new Error(dados.error?.message || `HTTP ${res.status}`);
  return dados;
}

// ---------- Descobrir o link do post ----------

const RE_SHOPEE = /(?:https?:\/\/)?(?:[\w-]+\.)*(?:shopee\.com\.br|shope\.ee|shopee\.com)\/[^\s)]+/i;
const RE_URL = /https?:\/\/[^\s)]+/i;

export function linkDaLegenda(legenda = '') {
  const achado = legenda.match(RE_SHOPEE)?.[0] || legenda.match(RE_URL)?.[0];
  if (!achado) return null;
  const limpo = achado.replace(/[.,;:!?'"»…]+$/, '');
  return /^https?:\/\//i.test(limpo) ? limpo : `https://${limpo}`;
}

// Retorna { link, permalink }
export async function linkDoPost(cfg, mediaId) {
  if (links[mediaId]) return { link: links[mediaId], permalink: '' };
  const m = await chamar(cfg, `/${mediaId}?fields=caption,permalink,shortcode`);
  const link = (m.shortcode && links[m.shortcode]) || linkDaLegenda(m.caption) || m.permalink;
  return { link, permalink: m.permalink || '' };
}

export async function ultimoPost(cfg) {
  const { data } = await chamar(cfg, `/${cfg.igUserId}/media?fields=id&limit=1`);
  return data?.[0]?.id;
}

// ---------- Enviar ----------

// Resposta privada (direct) para quem comentou: 1 por comentário, até 7 dias depois.
// A resposta traz recipient_id, que usamos para saber se a pessoa respondeu depois.
export const responderNoDirect = (cfg, commentId, texto) =>
  chamar(cfg, `/${cfg.igUserId}/messages`, { method: 'POST', body: { recipient: { comment_id: commentId }, message: { text: texto } } });

export const enviarDirect = (cfg, igsid, texto) =>
  chamar(cfg, `/${cfg.igUserId}/messages`, { method: 'POST', body: { recipient: { id: igsid }, message: { text: texto } } });

export const responderComentario = (cfg, commentId, texto) =>
  chamar(cfg, `/${commentId}/replies`, { method: 'POST', body: { message: texto } });

// ---------- Conta / token ----------

export const quemSou = (cfg) => chamar(cfg, '/me?fields=user_id,username,name,profile_picture_url,followers_count');

export async function renovarToken(token) {
  const u = `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(token)}`;
  const res = await fetch(u);
  const d = await res.json().catch(() => ({}));
  if (!res.ok || d.error || !d.access_token) throw new Error(d.error?.message || `HTTP ${res.status}`);
  return d; // { access_token, token_type, expires_in }
}
