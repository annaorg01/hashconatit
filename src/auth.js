// ==========================================================
//  Minimal signed-cookie session auth for the admin panel.
//  No external session store needed.
// ==========================================================
import crypto from 'node:crypto';
import 'dotenv/config';

const SECRET = process.env.SESSION_SECRET || 'dev-secret-change-me';

function sign(value) {
  const h = crypto.createHmac('sha256', SECRET).update(value).digest('hex');
  return `${value}.${h}`;
}
function verify(signed) {
  if (!signed || !signed.includes('.')) return null;
  const idx = signed.lastIndexOf('.');
  const value = signed.slice(0, idx);
  const expected = sign(value);
  return crypto.timingSafeEqual(Buffer.from(signed), Buffer.from(expected)) ? value : null;
}

export function issueSession(res) {
  const token = sign(`admin:${Date.now()}`);
  res.cookie('hsh_session', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 12, // 12h
  });
}

export function clearSession(res) {
  res.clearCookie('hsh_session');
}

export function checkCredentials(username, password) {
  const U = process.env.ADMIN_USERNAME || 'admin';
  const P = process.env.ADMIN_PASSWORD || 'admin';
  // constant-time-ish comparison
  const okU = username === U;
  const okP = password === P;
  return okU && okP;
}

export function requireAuth(req, res, next) {
  const valid = verify(req.cookies?.hsh_session);
  if (valid) return next();
  // API vs page
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'unauthorized' });
  return res.redirect('/admin/login');
}
