import express from 'express';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, extname } from 'node:path';
import { mkdirSync } from 'node:fs';
import 'dotenv/config';

import { initSchema, Leads, Campaigns, Promotions, SmsLog, Machines, Products } from './sheets.js';
import { issueSession, clearSession, checkCredentials, requireAuth } from './auth.js';
import { runCampaign } from './services/broadcaster.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// בסביבת serverless (Netlify/Lambda) רק /tmp ניתן לכתיבה
const IS_SERVERLESS = !!process.env.NETLIFY || !!process.env.AWS_LAMBDA_FUNCTION_NAME;
const UPLOAD_DIR = IS_SERVERLESS ? '/tmp/uploads' : join(ROOT, 'uploads');

try { mkdirSync(UPLOAD_DIR, { recursive: true }); } catch {}

initSchema();

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Static files — Netlify serves public/ directly; locally Express serves them
if (!IS_SERVERLESS) {
  app.use('/uploads', express.static(UPLOAD_DIR));
  app.use(express.static(join(ROOT, 'public')));
}

// ---------- File uploads (campaign media) ----------
const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/[^\w.\-]/g, '_')}`),
});
const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = ['.jpg', '.jpeg', '.png', '.mp4'].includes(extname(file.originalname).toLowerCase());
    cb(ok ? null : new Error('Only JPG/PNG/MP4 allowed'), ok);
  },
});

// =========================================================
//  PUBLIC — Lead capture
// =========================================================
const leadLimiter = rateLimit({ windowMs: 60 * 1000, max: 20 });

app.post('/api/leads', leadLimiter, async (req, res) => {
  try {
    const { full_name, phone, email, machine_id, consent } = req.body;

    if (!full_name || !String(full_name).trim())
      return res.status(400).json({ error: 'שם מלא חובה' });

    const digits = String(phone || '').replace(/\D/g, '');
    if (digits.length !== 10)
      return res.status(400).json({ error: 'מספר טלפון חייב להכיל 10 ספרות' });

    if (!consent)
      return res.status(400).json({ error: 'חובה לאשר קבלת דיוור' });

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return res.status(400).json({ error: 'כתובת אימייל לא תקינה' });

    const lead = await Leads.create({
      full_name: String(full_name).trim(),
      phone: digits,
      email: email ? String(email).trim() : null,
      machine_id: (machine_id || 'unknown').toString().slice(0, 64),
      consent_granted: true,
    });

    if (process.env.MAKE_WEBHOOK_URL) {
      fetch(process.env.MAKE_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(lead),
      }).catch(() => {});
    }

    res.json({ ok: true, lead });
  } catch (e) {
    res.status(500).json({ error: 'שגיאת שרת', detail: e.message });
  }
});

app.get('/api/promotions', async (req, res) => {
  try {
    res.json({ promotions: await Promotions.all({ activeOnly: true, machine_id: req.query.machine || null }) });
  } catch (e) {
    res.json({ promotions: [] });
  }
});

app.get('/api/machines', async (req, res) => {
  try {
    const all = await Machines.all();
    res.json({ machines: all.filter(m => m.status === 'active').map(m => ({ id: m.id, name: m.name, location: m.location, lat: m.lat ?? null, lng: m.lng ?? null })) });
  } catch (e) {
    res.json({ machines: [] });
  }
});

// =========================================================
//  ADMIN — auth
// =========================================================
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10 });

app.post('/api/admin/login', loginLimiter, (req, res) => {
  const { username, password } = req.body;
  if (checkCredentials(username, password)) {
    issueSession(res);
    return res.json({ ok: true });
  }
  res.status(401).json({ error: 'שם משתמש או סיסמה שגויים' });
});

app.post('/api/admin/logout', (req, res) => { clearSession(res); res.json({ ok: true }); });

app.get('/admin/login', (req, res) => res.sendFile(join(ROOT, 'public', 'login.html')));
app.get('/admin', requireAuth, (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.sendFile(join(ROOT, 'public', 'admin.html'));
});

// =========================================================
//  ADMIN — data API
// =========================================================
app.get('/api/admin/stats', requireAuth, async (req, res) => {
  try {
    const [stats, machines] = await Promise.all([Leads.stats(), Leads.machines()]);
    res.json({ stats, machines });
  } catch (e) { res.status(502).json({ error: 'שגיאת חיבור לגיליון', detail: e.message }); }
});

app.get('/api/admin/leads', requireAuth, async (req, res) => {
  try {
    const { machine_id, search, status } = req.query;
    res.json({ leads: await Leads.all({ machine_id, search, status }) });
  } catch (e) { res.status(502).json({ error: 'שגיאת חיבור לגיליון', detail: e.message }); }
});

app.get('/api/admin/leads/export', requireAuth, async (req, res) => {
  const { machine_id, search } = req.query;
  const rows = await Leads.all({ machine_id, search });
  const header = ['id', 'full_name', 'phone', 'email', 'machine_id', 'consent_granted', 'status', 'tags', 'notes', 'created_at'];
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = '﻿' + [
    header.join(','),
    ...rows.map(r => header.map(h => esc(r[h])).join(',')),
  ].join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="leads_${Date.now()}.csv"`);
  res.send(csv);
});

