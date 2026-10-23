# Maps Leads Finder

Ferramenta **open-source** para encontrar empresas no Google Maps que **não têm website**.

Ideal para quem vende websites, serviços digitais ou faz prospeção local.

---

## O que faz

- Pesquisa empresas no Google Maps por **nicho + localização**
- Filtra automaticamente apenas as que **não têm website**
- Exporta resultados em **CSV**, **Excel** e **PDF profissional**
- Permite escolher o motor: **Outscraper**, **Apify** ou **Automático**

---

## Versões

| Versão | Estado | Descrição |
|--------|--------|-----------|
| **V1** | ✅ | Interface + filtro + exportações (demo) |
| **V2** | ✅ | Integração real com Outscraper + Apify |
| **V3** | ⏸ Adiada | Login (só quando fizer sentido escalar) |
| **V4** | ✅ Pronta | PDF profissional (cabeçalho, tabela, rodapé, páginas) |
| **V5** | Planeada | Deploy + polimento final |

---

## Como usar

### 1. Clone
```bash
git clone https://github.com/EdilBorg/maps-leads-finder.git
cd maps-leads-finder
```

### 2. Instala dependências
```bash
npm install
```

### 3. Configura as API keys
```bash
cp .env.example .env
```

Edita o `.env`:

```env
OUTSCRAPER_API_KEY=colocar_API_key_Outscraper_aqui
APIFY_API_TOKEN=colocar_API_token_Apify_aqui
```

- Outscraper → https://outscraper.com/
- Apify → https://console.apify.com/account/integrations

### 4. Arranca
```bash
npm start
```

Abre: **http://localhost:3000**

---

## PDF profissional (V4)

O botão **Exportar PDF** gera um ficheiro A4 horizontal com:

- Cabeçalho azul com título e data
- Critérios da pesquisa (nicho, localização, motor)
- Tabela formatada com linhas alternadas
- Rodapé com número de página
- Nome de ficheiro automático (`leads-nicho-cidade-data.pdf`)

---

## Estrutura

```
maps-leads-finder/
├── index.html       # Interface + PDF profissional
├── server.js        # Backend Outscraper + Apify
├── package.json
├── .env.example
├── .gitignore
└── README.md
```

---

## Roadmap

- [x] V1 — Interface + demo
- [x] V2 — APIs reais
- [ ] V3 — Login (adiada)
- [x] V4 — PDF profissional
- [ ] V5 — Deploy + polimento

---

## Licença

MIT
