# השכונתית · HaShchunatit — Lead Gen & Omnichannel Marketing

מערכת קלת-משקל לאיסוף לידים ממכונות אוטומטיות (דרך QR) ולשליחת קמפיינים ב-SMS, אימייל ו-WhatsApp.
Mobile-first, RTL, ותואמת חוק הספאם הישראלי.

A lightweight, mobile-first lead-generation + omnichannel broadcast system for the
"HaShchunatit" vending-machine business. Built with **Node.js (Express)**, using
**Google Sheets as the database** (via the sheets-connector REST API).

---

## ✨ What's included

| Part | File(s) |
|------|---------|
| Mobile landing page (RTL, branded form) | `public/index.html` |
| Secured admin login | `public/login.html` |
| Admin dashboard (subscribers, CSV export, campaign studio, history) | `public/admin.html` |
| Express server + API routes | `src/server.js` |
| Google Sheets data layer | `src/sheets.js` |
| SMS / WhatsApp / Email adapters | `src/services/messaging.js` |
| Campaign broadcaster + scheduler | `src/services/broadcaster.js` |
| Cookie-session admin auth | `src/auth.js` |

---

## 🚀 Quick start

```bash
# 1. Create your Google Sheet (see מבנה-גוגל-שיטס.md for tabs + headers)

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env
#    → edit .env: set SHEETS_API_KEY, ADMIN_PASSWORD, SESSION_SECRET, and any messaging providers

# 4. Run
npm start
```

Then open:

- **Landing page:** `http://localhost:3000/?machine=building_A`
- **Admin panel:** `http://localhost:3000/admin`  (login with `ADMIN_USERNAME` / `ADMIN_PASSWORD`)

---

## 🔗 QR codes

Generate one QR per machine/building pointing to your deployed URL with a `machine` parameter:

```
https://your-domain.co.il/?machine=building_A
https://your-domain.co.il/?machine=building_B
```

The `machine` value is stored with each lead so you know which machine each subscriber came from.

---

## 🗄️ Data store — Google Sheets

The database is a Google Sheet with two tabs, accessed through the sheets-connector REST
API (`src/sheets.js`). **Full column layout is in `מבנה-גוגל-שיטס.md`.** In short:

- **`Leads`** tab: `id` (= phone, for dedup), `full_name`, `phone`, `email`, `machine_id`,
  `consent_granted` (1/0 — **must be 1 to receive any campaign**), `created_at`.
- **`Campaigns`** tab: logs every broadcast (channels, audience, recipients, results).

Configure the connection with `SHEETS_*` variables in `.env`. Re-submitting an existing
phone updates that row (PATCH) instead of creating a duplicate.

---

## 📣 Messaging providers

Each channel is **optional** — leave its env vars blank and it's skipped automatically.

- **SMS & WhatsApp** → [Twilio](https://www.twilio.com) (`TWILIO_*` vars).
  WhatsApp media (image/MP4) is attached natively; SMS appends a short link to the media.
- **Email** → any SMTP server via Nodemailer (`SMTP_*` vars) — Gmail, SendGrid, Mailgun, etc.

> Want an Israeli SMS genie instead of Twilio? Swap the body of `sendSMS()` in
> `src/services/messaging.js` for your provider's HTTP API — the interface stays the same.

---

## ⚖️ Israeli Spam Law compliance (חוק הספאם)

- The landing form **cannot** be submitted without ticking the consent checkbox.
- The server **rejects** any lead without `consent`.
- The broadcaster loads recipients **only** via `Leads.consented()` — leads with
  `consent_granted = 0` are physically never included in a send.

---

## 🔌 Make.com / Zapier integration

- **New lead → outbound webhook:** set `MAKE_WEBHOOK_URL`. Every new lead is POSTed as JSON
  (sync to Smoove / Inwise / ActiveTrail through a Make scenario).
- **Campaign mirroring:** set `MAKE_CAMPAIGN_WEBHOOK_URL` to also forward each campaign's
  recipient list to Make — useful if you prefer Make to do the actual sending.

---

## 🌐 Deploying

Works on any Node host (Render, Railway, Fly.io, a VPS, etc.):

1. Set all `.env` variables in the host's dashboard.
2. Set `PUBLIC_BASE_URL` to your real https domain (needed for media links).
3. Run `npm start`.
4. Put it behind HTTPS (most hosts do this automatically) — required for secure cookies & QR trust.

Because data lives in Google Sheets, there is **no local database to persist** — the app is
fully stateless and safe to run on free/ephemeral hosting tiers (e.g. Render free). A
ready-made `render.yaml` blueprint is included.

---

## 🔒 Security notes

- Change `ADMIN_PASSWORD` and `SESSION_SECRET` before going live.
- Admin routes are protected by a signed, http-only session cookie.
- Login and lead endpoints are rate-limited.
- Run behind HTTPS in production so the session cookie is sent securely.
