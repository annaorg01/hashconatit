// ==========================================================
//  Broadcaster — runs a campaign across selected channels.
//  LEGAL: only leads with consent_granted = 1 are ever loaded
//  (see Leads.consented), enforcing Israeli Spam Law (חוק הספאם).
// ==========================================================
import { Leads, Campaigns, SmsLog } from '../sheets.js';
import {
  sendSMS, sendWhatsApp, sendEmail,
  renderTemplate, mediaUrlFor, forwardCampaignWebhook,
} from './messaging.js';
import { resolve } from 'node:path';

// Resolve the audience into a list of CONSENTED leads.
export async function resolveAudience(audience) {
  if (audience.mode === 'single') {
    return Leads.consented({ phone: audience.phone, search: audience.search });
  }
  return Leads.consented({ machine_id: audience.machine_id || undefined });
}

export async function runCampaign(campaign) {
  const channels   = JSON.parse(campaign.channels);
  const audience   = JSON.parse(campaign.audience);
  const recipients = await resolveAudience(audience);

  const mediaUrl      = mediaUrlFor(campaign.media_path);
  const mediaAbsPath  = campaign.media_path
    ? resolve(process.cwd(), 'uploads', campaign.media_path)
    : null;

  const log = [];
  let sent = 0;

  for (const lead of recipients) {
    const body    = renderTemplate(campaign.body, lead);
    const results = [];

    if (channels.includes('sms')) {
      const r = await sendSMS(lead, body, mediaUrl);
      results.push(r);
      await SmsLog.add({
        lead_id: lead.id, phone: lead.phone, full_name: lead.full_name,
        message_body: body, channel: 'sms',
        status: r.status, error: r.error || null,
        campaign_id: campaign.id, machine_id: lead.machine_id,
      });
    }

    if (channels.includes('whatsapp')) {
      const r = await sendWhatsApp(lead, body, mediaUrl);
      results.push(r);
      await SmsLog.add({
        lead_id: lead.id, phone: lead.phone, full_name: lead.full_name,
        message_body: body, channel: 'whatsapp',
        status: r.status, error: r.error || null,
        campaign_id: campaign.id, machine_id: lead.machine_id,
      });
    }

    if (channels.includes('email')) {
      const r = await sendEmail(lead, body, mediaUrl, mediaAbsPath, campaign.media_path);
      results.push(r);
      await SmsLog.add({
        lead_id: lead.id, phone: lead.phone, full_name: lead.full_name,
        message_body: body, channel: 'email',
        status: r.status, error: r.error || null,
        campaign_id: campaign.id, machine_id: lead.machine_id,
      });
    }

    if (results.some(r => r.status === 'sent')) sent++;
    log.push({ lead_id: lead.id, name: lead.full_name, results });
  }

  await forwardCampaignWebhook({
    campaign_id: campaign.id,
    channels, body: campaign.body,
    recipients: recipients.map(l => ({ name: l.full_name, phone: l.phone, email: l.email })),
    media_url: mediaUrl,
  });

  return Campaigns.update(campaign.id, {
    status: 'sent',
    recipients: recipients.length,
    sent_count: sent,
    result_log: JSON.stringify(log),
  });
}

// Background poller for scheduled campaigns (checked every minute).
export function startScheduler() {
  setInterval(async () => {
    const due = await Campaigns.dueScheduled(new Date().toISOString());
    for (const c of due) {
      try { await runCampaign(c); }
      catch (e) { await Campaigns.update(c.id, { status: 'failed', result_log: JSON.stringify({ error: e.message }) }); }
    }
  }, 60 * 1000);
}
