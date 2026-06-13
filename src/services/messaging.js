// ==========================================================
//  Omnichannel messaging adapters
//  Each channel is optional: if its env vars are missing the
//  channel is reported as "skipped" instead of crashing.
//  Channels: SMS + WhatsApp (Twilio), Email (SMTP/Nodemailer).
// ==========================================================
import nodemailer from 'nodemailer';
import 'dotenv/config';

const {
  TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_SMS_FROM, TWILIO_WHATSAPP_FROM,
  SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, EMAIL_FROM,
  PUBLIC_BASE_URL,
} = process.env;

// ---- Lazy Twilio client (only if configured) ----
let twilioClient = null;
async function getTwilio() {
  if (twilioClient) return twilioClient;
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) return null;
  const { default: twilio } = await import('twilio');
  twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
  return twilioClient;
}

// ---- Lazy SMTP transport ----
let mailer = null;
function getMailer() {
  if (mailer) return mailer;
  if (!SMTP_HOST || !SMTP_USER) return null;
  mailer = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT) || 587,
    secure: String(SMTP_SECURE) === 'true',
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  return mailer;
}

// Replace {{full_name}}, {{machine_id}}, {{phone}} dynamic tags.
export function renderTemplate(text, lead) {
  return (text || '')
    .replace(/\{\{\s*full_name\s*\}\}/g, lead.full_name || '')
    .replace(/\{\{\s*machine_id\s*\}\}/g, lead.machine_id || '')
    .replace(/\{\{\s*phone\s*\}\}/g, lead.phone || '');
}

// Normalize an Israeli mobile number to E.164 (+972...).
export function toE164(phone) {
  let p = String(phone).replace(/\D/g, '');
  if (p.startsWith('972')) return '+' + p;
  if (p.startsWith('0')) return '+972' + p.slice(1);
  return '+' + p;
}

// ---------------- SMS ----------------
export async function sendSMS(lead, body, mediaUrl) {
  const client = await getTwilio();
  if (!client || !TWILIO_SMS_FROM) return { channel: 'sms', status: 'skipped', reason: 'not configured' };
  try {
    const msg = await client.messages.create({
      from: TWILIO_SMS_FROM,
      to: toE164(lead.phone),
      body: mediaUrl ? `${body}\n${mediaUrl}` : body, // SMS = text + short link to media
    });
    return { channel: 'sms', status: 'sent', id: msg.sid, to: lead.phone };
  } catch (e) {
    return { channel: 'sms', status: 'failed', reason: e.message, to: lead.phone };
  }
}

// ---------------- WhatsApp ----------------
export async function sendWhatsApp(lead, body, mediaUrl) {
  const client = await getTwilio();
  if (!client || !TWILIO_WHATSAPP_FROM) return { channel: 'whatsapp', status: 'skipped', reason: 'not configured' };
  try {
    const payload = {
      from: TWILIO_WHATSAPP_FROM,
      to: 'whatsapp:' + toE164(lead.phone),
      body,
    };
    if (mediaUrl) payload.mediaUrl = [mediaUrl]; // image/video attachment
    const msg = await client.messages.create(payload);
    return { channel: 'whatsapp', status: 'sent', id: msg.sid, to: lead.phone };
  } catch (e) {
    return { channel: 'whatsapp', status: 'failed', reason: e.message, to: lead.phone };
  }
}

// ---------------- Email ----------------
export async function sendEmail(lead, body, mediaUrl, mediaAbsPath, mediaName) {
  if (!lead.email) return { channel: 'email', status: 'skipped', reason: 'no email', to: lead.phone };
  const transport = getMailer();
  if (!transport) return { channel: 'email', status: 'skipped', reason: 'not configured' };
  try {
    const html = `<div dir="rtl" style="font-family:Arial,sans-serif;font-size:16px;line-height:1.6;color:#2b2b2b">
      ${body.replace(/\n/g, '<br>')}
      ${mediaUrl ? `<div style="margin-top:16px"><img src="${mediaUrl}" alt="" style="max-width:100%;border-radius:12px"></div>` : ''}
    </div>`;
    const attachments = mediaAbsPath ? [{ filename: mediaName || 'media', path: mediaAbsPath }] : [];
    const info = await transport.sendMail({
      from: EMAIL_FROM || SMTP_USER,
      to: lead.email,
      subject: 'השכונתית · עדכון חדש בשבילך',
      html,
      attachments,
    });
    return { channel: 'email', status: 'sent', id: info.messageId, to: lead.email };
  } catch (e) {
    return { channel: 'email', status: 'failed', reason: e.message, to: lead.email };
  }
}

// Optional: forward the whole send to Make.com instead of / in addition to direct sending.
export async function forwardCampaignWebhook(payload) {
  const url = process.env.MAKE_CAMPAIGN_WEBHOOK_URL;
  if (!url) return null;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return { channel: 'webhook', status: 'sent' };
  } catch (e) {
    return { channel: 'webhook', status: 'failed', reason: e.message };
  }
}

// Build an absolute media URL for SMS short-links / WhatsApp / email.
export function mediaUrlFor(mediaPath) {
  if (!mediaPath) return null;
  const base = PUBLIC_BASE_URL || 'http://localhost:3000';
  return `${base}/uploads/${mediaPath}`;
}
