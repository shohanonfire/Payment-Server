// server.js
const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

const app = express();
app.use(express.json());

// STATIC: generator + timeout same-origin serve
app.use(express.static(path.join(__dirname, 'public')));

// HOME: so "Cannot GET /" না দেখায়
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'generate.html'));
});

// ---- Config ----
const CONFIG_PATH = path.join(__dirname, 'config.json');
// Payment index যেই সাইটে হোস্ট করা, সেই BASE_URL লিংক বানাতে লাগবে
const BASE_URL = process.env.BASE_URL || 'https://promoshop.app/payment/en';

// Helpers
async function readConfig() {
  try {
    const raw = await fs.readFile(CONFIG_PATH, 'utf8');
    return raw.trim() ? JSON.parse(raw) : {};
  } catch (e) {
    if (e.code === 'ENOENT') return {};
    throw e;
  }
}
async function writeConfig(conf) {
  await fs.writeFile(CONFIG_PATH, JSON.stringify(conf, null, 2), 'utf8');
}

// ---- JSONP VALIDATE (no CORS needed) ----
// index পেজ cross-origin থেকে <script src> হিসাবে কল করবে:
// https://your-railway-url/api/validate-jsonp?id=XYZ&callback=cb
app.get('/api/validate-jsonp', async (req, res) => {
  const id = (req.query.id || '').trim();
  const cb = (req.query.callback || 'callback').replace(/[^\w$]/g, '');

  res.type('application/javascript');

  if (!id) {
    return res.send(`${cb}(${JSON.stringify({ valid:false, error:'missing id' })});`);
  }

  try {
    const conf = await readConfig();
    const entry = conf[id];
    if (!entry) {
      return res.send(`${cb}(${JSON.stringify({ valid:false, error:'not found' })});`);
    }
    const now = Date.now();
    if (entry.expiresAt && now > entry.expiresAt) {
      return res.send(`${cb}(${JSON.stringify({ valid:false, error:'expired' })});`);
    }
    return res.send(`${cb}(${JSON.stringify({
      valid: true,
      amount: entry.amount,
      expiresAt: entry.expiresAt
    })});`);
  } catch (err) {
    console.error(err);
    return res.send(`${cb}(${JSON.stringify({ valid:false, error:'server error' })});`);
  }
});

// ---- GENERATE (same-origin) ----
app.post('/api/generate', async (req, res) => {
  try {
    const { amount, expiryMinutes = 30, id: customId } = req.body || {};
    if (!amount) return res.status(400).json({ error: 'missing amount' });

    const conf = await readConfig();

    let id = customId && String(customId).trim();
    if (!id) {
      id = crypto.randomBytes(6).toString('hex'); // 12 chars
      while (conf[id]) id = crypto.randomBytes(6).toString('hex');
    } else {
      if (conf[id]) return res.status(409).json({ error: 'id exists' });
    }

    const now = Date.now();
    const expiresAt = now + (Number(expiryMinutes) || 30) * 60 * 1000;

    conf[id] = { amount: String(amount), createdAt: now, expiresAt };
    await writeConfig(conf);

    const link = `${BASE_URL}/?amount=${encodeURIComponent(String(amount))}&id=${encodeURIComponent(id)}`;
    return res.json({ id, link, expiresAt });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'server error' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('listening on', PORT));
