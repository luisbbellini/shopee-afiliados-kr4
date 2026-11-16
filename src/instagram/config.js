// Configurações do atendente. Tudo pode ser sobrescrito por variáveis de ambiente na Vercel.

const env = (k, padrao) => (process.env[k] && process.env[k].trim()) || padrao;

// Palavras/frases que disparam o envio do link (variações com letras repetidas,
// acentos, maiúsculas e pontuação já são tratadas automaticamente: "QUEROOO!!!" = "quero").
const PALAVRAS_PADRAO = [
  'quero', 'qro', 'qero', 'kero', 'quero link', 'eu quero', 'quero o link', 'quero um',
  'link', 'lnk', 'linkk', 'me manda', 'manda', 'mandar', 'manda o link', 'manda link',
  'me passa', 'passa o link', 'envia', 'me envia', 'onde compra', 'onde comprar', 'como compro',
];

export const config = {
  igUserId: env('IG_USER_ID'),
  token: env('IG_ACCESS_TOKEN'),
  appSecret: env('IG_APP_SECRET'),
  verifyToken: env('WEBHOOK_VERIFY_TOKEN', 'kr4-atendente'),
  apiVersion: env('IG_API_VERSION', 'v23.0'),

  palavras: env('PALAVRAS', '') ? env('PALAVRAS').split(',').map((s) => s.trim()).filter(Boolean) : PALAVRAS_PADRAO,

  // Mensagem do direct. {link} e {nome} são substituídos.
  mensagem: env('MENSAGEM', 'Oi{nome}! 😊 Aqui está o link que você pediu:\n\n{link}\n\nQualquer dúvida é só chamar!'),

  // Resposta pública no comentário (deixe RESPOSTA_PUBLICA=off para desligar). Separe variações com |
  respostaPublica: env('RESPOSTA_PUBLICA', 'Te mandei no direct! 📩|Enviado no seu direct 😉|Corre no direct, já te mandei! 💌'),

  // Responder também quem mandar "quero/link" direto no direct (envia o link do último post).
  responderDirect: env('RESPONDER_DIRECT', 'on') !== 'off',
};
