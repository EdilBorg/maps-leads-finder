# Message prep (Fase 1) — estado real

Branch: `feat/message-prep`

## Arranque

```bash
npm install
npm start   # node server.js
```

`server.js` monta autenticação/sessão e chama `lib/app-core.js`.

## Módulos

| Ficheiro | Função |
|----------|--------|
| `server.js` | Express, sessão, login, static, monta app-core |
| `lib/app-core.js` | `/api/search`, `/api/locale-options`, `/api/status`, listen |
| `lib/search-lib.js` | Orquestra place-model + search-engines |
| `lib/place-model.js` | Junta constants + normalize + filters |
| `lib/place-constants.js` | Tokens, Overpass, geocode, tags OSM, helpers |
| `lib/place-normalize.js` | emptyPlace, normalize OSM/Apify (`googlePlaceId`, `osmId`, `googleMapsUrl`) |
| `lib/place-filters.js` | dedupe/merge/filters |
| `lib/search-engines.js` | searchOpenStreetMap, searchApify, searchCombined |
| `lib/locale.js` | País comercial → idioma por omissão |
| `lib/lead-fields.js` | Extração segura de Place ID / URL de ficha |

## Localização vs mercado

- **Localização** (`#location`): onde se pesquisam empresas.
- **Mercado (mensagens)** (`#commercialCountry`) + **idioma opcional** (`#commercialLanguage`): só para copy comercial (Fase 2 usará IA). Persistidos via `template.js` / localStorage.

## Msg / WA+ / Maps

- Msg e WA+ usam `buildLeadMessage` com data-attributes do lead (sem inventar campos).
- Maps usa `googleMapsUrl` quando for URL de ficha validada; senão pesquisa genérica.

## Testes

```bash
npm test
# = node tests/auth.test.js && node tests/locale.test.js
```

## Fora de âmbito (Fase 2)

Gemini, pesquisa web extra, preview de IA, serviços pagos novos.