app.get('/api/admin/leads/:id', requireAuth, async (req, res) => {
  try {
    const lead = await Leads.get(req.params.id);
    if (!lead) return res.status(404).json({ error: 'ליד לא נמצא' });
    const campaigns = await Campaigns.all();
    const history = [];
    for (const c of campaigns) {
      let log = [];
      try { log = JSON.parse(c.result_log || '[]'); } catch {}
      const mine = log.find(e => String(e.lead_id) === String(lead.id));
      if (mine) history.push({ id: c.id, body: c.body, channels: c.channels, created_at: c.created_at, results: mine.results || [] });
    }
    res.json({ lead, history });
  } catch (e) { res.status(502).json({ error: 'שגיאת חיבור לגיליון', detail: e.message }); }
});

app.delete('/api/admin/leads/:id', requireAuth, async (req, res) => {
  try {
    await Leads.remove(req.params.id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'שגיאת מחיקה', detail: e.message }); }
});

app.patch('/api/admin/leads/:id', requireAuth, async (req, res) => {
  try {
    const allowed = {};
    for (const k of ['status', 'tags', 'notes', 'machine_id']) {
      if (k in req.body) allowed[k] = String(req.body[k] ?? '');
    }
    if (!Object.keys(allowed).length) return res.status(400).json({ error: 'אין שדות לעדכון' });
    const lead = await Leads.update(req.params.id, allowed);
    res.json({ ok: true, lead });
  } catch (e) { res.status(502).json({ error: 'שגיאת עדכון', detail: e.message }); }
});

app.get('/api/admin/dashboard', requireAuth, async (req, res) => {
  try {
    const [leads, campaigns] = await Promise.all([Leads.all(), Campaigns.all()]);
    const byDay = {}, byMachine = {}, byStatus = {};
    for (const l of leads) {
      const day = (l.created_at || '').slice(0, 10) || 'ללא תאריך';
      byDay[day] = (byDay[day] || 0) + 1;
      byMachine[l.machine_id] = (byMachine[l.machine_id] || 0) + 1;
      byStatus[l.status] = (byStatus[l.status] || 0) + 1;
    }
    const totalSent = campaigns.reduce((s, c) => s + (c.sent_count || 0), 0);
    res.json({
      totals: { leads: leads.length, consented: leads.filter(l => l.consent_granted === 1).length, campaigns: campaigns.length, messages_sent: totalSent },
      by_day: Object.entries(byDay).sort((a, b) => a[0].localeCompare(b[0])),
      by_machine: Object.entries(byMachine).sort((a, b) => b[1] - a[1]),
      by_status: Object.entries(byStatus).sort((a, b) => b[1] - a[1]),
    });
  } catch (e) { res.status(502).json({ error: 'שגיאת חיבור לגיליון', detail: e.message }); }
});

