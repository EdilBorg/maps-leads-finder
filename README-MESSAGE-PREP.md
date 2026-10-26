# Message prep — estado Fase 1

## Arranque

```bash
npm install
npm test
npm start
```

## UI

O `template.js` na branch chama `POST /api/message/prepare` e abre modal WA+ antes de `wa.me`.

Se `index.html` na branch estiver incompleto, restaura a UI completa a partir de `main` e aplica os selects de mercado/idioma e `data-*` nos botões Msg/WA+/Maps (ver commits locais / artefactos `index.fase1.html`).

## Contrato API

```http
POST /api/message/prepare
Content-Type: application/json
Cookie: sessão autenticada

{
  "lead": { "name", "city", "address", "phone", "category", "website", "googlePlaceId", "osmId", "googleMapsUrl", ... },
  "commercialCountry": "PT",
  "language": "",
  "forceRefresh": false
}
```

Resposta: `{ success, text, source, cached, warning? }`.

Sem `GEMINI_API_KEY`, o backend devolve fallback de texto (ainda `success: true` com `source: fallback`).

## Fora de âmbito nesta fase

Limpeza de `parts/`, `assemble-server.js`, e endurecimento de `express.static`.
