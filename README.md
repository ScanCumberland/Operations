<p align="center">
  <img src="assets/logotp.png" alt="ScanCumberland Logo" width="220">
</p>

# ScanCumberland Operations

A two-level web console for the **ScanCumberland Communications System**.

- **Public:** Embedded Broadcastify Feeds + Calls and a simple aggregate activity view (no TG IDs/units).
- **Administrator:** Login to view live talkgroup activity (metadata only) and system status.

> **Broadcastify TOS:** This site only embeds official Broadcastify pages/players. No audio is proxied, downloaded, cached, or re-streamed. No LE-restricted channels.

---

## Live URLs (after Pages is enabled)
- Public: `https://kb3oan.github.io/ScanCumberland-Operations/`
- Admin:  `https://kb3oan.github.io/ScanCumberland-Operations/admin.html`

---

## Repo Layout
```
assets/                    # logos + favicon
bridge/                    # Node.js Activity Bridge (auth + roles + public aggregate)
  activity-bridge.js
  .env.template
  package.json
docs/
  DEPLOY-STEPS.md          # step-by-step deploy guide
index.html                 # public dashboard
admin.html                 # admin portal (login)
config.js                  # set bridge URLs + feed/calls config
app-public.js              # public page logic
app-admin.js               # admin page logic
styles.css                 # shared styles
```

---

## Quick Start

### 1) Enable GitHub Pages
Repo → Settings → Pages → Source: Deploy from branch → Branch: `main` / `/` (root). Wait ~1–3 minutes for the site to publish.

### 2) Run the Activity Bridge (on the SDRTrunk PC)
```bash
# In the bridge/ folder:
npm i
copy .env.template .env   # Windows
# edit .env → set ADMIN creds, ALLOWED_ORIGIN, WATCH_JSON_DIR (or CSV fallback)
npm start
```

**Generate bcrypt password hash**:
```bash
node -e "require('bcrypt').hash(process.argv[1],10).then(h=>console.log(h))" YOUR_PASSWORD
```
Put the printed hash into `ADMIN_PASSWORD_HASH` in `.env`.

### 3) Expose the Bridge for free (no domain)
```bash
cloudflared tunnel --url http://localhost:8091
```
Copy the `https://<random>.trycloudflare.com` URL it prints.

### 4) Wire the site to the bridge
Edit `config.js`:
```js
const BRIDGE_HTTP_BASE = "https://<random>.trycloudflare.com";
const ACTIVITY_WS_URL  = "wss://<random>.trycloudflare.com/activity";
```
Commit & push, then test `/admin.html`.

---

## Bridge .env (example)
```ini
PORT=8091
WS_PATH=/activity
ALLOWED_ORIGIN=https://kb3oan.github.io
JWT_SECRET=please-change-me
JWT_EXPIRES=8h
ADMIN_USERNAME=scadmin
ADMIN_PASSWORD_HASH=REPLACE_WITH_BCRYPT_HASH
WATCH_JSON_DIR=C:\Users\YOU\SDRTrunk\recordings
JSON_GLOB=**/*.json
CSV_HAS_HEADER=true
PUBLIC_WINDOW_SEC=300
```

---

### Credits
Built for **ScanCumberland** by **KB3OAN**.  
Branding (name/logo) © KB3OAN. Code is MIT-licensed (see LICENSE).
