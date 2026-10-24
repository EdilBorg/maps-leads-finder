# Deploy — Maps Leads Finder

A app é um servidor Node.js (`server.js`) + ficheiros estáticos. Precisas de **Node 18+** e das variáveis no ambiente (nunca no Git).

---

## Opção A — Railway (recomendado, simples)

1. Conta em [railway.app](https://railway.app)
2. **New Project** → **Deploy from GitHub** → escolhe `EdilBorg/maps-leads-finder`
3. Railway deteta Node e corre `npm start`
4. Em **Variables**, adiciona:

```
OUTSCRAPER_API_KEY=a_tua_chave
APIFY_API_TOKEN=o_teu_token
```

(só uma das duas basta)

5. Em **Settings → Networking → Generate Domain** — fica com um URL tipo `https://xxx.up.railway.app`

Pronto. Abre o URL no browser.

> Plano free tem limites de horas; para uso pessoal costuma chegar.

---

## Opção B — Render

1. Conta em [render.com](https://render.com)
2. **New → Web Service** → liga o repo GitHub
3. Configura:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance:** Free
4. **Environment** → as mesmas variáveis (`OUTSCRAPER_API_KEY`, `APIFY_API_TOKEN`)
5. Deploy → usa o URL `https://xxx.onrender.com`

> No free tier o serviço “dorme” após inatividade; a primeira abertura pode demorar ~30–60s.

---

## Opção C — VPS (controlo total)

Ex.: DigitalOcean, Hetzner, Contabo, ou qualquer Ubuntu.

```bash
# no servidor
sudo apt update && sudo apt install -y nodejs npm git
# (ou instala Node 20 via nodesource se a versão do apt for antiga)

git clone https://github.com/EdilBorg/maps-leads-finder.git
cd maps-leads-finder
cp .env.example .env
nano .env   # coloca as API keys

npm install

# testar
npm start
# http://IP:3000
```

### Manter online com PM2

```bash
sudo npm install -g pm2
pm2 start server.js --name maps-leads
pm2 save
pm2 startup
```

### HTTPS com domínio (Nginx + Certbot)

```bash
sudo apt install -y nginx certbot python3-certbot-nginx
```

Exemplo de site Nginx (`/etc/nginx/sites-available/maps-leads`):

```nginx
server {
    listen 80;
    server_name teudominio.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/maps-leads /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d teudominio.com
```

---

## Variáveis obrigatórias

| Variável | Onde obter |
|----------|------------|
| `OUTSCRAPER_API_KEY` | https://outscraper.com/ |
| `APIFY_API_TOKEN` | https://console.apify.com/account/integrations |
| `PORT` | Opcional (Railway/Render definem sozinhos) |

O `server.js` já usa `process.env.PORT`.

---

## Segurança (importante)

- **Não** commits o ficheiro `.env`
- Se puseres a app **pública** na internet, qualquer pessoa pode gastar as **tuas** quotas de API
- Para uso só teu: ou manténs local, ou no VPS com firewall, ou um password simples à frente (Nginx basic auth)

Exemplo Nginx basic auth:

```bash
sudo apt install -y apache2-utils
sudo htpasswd -c /etc/nginx/.htpasswd teuuser
```

No `location /`:

```nginx
auth_basic "Maps Leads";
auth_basic_user_file /etc/nginx/.htpasswd;
```

---

## Checklist rápido

1. Repo no GitHub actualizado (`git pull`)
2. Keys no painel do host (ou `.env` no VPS)
3. `npm start` / start command correcto
4. Abrir o URL e ver o estado das APIs no canto superior
5. Fazer uma pesquisa de teste com poucos resultados
