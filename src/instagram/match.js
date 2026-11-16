// Detecta se um texto é um pedido de link ("quero", "manda link", "QUEROOO!!!", "eu já quero 😍"...).

export function normalizar(texto = '') {
  return ` ${texto}`
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // tira acentos
    .replace(/[^a-z0-9]+/g, ' ')                      // tira emoji/pontuação
    .replace(/([a-z])\1+/g, '$1')                     // "queroooo" -> "quero", "linkk" -> "link"
    .replace(/\s+/g, ' ')
    .trim();
}

const NEGACOES = ['nao quero', 'n quero', 'nem quero', 'nunca quero', 'nao precisa', 'nao manda'];

export function pedeLink(texto, palavras) {
  const t = ` ${normalizar(texto)} `;
  if (t.trim() === '') return false;
  if (NEGACOES.some((n) => t.includes(` ${normalizar(n)} `))) return false;
  return palavras.some((p) => t.includes(` ${normalizar(p)} `));
}
