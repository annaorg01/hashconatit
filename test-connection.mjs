// ==========================================================
//  בדיקת חיבור ל-Google Sheets (sheets-connector)
//  הרצה:  node test-connection.mjs
//  קורא את ההגדרות מ-.env (SHEETS_API_KEY, SHEETS_PROJECT_ID, שמות הטבלאות).
// ==========================================================
import 'dotenv/config';

const BASE = (process.env.SHEETS_API_BASE || 'https://sheets-connector.vercel.app/api/v1').replace(/\/$/, '');
const PROJECT = process.env.SHEETS_PROJECT_ID || '';
const KEY = process.env.SHEETS_API_KEY || '';
const TABLES = {
  Leads: process.env.SHEETS_LEADS_TABLE || 'Leads',
  Campaigns: process.env.SHEETS_CAMPAIGNS_TABLE || 'Campaigns',
  Promotions: process.env.SHEETS_PROMOTIONS_TABLE || 'Promotions',
};

if (!PROJECT || !KEY) {
  console.error('❌ חסר SHEETS_PROJECT_ID או SHEETS_API_KEY בקובץ .env');
  process.exit(1);
}

console.log(`\n🔎 בודק פרויקט: ${PROJECT}\n`);

let allOk = true;
for (const [role, table] of Object.entries(TABLES)) {
  const url = `${BASE}/projects/${PROJECT}/tables/${encodeURIComponent(table)}?limit=1&offset=0`;
  try {
    const res = await fetch(url, { headers: { 'x-api-key': KEY } });
    const text = await res.text();
    let rows = '?';
    try {
      const j = JSON.parse(text);
      const arr = Array.isArray(j) ? j : (j.data || j.rows || j.records || j.results || j.items || []);
      rows = Array.isArray(arr) ? arr.length : '?';
    } catch {}
    if (res.ok) {
      console.log(`✅ ${role.padEnd(11)} → טבלה "${table}" נגישה (HTTP ${res.status})`);
    } else {
      allOk = false;
      console.log(`❌ ${role.padEnd(11)} → טבלה "${table}" החזירה HTTP ${res.status}`);
      console.log(`   ${text.slice(0, 200)}`);
    }
  } catch (e) {
    allOk = false;
    console.log(`❌ ${role.padEnd(11)} → שגיאת רשת: ${e.message}`);
  }
}

console.log(
  allOk
    ? '\n🎉 כל שלוש הטבלאות נגישות! אפשר להריץ npm start.\n'
    : '\n⚠️  חלק מהטבלאות לא נגישות. ודאי שהן קיימות בפרויקט בשמות הנכונים\n   (או עדכני את שמות הטבלאות ב-.env), ושהמפתח שייך לאותו פרויקט.\n'
);
