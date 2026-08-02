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
console.log('ENV CHECK:', process.env.OPENWEATHER_API_KEY ? 'KEY FOUND' : 'KEY MISSING');
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
    // Don't close irrigation session if starting Foggers
    if(session_type !== 'Foggers'){
      await pool.query(
        "UPDATE orchard_sessions SET status='completed', finish_time=NOW(), hours=EXTRACT(EPOCH FROM (NOW()-start_time))/3600 WHERE block_name=$1 AND status='open' AND session_type != 'Foggers'",
        [block_name]
      );
    }
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
   updateWaterAlerts(); 
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
// ── WEATHER ──
app.get('/api/weather', async (req, res) => {
  try {
    const apiKey = process.env.OPENWEATHER_API_KEY;
    if(!apiKey) return res.status(500).json({ success: false, message: 'No API key' });
    const url = `https://api.openweathermap.org/data/2.5/weather?lat=47.499334&lon=-120.4423954&appid=${apiKey}&units=imperial`;
    const response = await fetch(url);
    const data = await response.json();
    console.log('Weather API response:', JSON.stringify(data).substring(0, 200));
    if(!data.main) return res.status(500).json({ success: false, message: 'Bad API response', data });
    res.json({
      success: true,
      temp: Math.round(data.main.temp),
      feels_like: Math.round(data.main.feels_like),
      humidity: data.main.humidity,
      description: data.weather[0].description,
      wind: Math.round(data.wind.speed)
    });
  } catch(e) {
    res.status(500).json({ success: false, message: e.message });
  }
});// ── SHIFTS ──
app.post('/api/shifts/clockin', async (req, res) => {
  try {
    const { operator, activity, block_name, notes } = req.body;
    // Close any active shift first
    await pool.query(
      "UPDATE orchard_shifts SET status='completed', clock_out=NOW(), total_hours=EXTRACT(EPOCH FROM (NOW()-clock_in))/3600 WHERE operator=$1 AND status='active'",
      [operator || 'Jorge']
    );
    const shift = await pool.query(
      'INSERT INTO orchard_shifts (operator, activity, block_name, notes) VALUES ($1,$2,$3,$4) RETURNING id',
      [operator || 'Jorge', activity || 'General', block_name || '', notes || '']
    );
    res.json({ success: true, shift_id: shift.rows[0].id });
  } catch(e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.post('/api/shifts/clockout', async (req, res) => {
  try {
    const { operator } = req.body;
    const result = await pool.query(
      "UPDATE orchard_shifts SET status='completed', clock_out=NOW(), total_hours=EXTRACT(EPOCH FROM (NOW()-clock_in))/3600 WHERE operator=$1 AND status='active' RETURNING total_hours",
      [operator || 'Jorge']
    );
    if(!result.rows.length) return res.status(404).json({ success: false, message: 'No active shift found' });
    res.json({ success: true, hours: parseFloat(result.rows[0].total_hours).toFixed(2) });
  } catch(e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.post('/api/shifts/switch', async (req, res) => {
  try {
    const { operator, activity, block_name } = req.body;
    // Close current shift
    await pool.query(
      "UPDATE orchard_shifts SET status='completed', clock_out=NOW(), total_hours=EXTRACT(EPOCH FROM (NOW()-clock_in))/3600 WHERE operator=$1 AND status='active'",
      [operator || 'Jorge']
    );
    // Start new shift with new activity
    const shift = await pool.query(
      'INSERT INTO orchard_shifts (operator, activity, block_name) VALUES ($1,$2,$3) RETURNING id',
      [operator || 'Jorge', activity || 'General', block_name || '']
    );
    res.json({ success: true, shift_id: shift.rows[0].id });
  } catch(e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.get('/api/shifts/active', async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM orchard_shifts WHERE status='active' ORDER BY clock_in DESC"
    );
    res.json({ success: true, shifts: result.rows });
  } catch(e) {
    res.status(500).json({ success: false, message: e.message });
  }
});
// ── WEEKLY HOURS ──
app.get('/api/shifts/weekly', async (req, res) => {
  try {
    // Get start of current week (Sunday to Saturday — Pacific time)
    // Use Pacific time offset: UTC-7 (PDT) in summer
    const nowUTC = new Date();
    const pacificOffset = -7 * 60; // PDT = UTC-7
    const nowPacific = new Date(nowUTC.getTime() + pacificOffset * 60000);
    const dayOfWeek = nowPacific.getUTCDay(); // 0=Sunday
    
    // Start of week = Sunday Pacific midnight
    const weekStartPacific = new Date(nowPacific);
    weekStartPacific.setUTCDate(nowPacific.getUTCDate() - dayOfWeek);
    weekStartPacific.setUTCHours(0,0,0,0);
    
    // Convert back to UTC for database query
    const weekStart = new Date(weekStartPacific.getTime() - pacificOffset * 60000);
    
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    weekEnd.setUTCHours(23,59,59,999);

    const result = await pool.query(
      `SELECT s.*, b.location 
       FROM orchard_shifts s
       LEFT JOIN orchard_blocks b ON b.name = s.block_name
       WHERE s.clock_in >= $1 AND s.clock_in <= $2
       ORDER BY s.clock_in ASC`,
      [weekStart.toISOString(), weekEnd.toISOString()]
    );

    // Calculate total hours
    var totalHours = 0;
    result.rows.forEach(function(s){
      if(s.total_hours) totalHours += parseFloat(s.total_hours);
    });

    // Calculate breaks based on first clock in of the day
    var byDay = {};
    result.rows.forEach(function(s){
      var d = new Date(s.clock_in).toLocaleDateString('en-US',{timeZone:'America/Los_Angeles'});
      if(!byDay[d]) byDay[d] = [];
      byDay[d].push(s);
    });

    var weekdays = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    var entries = Object.keys(byDay).map(function(date){
      var dayShifts = byDay[date];
      var firstIn = new Date(dayShifts[0].clock_in);
      var lastOut = dayShifts[dayShifts.length-1].clock_out ? new Date(dayShifts[dayShifts.length-1].clock_out) : null;
      var dayHours = dayShifts.reduce(function(sum,s){ return sum + (parseFloat(s.total_hours)||0); }, 0);
      var totalMinutes = dayHours * 60;
      
      // Break rules from first clock in
      var breaks = [];
      if(totalMinutes > 180) breaks.push({time:'After 3h', duration:'10 min break'});
      if(totalMinutes > 300) breaks.push({time:'After 5h', duration:'30 min lunch'});
      if(totalMinutes > 420) breaks.push({time:'After 7h', duration:'10 min break'});

      return {
        date: date,
        weekday: weekdays[new Date(date).getDay()],
        first_in: firstIn.toISOString(),
        last_out: lastOut ? lastOut.toISOString() : null,
        day_hours: parseFloat(dayHours.toFixed(2)),
        breaks: breaks,
        shifts: dayShifts
      };
    });

    res.json({
      success: true,
      week_start: weekStart.toLocaleDateString('en-US',{month:'numeric',day:'numeric',year:'2-digit'}),
      week_end: weekEnd.toLocaleDateString('en-US',{month:'numeric',day:'numeric',year:'2-digit'}),
      total_hours: parseFloat(totalHours.toFixed(2)),
      limit: 39,
      remaining: parseFloat((39 - totalHours).toFixed(2)),
      entries: entries
    });
  } catch(e) {
    res.status(500).json({ success: false, message: e.message });
  }
});
// ── ADMIN SHIFTS ──
app.get('/api/admin/shifts', async (req, res) => {
  try {
    const { operator, activity, status, from, to } = req.query;
    let query = 'SELECT s.*, b.location FROM orchard_shifts s LEFT JOIN orchard_blocks b ON b.name = s.block_name WHERE 1=1';
    let params = [];
    let i = 1;
    if(operator){ query += ` AND s.operator ILIKE $${i++}`; params.push('%'+operator+'%'); }
    if(activity){ query += ` AND s.activity=$${i++}`; params.push(activity); }
    if(status){ query += ` AND s.status=$${i++}`; params.push(status); }
    if(from){ query += ` AND s.clock_in>=$${i++}`; params.push(from); }
    if(to){ query += ` AND s.clock_in<=$${i++}`; params.push(to); }
    query += ' ORDER BY s.clock_in DESC LIMIT 500';
    const result = await pool.query(query, params);
    res.json({ success: true, shifts: result.rows });
  } catch(e) {
    res.status(500).json({ success: false, message: e.message });
  }
});
// ── WORKERS ──
app.get('/api/workers', async (req, res) => {
  try {
    const result = await pool.query('SELECT id, name, role, greeting, active, created_at FROM orchard_workers ORDER BY name');
    res.json({ success: true, workers: result.rows });
  } catch(e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.post('/api/workers/login', async (req, res) => {
  try {
    const { pin } = req.body;
    const result = await pool.query(
      'SELECT id, name, role, greeting FROM orchard_workers WHERE pin=$1 AND active=TRUE',
      [pin]
    );
    if(!result.rows.length) return res.status(401).json({ success: false, message: 'Invalid PIN' });
    res.json({ success: true, worker: result.rows[0] });
  } catch(e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.post('/api/workers/add', async (req, res) => {
  try {
    const { name, pin, role, greeting } = req.body;
    const result = await pool.query(
      'INSERT INTO orchard_workers (name, pin, role, greeting) VALUES ($1,$2,$3,$4) RETURNING id',
      [name, pin, role || 'Worker', greeting || 'Hello']
    );
    res.json({ success: true, id: result.rows[0].id });
  } catch(e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.post('/api/workers/toggle', async (req, res) => {
  try {
    const { id } = req.body;
    await pool.query('UPDATE orchard_workers SET active = NOT active WHERE id=$1', [id]);
    res.json({ success: true });
  } catch(e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.post('/api/workers/update', async (req, res) => {
  try {
    const { id, name, pin, role, greeting } = req.body;
    await pool.query(
      'UPDATE orchard_workers SET name=$1, pin=$2, role=$3, greeting=$4 WHERE id=$5',
      [name, pin, role, greeting, id]
    );
    res.json({ success: true });
  } catch(e) {
    res.status(500).json({ success: false, message: e.message });
  }
});
// ── TEMP ALERT ──
app.post('/api/weather/alert', async (req, res) => {
  try {
    const { temp, level } = req.body;
    const topic = 'orama-ordenes'; // reuse your existing ntfy topic
    const title = level === 'critical' ? '🚨 COOLING SYSTEM REQUIRED' : '🌫️ Foggers Recommended';
    const message = `Temperature is ${temp}°F at the orchard. ${level === 'critical' ? 'Start cooling foggers immediately!' : 'Consider running foggers.'}`;
    
    await fetch(`https://ntfy.sh/${topic}`, {
      method: 'POST',
      headers: { 'Title': title, 'Priority': level === 'critical' ? 'urgent' : 'high', 'Tags': 'thermometer' },
      body: message
    });
    res.json({ success: true });
  } catch(e) {
    res.status(500).json({ success: false, message: e.message });
  }
});
// ── UPDATE WATER ALERTS ──
async function updateWaterAlerts(){
  try {
    // Get last irrigation session per block (excluding Foggers)
    const result = await pool.query(`
      SELECT DISTINCT ON (block_name) 
        block_name, finish_time
      FROM orchard_sessions
      WHERE status='completed' 
        AND session_type='Irrigation'
        AND irr_type != 'Foggers'
        AND finish_time IS NOT NULL
      ORDER BY block_name, finish_time DESC
    `);

    for(const row of result.rows){
      // Get cycle days for this block
      const block = await pool.query(
        'SELECT cycle_days FROM orchard_blocks WHERE name=$1',
        [row.block_name]
      );
      if(!block.rows.length) continue;

      const cycleDays = block.rows[0].cycle_days || 6;
      const lastWatered = new Date(row.finish_time);
      const nextWater = new Date(lastWatered);
      nextWater.setDate(lastWatered.getDate() + cycleDays);

      const now = new Date();
      const daysUntil = Math.floor((nextWater - now) / (1000*60*60*24));

      let alert = '✅ OK';
      if(daysUntil <= 0) alert = '🛑 Due';
      else if(daysUntil <= 2) alert = '🟡 Soon';

      await pool.query(
        'UPDATE orchard_blocks SET water_alert=$1, last_watered=$2, next_water=$3 WHERE name=$4',
        [alert, lastWatered, nextWater.toISOString().split('T')[0], row.block_name]
      );
    }
    console.log('Water alerts updated');
  } catch(e) {
    console.error('Water alert update error:', e.message);
  }
}
// ── ADMIN FUEL ──
app.get('/api/admin/fuel', async (req, res) => {
  try {
    const { vehicle, fuel_type, from, to } = req.query;
    let query = 'SELECT * FROM orchard_fuel WHERE 1=1';
    let params = [];
    let i = 1;
    if(vehicle){ query += ` AND vehicle=$${i++}`; params.push(vehicle); }
    if(fuel_type){ query += ` AND fuel_type=$${i++}`; params.push(fuel_type); }
    if(from){ query += ` AND log_date>=$${i++}`; params.push(from); }
    if(to){ query += ` AND log_date<=$${i++}`; params.push(to); }
    query += ' ORDER BY log_date DESC, created_at DESC LIMIT 500';
    const result = await pool.query(query, params);
    res.json({ success: true, logs: result.rows });
  } catch(e) {
    res.status(500).json({ success: false, message: e.message });
  }
});
// ── SWITCH IRRIGATION TYPE ──
app.post('/api/sessions/switch-type', async (req, res) => {
  try {
    const { block_name, irr_type } = req.body;
    if(!block_name || !irr_type){
      return res.status(400).json({ success: false, message: 'Block name and irrigation type required' });
    }

    // Close current open session and log hours
    const closed = await pool.query(
      `UPDATE orchard_sessions 
       SET status='completed', finish_time=NOW(), 
           hours=EXTRACT(EPOCH FROM (NOW()-start_time))/3600
       WHERE block_name=$1 AND status='open' AND session_type='Irrigation'
       RETURNING hours`,
      [block_name]
    );

    // Update total hours on block
    if(closed.rows.length && closed.rows[0].hours){
      await pool.query(
        'UPDATE orchard_blocks SET total_hours = total_hours + $1 WHERE name=$2',
        [parseFloat(closed.rows[0].hours), block_name]
      );
    }

    // Start new session with new irrigation type
    const block = await pool.query('SELECT id FROM orchard_blocks WHERE name=$1', [block_name]);
    if(!block.rows.length) return res.status(404).json({ success: false, message: 'Block not found' });

    const session = await pool.query(
      'INSERT INTO orchard_sessions (block_id, block_name, session_type, irr_type) VALUES ($1,$2,$3,$4) RETURNING id',
      [block.rows[0].id, block_name, 'Irrigation', irr_type]
    );

    res.json({ success: true, session_id: session.rows[0].id });
  } catch(e) {
    res.status(500).json({ success: false, message: e.message });
  }
});
// ── EDIT/DELETE SESSION ──
app.post('/api/admin/sessions/delete', async (req, res) => {
  try {
    const { id } = req.body;
    if(!id) return res.status(400).json({ success: false, message: 'Session ID required' });
    await pool.query('DELETE FROM orchard_sessions WHERE id=$1', [id]);
    res.json({ success: true });
  } catch(e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.post('/api/admin/sessions/edit', async (req, res) => {
  try {
    const { id, block_name, session_type, irr_type, notes, status } = req.body;
    if(!id) return res.status(400).json({ success: false, message: 'Session ID required' });
    await pool.query(
      'UPDATE orchard_sessions SET block_name=$1, session_type=$2, irr_type=$3, notes=$4, status=$5 WHERE id=$6',
      [block_name, session_type, irr_type, notes || '', status, id]
    );
    res.json({ success: true });
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
