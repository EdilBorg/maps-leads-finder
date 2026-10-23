# Maps Leads Finder

Ferramenta **open-source** para encontrar empresas no Google Maps que **não têm website**.

Ideal para quem vende websites, serviços digitais ou faz prospeção local.

---

## O que faz

- Pesquisa empresas no Google Maps por **nicho + localização**
- Filtra automaticamente apenas as que **não têm website**
- Exporta resultados em **CSV**, **Excel** e **PDF**
- Permite escolher o motor: **Outscraper**, **Apify** ou **Automático**

---

## Versões

| Versão | Estado | Descrição |
|--------|--------|-----------|
| **V1** | ✅ Pronta | Interface completa + filtro sem website + exportações (dados de demonstração) |
| **V2** | Em breve | Integração real com Outscraper + Apify |
| **V3** | Planeada | Login + histórico de pesquisas |
| **V4** | Planeada | PDF profissional + Google Sheets + templates de mensagem |
| **V5** | Planeada | Design final + deploy + polimento |

---

## Como usar a V1 (agora)

1. Faz clone do repositório:
```bash
git clone https://github.com/EdilBorg/maps-leads-finder.git
cd maps-leads-finder
```

2. Abre o ficheiro `index.html` no browser (podes usar Live Server ou simplesmente abrir o ficheiro).

3. Escolhe o motor, preenche o nicho e a localização, e clica em **Procurar leads**.

> **Nota:** A V1 funciona em modo demo com dados de exemplo. As APIs reais entram na V2.

---

## Configurar API Keys (para a V2)

1. Copia o ficheiro de exemplo:
```bash
cp .env.example .env
```

2. Abre o `.env` e coloca as tuas chaves:

```env
OUTSCRAPER_API_KEY=colocar_API_key_Outscraper_aqui
APIFY_API_TOKEN=colocar_API_token_Apify_aqui
```

3. Obtém as chaves:
   - Outscraper → https://outscraper.com/
   - Apify → https://console.apify.com/account/integrations

**Importante:** Nunca commits o ficheiro `.env` com chaves reais. Ele já está no `.gitignore`.

---

## Estrutura do projeto

```
maps-leads-finder/
├── index.html          # Interface principal (V1)
├── .env.example        # Modelo de variáveis de ambiente
├── .gitignore
├── README.md
└── (futuro) backend/   # Lógica de APIs (V2+)
```

---

## Roadmap

- [x] V1 — Interface + filtro + exportações (demo)
- [ ] V2 — Integração real Outscraper + Apify
- [ ] V3 — Autenticação e histórico
- [ ] V4 — Exportações avançadas e templates
- [ ] V5 — Deploy e polimento final

---

## Licença

MIT — Podes usar, modificar e distribuir livremente.

---

Feito para quem quer encontrar leads locais de forma rápida e inteligente.
