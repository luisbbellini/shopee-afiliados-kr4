// Gerenciador de Anúncios da Meta (Facebook/Instagram) — Marketing API, só leitura (permissão ads_read).
// Token e conta de anúncios vêm do aparelho (cabeçalhos) ou da Vercel (META_ACCESS_TOKEN / META_AD_ACCOUNT).

const VERSION = process.env.META_API_VERSION || 'v25.0';
const BASE = `https://graph.facebook.com/${VERSION}`;

export function metaCtx(headers = {}) {
  const token = String(headers['x-meta-token'] || process.env.META_ACCESS_TOKEN || '').trim();
  let account = String(headers['x-meta-account'] || process.env.META_AD_ACCOUNT || '').trim();
  if (account && !account.startsWith('act_')) account = 'act_' + account.replace(/\D/g, '');
  return { token, account };
}

const FRIENDLY = {
  190: 'Token da Meta inválido ou vencido. Gere um novo e cole em ⚙ Configurações → Anúncios da Meta.',
  200: 'O token não tem permissão para ler anúncios (falta ads_read) ou você não tem acesso a esta conta.',
  10: 'O token não tem permissão para ler anúncios (falta ads_read).',
  100: 'Conta de anúncios ou campo não encontrado. Confira a conta escolhida.',
  17: 'Limite de consultas da Meta atingido. Espere alguns minutos.',
  4: 'Limite de consultas da Meta atingido. Espere alguns minutos.',
  80004: 'Limite de consultas da Meta atingido. Espere alguns minutos.',
};

async function graph(path, params, token) {
  const u = new URL(path.startsWith('http') ? path : BASE + path);
  if (params) for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') u.searchParams.set(k, typeof v === 'object' ? JSON.stringify(v) : v);
  if (!u.searchParams.has('access_token')) u.searchParams.set('access_token', token);
  const r = await fetch(u, { signal: AbortSignal.timeout(25000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) {
    const e = j.error || {}; const msg = FRIENDLY[e.code] || e.error_user_msg || e.message || 'HTTP ' + r.status;
    throw new Error(`Meta: ${msg}`);
  }
  return j;
}
async function allPages(path, params, token, max = 10) {
  let j = await graph(path, params, token); const out = [...(j.data || [])];
  for (let i = 1; i < max && j.paging?.next; i++) { j = await graph(j.paging.next, null, token); out.push(...(j.data || [])); }
  return out;
}

export async function metaAccounts(ctx) {
  if (!ctx.token) throw new Error('Cole o token da Meta em ⚙ Configurações → Anúncios da Meta.');
  const me = await graph('/me', { fields: 'id,name' }, ctx.token);
  const accounts = await allPages('/me/adaccounts', { fields: 'id,name,account_status,currency,business{name}', limit: 100 }, ctx.token, 5);
  return { user: me.name, accounts: accounts.map((a) => ({ id: a.id, name: a.name, status: a.account_status === 1 ? 'Ativa' : 'Inativa', currency: a.currency, business: a.business?.name || '' })) };
}

const sumActions = (arr, types) => (arr || []).filter((a) => !types || types.includes(a.action_type)).reduce((s, a) => s + (+a.value || 0), 0);
const LINK_RE = /https?:\/\/[^\s"'\\]*(shopee|shp\.ee)[^\s"'\\]*/gi;

export async function metaInsights({ since, until, preset } = {}, ctx) {
  if (!ctx.token) throw new Error('Conecte o Gerenciador de Anúncios em ⚙ Configurações → Anúncios da Meta.');
  if (!ctx.account) throw new Error('Escolha a conta de anúncios em ⚙ Configurações → Anúncios da Meta.');
  const range = since && until ? { time_range: { since, until } } : { date_preset: preset || 'last_30d' };
  const fields = ['ad_id', 'ad_name', 'adset_name', 'campaign_name', 'spend', 'impressions', 'reach', 'frequency', 'clicks', 'inline_link_clicks', 'ctr', 'cpc', 'cpm',
    'actions', 'video_play_actions', 'video_thruplay_watched_actions', 'video_p25_watched_actions', 'video_p50_watched_actions', 'video_p75_watched_actions', 'video_p100_watched_actions', 'video_avg_time_watched_actions'].join(',');
  const [rows, daily, ads] = await Promise.all([
    allPages(`/${ctx.account}/insights`, { level: 'ad', fields, limit: 200, ...range }, ctx.token),
    allPages(`/${ctx.account}/insights`, { level: 'account', fields: 'spend,impressions,inline_link_clicks', time_increment: 1, limit: 100, ...range }, ctx.token, 4).catch(() => []),
    allPages(`/${ctx.account}/ads`, { fields: 'id,name,effective_status,created_time,creative{thumbnail_url,image_url,object_story_spec,asset_feed_spec,url_tags,link_url}', limit: 100 }, ctx.token, 5).catch(() => []),
  ]);
  const adInfo = new Map(ads.map((a) => {
    const blob = JSON.stringify(a.creative || {});
    const links = [...new Set((blob.match(LINK_RE) || []).map((l) => l.replace(/\\\//g, '/')))];
    return [a.id, { status: a.effective_status, created: a.created_time, thumb: a.creative?.thumbnail_url || a.creative?.image_url || '', links, urlTags: a.creative?.url_tags || '' }];
  }));
  const out = rows.map((r) => {
    const info = adInfo.get(r.ad_id) || {};
    const plays = sumActions(r.video_play_actions);
    return {
      adId: r.ad_id, adName: r.ad_name, adset: r.adset_name, campaign: r.campaign_name, status: info.status || '', created: info.created || '', thumb: info.thumb || '', links: info.links || [], urlTags: info.urlTags || '',
      spend: +r.spend || 0, impressions: +r.impressions || 0, reach: +r.reach || 0, frequency: +r.frequency || 0,
      clicks: +r.clicks || 0, linkClicks: +r.inline_link_clicks || sumActions(r.actions, ['link_click']), ctr: +r.ctr || 0, cpc: +r.cpc || 0, cpm: +r.cpm || 0,
      plays, thruplays: sumActions(r.video_thruplay_watched_actions),
      p25: sumActions(r.video_p25_watched_actions), p50: sumActions(r.video_p50_watched_actions), p75: sumActions(r.video_p75_watched_actions), p100: sumActions(r.video_p100_watched_actions),
      avgWatch: sumActions(r.video_avg_time_watched_actions),
      engagement: sumActions(r.actions, ['post_engagement']), reactions: sumActions(r.actions, ['post_reaction', 'like']), comments: sumActions(r.actions, ['comment']), shares: sumActions(r.actions, ['post']), saves: sumActions(r.actions, ['onsite_conversion.post_save']),
    };
  });
  return { ads: out, daily: daily.map((d) => ({ date: d.date_start, spend: +d.spend || 0, impressions: +d.impressions || 0, linkClicks: +d.inline_link_clicks || 0 })), account: ctx.account, range };
}
