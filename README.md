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
| **V1** | ✅ | Interface + filtro + exportações (demo) |
| **V2** | ✅ Pronta | Integração real com Outscraper + Apify |
| **V3** | Planeada | Login + histórico de pesquisas |
| **V4** | Planeada | PDF profissional + Google Sheets + templates |
| **V5** | Planeada | Design final + deploy + polimento |

---

## Como usar a V2 (APIs reais)

### 1. Clone o repositório
```bash
git clone https://github.com/EdilBorg/maps-leads-finder.git
cd maps-leads-finder
```

### 2. Instala as dependências
```bash
npm install
```

### 3. Configura as API keys
```bash
cp .env.example .env
```

Abre o ficheiro `.env` e coloca as tuas chaves:

```env
OUTSCRAPER_API_KEY=colocar_API_key_Outscraper_aqui
APIFY_API_TOKEN=colocar_API_token_Apify_aqui
```

**Onde obter as chaves:**
- Outscraper → https://outscraper.com/ (500 grátis/mês)
- Apify → https://console.apify.com/account/integrations (~$5 grátis/mês)

> Podes configurar só uma das duas. O modo **Automático** usa a que estiver disponível.

### 4. Arranca o servidor
```bash
npm start
```

Abre no browser: **http://localhost:3000**

---

## Estrutura do projeto

```
maps-leads-finder/
├── index.html       # Interface (frontend)
├── server.js        # Backend (Outscraper + Apify)
├── package.json
├── .env.example     # Modelo das chaves (NUNCA commits o .env real)
├── .gitignore
└── README.md
```

---

## Como funciona

1. Escolhes o motor (Outscraper / Apify / Automático)
2. Preenches nicho + localização
3. A plataforma pesquisa no Google Maps
4. Filtra automaticamente só empresas **sem website**
5. Exportas em CSV, Excel ou PDF

---

## Roadmap

- [x] V1 — Interface + filtro + exportações (demo)
- [x] V2 — Integração real Outscraper + Apify
- [ ] V3 — Autenticação e histórico
- [ ] V4 — Exportações avançadas e templates
- [ ] V5 — Deploy e polimento final

---

## Licença

MIT — Podes usar, modificar e distribuir livremente.

---

Feito para quem quer encontrar leads locais de forma rápida e inteligente.
