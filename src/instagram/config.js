// Configurações do atendente.
// Ordem de prioridade: o que foi salvo pelo painel (/instagram) > variáveis de ambiente da Vercel > padrão.
import { cmd, storeEnabled } from '../store.js';

const env = (k) => (process.env[k] || '').trim();

// Variações com letras repetidas, acentos, maiúsculas e pontuação já são tratadas: "QUEROOO!!!" = "quero".
export const PALAVRAS_PADRAO = [
  'quero', 'qro', 'qero', 'kero', 'quero link', 'eu quero', 'quero o link', 'quero um',
  'link', 'lnk', 'linkk', 'me manda', 'manda', 'mandar', 'manda o link', 'manda link',
  'me passa', 'passa o link', 'envia', 'me envia', 'onde compra', 'onde comprar', 'como compro',
];

const PADRAO = {
  igUserId: '',
  token: '',
  appSecret: '',
  verifyToken: 'kr4-atendente',
  apiVersion: 'v23.0',
  palavras: PALAVRAS_PADRAO.join(', '),
  mensagem: 'Oi{nome}! 😊 Aqui está o link que você pediu:\n\n{link}\n\nQualquer dúvida é só chamar!',
  respostaPublica: 'Te mandei no direct! 📩|Enviado no seu direct 😉|Corre no direct, já te mandei! 💌',
  responderDirect: 'on',
  tokenSalvoEm: '',
  igUsername: '',
};

const ENV = {
  igUserId: 'IG_USER_ID', token: 'IG_ACCESS_TOKEN', appSecret: 'IG_APP_SECRET', verifyToken: 'WEBHOOK_VERIFY_TOKEN',
  apiVersion: 'IG_API_VERSION', palavras: 'PALAVRAS', mensagem: 'MENSAGEM', respostaPublica: 'RESPOSTA_PUBLICA',
  responderDirect: 'RESPONDER_DIRECT',
};

export const CAMPOS = Object.keys(PADRAO);
const CHAVE = 'ig:config';

let cache = null;
let cacheEm = 0;

async function salvos() {
  if (!storeEnabled()) return {};
  const arr = (await cmd('HGETALL', CHAVE)) || [];
  const o = {};
  for (let i = 0; i < arr.length; i += 2) o[arr[i]] = arr[i + 1];
  return o;
}

export async function getConfig({ fresco = false } = {}) {
  if (!fresco && cache && Date.now() - cacheEm < 30_000) return cache;
  const db = await salvos().catch(() => ({}));
  const c = {};
  for (const k of CAMPOS) c[k] = (db[k] ?? '').toString().trim() || env(ENV[k] || '') || PADRAO[k];
  c.origem = { token: db.token ? 'painel' : env('IG_ACCESS_TOKEN') ? 'vercel' : '' };
  c.listaPalavras = c.palavras.split(',').map((s) => s.trim()).filter(Boolean);
  c.respostasPublicas = c.respostaPublica.toLowerCase() === 'off' ? [] : c.respostaPublica.split('|').map((s) => s.trim()).filter(Boolean);
  c.direct = c.responderDirect !== 'off';
  cache = c;
  cacheEm = Date.now();
  return c;
}

export async function saveConfig(parcial = {}) {
  if (!storeEnabled()) throw new Error('Banco de dados não configurado');
  const pares = [];
  for (const k of CAMPOS) {
    if (parcial[k] === undefined) continue;
    pares.push(k, String(parcial[k]).trim());
  }
  if (pares.length) await cmd('HSET', CHAVE, ...pares);
  cache = null;
  return getConfig({ fresco: true });
}

const mascarar = (s = '') => (s.length > 12 ? `${s.slice(0, 6)}…${s.slice(-4)}` : s ? '••••' : '');

// Versão segura para mostrar no painel (sem segredos completos).
export async function configPublica() {
  const c = await getConfig({ fresco: true });
  return {
    igUserId: c.igUserId, igUsername: c.igUsername,
    token: mascarar(c.token), temToken: !!c.token, origemToken: c.origem.token, tokenSalvoEm: c.tokenSalvoEm,
    appSecret: mascarar(c.appSecret), temAppSecret: !!c.appSecret,
    verifyToken: c.verifyToken, apiVersion: c.apiVersion,
    palavras: c.palavras, mensagem: c.mensagem, respostaPublica: c.respostaPublica, responderDirect: c.responderDirect,
  };
}
