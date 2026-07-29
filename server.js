const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(require('path').join(__dirname, 'public')));

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS orchard_blocks (
      id SERIAL PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      location TEXT,
      irr_type TEXT,
      water_source TEXT,
      variety TEXT,
      cycle_days INTEGER DEFAULT 6,
      instructions TEXT,
      total_hours NUMERIC DEFAULT 0,
      last_watered TIMESTAMP,
      next_water DATE,
      water_alert TEXT DEFAULT 'OK',
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS orchard_sessions (
      id SERIAL PRIMARY KEY,
      block_id INTEGER REFERENCES orchard_blocks(id),
      block_name TEXT,
      session_type TEXT,
      irr_type TEXT,
      start_time TIMESTAMP DEFAULT NOW(),
      finish_time TIMESTAMP,
      hours NUMERIC,
      notes TEXT,
      status TEXT DEFAULT 'open',
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  console.log('Database ready');
}

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.get('/api/blocks', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT b.*, s.id as open_session_id, s.irr_type as active_irr_type, s.start_time as session_start FROM orchard_blocks b LEFT JOIN orchard_sessions s ON s.block_name = b.name AND s.status = $1 ORDER BY b.name',
      ['open']
    );
    res.json({ success: true, blocks: result.rows });
  } catch(e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.post('/api/sessions/start', async (req, res) => {
  try {
    const { block_name, session_type, irr_type, notes } = req.body;
    const block = await pool.query('SELECT id FROM orchard_blocks WHERE name=$1', [block_name]);
    if (!block.rows.length) return res.status(404).json({ success: false, message: 'Block not found' });
    await pool.query(
      "UPDATE orchard_sessions SET status='completed', finish_time=NOW(), hours=EXTRACT(EPOCH FROM (NOW()-start_time))/3600 WHERE block_name=$1 AND status='open'",
      [block_name]
    );
    const session = await pool.query(
      'INSERT INTO orchard_sessions (block_id, block_name, session_type, irr_type, notes) VALUES ($1,$2,$3,$4,$5) RETURNING id',
      [block.rows[0].id, block_name, session_type || 'Irrigation', irr_type || 'Sprinkler r10', notes || '']
    );
    if (session_type !== 'Foggers') {
      await pool.query('UPDATE orchard_blocks SET last_watered=NOW() WHERE name=$1', [block_name]);
    }
    res.json({ success: true, session_id: session.rows[0].id });
  } catch(e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.post('/api/sessions/end', async (req, res) => {
  try {
    const { block_name, session_id } = req.body;
    const result = await pool.query(
      "UPDATE orchard_sessions SET status='completed', finish_time=NOW(), hours=EXTRACT(EPOCH FROM (NOW()-start_time))/3600 WHERE (id=$1 OR block_name=$2) AND status='open' RETURNING hours, block_name, session_type",
      [session_id || 0, block_name]
    );
    if (!result.rows.length) return res.status(404).json({ success: false, message: 'No open session found' });
    const row = result.rows[0];
    if (row.session_type !== 'Foggers') {
      await pool.query('UPDATE orchard_blocks SET total_hours = total_hours + $1 WHERE name=$2', [parseFloat(row.hours), row.block_name]);
    }
    res.json({ success: true, hours: parseFloat(row.hours).toFixed(2) });
  } catch(e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.post('/api/sessions/fertilizer', async (req, res) => {
  try {
    const { block_name, notes } = req.body;
    const block = await pool.query('SELECT id FROM orchard_blocks WHERE name=$1', [block_name]);
    if (!block.rows.length) return res.status(404).json({ success: false, message: 'Block not found' });
    await pool.query(
      "INSERT INTO orchard_sessions (block_id, block_name, session_type, irr_type, notes, status, finish_time, hours) VALUES ($1,$2,'Fertilizer','Fertilizer',$3,'completed',NOW(),0)",
      [block.rows[0].id, block_name, notes || '']
    );
    res.json({ success: true });
  } catch(e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.post('/api/sessions/foggers', async (req, res) => {
  try {
    const { block_name, notes } = req.body;
    const block = await pool.query('SELECT id FROM orchard_blocks WHERE name=$1', [block_name]);
    if (!block.rows.length) return res.status(404).json({ success: false, message: 'Block not found' });
    await pool.query(
      "INSERT INTO orchard_sessions (block_id, block_name, session_type, irr_type, notes, status, finish_time, hours) VALUES ($1,$2,'Foggers','Foggers',$3,'completed',NOW(),0)",
      [block.rows[0].id, block_name, notes || '']
    );
    res.json({ success: true });
  } catch(e) {
    res.status(500).json({ success: false, message: e.message });
  }
});
// ── ADMIN SESSIONS ──
app.get('/api/admin/sessions', async (req, res) => {
  try {
    const { block, type, irr_type, status, from, to } = req.query;
    
    let query = 'SELECT * FROM orchard_sessions WHERE 1=1';
    let params = [];
    let i = 1;

    if(block){ query += ` AND block_name=$${i++}`; params.push(block); }
    if(type){ query += ` AND session_type=$${i++}`; params.push(type); }
    if(irr_type){ query += ` AND irr_type=$${i++}`; params.push(irr_type); }
    if(status){ query += ` AND status=$${i++}`; params.push(status); }
    if(from){ query += ` AND start_time>=$${i++}`; params.push(from); }
    if(to){ query += ` AND start_time<=$${i++}`; params.push(to); }

    query += ' ORDER BY start_time DESC LIMIT 500';

    const result = await pool.query(query, params);

    // Summary totals
    const totals = await pool.query(
      'SELECT session_type, irr_type, COUNT(*) as count, ROUND(SUM(hours)::numeric,2) as total_hours FROM orchard_sessions WHERE status=$1 GROUP BY session_type, irr_type ORDER BY session_type',
      ['completed']
    );

    res.json({ success: true, sessions: result.rows, totals: totals.rows });
  } catch(e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ── ADMIN BLOCKS SUMMARY ──
app.get('/api/admin/blocks', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT name, location, irr_type, water_source, variety, cycle_days, total_hours, last_watered, next_water, water_alert FROM orchard_blocks ORDER BY name'
    );
    res.json({ success: true, blocks: result.rows });
  } catch(e) {
    res.status(500).json({ success: false, message: e.message });
  }
});
// ── FUEL LOG ──
app.post('/api/fuel', async (req, res) => {
  try {
    const { log_date, vehicle, fuel_type, gallons, operator, notes } = req.body;
    await pool.query(
      'INSERT INTO orchard_fuel (log_date, vehicle, fuel_type, gallons, operator, notes) VALUES ($1,$2,$3,$4,$5,$6)',
      [log_date || new Date().toISOString().split('T')[0], vehicle || 'Truck', fuel_type || 'Diesel', gallons, operator || 'Jorge', notes || '']
    );
    res.json({ success: true });
  } catch(e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.get('/api/fuel', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM orchard_fuel ORDER BY log_date DESC, created_at DESC LIMIT 100');
    res.json({ success: true, logs: result.rows });
  } catch(e) {
    res.status(500).json({ success: false, message: e.message });
  }
});
const PORT = process.env.PORT || 3001;
initDB().then(() => {
  app.listen(PORT, () => console.log('Orchard server running on port ' + PORT));
}).catch(e => {
  console.error('Startup error:', e.message);
});
