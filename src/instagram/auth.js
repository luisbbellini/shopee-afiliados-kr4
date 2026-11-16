// Login do painel do Instagram: usuário + senha.
// - Se ADMIN_USUARIO e ADMIN_SENHA existirem na Vercel, valem eles.
// - Senão, no primeiro acesso o painel pede para criar o usuário (fica salvo no banco, com a senha criptografada).
//   Se o painel da Shopee tiver PANEL_KEY, ela é pedida para criar o primeiro usuário (ninguém de fora consegue).
import crypto from 'node:crypto';
import { cmd, storeEnabled } from '../store.js';

const ENV_USER = (process.env.ADMIN_USUARIO || '').trim();
const ENV_PASS = process.env.ADMIN_SENHA || '';
const PANEL_KEY = process.env.PANEL_KEY || '';
const DIAS_SESSAO = 30;

const igual = (a = '', b = '') => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
const hash = (senha, sal) => crypto.scryptSync(String(senha), sal, 64).toString('hex');

async function segredo() {
  if (process.env.IG_SESSION_SECRET) return process.env.IG_SESSION_SECRET;
  if (!storeEnabled()) return crypto.createHash('sha256').update(`${ENV_USER}:${ENV_PASS}:${PANEL_KEY}`).digest('hex');
  let s = await cmd('GET', 'ig:auth:segredo');
  if (!s) { s = crypto.randomBytes(32).toString('hex'); await cmd('SET', 'ig:auth:segredo', s); }
  return s;
}

async function usuarioSalvo() {
  if (!storeEnabled()) return null;
  const arr = (await cmd('HGETALL', 'ig:auth')) || [];
  const o = {};
  for (let i = 0; i < arr.length; i += 2) o[arr[i]] = arr[i + 1];
  return o.usuario ? o : null;
}

export async function estadoLogin() {
  const usuario = ENV_USER ? true : !!(await usuarioSalvo().catch(() => null));
  return { temUsuario: usuario, viaVercel: !!ENV_USER, precisaChavePainel: !ENV_USER && !!PANEL_KEY, banco: storeEnabled() };
}

const validar = (usuario, senha) => {
  if (!/^[\w.@-]{3,40}$/.test(usuario || '')) throw new Error('Usuário: 3 a 40 letras, números, ponto, @, - ou _');
  if (String(senha || '').length < 6) throw new Error('A senha precisa ter pelo menos 6 caracteres');
};

export async function criarUsuario({ usuario, senha, chavePainel }) {
  if (ENV_USER) throw new Error('O usuário está definido na Vercel (ADMIN_USUARIO).');
  if (!storeEnabled()) throw new Error('Conecte o banco de dados na Vercel antes de criar o usuário.');
  if (await usuarioSalvo()) throw new Error('Já existe um usuário. Entre com ele.');
  if (PANEL_KEY && !igual(chavePainel, PANEL_KEY)) throw new Error('Senha do painel da Shopee incorreta.');
  validar(usuario, senha);
  const sal = crypto.randomBytes(16).toString('hex');
  await cmd('HSET', 'ig:auth', 'usuario', usuario, 'sal', sal, 'hash', hash(senha, sal), 'versao', String(Date.now()));
  return entrar({ usuario, senha });
}

export async function entrar({ usuario, senha }) {
  let ok = false, versao = 'env';
  if (ENV_USER) {
    ok = igual(usuario, ENV_USER) && igual(senha, ENV_PASS);
  } else {
    const u = await usuarioSalvo();
    if (u) { ok = igual(usuario, u.usuario) && igual(hash(senha, u.sal), u.hash); versao = u.versao; }
  }
  if (!ok) {
    await new Promise((r) => setTimeout(r, 800)); // atrasa tentativas de adivinhar
    throw new Error('Usuário ou senha incorretos');
  }
  const corpo = Buffer.from(JSON.stringify({ u: usuario, v: versao, exp: Date.now() + DIAS_SESSAO * 86400000 })).toString('base64url');
  const assinatura = crypto.createHmac('sha256', await segredo()).update(corpo).digest('base64url');
  return { token: `${corpo}.${assinatura}`, usuario };
}

// Retorna o usuário da sessão ou null.
export async function sessao(token = '') {
  const [corpo, assinatura] = String(token).split('.');
  if (!corpo || !assinatura) return null;
  const esperado = crypto.createHmac('sha256', await segredo()).update(corpo).digest('base64url');
  if (!igual(assinatura, esperado)) return null;
  let d;
  try { d = JSON.parse(Buffer.from(corpo, 'base64url').toString()); } catch { return null; }
  if (!d.exp || d.exp < Date.now()) return null;
  if (!ENV_USER) {
    const u = await usuarioSalvo();
    if (!u || u.usuario !== d.u || u.versao !== d.v) return null; // senha trocada derruba sessões antigas
  }
  return d.u;
}

export async function trocarSenha({ usuario, senhaAtual, novaSenha, novoUsuario }) {
  if (ENV_USER) throw new Error('Usuário e senha estão definidos na Vercel (ADMIN_USUARIO / ADMIN_SENHA). Troque por lá.');
  const u = await usuarioSalvo();
  if (!u || u.usuario !== usuario || !igual(hash(senhaAtual, u.sal), u.hash)) throw new Error('Senha atual incorreta');
  const nome = (novoUsuario || usuario).trim();
  validar(nome, novaSenha);
  const sal = crypto.randomBytes(16).toString('hex');
  await cmd('HSET', 'ig:auth', 'usuario', nome, 'sal', sal, 'hash', hash(novaSenha, sal), 'versao', String(Date.now()));
  return entrar({ usuario: nome, senha: novaSenha });
}
