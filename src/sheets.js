// ==========================================================
//  Data layer — Supabase (PostgreSQL)
//  Tables: leads, campaigns, promotions
//  Run the SQL in supabase-schema.sql once in the Supabase SQL editor.
// ==========================================================
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const truthy = v => v === true || v === 1 || v === '1' || String(v).toLowerCase() === 'true';
const num    = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const nowStr = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

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

export const Leads = {
  async create({ full_name, phone, email, machine_id, consent_granted }) {
    const id = String(phone);

    const { data: existing } = await supabase
      .from('leads').select('*').eq('id', id).maybeSingle();

    if (existing) {
      const patch = {
        full_name,
        phone: String(phone),
        email: email || null,
        machine_id: machine_id || 'unknown',
        consent_granted: !!consent_granted,
      };
      const { data } = await supabase
        .from('leads').update(patch).eq('id', id).select().maybeSingle();
      return normalizeLead(data || { ...existing, ...patch });
    }

    const row = {
      id,
      full_name,
      phone: String(phone),
      email: email || null,
      machine_id: machine_id || 'unknown',
      consent_granted: !!consent_granted,
      status: 'חדש',
      tags: '',
      notes: '',
      created_at: nowStr(),
    };
    const { data } = await supabase.from('leads').insert(row).select().maybeSingle();
    return normalizeLead(data || row);
  },

  async get(id) {
    const { data } = await supabase
      .from('leads').select('*').eq('id', id).maybeSingle();
    return data ? normalizeLead(data) : null;
  },

  async update(id, fields) {
    const { data } = await supabase
      .from('leads').update(fields).eq('id', id).select().maybeSingle();
    return data ? normalizeLead(data) : null;
  },

  async all({ machine_id, search, status } = {}) {
    let q = supabase.from('leads').select('*').order('created_at', { ascending: false });
    if (status) q = q.eq('status', status);
    const { data = [] } = await q;
    let rows = (data || []).map(normalizeLead);
    if (machine_id) rows = rows.filter(r =>
      r.machine_id.split(',').map(s => s.trim()).includes(machine_id));
    if (search) {
      const s = String(search).toLowerCase();
      rows = rows.filter(r =>
        r.full_name.toLowerCase().includes(s) ||
        r.phone.includes(s) ||
        (r.email || '').toLowerCase().includes(s) ||
        (r.tags  || '').toLowerCase().includes(s));
    }
    return rows;
  },

  async consented({ machine_id, phone, search } = {}) {
    let q = supabase.from('leads').select('*').eq('consent_granted', true);
    if (phone) q = q.eq('phone', String(phone));
    const { data = [] } = await q;
    let rows = (data || []).map(normalizeLead);
    if (machine_id) rows = rows.filter(r =>
      r.machine_id.split(',').map(s => s.trim()).includes(machine_id));
    if (search) {
      const s = String(search).toLowerCase();
      rows = rows.filter(r => r.full_name.toLowerCase().includes(s) || r.phone.includes(s));
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

  async remove(id) {
    await supabase.from('leads').delete().eq('id', id);
    return { ok: true };
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
      media_path: c.media_path || null,
      scheduled_at: c.scheduled_at || null,
      status: c.status || 'pending',
      recipients: c.recipients ?? 0,
      sent_count: 0,
      result_log: '',
      created_at: nowStr(),
    };
    const { data } = await supabase.from('campaigns').insert(row).select().maybeSingle();
    return normalizeCampaign(data || row);
  },

  async update(id, fields) {
    const patch = { ...fields };
    if ('recipients' in patch) patch.recipients = num(patch.recipients);
    if ('sent_count' in patch) patch.sent_count  = num(patch.sent_count);
    const { data } = await supabase
      .from('campaigns').update(patch).eq('id', id).select().maybeSingle();
    return normalizeCampaign(data || { id, ...patch });
  },

  async all() {
    const { data = [] } = await supabase
      .from('campaigns').select('*').order('created_at', { ascending: false }).limit(100);
    return (data || []).map(normalizeCampaign);
  },

  async dueScheduled(nowIso) {
    const { data = [] } = await supabase
      .from('campaigns').select('*').eq('status', 'scheduled').lte('scheduled_at', nowIso);
    return (data || []).map(normalizeCampaign);
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
    machine_id: r.machine_id || null,
    created_at: r.created_at || '',
  };
}

export const Promotions = {
  async all({ activeOnly = false, machine_id } = {}) {
    let q = supabase.from('promotions').select('*').order('sort_order', { ascending: true });
    if (activeOnly) q = q.eq('active', true);
    const { data = [] } = await q;
    let rows = (data || []).map(normalizePromotion)
      .sort((a, b) => a.sort_order - b.sort_order || (b.created_at || '').localeCompare(a.created_at || ''));
    // filter: show global promos + promos for this specific machine
    if (machine_id) rows = rows.filter(p => !p.machine_id || p.machine_id === machine_id);
    return rows;
  },

  async create(p) {
    const id = String(Date.now());
    const full = {
      id,
      title: p.title || '',
      description: p.description || '',
      badge: p.badge || '',
      emoji: p.emoji || '🌿',
      active: !!p.active,
      sort_order: p.sort_order ?? 0,
      machine_id: p.machine_id || null,
      created_at: nowStr(),
    };
    const { machine_id: _m, ...base } = full;
    for (const row of [full, base]) {
      const { data, error } = await supabase.from('promotions').insert(row).select().maybeSingle();
      if (!error) return normalizePromotion(data || row);
      const msg = (error.message || '').toLowerCase();
      if (!msg.includes('column') && !msg.includes('does not exist') && error.code !== 'PGRST204') {
        throw new Error(error.message);
      }
    }
    return normalizePromotion(base);
  },

  async update(id, fields) {
    const patch = { ...fields };
    if ('active' in patch)     patch.active     = !!patch.active;
    if ('sort_order' in patch) patch.sort_order = num(patch.sort_order);
    if ('machine_id' in patch) patch.machine_id = patch.machine_id || null;
    const { data, error } = await supabase
      .from('promotions').update(patch).eq('id', id).select().maybeSingle();
    if (!error) return normalizePromotion(data || { id, ...patch });
    // Retry without optional columns not yet in DB schema
    const msg = (error.message || '').toLowerCase();
    if (msg.includes('column') || msg.includes('does not exist') || error.code === 'PGRST204') {
      const { machine_id: _m, ...safePatch } = patch;
      const { data: d2, error: e2 } = await supabase
        .from('promotions').update(safePatch).eq('id', id).select().maybeSingle();
      if (e2) throw new Error(e2.message);
      return normalizePromotion(d2 || { id, ...safePatch });
    }
    throw new Error(error.message);
  },

  async remove(id) {
    await supabase.from('promotions').delete().eq('id', id);
    return { ok: true };
  },
};

// =================== SMS Log ===================
export const SmsLog = {
  async add({ lead_id, phone, full_name, message_body, channel, status, error, campaign_id, machine_id }) {
    const id = `sms_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const row = {
      id,
      lead_id: lead_id || null,
      phone: String(phone || ''),
      full_name: String(full_name || ''),
      message_body: String(message_body || ''),
      channel: channel || 'sms',
      status: status || 'sent',
      error: error || null,
      campaign_id: campaign_id || null,
      machine_id: machine_id || null,
      sent_at: nowStr(),
    };
    await supabase.from('sms_log').insert(row);
    return row;
  },

  async all({ lead_id, machine_id, channel, status, search, limit = 500 } = {}) {
    let q = supabase.from('sms_log').select('*').order('sent_at', { ascending: false }).limit(limit);
    if (lead_id)    q = q.eq('lead_id', lead_id);
    if (machine_id) q = q.eq('machine_id', machine_id);
    if (channel)    q = q.eq('channel', channel);
    if (status)     q = q.eq('status', status);
    const { data = [] } = await q;
    let rows = data || [];
    if (search) {
      const s = String(search).toLowerCase();
      rows = rows.filter(r =>
        r.full_name.toLowerCase().includes(s) ||
        r.phone.includes(s) ||
        r.message_body.toLowerCase().includes(s));
    }
    return rows;
  },

  async stats() {
    const { data = [] } = await supabase.from('sms_log').select('status, channel');
    const rows = data || [];
    return {
      total: rows.length,
      sent: rows.filter(r => r.status === 'sent').length,
      failed: rows.filter(r => r.status === 'failed').length,
      by_channel: ['sms','whatsapp','email'].map(ch => ({
        channel: ch,
        count: rows.filter(r => r.channel === ch).length,
      })),
    };
  },
};

// =================== Machines ===================
export const Machines = {
  async all() {
    const { data, error } = await supabase.from('machines').select('*');
    if (error) throw new Error(error.message);
    return (data || []).sort((a, b) => (a.sort_order ?? 999) - (b.sort_order ?? 999));
  },

  async create({ name, location, status, notes, sort_order, lat, lng }) {
    const id = `m_${Date.now()}`;
    const base = {
      id,
      name: String(name || ''),
      location: String(location || ''),
      status: status || 'active',
      notes: String(notes || ''),
      created_at: nowStr(),
    };
    const withOrder = { ...base, sort_order: num(sort_order) };
    const full = { ...withOrder };
    if (lat != null && lat !== '' && !isNaN(parseFloat(lat))) full.lat = parseFloat(lat);
    if (lng != null && lng !== '' && !isNaN(parseFloat(lng))) full.lng = parseFloat(lng);
    // Try three progressively-stripped rows; only retry on missing-column errors
    let lastError;
    for (const row of [full, withOrder, base]) {
      const { data, error } = await supabase.from('machines').insert(row).select().maybeSingle();
      if (!error && data) return data; // saved successfully
      if (!error && !data) {
        // Insert appeared to succeed but returned no row — Row Level Security is
        // silently blocking writes. Run the SQL below in Supabase SQL Editor:
        //   ALTER TABLE machines DISABLE ROW LEVEL SECURITY;
        throw new Error('RLS חוסם כתיבה — הרץ ב-SQL Editor של Supabase: ALTER TABLE machines DISABLE ROW LEVEL SECURITY;');
      }
      lastError = error;
      const msg = (error.message || '').toLowerCase();
      if (!msg.includes('does not exist') && !msg.includes('column') && error.code !== '42703') break;
    }
    throw new Error(lastError?.message || 'שגיאה בהוספת מכונה');
  },

  async update(id, fields) {
    const patch = { ...fields };
    if ('sort_order' in patch) patch.sort_order = num(patch.sort_order);
    if ('lat' in patch) patch.lat = (patch.lat != null && patch.lat !== '') ? parseFloat(patch.lat) : null;
    if ('lng' in patch) patch.lng = (patch.lng != null && patch.lng !== '') ? parseFloat(patch.lng) : null;
    const { data, error } = await supabase
      .from('machines').update(patch).eq('id', id).select().maybeSingle();
    if (error) {
      // Retry without optional columns that might not exist in DB yet
      const { sort_order: _s, lat: _la, lng: _lo, ...safeFields } = patch;
      const r2 = await supabase.from('machines').update(safeFields).eq('id', id).select().maybeSingle();
      return r2.data;
    }
    return data;
  },

  async remove(id) {
    await supabase.from('machines').delete().eq('id', id);
    return { ok: true };
  },
};

// =================== Products ===================
export const Products = {
  async all({ search } = {}) {
    const { data = [] } = await supabase
      .from('products').select('*').order('name', { ascending: true });
    let rows = data || [];
    if (search) {
      const s = String(search).toLowerCase();
      rows = rows.filter(r => r.name.toLowerCase().includes(s));
    }
    return rows;
  },

  async create({ name, category, price_before, price_after }) {
    const id = `p_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const full = { id, name: String(name || ''), category: String(category || ''), price_before: parseFloat(price_before) || 0, price_after: parseFloat(price_after) || 0, created_at: nowStr() };
    const { category: _c, ...base } = full;
    for (const row of [full, base]) {
      const { data, error } = await supabase.from('products').insert(row).select().maybeSingle();
      if (!error) return data || row;
      const msg = (error.message || '').toLowerCase();
      if (!msg.includes('column') && !msg.includes('does not exist') && error.code !== 'PGRST204') throw new Error(error.message);
    }
    return base;
  },

  async bulkInsert(products) {
    const ts = Date.now();
    const now = nowStr();
    const full = products.map((p, i) => ({
      id: `p_bulk_${ts}_${i}`,
      name: String(p.name || ''),
      category: String(p.category || ''),
      price_before: parseFloat(p.price_before) || 0,
      price_after: parseFloat(p.price_after) || 0,
      created_at: now,
    }));
    const { error } = await supabase.from('products').insert(full);
    if (!error) return { count: full.length };
    const msg = (error.message || '').toLowerCase();
    if (msg.includes('column') || msg.includes('does not exist') || error.code === 'PGRST204') {
      const safe = full.map(({ category: _c, ...r }) => r);
      const { error: e2 } = await supabase.from('products').insert(safe);
      if (e2) throw new Error(e2.message);
      return { count: safe.length };
    }
    throw new Error(error.message);
  },

  async update(id, { name, category, price_before, price_after }) {
    const patch = {};
    if (name != null) patch.name = String(name);
    if (category != null) patch.category = String(category);
    if (price_before != null) patch.price_before = parseFloat(price_before) || 0;
    if (price_after != null) patch.price_after = parseFloat(price_after) || 0;
    const { data, error } = await supabase.from('products').update(patch).eq('id', id).select().maybeSingle();
    if (!error) return data;
    const msg = (error.message || '').toLowerCase();
    if (msg.includes('column') || msg.includes('does not exist') || error.code === 'PGRST204') {
      const { category: _c, ...safePatch } = patch;
      const { data: d2 } = await supabase.from('products').update(safePatch).eq('id', id).select().maybeSingle();
      return d2;
    }
    throw new Error(error.message);
  },

  async remove(id) {
    await supabase.from('products').delete().eq('id', id);
    return { ok: true };
  },
};

// Tables are created via the Supabase SQL editor — see supabase-schema.sql
export function initSchema() {}

export default { Leads, Campaigns, Promotions, SmsLog, Machines, initSchema };
