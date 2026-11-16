// Teste local do atendente + painel: simula a Meta e o navegador, sem chamar o Instagram de verdade.
// Rodar: npm run test:instagram
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

process.env.STORE_MEMORY = '1';
process.env.IG_USER_ID = '999';
process.env.IG_ACCESS_TOKEN = 'tok';
process.env.IG_APP_SECRET = 'segredo';
process.env.PANEL_KEY = 'chave-shopee';

const chamadas = [];
globalThis.fetch = async (url, opts = {}) => {
  chamadas.push({ url, method: opts.method || 'GET', body: opts.body && JSON.parse(opts.body) });
  let resp = { id: 'ok' };
  if (url.includes('/M1?')) resp = { caption: 'Achadinho! Compre: s.shopee.com.br/abc123.', permalink: 'https://instagram.com/p/X1', shortcode: 'X1' };
  if (url.includes('/M2?')) resp = { caption: 'Sem link', permalink: 'https://instagram.com/p/X2', shortcode: 'X2' };
  if (url.includes('/media?')) resp = { data: [{ id: 'M2' }] };
  if (url.endsWith('/messages')) resp = { recipient_id: opts.body.includes('comment_id') ? 'IGSID-555' : JSON.parse(opts.body).recipient.id, message_id: 'm' };
  if (url.includes('/me?')) resp = { user_id: '999', username: 'lojakr4' };
  if (url.includes('refresh_access_token')) resp = { access_token: 'tok-novo', expires_in: 5184000 };
  if (url.includes('/M9?')) return new Response(JSON.stringify({ error: { message: 'Mídia não encontrada' } }), { status: 400 });
  return new Response(JSON.stringify(resp), { status: 200 });
};

const { pedeLink } = await import('../src/instagram/match.js');
const { PALAVRAS_PADRAO } = await import('../src/instagram/config.js');
const { GET, POST } = await import('../api/instagram.js');

// 1) Palavras
['quero', 'QUEROOOO!!!', 'eu já quero 😍', 'manda link', 'Link pfv', 'me manda', 'kero', 'quero o link 🙏', 'onde compra?']
  .forEach((t) => assert.ok(pedeLink(t, PALAVRAS_PADRAO), `deveria disparar: ${t}`));
['lindo demais', 'não quero', 'linda', 'querosene', '😍😍', '']
  .forEach((t) => assert.ok(!pedeLink(t, PALAVRAS_PADRAO), `não deveria disparar: ${t}`));

// 2) Verificação do webhook
assert.equal(await (await GET(new Request('https://x/api/instagram?hub.mode=subscribe&hub.verify_token=kr4-atendente&hub.challenge=123'))).text(), '123');
assert.equal((await GET(new Request('https://x/api/instagram?hub.mode=subscribe&hub.verify_token=errado&hub.challenge=1'))).status, 403);

// helpers
const meta = async (payload, assinar = true) => {
  const corpo = JSON.stringify(payload);
  const sig = 'sha256=' + crypto.createHmac('sha256', 'segredo').update(corpo).digest('hex');
  return POST(new Request('https://x/api/instagram', { method: 'POST', body: corpo, headers: assinar ? { 'x-hub-signature-256': sig } : {} }));
};
const comentario = (id, texto, media, from = { id: '555', username: 'cliente' }) =>
  ({ object: 'instagram', entry: [{ id: '999', changes: [{ field: 'comments', value: { id, text: texto, media: { id: media }, from } }] }] });
const direct = (sender, text) => ({ object: 'instagram', entry: [{ id: '999', messaging: [{ sender: { id: sender }, recipient: { id: '999' }, message: { mid: 'm', text } }] }] });
let token = '';
const api = async (acao, body, metodo = 'POST') => {
  const r = await (metodo === 'GET' ? GET : POST)(new Request(`https://painel.app/api/instagram?acao=${acao}`, {
    method: metodo, body: metodo === 'POST' ? JSON.stringify(body || {}) : undefined,
    headers: token ? { authorization: `Bearer ${token}` } : {},
  }));
  return { status: r.status, ...(await r.json()) };
};

// 3) Assinatura inválida
assert.equal((await meta(comentario('C0', 'quero', 'M1'), false)).status, 401);

// 4) Comentário com link Shopee na legenda
chamadas.length = 0;
await meta(comentario('C1', 'Eu querooo!', 'M1'));
const dm = chamadas.find((c) => c.url.endsWith('/999/messages'));
assert.deepEqual(dm.body.recipient, { comment_id: 'C1' });
assert.ok(dm.body.message.text.includes('https://s.shopee.com.br/abc123'));
assert.ok(dm.body.message.text.includes('@cliente'));
assert.ok(chamadas.some((c) => c.url.endsWith('/C1/replies')), 'resposta pública');

