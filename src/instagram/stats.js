// Contadores do atendente no Redis.
//   ig:total            hash  campo -> número (desde sempre)
//   ig:dia:AAAA-MM-DD   hash  campo -> número (90 dias)
//   ig:enviados         set   IDs de quem recebeu link
//   ig:responderam      set   IDs de quem respondeu depois de receber
//   ig:post:enviados    hash  mediaId -> links enviados
//   ig:post:link        hash  mediaId -> JSON { link, permalink }
//   ig:log              lista últimas 200 ações
import { cmd, pipeline, storeEnabled, today } from '../store.js';

export const CAMPOS = ['comentarios', 'pedidos', 'enviados', 'falhas', 'directs', 'responderam'];

const ativo = () => storeEnabled();
const silencioso = (p) => p.catch((e) => console.warn('[stats]', e.message));

export function contar(campos = []) {
  if (!ativo() || !campos.length) return Promise.resolve();
  const dia = `ig:dia:${today()}`;
  const cmds = [];
  for (const c of campos) cmds.push(['HINCRBY', 'ig:total', c, 1], ['HINCRBY', dia, c, 1]);
  cmds.push(['EXPIRE', dia, 90 * 86400]);
  return silencioso(pipeline(cmds));
}

export function registrar(evento) {
  if (!ativo()) return Promise.resolve();
  const e = JSON.stringify({ t: Date.now(), ...evento, texto: evento.texto?.slice(0, 200) });
  return silencioso(pipeline([['LPUSH', 'ig:log', e], ['LTRIM', 'ig:log', 0, 199]]));
}

export function marcarEnviado({ ids = [], mediaId, link, permalink }) {
  if (!ativo()) return Promise.resolve();
  const cmds = [];
  const lista = ids.filter(Boolean).map(String);
  if (lista.length) cmds.push(['SADD', 'ig:enviados', ...lista]);
  if (mediaId) {
    cmds.push(['HINCRBY', 'ig:post:enviados', mediaId, 1]);
    cmds.push(['HSET', 'ig:post:link', mediaId, JSON.stringify({ link, permalink })]);
  }
  return silencioso(pipeline(cmds));
}

// Retorna true só na PRIMEIRA vez que alguém que recebeu link responde.
export async function marcarResposta(id) {
  if (!ativo() || !id) return false;
  try {
    const [recebeu, jaRespondeu] = await pipeline([['SISMEMBER', 'ig:enviados', id], ['SISMEMBER', 'ig:responderam', id]]);
    if (Number(recebeu) !== 1 || Number(jaRespondeu) === 1) return false;
    await cmd('SADD', 'ig:responderam', id);
    return true;
  } catch (e) {
    console.warn('[stats]', e.message);
    return false;
  }
}

const obj = (arr) => { const o = {}; for (let i = 0; i < (arr || []).length; i += 2) o[arr[i]] = arr[i + 1]; return o; };
const numeros = (o) => Object.fromEntries(CAMPOS.map((c) => [c, Number(o?.[c] || 0)]));

export async function resumo(dias = 30) {
  const datas = Array.from({ length: dias }, (_, i) => today(-(dias - 1 - i)));
  const r = await pipeline([
    ['HGETALL', 'ig:total'],
    ['SCARD', 'ig:enviados'],
    ['SCARD', 'ig:responderam'],
    ['HGETALL', 'ig:post:enviados'],
    ['HGETALL', 'ig:post:link'],
    ['LRANGE', 'ig:log', 0, 199],
    ...datas.map((d) => ['HGETALL', `ig:dia:${d}`]),
  ]);
  const [total, pessoas, pessoasResponderam, postEnv, postLink, log] = r;
  const porDia = datas.map((d, i) => ({ dia: d, ...numeros(obj(r[6 + i])) }));
  const links = obj(postLink);
  const posts = Object.entries(obj(postEnv))
    .map(([id, n]) => { let info = {}; try { info = JSON.parse(links[id] || '{}'); } catch {} return { id, enviados: Number(n), ...info }; })
    .sort((a, b) => b.enviados - a.enviados)
    .slice(0, 10);
  return {
    total: numeros(obj(total)),
    pessoas: Number(pessoas || 0),
    pessoasResponderam: Number(pessoasResponderam || 0),
    porDia,
    posts,
    log: (log || []).map((x) => { try { return JSON.parse(x); } catch { return null; } }).filter(Boolean),
  };
}
