// ==========================================================
//  Data layer — Google Sheets via the "sheets-connector" REST API
//  (https://sheets-connector.vercel.app). Every method is ASYNC
//  because it makes HTTP calls.
//
//  Endpoints used (per table):
//    GET    /tables/{TABLE}?limit&offset      → list rows
//    GET    /tables/{TABLE}/{id}              → single row
//    POST   /tables/{TABLE}                   → add row (must include "id")
//    PATCH  /tables/{TABLE}/{id}              → update row
//    DELETE /tables/{TABLE}/{id}              → soft delete
//  Auth header: x-api-key
// ==========================================================
import 'dotenv/config';

const BASE       = (process.env.SHEETS_API_BASE || 'https://sheets-connector.vercel.app/api/v1').replace(/\/$/, '');
const PROJECT_ID = process.env.SHEETS_PROJECT_ID || '';
const API_KEY    = process.env.SHEETS_API_KEY || '';
const LEADS_TABLE      = process.env.SHEETS_LEADS_TABLE || 'Leads';
const CAMPAIGNS_TABLE  = process.env.SHEETS_CAMPAIGNS_TABLE || 'Campaigns';
const PROMOTIONS_TABLE = process.env.SHEETS_PROMOTIONS_TABLE || 'Promotions';
const PAGE = 1000; // rows per page when listing

function tableUrl(table, idOrQuery = '') {
  return `${BASE}/projects/${PROJECT_ID}/tables/${encodeURIComponent(table)}${idOrQuery}`;
}

