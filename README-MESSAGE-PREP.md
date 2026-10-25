# Preparacao para mensagens comerciais (fase 1)

Branch: `feat/message-prep`

## Aplicar patch do server.js

```bash
git checkout feat/message-prep
patch -p1 < patches/server-message-prep.patch
npm test
```

## Ja na branch

- `lib/locale.js` — pais para idioma comercial
- `lib/lead-fields.js` — extracao segura de Google Place ID / URL
- `template.js` — buildLeadMessage, prepareMessageForSend, locale comercial
- `tests/locale.test.js`

## Campos de lead

- `googlePlaceId`: Apify placeId (nunca inventado)
- `googleMapsUrl`: URL de ficha Google Maps se o provider enviar
- `osmId`: node/id ou way/id OSM
- `place_id`: legado (Google id se existir, senao OSM)
- `category`: primeira categoria

O botao Maps usa `googleMapsUrl` quando existe; caso contrario pesquisa generica.

## index.html

Incluir selects Pais/Idioma (mensagens) e data-attributes nos botoes Msg/WA+. Ver diff local ou reaplicar alteracoes descritas no relatorio da fase 1.