// =========================================================
//  ADMIN — promotions
// =========================================================
app.get('/api/admin/promotions', requireAuth, async (req, res) => {
  try {
    res.json({ promotions: await Promotions.all() });
  } catch (e) { res.status(502).json({ error: 'שגיאת חיבור לגיליון', detail: e.message }); }
});

app.post('/api/admin/promotions', requireAuth, async (req, res) => {
  try {
    const { title, description, badge, emoji, active, sort_order, machine_id } = req.body;
    if (!title || !String(title).trim()) return res.status(400).json({ error: 'כותרת חובה' });
    const promo = await Promotions.create({ title: String(title).trim(), description: String(description || '').trim(), badge: String(badge || '').trim(), emoji: String(emoji || '🌿').trim(), active: active === undefined ? true : !!active, sort_order: Number(sort_order) || 0, machine_id: machine_id || null });
    res.json({ ok: true, promotion: promo });
  } catch (e) { res.status(502).json({ error: 'שגיאה ביצירת מבצע', detail: e.message }); }
});

app.patch('/api/admin/promotions/:id', requireAuth, async (req, res) => {
  try {
    const fields = {};
    for (const k of ['title', 'description', 'badge', 'emoji', 'sort_order', 'machine_id']) {
      if (k in req.body) fields[k] = req.body[k];
    }
    if ('active' in req.body) fields.active = !!req.body.active;
    const promo = await Promotions.update(req.params.id, fields);
    res.json({ ok: true, promotion: promo });
  } catch (e) { res.status(502).json({ error: 'שגיאת עדכון מבצע', detail: e.message }); }
});

app.delete('/api/admin/promotions/:id', requireAuth, async (req, res) => {
  try {
    await Promotions.remove(req.params.id);
    res.json({ ok: true });
  } catch (e) { res.status(502).json({ error: 'שגיאת מחיקת מבצע', detail: e.message }); }
});

// =========================================================
//  ADMIN — campaigns
// =========================================================
app.get('/api/admin/campaigns', requireAuth, async (req, res) => {
  try {
    res.json({ campaigns: await Campaigns.all() });
  } catch (e) { res.status(502).json({ error: 'שגיאת חיבור לגיליון', detail: e.message }); }
});

app.post('/api/admin/campaigns', requireAuth, upload.single('media'), async (req, res) => {
  try {
    const channels = JSON.parse(req.body.channels || '[]');
    if (!channels.length) return res.status(400).json({ error: 'בחר/י לפחות ערוץ אחד' });
    const audience = JSON.parse(req.body.audience || '{}');
    const body = (req.body.body || '').trim();
    if (!body) return res.status(400).json({ error: 'תוכן ההודעה חובה' });
    const scheduledAt = req.body.scheduled_at || null;
    const campaign = await Campaigns.create({ channels: JSON.stringify(channels), audience: JSON.stringify(audience), body, media_path: req.file ? req.file.filename : null, scheduled_at: scheduledAt, status: scheduledAt ? 'scheduled' : 'pending', recipients: 0 });
    if (scheduledAt) return res.json({ ok: true, scheduled: true, campaign });
    const done = await runCampaign(campaign);
    res.json({ ok: true, scheduled: false, campaign: done });
  } catch (e) {
    res.status(500).json({ error: 'שגיאה בשליחת הקמפיין', detail: e.message });
  }
});

// =========================================================
//  ADMIN — SMS log
// =========================================================
app.get('/api/admin/sms-log', requireAuth, async (req, res) => {
  try {
    const { lead_id, machine_id, channel, status, search } = req.query;
    const [logs, stats] = await Promise.all([
      SmsLog.all({ lead_id, machine_id, channel, status, search }),
      SmsLog.stats(),
    ]);
    res.json({ logs, stats });
  } catch (e) { res.status(502).json({ error: 'שגיאת טעינת לוג SMS', detail: e.message }); }
});

