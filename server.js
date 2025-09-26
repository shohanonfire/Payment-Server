// server.js
const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

const app = express();
app.use(express.json());

// CONFIG
const CONFIG_PATH = path.join(__dirname, 'config.json'); // your config file in this repo
const BASE_URL = 'https://yourdomain.com'; // change to domain where payment page (index) lives

// helper to read config
async function readConfig(){
  try {
    const raw = await fs.readFile(CONFIG_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    if (e.code === 'ENOENT') return {}; // empty
    throw e;
  }
}
async function writeConfig(conf){
  await fs.writeFile(CONFIG_PATH, JSON.stringify(conf, null, 2), 'utf8');
}

// Validate endpoint (used by index validation script)
app.get('/api/validate', async (req,res)=>{
  const id = req.query.id;
  if (!id) return res.status(400).json({ valid:false, error:'missing id' });
  try {
    const conf = await readConfig();
    const entry = conf[id];
    if (!entry) return res.status(404).json({ valid:false, error:'not found' });

    // entry expected { amount: "10.00", createdAt: 169..., expiresAt: 169... }
    const now = Date.now();
    if (entry.expiresAt && now > entry.expiresAt) {
      return res.status(410).json({ valid:false, error:'expired' });
    }
    return res.json({ valid:true, amount: entry.amount, expiresAt: entry.expiresAt });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ valid:false, error:'server error' });
  }
});

// Generate endpoint (used by admin generator page)
// NOTE: No auth in this template — add auth (basic/token) before using in prod.
app.post('/api/generate', async (req,res)=>{
  try {
    const { amount, expiryMinutes = 30, id: customId } = req.body;
    if (!amount) return res.status(400).json({ error: 'missing amount' });

    const conf = await readConfig();

    let id = customId && String(customId).trim();
    if (!id) {
      // make short random id
      id = crypto.randomBytes(6).toString('hex'); // 12 chars
      while (conf[id]) {
        id = crypto.randomBytes(6).toString('hex');
      }
    } else {
      if (conf[id]) return res.status(409).json({ error: 'id exists' });
    }

    const now = Date.now();
    const expiresAt = now + (Number(expiryMinutes) || 30) * 60 * 1000;

    conf[id] = {
      amount: String(amount),
      createdAt: now,
      expiresAt: expiresAt
    };

    // write back
    await writeConfig(conf);

    const link = `${BASE_URL}/?amount=${encodeURIComponent(String(amount))}&id=${encodeURIComponent(id)}`;
    return res.json({ id, link, expiresAt });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'server error' });
  }
});

// optional: admin route to list current entries (ONLY enable in protected env)
app.get('/admin/list', async (req,res)=>{
  const conf = await readConfig();
  res.json(conf);
});

// start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=> console.log('server listening on', PORT));
