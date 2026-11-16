// Teste local: simula webhooks da Meta e intercepta as chamadas à API do Instagram.
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

process.env.IG_USER_ID = '999';
process.env.IG_ACCESS_TOKEN = 'tok';
process.env.IG_APP_SECRET = 'segredo';

const chamadas = [];
globalThis.fetch = async (url, opts = {}) => {
  chamadas.push({ url, method: opts.method || 'GET', body: opts.body && JSON.parse(opts.body) });
  let resp = { id: 'ok' };
  if (url.includes('/M1?')) resp = { caption: 'Achadinho lindo! Compre aqui: s.shopee.com.br/abc123.', permalink: 'https://instagram.com/p/X1', shortcode: 'X1' };
  if (url.includes('/M2?')) resp = { caption: 'Sem link', permalink: 'https://instagram.com/p/X2', shortcode: 'X2' };
  if (url.includes('/media?')) resp = { data: [{ id: 'M2' }] };
  return new Response(JSON.stringify(resp), { status: 200 });
};

const { pedeLink } = await import('../src/instagram/match.js');
const { config } = await import('../src/instagram/config.js');
const { GET, POST } = await import('../api/instagram.js');

// 1) Palavras
const sim = ['quero', 'QUEROOOO!!!', 'eu já quero 😍', 'manda link', 'Link pfv', 'me manda', 'kero', 'quero o link 🙏', 'onde compra?'];
const nao = ['lindo demais', 'não quero', 'linda', 'querosene', '😍😍', ''];
sim.forEach((t) => assert.ok(pedeLink(t, config.palavras), `deveria disparar: ${t}`));
nao.forEach((t) => assert.ok(!pedeLink(t, config.palavras), `não deveria disparar: ${t}`));

// 2) Verificação do webhook
const v = await GET(new Request('https://x/api/instagram?hub.mode=subscribe&hub.verify_token=kr4-atendente&hub.challenge=123'));
assert.equal(await v.text(), '123');

// helper
const enviar = async (payload, assinar = true) => {
  const corpo = JSON.stringify(payload);
  const sig = 'sha256=' + crypto.createHmac('sha256', 'segredo').update(corpo).digest('hex');
  return POST(new Request('https://x/api/instagram', { method: 'POST', body: corpo, headers: assinar ? { 'x-hub-signature-256': sig } : {} }));
};
const comentario = (id, texto, media, from = { id: '555', username: 'cliente' }) =>
  ({ object: 'instagram', entry: [{ id: '999', changes: [{ field: 'comments', value: { id, text: texto, media: { id: media }, from } }] }] });

// 3) Assinatura inválida
assert.equal((await enviar(comentario('C0', 'quero', 'M1'), false)).status, 401);

// 4) Comentário com link Shopee na legenda
chamadas.length = 0;
await enviar(comentario('C1', 'Eu querooo!', 'M1'));
const dm = chamadas.find((c) => c.url.endsWith('/999/messages'));
assert.deepEqual(dm.body.recipient, { comment_id: 'C1' });
assert.ok(dm.body.message.text.includes('https://s.shopee.com.br/abc123'), dm.body.message.text);
assert.ok(dm.body.message.text.includes('@cliente'));
assert.ok(chamadas.some((c) => c.url.endsWith('/C1/replies')), 'resposta pública');

// 5) Post sem link na legenda -> manda o permalink
chamadas.length = 0;
await enviar(comentario('C2', 'link', 'M2'));
assert.ok(chamadas.find((c) => c.url.endsWith('/messages')).body.message.text.includes('https://instagram.com/p/X2'));

// 6) Comentário que não pede link e comentário do próprio perfil -> nada enviado
chamadas.length = 0;
await enviar(comentario('C3', 'que lindo', 'M1'));
await enviar(comentario('C4', 'quero', 'M1', { id: '999', username: 'eu' }));
assert.equal(chamadas.length, 0);

// 7) Pedido pelo direct -> link do último post
chamadas.length = 0;
await enviar({ object: 'instagram', entry: [{ id: '999', messaging: [{ sender: { id: '777' }, recipient: { id: '999' }, message: { mid: 'm', text: 'manda o link' } }] }] });
const d = chamadas.find((c) => c.url.endsWith('/messages'));
assert.deepEqual(d.body.recipient, { id: '777' });
assert.ok(d.body.message.text.includes('https://instagram.com/p/X2'));

console.log('✅ Todos os testes passaram');