// =========================================================
//  ADMIN — machines
// =========================================================
app.get('/api/admin/machines/debug', requireAuth, async (req, res) => {
  const { createClient } = await import('@supabase/supabase-js');
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
  const raw = await sb.from('machines').select('*');
  res.json({ url: process.env.SUPABASE_URL?.slice(0,40), data: raw.data, error: raw.error, count: raw.data?.length ?? null });
});

app.get('/api/admin/machines', requireAuth, async (req, res) => {
  try { res.json({ machines: await Machines.all() }); }
  catch (e) { res.status(502).json({ error: 'שגיאת טעינת מכונות', detail: e.message }); }
});

app.post('/api/admin/machines', requireAuth, async (req, res) => {
  try {
    const { name, location, status, notes, lat, lng } = req.body;
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'שם המכונה חובה' });
    const machine = await Machines.create({
      name: String(name).trim(),
      location: String(location || '').trim(),
      status: status || 'active',
      notes: String(notes || '').trim(),
      sort_order: Number(req.body.sort_order) || 0,
      lat: lat != null && lat !== '' ? parseFloat(lat) : null,
      lng: lng != null && lng !== '' ? parseFloat(lng) : null,
    });
    res.json({ ok: true, machine });
  } catch (e) { res.status(500).json({ error: 'שגיאה ביצירת מכונה', detail: e.message }); }
});

app.patch('/api/admin/machines/:id', requireAuth, async (req, res) => {
  try {
    const fields = {};
    for (const k of ['name', 'location', 'status', 'notes']) {
      if (k in req.body) fields[k] = String(req.body[k] ?? '').trim();
    }
    if ('sort_order' in req.body) fields.sort_order = Number(req.body.sort_order) || 0;
    if ('lat' in req.body) fields.lat = req.body.lat !== '' ? parseFloat(req.body.lat) : null;
    if ('lng' in req.body) fields.lng = req.body.lng !== '' ? parseFloat(req.body.lng) : null;
    const machine = await Machines.update(req.params.id, fields);
    res.json({ ok: true, machine });
  } catch (e) { res.status(500).json({ error: 'שגיאת עדכון מכונה', detail: e.message }); }
});

app.delete('/api/admin/machines/:id', requireAuth, async (req, res) => {
  try { await Machines.remove(req.params.id); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: 'שגיאת מחיקת מכונה', detail: e.message }); }
});

// =========================================================
//  ADMIN — products
// =========================================================
app.get('/api/admin/products', requireAuth, async (req, res) => {
  try { res.json({ products: await Products.all({ search: req.query.search }) }); }
  catch (e) { res.status(502).json({ error: 'שגיאת טעינת מוצרים', detail: e.message }); }
});

app.post('/api/admin/products', requireAuth, async (req, res) => {
  try {
    const { name, category, price_before, price_after } = req.body;
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'שם המוצר חובה' });
    const product = await Products.create({ name: String(name).trim(), category: String(category || '').trim(), price_before, price_after });
    res.json({ ok: true, product });
  } catch (e) { res.status(500).json({ error: 'שגיאה ביצירת מוצר', detail: e.message }); }
});

app.post('/api/admin/products/bulk', requireAuth, async (req, res) => {
  try {
    const { products } = req.body;
    if (!Array.isArray(products) || !products.length) return res.status(400).json({ error: 'רשימת מוצרים ריקה' });
    const result = await Products.bulkInsert(products);
    res.json({ ok: true, ...result });
  } catch (e) { res.status(500).json({ error: 'שגיאה בייבוא מוצרים', detail: e.message }); }
});

app.patch('/api/admin/products/:id', requireAuth, async (req, res) => {
  try {
    const { name, category, price_before, price_after } = req.body;
    const product = await Products.update(req.params.id, { name, category, price_before, price_after });
    res.json({ ok: true, product });
  } catch (e) { res.status(500).json({ error: 'שגיאת עדכון מוצר', detail: e.message }); }
});

app.delete('/api/admin/products/:id', requireAuth, async (req, res) => {
  try { await Products.remove(req.params.id); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: 'שגיאת מחיקת מוצר', detail: e.message }); }
});

// =========================================================
//  Health
// =========================================================
app.get('/api/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

export default app;