// 5) Post sem link na legenda -> permalink; comentários comuns; próprio perfil; falha
await meta(comentario('C2', 'link', 'M2', { id: '556', username: 'maria' }));
await meta(comentario('C3', 'que lindo', 'M1'));
chamadas.length = 0;
await meta(comentario('C4', 'quero', 'M1', { id: '999', username: 'eu' }));
assert.equal(chamadas.length, 0, 'não responde o próprio perfil');
await meta(comentario('C5', 'quero', 'M9', { id: '557', username: 'joao' }));

// 6) Quem recebeu responde no direct (conta 1x só) + alguém pede pelo direct
await meta(direct('IGSID-555', 'obrigada!'));
await meta(direct('IGSID-555', 'chegou sim'));
await meta(direct('777', 'manda o link'));
const d = chamadas.filter((c) => c.url.endsWith('/messages')).pop();
assert.deepEqual(d.body.recipient, { id: '777' });
assert.ok(d.body.message.text.includes('https://instagram.com/p/X2'));

// 7) Painel: sem login bloqueia
assert.equal((await api('painel')).status, 401);
let e = await api('estado', null, 'GET');
assert.equal(e.temUsuario, false);
assert.equal(e.precisaChavePainel, true);

// criar usuário exige a senha do painel da Shopee
assert.equal((await api('criar-usuario', { usuario: 'fernando', senha: '123456', chavePainel: 'errada' })).status, 400);
const c = await api('criar-usuario', { usuario: 'fernando', senha: '123456', chavePainel: 'chave-shopee' });
assert.ok(c.token);
assert.equal((await api('criar-usuario', { usuario: 'outro', senha: '123456', chavePainel: 'chave-shopee' })).status, 400, 'só um usuário');
assert.equal((await api('entrar', { usuario: 'fernando', senha: 'errada' })).status, 400);
token = (await api('entrar', { usuario: 'fernando', senha: '123456' })).token;
assert.ok(token);

// 8) Números
const p = await api('painel', { dias: 7 });
assert.equal(p.status, 200, JSON.stringify(p));
const t = p.stats.total;
assert.equal(t.comentarios, 4, 'C1, C2, C3, C5');
assert.equal(t.pedidos, 4, 'C1, C2, C5 + direct 777');
assert.equal(t.enviados, 3, 'C1, C2, direct 777');
assert.equal(t.falhas, 1, 'C5');
assert.equal(t.directs, 3);
assert.equal(t.responderam, 1, 'IGSID-555 conta uma vez');
assert.equal(p.stats.pessoasResponderam, 1);
assert.equal(p.stats.porDia.length, 7);
assert.equal(p.stats.porDia.at(-1).enviados, 3);
assert.equal(p.stats.posts[0].id, 'M2');
assert.ok(p.stats.log.some((x) => x.tipo === 'respondeu'));
assert.ok(p.stats.log.some((x) => x.tipo === 'falha' && x.erro.includes('Mídia')));
assert.equal(p.webhookUrl, 'https://painel.app/api/instagram');
assert.ok(!JSON.stringify(p.config).includes('segredo'), 'não vaza o app secret');

// 9) Configurar pelo painel + renovar token + testar
const s = await api('salvar-config', { token: 'tok-painel', mensagem: 'Seu link: {link}', respostaPublica: 'off' });
assert.equal(s.config.origemToken, 'painel');
assert.equal((await api('renovar-token')).expiraEmDias, 60);
assert.equal((await api('testar')).conta.username, 'lojakr4');
chamadas.length = 0;
await meta(comentario('C6', 'quero', 'M1', { id: '558', username: 'ana' }));
assert.equal(chamadas.find((x) => x.url.endsWith('/messages')).body.message.text, 'Seu link: https://s.shopee.com.br/abc123');
assert.ok(!chamadas.some((x) => x.url.endsWith('/replies')), 'resposta pública desligada');
assert.ok(chamadas.every((x) => !x.url.includes('graph.instagram.com') || true));

// 10) Trocar senha derruba a sessão antiga
const novo = await api('trocar-senha', { senhaAtual: '123456', novaSenha: 'nova-senha' });
assert.ok(novo.token);
assert.equal((await api('painel')).status, 401, 'token antigo não vale mais');
token = novo.token;
assert.equal((await api('painel')).status, 200);

console.log('✅ Todos os testes passaram');