async function api(method, url, body) {
  if (!PROJECT_ID || !API_KEY) {
    throw new Error('Google Sheets API not configured — set SHEETS_PROJECT_ID and SHEETS_API_KEY in .env');
  }
  const res = await fetch(url, {
    method,
    headers: {
      'x-api-key': API_KEY,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!res.ok) {
    throw new Error(`Sheets API ${method} ${res.status}: ${text?.slice(0, 300)}`);
  }
  return json;
}

// The connector may wrap rows in different shapes — normalize to an array.
function extractRows(json) {
  if (Array.isArray(json)) return json;
  for (const key of ['data', 'rows', 'records', 'results', 'items']) {
    if (Array.isArray(json?.[key])) return json[key];
  }
  if (json && typeof json === 'object' && ('id' in json)) return [json];
  return [];
}

// Fetch every row of a table (paginates until a short page is returned).
async function listAll(table) {
  const out = [];
  let offset = 0;
  for (let i = 0; i < 100; i++) {
    const json = await api('GET', tableUrl(table, `?limit=${PAGE}&offset=${offset}`));
    const rows = extractRows(json);
    out.push(...rows);
    if (rows.length < PAGE) break;
    offset += PAGE;
  }
  return out;
}

const truthy = v => v === true || v === 1 || v === '1' || String(v).toLowerCase() === 'true';
const num    = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const nowStr = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

// Coerce a raw sheet row into the lead shape the app expects.
function normalizeLead(r) {
  return {
    id: r.id,
    full_name: r.full_name || '',
    phone: String(r.phone || ''),
    email: r.email || null,
    machine_id: r.machine_id || 'unknown',
    consent_granted: truthy(r.consent_granted) ? 1 : 0,
    status: r.status || 'חדש',
    tags: r.tags || '',
    notes: r.notes || '',
    created_at: r.created_at || '',
  };
}

// ===================== Leads =====================
export const Leads = {
  // Upsert by phone (phone is used as the row id → natural dedup).
  async create({ full_name, phone, email, machine_id, consent_granted }) {
    const id = String(phone);

    let existing = null;
    try {
      const found = await api('GET', tableUrl(LEADS_TABLE, `/${encodeURIComponent(id)}`));
      const rows = extractRows(found);
      existing = rows.length ? rows[0] : (found && found.id ? found : null);
    } catch { existing = null; }

    if (existing) {
      // Update contact details but PRESERVE crm fields (status/tags/notes) and created_at.
      const patch = {
        full_name,
        phone: String(phone),
        email: email || '',
        machine_id: machine_id || 'unknown',
        consent_granted: consent_granted ? '1' : '0',
      };
      await api('PATCH', tableUrl(LEADS_TABLE, `/${encodeURIComponent(id)}`), patch);
      return normalizeLead({ ...existing, ...patch });
    }

    const row = {
      id,
      full_name,
      phone: String(phone),
      email: email || '',
      machine_id: machine_id || 'unknown',
      consent_granted: consent_granted ? '1' : '0',
      status: 'חדש',
      tags: '',
      notes: '',
      created_at: nowStr(),
    };
    await api('POST', tableUrl(LEADS_TABLE), row);
    return normalizeLead(row);
  },

  async get(id) {
    try {
      const found = await api('GET', tableUrl(LEADS_TABLE, `/${encodeURIComponent(id)}`));
      const rows = extractRows(found);
      const r = rows.length ? rows[0] : (found && found.id ? found : null);
      return r ? normalizeLead(r) : null;
    } catch { return null; }
  },

  // Update CRM fields (status, tags, notes, etc.).
  async update(id, fields) {
    const patch = {};
    for (const [k, v] of Object.entries(fields)) patch[k] = typeof v === 'number' ? String(v) : v;
    await api('PATCH', tableUrl(LEADS_TABLE, `/${encodeURIComponent(id)}`), patch);
    return this.get(id);
  },

  async all({ machine_id, search, status } = {}) {
    let rows = (await listAll(LEADS_TABLE)).map(normalizeLead);
    if (machine_id) rows = rows.filter(r => r.machine_id === machine_id);
    if (status)     rows = rows.filter(r => r.status === status);
    if (search) {
      const q = String(search).toLowerCase();
      rows = rows.filter(r =>
        r.full_name.toLowerCase().includes(q) ||
        r.phone.includes(q) ||
        (r.email || '').toLowerCase().includes(q) ||
        (r.tags || '').toLowerCase().includes(q));
    }
    return rows.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  },

  // LEGAL: only consented leads — enforces Israeli Spam Law.
  async consented({ machine_id, phone, search } = {}) {
    let rows = (await listAll(LEADS_TABLE)).map(normalizeLead).filter(r => r.consent_granted === 1);
    if (machine_id) rows = rows.filter(r => r.machine_id === machine_id);
    if (phone)      rows = rows.filter(r => r.phone === String(phone));
    if (search) {
      const q = String(search).toLowerCase();
      rows = rows.filter(r => r.full_name.toLowerCase().includes(q) || r.phone.includes(q));
    }
    return rows;
  },

  async machines() {
    const rows = await this.all();
    const map = new Map();
    for (const r of rows) map.set(r.machine_id, (map.get(r.machine_id) || 0) + 1);
    return [...map.entries()]
      .map(([machine_id, count]) => ({ machine_id, count }))
      .sort((a, b) => b.count - a.count);
  },

  async stats() {
    const rows = await this.all();
    return {
      total: rows.length,
      consented: rows.filter(r => r.consent_granted === 1).length,
      with_email: rows.filter(r => r.email && r.email !== '').length,
    };
  },
};

// =================== Campaigns ===================
function normalizeCampaign(r) {
  return {
    id: r.id,
    channels: r.channels || '[]',
    audience: r.audience || '{}',
    body: r.body || '',
    media_path: r.media_path || null,
    scheduled_at: r.scheduled_at || null,
    status: r.status || 'pending',
    recipients: num(r.recipients),
    sent_count: num(r.sent_count),
    result_log: r.result_log || '',
    created_at: r.created_at || '',
  };
}

export const Campaigns = {
  async create(c) {
    const id = String(Date.now());
    const row = {
      id,
      channels: c.channels,
      audience: c.audience,
      body: c.body,
      media_path: c.media_path || '',
      scheduled_at: c.scheduled_at || '',
      status: c.status || 'pending',
      recipients: String(c.recipients ?? 0),
      sent_count: '0',
      result_log: '',
      created_at: nowStr(),
    };
    await api('POST', tableUrl(CAMPAIGNS_TABLE), row);
    return normalizeCampaign(row);
  },

  async update(id, fields) {
    const patch = {};
    for (const [k, v] of Object.entries(fields)) patch[k] = typeof v === 'number' ? String(v) : v;
    await api('PATCH', tableUrl(CAMPAIGNS_TABLE, `/${encodeURIComponent(id)}`), patch);
    return normalizeCampaign({ id, ...patch });
  },

  async all() {
    const rows = (await listAll(CAMPAIGNS_TABLE)).map(normalizeCampaign);
    return rows.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')).slice(0, 100);
  },

  async dueScheduled(nowIso) {
    const rows = (await listAll(CAMPAIGNS_TABLE)).map(normalizeCampaign);
    return rows.filter(c => c.status === 'scheduled' && c.scheduled_at && c.scheduled_at <= nowIso);
  },
};

// =================== Promotions ===================
function normalizePromotion(r) {
  return {
    id: r.id,
    title: r.title || '',
    description: r.description || '',
    badge: r.badge || '',
    emoji: r.emoji || '🌿',
    active: truthy(r.active) ? 1 : 0,
    sort_order: num(r.sort_order),
    created_at: r.created_at || '',
  };
}

export const Promotions = {
  async all({ activeOnly = false } = {}) {
    let rows = (await listAll(PROMOTIONS_TABLE)).map(normalizePromotion);
    if (activeOnly) rows = rows.filter(p => p.active === 1);
    return rows.sort((a, b) => (a.sort_order - b.sort_order) || (b.created_at || '').localeCompare(a.created_at || ''));
  },

  async create(p) {
    const id = String(Date.now());
    const row = {
      id,
      title: p.title || '',
      description: p.description || '',
      badge: p.badge || '',
      emoji: p.emoji || '🌿',
      active: p.active ? '1' : '0',
      sort_order: String(p.sort_order ?? 0),
      created_at: nowStr(),
    };
    await api('POST', tableUrl(PROMOTIONS_TABLE), row);
    return normalizePromotion(row);
  },

  async update(id, fields) {
    const patch = {};
    for (const [k, v] of Object.entries(fields)) {
      patch[k] = (k === 'active') ? (v ? '1' : '0') : (typeof v === 'number' ? String(v) : v);
    }
    await api('PATCH', tableUrl(PROMOTIONS_TABLE, `/${encodeURIComponent(id)}`), patch);
    return normalizePromotion({ id, ...patch });
  },

  async remove(id) {
    await api('DELETE', tableUrl(PROMOTIONS_TABLE, `/${encodeURIComponent(id)}`));
    return { ok: true };
  },
};

// No schema to initialize — the Google Sheet (tabs + headers) is created by hand.
// See "מבנה-גוגל-שיטס.md".
export function initSchema() { /* no-op for the Sheets backend */ }

export default { Leads, Campaigns, Promotions, initSchema };
