# Shopee Afiliados — base do sistema

Painel publicado em https://shopee-afiliados-kr4.vercel.app

Cliente Node da **Shopee Affiliate Open API (Brasil)** + painel web para navegar pelos dados.
Sem dependências: só precisa do Node 18 ou mais novo.

## Rodar

```bash
cd shopee-afiliados
node server.js            # usa as credenciais do .env
# abra http://localhost:3000
```

Testar sem gastar chamadas da API (dados falsos):

```bash
npm run mock              # Linux/Mac
npm run mock:win          # Windows
```

## Credenciais (.env)

```
SHOPEE_APP_ID=...
SHOPEE_SECRET=...
PORT=3000
```

O `.env` está no `.gitignore`. Nunca coloque o Secret no front-end nem em repositório.

## O que o painel traz

| Aba | Consulta | Dados |
|---|---|---|
| Produtos | `productOfferV2` | nome, preço mín/máx, desconto, vendas, nota, comissão (% e R$, vendedor/Shopee), loja, tipo de loja, categorias, link de afiliado, imagem, validade |
| Lojas | `shopOfferV2` | loja, tipo (Mall/Star/Star+), nota, comissão, cobertura, orçamento, banners, link |
| Campanhas Shopee | `shopeeOfferV2` | campanhas oficiais, comissão, categoria/coleção, período, link |
| Gerar links | `generateShortLink` | link curto com até 5 subIds, em lote (até 50 URLs) |
| Conversões | `conversionReport` | pedidos, itens, valores, comissões (bruta, limitada, líquida, vendedor, Shopee, MCN), status, fraude, dispositivo, comprador novo/antigo, **utmContent (subId)** — com resumo por vídeo e por produto |
| Validados | `validatedReport` | comissões validadas para pagamento (precisa do validationId) |
| Feeds | `listItemFeeds` / `getItemFeedData` | catálogo em massa (se a conta tiver acesso) |
| Console | qualquer GraphQL | executa consultas livres e tenta baixar o schema completo |

Em todas as abas: filtro, ordenação por coluna, detalhes completos de cada item, exportação CSV/JSON e paginação automática ("Todas as páginas").

## Detalhes técnicos

- **Assinatura:** `SHA256(appId + timestamp + payload + secret)`, header
  `Authorization: SHA256 Credential={appId}, Timestamp={ts}, Signature={sig}`.
- **Campos auto-ajustáveis:** se a Shopee rejeitar algum campo (`Cannot query field "x"`), o cliente remove o campo e repete a consulta. O painel mostra quais foram removidos — atualize `FIELDS` em `src/shopee.js` se quiser fixar.
- **Cache** de 5 minutos para buscas de produtos/lojas/campanhas (botão "Limpar cache").
- **Paginação:** produtos/lojas/campanhas usam `page`; relatórios usam `scrollId` (expira rápido, por isso é percorrido em sequência).

## Usar o cliente em outro código

```js
import { ShopeeAffiliate } from './src/shopee.js';
const shopee = new ShopeeAffiliate({ appId: process.env.SHOPEE_APP_ID, secret: process.env.SHOPEE_SECRET });

const top = await shopee.productOffers({ keyword: 'garrafa térmica', sortType: 2, limit: 50 });
const tudo = await shopee.allPages('productOffers', { keyword: 'fone', sortType: 5 }, { maxPages: 10 });
const link = await shopee.shortLink({ originUrl: 'https://shopee.com.br/...', subIds: ['video001', 'tiktok'] });
const vendas = await shopee.allScroll('conversionReport', { purchaseTimeStart: 1730000000, purchaseTimeEnd: 1732600000 });
```

## API local (para integrar com outros sistemas)

`GET /api/status` · `POST /api/products` · `/api/shops` · `/api/offers` · `/api/shortlink` · `/api/shortlinks` ·
`/api/conversions` · `/api/validated` · `/api/feeds` · `/api/feed-data` · `/api/graphql` · `/api/introspect` · `/api/cache/clear`

Todas recebem JSON com os mesmos parâmetros dos formulários (ex.: `{"keyword":"fone","sortType":5,"allPages":true,"maxPages":5}`).

## Publicar na Vercel (acesso pelo celular de qualquer lugar)

O projeto já está pronto para a Vercel: `api/index.js` (função) + `public/` (painel) + `vercel.json`.

```bash
cd shopee-afiliados
npx vercel login
npx vercel link                 # crie o projeto, ex.: shopee-afiliados-kr4
npx vercel env add SHOPEE_APP_ID production
npx vercel env add SHOPEE_SECRET production
npx vercel env add PANEL_KEY production      # senha para abrir o painel
npx vercel --prod
```

Na primeira busca o painel pede a senha (`PANEL_KEY`) e guarda no aparelho. O botão **Sair** apaga.
Sem `PANEL_KEY` o painel fica aberto para qualquer um com o link — não publique sem ela.
