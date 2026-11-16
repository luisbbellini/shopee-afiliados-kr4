import { config } from './config.js';
import links from './links.js';

const base = () => `https://graph.instagram.com/${config.apiVersion}`;

async function api(caminho, { method = 'GET', body } = {}) {
  const res = await fetch(`${base()}${caminho}`, {
    method,
    headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const dados = await res.json().catch(() => ({}));
  if (!res.ok || dados.error) {
    const msg = dados.error?.message || res.statusText;
    throw new Error(`Instagram API ${method} ${caminho}: ${msg}`);
  }
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

export async function linkDoPost(mediaId) {
  if (links[mediaId]) return links[mediaId];
  const midia = await api(`/${mediaId}?fields=caption,permalink,shortcode`);
  if (midia.shortcode && links[midia.shortcode]) return links[midia.shortcode];
  return linkDaLegenda(midia.caption) || midia.permalink;
}

export async function ultimoPost() {
  const { data } = await api(`/${config.igUserId}/media?fields=id&limit=1`);
  return data?.[0]?.id;
}

// ---------- Enviar ----------

// Resposta privada (direct) para quem comentou. A Meta permite 1 por comentário, até 7 dias depois.
export const responderNoDirect = (commentId, texto) =>
  api(`/${config.igUserId}/messages`, {
    method: 'POST',
    body: { recipient: { comment_id: commentId }, message: { text: texto } },
  });

// Mensagem normal no direct (quando a pessoa escreveu no direct).
export const enviarDirect = (igsid, texto) =>
  api(`/${config.igUserId}/messages`, {
    method: 'POST',
    body: { recipient: { id: igsid }, message: { text: texto } },
  });

// Resposta pública embaixo do comentário.
export const responderComentario = (commentId, texto) =>
  api(`/${commentId}/replies`, { method: 'POST', body: { message: texto } });
