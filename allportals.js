const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function ensureTables() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS company_settings (
        id SERIAL PRIMARY KEY,
        company_name VARCHAR(150) DEFAULT 'ABC Builders',
        logo_url TEXT DEFAULT '',
        address VARCHAR(255) DEFAULT 'Angeles City',
        contact_number VARCHAR(50) DEFAULT '09123456789'
      );

      CREATE TABLE IF NOT EXISTS workers (
        id SERIAL PRIMARY KEY,
        worker_id VARCHAR(50) UNIQUE NOT NULL,
        full_name VARCHAR(100) NOT NULL,
        contact_number VARCHAR(20),
        position VARCHAR(50),
        daily_rate DECIMAL(10, 2) DEFAULT 500.00,
        assigned_project VARCHAR(100),
        qr_code VARCHAR(100) UNIQUE NOT NULL,
        profile_pic TEXT DEFAULT '',
        status VARCHAR(20) DEFAULT 'Active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS attendance (
        id SERIAL PRIMARY KEY,
        worker_id VARCHAR(50) NOT NULL,
        date DATE DEFAULT CURRENT_DATE,
        time_in_1 TIMESTAMP,
        time_out_1 TIMESTAMP,
        time_in_2 TIMESTAMP,
        time_out_2 TIMESTAMP,
        status VARCHAR(20) DEFAULT 'Present'
      );

      CREATE TABLE IF NOT EXISTS inventory (
        id SERIAL PRIMARY KEY,
        item_code VARCHAR(100) UNIQUE NOT NULL,
        item_name VARCHAR(150) NOT NULL,
        category VARCHAR(50),
        stock_qty INT DEFAULT 0,
        unit VARCHAR(20) DEFAULT 'pcs'
      );

      CREATE TABLE IF NOT EXISTS inventory_logs (
        id SERIAL PRIMARY KEY,
        item_code VARCHAR(100) NOT NULL,
        action_type VARCHAR(20) NOT NULL,
        quantity INT NOT NULL,
        remarks VARCHAR(255),
        date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS advances (
        id SERIAL PRIMARY KEY,
        worker_id VARCHAR(50) NOT NULL,
        amount DECIMAL(10,2) NOT NULL,
        reason VARCHAR(255),
        status VARCHAR(20) DEFAULT 'Unpaid',
        date DATE DEFAULT CURRENT_DATE
      );

      CREATE TABLE IF NOT EXISTS payroll_payouts (
        id SERIAL PRIMARY KEY,
        worker_id VARCHAR(50) NOT NULL,
        week_start DATE NOT NULL,
        week_end DATE NOT NULL,
        days_worked INT DEFAULT 0,
        daily_rate DECIMAL(10,2) DEFAULT 0,
        gross_salary DECIMAL(10,2) DEFAULT 0,
        total_advance_deducted DECIMAL(10,2) DEFAULT 0,
        net_salary DECIMAL(10,2) DEFAULT 0,
        payout_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS announcements (
        id SERIAL PRIMARY KEY,
        title VARCHAR(150) NOT NULL,
        message TEXT NOT NULL,
        date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // SAFE ALTER MIGRATIONS (Para masiguro na meron ang mga columns kahit lumang database pa ito)
    await pool.query(`
      ALTER TABLE attendance ADD COLUMN IF NOT EXISTS time_in_1 TIMESTAMP;
      ALTER TABLE attendance ADD COLUMN IF NOT EXISTS time_out_1 TIMESTAMP;
      ALTER TABLE attendance ADD COLUMN IF NOT EXISTS time_in_2 TIMESTAMP;
      ALTER TABLE attendance ADD COLUMN IF NOT EXISTS time_out_2 TIMESTAMP;
      ALTER TABLE attendance ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'Present';
      ALTER TABLE workers ADD COLUMN IF NOT EXISTS assigned_project VARCHAR(100);
      ALTER TABLE workers ADD COLUMN IF NOT EXISTS profile_pic TEXT DEFAULT '';
    `);

    const compCheck = await pool.query('SELECT * FROM company_settings LIMIT 1');
    if (compCheck.rows.length === 0) {
      await pool.query(`INSERT INTO company_settings (company_name, address, contact_number) VALUES ('ABC Builders', 'Angeles City', '09123456789')`);
    }

    const invCheck = await pool.query('SELECT * FROM inventory LIMIT 1');
    if (invCheck.rows.length === 0) {
      await pool.query(`
        INSERT INTO inventory (item_code, item_name, category, stock_qty, unit) VALUES
        ('INV-001', 'Semento (Portland)', 'Materials', 150, 'bags'),
        ('INV-002', 'Deformed Steel Bar 16mm', 'Materials', 80, 'pcs')
      `);
    }

    console.log('Database tables & columns successfully verified and fixed!');
  } catch (err) {
    console.error('DB Setup Error:', err.message);
  }
}
ensureTables();

async function getCompanyInfo() {
  try {
    const res = await pool.query('SELECT * FROM company_settings LIMIT 1');
    return res.rows[0] || { company_name: 'ABC Builders', logo_url: '', address: 'Angeles City', contact_number: '09123456789' };
  } catch (e) {
    return { company_name: 'ABC Builders', logo_url: '', address: 'Angeles City', contact_number: '09123456789' };
  }
}

// ================= API ENDPOINTS =================
app.get('/api/settings', async (req, res) => res.json(await getCompanyInfo()));
app.post('/api/settings', async (req, res) => {
  const { company_name, logo_url, address, contact_number } = req.body;
  await pool.query('UPDATE company_settings SET company_name = $1, logo_url = $2, address = $3, contact_number = $4 WHERE id = 1', [company_name, logo_url, address || '', contact_number || '']);
  res.json({ success: true });
});

app.get('/api/workers', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM workers ORDER BY id DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/workers', async (req, res) => {
  const { worker_id, full_name, contact_number, position, daily_rate, assigned_project, profile_pic } = req.body;
  try {
    await pool.query(
      `INSERT INTO workers (worker_id, full_name, contact_number, position, daily_rate, assigned_project, qr_code, profile_pic) 
       VALUES ($1, $2, $3, $4, $5, $6, $1, $7) 
       ON CONFLICT (worker_id) DO UPDATE SET 
       full_name = EXCLUDED.full_name, contact_number = EXCLUDED.contact_number, position = EXCLUDED.position, daily_rate = EXCLUDED.daily_rate, assigned_project = EXCLUDED.assigned_project`,
      [worker_id, full_name, contact_number, position, daily_rate, assigned_project, worker_id, profile_pic || '']
    );
    res.json({ success: true });
  } catch (err) { 
    res.status(500).json({ error: err.message }); 
  }
});

// ================= INVENTORY & STOCK IN/OUT API =================
app.get('/api/inventory', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM inventory ORDER BY id DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/inventory/logs', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT l.*, i.item_name, i.unit 
      FROM inventory_logs l 
      JOIN inventory i ON l.item_code = i.item_code 
      ORDER BY l.id DESC LIMIT 100
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/inventory/transaction', async (req, res) => {
  const { item_code, action_type, quantity, remarks } = req.body;
  
  if (!item_code || !action_type || !quantity) {
    return res.status(400).json({ error: 'Kulang ang mga kinakailangang impormasyon para sa transaksyon.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const qty = parseInt(quantity);
    if (isNaN(qty) || qty <= 0) {
      throw new Error('Invalid quantity value.');
    }

    const itemRes = await client.query('SELECT * FROM inventory WHERE item_code = $1 FOR UPDATE', [item_code]);
    if (itemRes.rows.length === 0) {
      throw new Error('Item not found in inventory!');
    }
    
    const currentStock = itemRes.rows[0].stock_qty;
    let newStock = currentStock;

    if (action_type === 'STOCK IN') {
      newStock += qty;
    } else if (action_type === 'STOCK OUT') {
      if (currentStock < qty) {
        throw new Error(`Kulang ang stock! Kasalukuyang stock ay ${currentStock}, ngunit nais maglabas ng ${qty}.`);
      }
      newStock -= qty;
    } else {
      throw new Error('Invalid action type.');
    }

    await client.query('UPDATE inventory SET stock_qty = $1 WHERE item_code = $2', [newStock, item_code]);
    await client.query('INSERT INTO inventory_logs (item_code, action_type, quantity, remarks) VALUES ($1, $2, $3, $4)', [item_code, action_type, qty, remarks || '']);

    await client.query('COMMIT');
    res.json({ success: true, new_stock: newStock });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ================= PAYROLL API =================
app.get('/api/admin/payroll/summary', async (req, res) => {
  try {
    const workers = await pool.query('SELECT * FROM workers ORDER BY full_name ASC');
    let payrollList = [];

    for (let w of workers.rows) {
      const attRes = await pool.query('SELECT COUNT(*) FROM attendance WHERE worker_id = $1 AND time_in_1 IS NOT NULL', [w.worker_id]);
      const daysWorked = parseInt(attRes.rows[0].count) || 0;
      const dailyRate = parseFloat(w.daily_rate) || 0;
      const grossSalary = daysWorked * dailyRate;

      const advRes = await pool.query('SELECT SUM(amount) as total FROM advances WHERE worker_id = $1 AND status = $2', [w.worker_id, 'Unpaid']);
      const totalAdvance = parseFloat(advRes.rows[0].total || 0);
      const netSalary = grossSalary - totalAdvance;

      payrollList.push({
        worker_id: w.worker_id,
        full_name: w.full_name,
        position: w.position,
        daily_rate: dailyRate,
        days_worked: daysWorked,
        gross_salary: grossSalary,
        total_advance: totalAdvance,
        net_salary: netSalary < 0 ? 0 : netSalary
      });
    }

    res.json(payrollList);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/payroll/payout', async (req, res) => {
  const { worker_id } = req.body;
  try {
    const workerRes = await pool.query('SELECT * FROM workers WHERE worker_id = $1', [worker_id]);
    if (workerRes.rows.length === 0) return res.status(404).json({ error: 'Worker not found.' });
    const worker = workerRes.rows[0];

    const attRes = await pool.query('SELECT COUNT(*) FROM attendance WHERE worker_id = $1 AND time_in_1 IS NOT NULL', [worker_id]);
    const daysWorked = parseInt(attRes.rows[0].count) || 0;
    const dailyRate = parseFloat(worker.daily_rate) || 0;
    const grossSalary = daysWorked * dailyRate;

    const advRes = await pool.query('SELECT SUM(amount) as total FROM advances WHERE worker_id = $1 AND status = $2', [worker_id, 'Unpaid']);
    const totalAdvance = parseFloat(advRes.rows[0].total || 0);
    const netSalary = grossSalary - totalAdvance;

    await pool.query(
      `INSERT INTO payroll_payouts (worker_id, week_start, week_end, days_worked, daily_rate, gross_salary, total_advance_deducted, net_salary) 
       VALUES ($1, CURRENT_DATE - INTERVAL '7 days', CURRENT_DATE, $2, $3, $4, $5, $6)`,
      [worker_id, daysWorked, dailyRate, grossSalary, totalAdvance, netSalary < 0 ? 0 : netSalary]
    );

    await pool.query('UPDATE advances SET status = $1 WHERE worker_id = $2 AND status = $3', ['Paid', worker_id, 'Unpaid']);
    await pool.query('DELETE FROM attendance WHERE worker_id = $1', [worker_id]);

    res.json({ success: true, message: `Successfully released salary for ${worker.full_name} and reset records to 0.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ================= SCANNER & DASHBOARD API =================
app.get('/api/scanner/dashboard', async (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const company = await getCompanyInfo();
  const presentRes = await pool.query('SELECT COUNT(DISTINCT worker_id) as count FROM attendance WHERE date = $1', [today]);
  const timeIn1Res = await pool.query('SELECT COUNT(*) as count FROM attendance WHERE date = $1 AND time_in_1 IS NOT NULL', [today]);

  res.json({
    company,
    date: today,
    total_present: parseInt(presentRes.rows[0].count) || 0,
    total_time_in_1: parseInt(timeIn1Res.rows[0].count) || 0
  });
});

app.post('/api/scanner/scan', async (req, res) => {
  const { qr_code, scan_mode } = req.body; 
  const today = new Date().toISOString().split('T')[0];

  const workerRes = await pool.query('SELECT * FROM workers WHERE qr_code = $1 OR worker_id = $1', [qr_code]);
  if (workerRes.rows.length === 0) return res.status(404).json({ error: 'Invalid QR Code / Worker ID!' });
  const worker = workerRes.rows[0];

  let attRes = await pool.query('SELECT * FROM attendance WHERE worker_id = $1 AND date = $2', [worker.worker_id, today]);
  const currentTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  let attendanceRow = attRes.rows[0];
  let targetMode = scan_mode;

  if (!targetMode || targetMode === 'AUTO') {
    if (!attendanceRow || !attendanceRow.time_in_1) targetMode = 'TIME_IN_1';
    else if (!attendanceRow.time_out_1) targetMode = 'TIME_OUT_1';
    else if (!attendanceRow.time_in_2) targetMode = 'TIME_IN_2';
    else if (!attendanceRow.time_out_2) targetMode = 'TIME_OUT_2';
    else return res.status(400).json({ error: `${worker.full_name} ay kumpleto na ang 4-time logs para ngayong araw.` });
  }

  if (!attendanceRow) {
    await pool.query('INSERT INTO attendance (worker_id, date, time_in_1, status) VALUES ($1, $2, NOW(), $3)', [worker.worker_id, today, 'Present']);
  } else {
    if (targetMode === 'TIME_IN_1' && !attendanceRow.time_in_1) await pool.query('UPDATE attendance SET time_in_1 = NOW() WHERE id = $1', [attendanceRow.id]);
    else if (targetMode === 'TIME_OUT_1' && !attendanceRow.time_out_1) await pool.query('UPDATE attendance SET time_out_1 = NOW() WHERE id = $1', [attendanceRow.id]);
    else if (targetMode === 'TIME_IN_2' && !attendanceRow.time_in_2) await pool.query('UPDATE attendance SET time_in_2 = NOW() WHERE id = $1', [attendanceRow.id]);
    else if (targetMode === 'TIME_OUT_2' && !attendanceRow.time_out_2) await pool.query('UPDATE attendance SET time_out_2 = NOW() WHERE id = $1', [attendanceRow.id]);
  }

  res.json({ success: true, status_type: targetMode.replace('_', ' '), name: worker.full_name, position: worker.position, time: currentTime });
});

app.get('/api/admin/dashboard', async (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const workersCount = await pool.query('SELECT COUNT(*) FROM workers');
  const presentCount = await pool.query('SELECT COUNT(DISTINCT worker_id) FROM attendance WHERE date = $1', [today]);
  const totalWorkers = parseInt(workersCount.rows[0].count);
  const presentToday = parseInt(presentCount.rows[0].count);
  const absentToday = totalWorkers - presentToday;
  const advanceSum = await pool.query('SELECT SUM(amount) FROM advances WHERE status = $1', ['Unpaid']);

  res.json({
    total_workers: totalWorkers,
    present_today: presentToday,
    absent_today: absentToday < 0 ? 0 : absentToday,
    total_advance: parseFloat(advanceSum.rows[0].sum || 0)
  });
});

app.get('/api/admin/attendance', async (req, res) => {
  const result = await pool.query(`
    SELECT a.*, w.full_name FROM attendance a 
    JOIN workers w ON a.worker_id = w.worker_id 
    ORDER BY a.date DESC, a.id DESC LIMIT 50
  `);
  res.json(result.rows);
});

app.get('/api/advances', async (req, res) => {
  const result = await pool.query(`
    SELECT adv.*, w.full_name FROM advances adv 
    JOIN workers w ON adv.worker_id = w.worker_id 
    ORDER BY adv.id DESC
  `);
  res.json(result.rows);
});

app.post('/api/advances', async (req, res) => {
  const { worker_id, amount, reason } = req.body;
  await pool.query('INSERT INTO advances (worker_id, amount, reason) VALUES ($1, $2, $3)', [worker_id, amount, reason]);
  res.json({ success: true });
});

app.get('/api/announcements', async (req, res) => {
  const result = await pool.query('SELECT * FROM announcements ORDER BY id DESC');
  res.json(result.rows);
});

app.post('/api/announcements', async (req, res) => {
  const { title, message } = req.body;
  await pool.query('INSERT INTO announcements (title, message) VALUES ($1, $2)', [title, message]);
  res.json({ success: true });
});

app.get('/api/worker/:id', async (req, res) => {
  const workerId = req.params.id.trim();
  const company = await getCompanyInfo();
  try {
    const workerRes = await pool.query('SELECT * FROM workers WHERE worker_id ILIKE $1 OR qr_code ILIKE $1', [workerId]);
    if (workerRes.rows.length === 0) return res.status(404).json({ error: 'Worker ID not found.' });
    
    const worker = workerRes.rows[0];
    const today = new Date().toISOString().split('T')[0];
    const todayAtt = await pool.query('SELECT * FROM attendance WHERE worker_id = $1 AND date = $2', [worker.worker_id, today]);
    const attendanceHistory = await pool.query('SELECT * FROM attendance WHERE worker_id = $1 ORDER BY date DESC LIMIT 30', [worker.worker_id]);
    const advancesRes = await pool.query('SELECT * FROM advances WHERE worker_id = $1 ORDER BY id DESC', [worker.worker_id]);
    const totalAdvancesRes = await pool.query('SELECT SUM(amount) as total FROM advances WHERE worker_id = $1 AND status = $2', [worker.worker_id, 'Unpaid']);

    const daysWorkedRes = await pool.query('SELECT COUNT(*) FROM attendance WHERE worker_id = $1 AND time_in_1 IS NOT NULL', [worker.worker_id]);
    const daysWorked = parseInt(daysWorkedRes.rows[0].count) || 0;
    const dailyRate = parseFloat(worker.daily_rate) || 0;
    const totalSalary = daysWorked * dailyRate;
    const totalAdvance = parseFloat(totalAdvancesRes.rows[0].total || 0);
    const netSalary = totalSalary - totalAdvance;

    res.json({
      company,
      worker,
      today_attendance: todayAtt.rows[0] || null,
      attendance: attendanceHistory.rows,
      advances: advancesRes.rows,
      salary: { daily_rate: dailyRate, days_worked: daysWorked, total_salary: totalSalary, advance: totalAdvance, net_salary: netSalary }
    });
  } catch (err) {
    res.status(500).json({ error: 'Database error: ' + err.message });
  }
});

// ================= ADMIN PORTAL ( /admin ) =================
app.get('/admin', async (req, res) => {
  const company = await getCompanyInfo();
  res.send(`
    <!DOCTYPE html>
    <html lang="tl">
    <head>
      <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${company.company_name} - Admin Portal</title>
      <script src="https://cdn.tailwindcss.com"></script>
    </head>
    <body class="bg-slate-900 text-white min-h-screen flex flex-col md:flex-row">
      <aside class="w-full md:w-64 bg-slate-800 border-r border-slate-700 p-4 space-y-4 flex-shrink-0">
        <div class="flex items-center gap-3 border-b border-slate-700 pb-3">
          ${company.logo_url ? `<img src="${company.logo_url}" class="w-8 h-8 rounded-full object-cover border border-amber-400">` : '🏗️'}
          <div>
            <h1 class="font-bold text-amber-400 text-sm">${company.company_name}</h1>
            <p class="text-[10px] text-slate-400 uppercase font-bold">Admin Panel</p>
          </div>
        </div>
        <nav class="space-y-1 text-xs font-semibold overflow-x-auto md:overflow-y-auto max-h-[75vh] flex md:block gap-2 md:gap-0 pb-2">
          <button onclick="switchAdminTab('dash')" class="adm-btn w-full text-left p-2.5 rounded-lg flex items-center gap-2 bg-amber-500 text-slate-900 font-bold">🏠 Dashboard</button>
          <button onclick="switchAdminTab('workers')" class="adm-btn w-full text-left p-2.5 rounded-lg flex items-center gap-2 hover:bg-slate-700 text-slate-300">👷 Workers</button>
          <button onclick="switchAdminTab('inventory')" class="adm-btn w-full text-left p-2.5 rounded-lg flex items-center gap-2 hover:bg-slate-700 text-slate-300">📦 Stock In / Stock Out</button>
          <button onclick="switchAdminTab('payroll')" class="adm-btn w-full text-left p-2.5 rounded-lg flex items-center gap-2 hover:bg-slate-700 text-slate-300">💰 Payroll & Salary</button>
          <button onclick="switchAdminTab('advance')" class="adm-btn w-full text-left p-2.5 rounded-lg flex items-center gap-2 hover:bg-slate-700 text-slate-300">💵 Cash Advance</button>
          <button onclick="switchAdminTab('announce')" class="adm-btn w-full text-left p-2.5 rounded-lg flex items-center gap-2 hover:bg-slate-700 text-slate-300">📢 Announcements</button>
          <button onclick="switchAdminTab('settings')" class="adm-btn w-full text-left p-2.5 rounded-lg flex items-center gap-2 hover:bg-slate-700 text-slate-300">⚙️ Settings</button>
        </nav>
      </aside>

      <main class="flex-1 p-4 overflow-y-auto">
        
        <!-- DASHBOARD -->
        <section id="adm-dash" class="space-y-4">
          <h2 class="text-base font-bold text-amber-400">🏠 Dashboard Overview</h2>
          <div class="grid grid-cols-2 md:grid-cols-4 gap-3 text-center">
            <div class="bg-slate-800 p-4 rounded-xl border border-slate-700"><p class="text-xs text-slate-400">Total Workers</p><h3 id="stat-total" class="text-2xl font-bold text-amber-400 mt-1">0</h3></div>
            <div class="bg-slate-800 p-4 rounded-xl border border-slate-700"><p class="text-xs text-slate-400">Present Today</p><h3 id="stat-present" class="text-2xl font-bold text-emerald-400 mt-1">0</h3></div>
            <div class="bg-slate-800 p-4 rounded-xl border border-slate-700"><p class="text-xs text-slate-400">Absent Today</p><h3 id="stat-absent" class="text-2xl font-bold text-red-400 mt-1">0</h3></div>
            <div class="bg-slate-800 p-4 rounded-xl border border-slate-700"><p class="text-xs text-slate-400">Total Advance</p><h3 id="stat-advance" class="text-2xl font-bold text-purple-400 mt-1">₱0</h3></div>
          </div>
        </section>

        <!-- WORKERS -->
        <section id="adm-workers" class="hidden space-y-4">
          <div class="bg-slate-800 p-4 rounded-xl border border-slate-700 space-y-3">
            <h2 class="text-sm font-bold text-amber-400">👷 Add Worker</h2>
            <form id="worker-form" onsubmit="addWorker(event)" class="grid grid-cols-1 md:grid-cols-3 gap-2">
              <input type="text" id="wid" placeholder="Worker ID (e.g. W-003)" required class="bg-slate-700 border border-slate-600 p-2 rounded text-white text-xs">
              <input type="text" id="wname" placeholder="Full Name" required class="bg-slate-700 border border-slate-600 p-2 rounded text-white text-xs">
              <input type="text" id="wpos" placeholder="Position" required class="bg-slate-700 border border-slate-600 p-2 rounded text-white text-xs">
              <input type="text" id="wcontact" placeholder="Contact Number" class="bg-slate-700 border border-slate-600 p-2 rounded text-white text-xs">
              <input type="number" id="wrate" placeholder="Daily Rate (₱)" required class="bg-slate-700 border border-slate-600 p-2 rounded text-white text-xs">
              <input type="text" id="wproject" placeholder="Assigned Project" class="bg-slate-700 border border-slate-600 p-2 rounded text-white text-xs">
              <button type="submit" id="save-worker-btn" class="bg-emerald-600 hover:bg-emerald-500 font-bold p-2 rounded col-span-full text-xs">Save Worker</button>
            </form>
          </div>
          <div class="bg-slate-800 p-4 rounded-xl border border-slate-700">
            <h2 class="text-sm font-bold text-amber-400 mb-2">Workers List</h2>
            <div class="overflow-x-auto"><table class="w-full text-left text-xs">
              <thead><tr class="bg-slate-700 text-slate-300 border-b border-slate-600"><th class="p-2">ID</th><th class="p-2">Name</th><th class="p-2">Position</th><th class="p-2">Project</th><th class="p-2">Rate</th></tr></thead>
              <tbody id="worker-table" class="divide-y divide-slate-700"></tbody>
            </table></div>
          </div>
        </section>

        <!-- STOCK IN / STOCK OUT & REPORTS -->
        <section id="adm-inventory" class="hidden space-y-4">
          <div class="bg-slate-800 p-4 rounded-xl border border-slate-700 space-y-3">
            <h2 class="text-sm font-bold text-amber-400">📦 Inventory Stock In / Stock Out Form</h2>
            <form onsubmit="submitInventory(event)" class="grid grid-cols-1 md:grid-cols-4 gap-2">
              <select id="inv-item" required class="bg-slate-700 border border-slate-600 p-2 rounded text-white text-xs"></select>
              <select id="inv-action" required class="bg-slate-700 border border-slate-600 p-2 rounded text-white text-xs">
                <option value="STOCK IN">STOCK IN (+ Dagdag)</option>
                <option value="STOCK OUT">STOCK OUT (- Bawas / Labas)</option>
              </select>
              <input type="number" id="inv-qty" placeholder="Quantity" required class="bg-slate-700 border border-slate-600 p-2 rounded text-white text-xs">
              <input type="text" id="inv-remarks" placeholder="Remarks / Project / Kumuha" class="bg-slate-700 border border-slate-600 p-2 rounded text-white text-xs">
              <button type="submit" class="bg-amber-500 text-slate-900 font-bold p-2 rounded col-span-full text-xs">I-submit ang Transaksyon</button>
            </form>
            <div id="inv-alert" class="hidden p-2 rounded text-xs font-bold text-center"></div>
          </div>

          <!-- Current Stocks Table -->
          <div class="bg-slate-800 p-4 rounded-xl border border-slate-700 space-y-3">
            <h2 class="text-sm font-bold text-amber-400">Kasalukuyang Inventory Stocks</h2>
            <div class="overflow-x-auto"><table class="w-full text-left text-xs">
              <thead><tr class="bg-slate-700 text-slate-300 border-b border-slate-600"><th class="p-2">Item Code</th><th class="p-2">Item Name</th><th class="p-2">Category</th><th class="p-2">Stock Qty</th><th class="p-2">Unit</th></tr></thead>
              <tbody id="inventory-table" class="divide-y divide-slate-700"></tbody>
            </table></div>
          </div>

          <!-- Stock In / Stock Out History Report -->
          <div class="bg-slate-800 p-4 rounded-xl border border-slate-700 space-y-3">
            <h2 class="text-sm font-bold text-emerald-400">📄 Stock In / Stock Out History Report (Mga Lumabas at Pumasok)</h2>
            <div class="overflow-x-auto max-h-64">
              <table class="w-full text-left text-xs">
                <thead><tr class="bg-slate-700 text-slate-300 border-b border-slate-600"><th class="p-2">Petsa / Oras</th><th class="p-2">Item Name</th><th class="p-2">Action</th><th class="p-2">Qty</th><th class="p-2">Remarks / Project</th></tr></thead>
                <tbody id="inventory-logs-table" class="divide-y divide-slate-700"></tbody>
              </table>
            </div>
          </div>
        </section>

        <!-- PAYROLL -->
        <section id="adm-payroll" class="hidden space-y-4">
          <div class="bg-slate-800 p-4 rounded-xl border border-slate-700 space-y-3">
            <h2 class="text-sm font-bold text-amber-400">💰 Weekly Payroll & Salary Report</h2>
            <div class="overflow-x-auto"><table class="w-full text-left text-xs">
              <thead><tr class="bg-slate-700 text-slate-300 border-b border-slate-600"><th class="p-2">Worker</th><th class="p-2">Rate</th><th class="p-2">Days Worked</th><th class="p-2">Gross</th><th class="p-2">Advance</th><th class="p-2 text-emerald-400">Net Salary</th><th class="p-2 text-center">Action</th></tr></thead>
              <tbody id="payroll-table-body" class="divide-y divide-slate-700"></tbody>
            </table></div>
          </div>
        </section>

        <!-- CASH ADVANCE -->
        <section id="adm-advance" class="hidden space-y-4">
          <div class="bg-slate-800 p-4 rounded-xl border border-slate-700 space-y-3">
            <h2 class="text-sm font-bold text-amber-400">💵 Add Cash Advance</h2>
            <form onsubmit="addAdvance(event)" class="grid grid-cols-1 md:grid-cols-3 gap-2">
              <select id="adv-worker" required class="bg-slate-700 border border-slate-600 p-2 rounded text-white text-xs"></select>
              <input type="number" id="adv-amount" placeholder="Amount (₱)" required class="bg-slate-700 border border-slate-600 p-2 rounded text-white text-xs">
              <input type="text" id="adv-reason" placeholder="Reason" class="bg-slate-700 border border-slate-600 p-2 rounded text-white text-xs">
              <button type="submit" class="bg-purple-600 hover:bg-purple-500 font-bold p-2 rounded col-span-full text-xs">Record Advance</button>
            </form>
          </div>
          <div class="bg-slate-800 p-4 rounded-xl border border-slate-700">
            <h2 class="text-sm font-bold text-amber-400 mb-2">Advances History</h2>
            <div class="overflow-x-auto"><table class="w-full text-left text-xs">
              <thead><tr class="bg-slate-700 text-slate-300 border-b border-slate-600"><th class="p-2">Worker</th><th class="p-2">Amount</th><th class="p-2">Reason</th><th class="p-2">Status</th><th class="p-2">Date</th></tr></thead>
              <tbody id="advance-table" class="divide-y divide-slate-700"></tbody>
            </table></div>
          </div>
        </section>

        <!-- ANNOUNCEMENTS -->
        <section id="adm-announce" class="hidden bg-slate-800 p-4 rounded-xl border border-slate-700 space-y-3">
          <h2 class="text-sm font-bold text-amber-400">📢 Announcements</h2>
          <form onsubmit="postAnnouncement(event)" class="space-y-2">
            <input type="text" id="ann-title" placeholder="Title" required class="bg-slate-700 border border-slate-600 p-2 rounded w-full text-white text-xs">
            <textarea id="ann-msg" placeholder="Message..." required class="bg-slate-700 border border-slate-600 p-2 rounded w-full text-white text-xs"></textarea>
            <button type="submit" class="bg-blue-600 hover:bg-blue-500 font-bold p-2 rounded w-full text-xs">Publish</button>
          </form>
        </section>

        <!-- SETTINGS -->
        <section id="adm-settings" class="hidden bg-slate-800 p-4 rounded-xl border border-slate-700 space-y-3">
          <h2 class="text-sm font-bold text-amber-400">⚙️ Settings</h2>
          <form onsubmit="saveSettings(event)" class="space-y-2">
            <div><label class="text-[10px] text-slate-400">Company Name</label><input type="text" id="set-name" value="${company.company_name}" required class="bg-slate-700 border border-slate-600 p-2 rounded w-full text-white text-xs"></div>
            <div><label class="text-[10px] text-slate-400">Logo URL</label><input type="text" id="set-logo" value="${company.logo_url}" class="bg-slate-700 border border-slate-600 p-2 rounded w-full text-white text-xs"></div>
            <button type="submit" class="bg-emerald-600 hover:bg-emerald-500 font-bold p-2 rounded w-full text-xs">Save Settings</button>
          </form>
        </section>

      </main>

      <script>
        const tabs = ['dash', 'workers', 'inventory', 'payroll', 'advance', 'announce', 'settings'];

        function switchAdminTab(tabName) {
          tabs.forEach(t => {
            const el = document.getElementById('adm-' + t);
            if(el) el.classList.add('hidden');
          });
          document.getElementById('adm-' + tabName).classList.remove('hidden');

          document.querySelectorAll('.adm-btn').forEach(btn => {
            btn.classList.remove('bg-amber-500', 'text-slate-900', 'font-bold');
            btn.classList.add('hover:bg-slate-700', 'text-slate-300');
          });
          event.currentTarget.classList.remove('hover:bg-slate-700', 'text-slate-300');
          event.currentTarget.classList.add('bg-amber-500', 'text-slate-900', 'font-bold');

          if(tabName === 'dash') loadDashboardStats();
          if(tabName === 'workers') loadWorkers();
          if(tabName === 'inventory') loadInventory();
          if(tabName === 'payroll') loadPayrollSummary();
          if(tabName === 'advance') loadAdvances();
        }

        async function loadDashboardStats() {
          try {
            const res = await fetch('/api/admin/dashboard'); const d = await res.json();
            document.getElementById('stat-total').innerText = d.total_workers;
            document.getElementById('stat-present').innerText = d.present_today;
            document.getElementById('stat-absent').innerText = d.absent_today;
            document.getElementById('stat-advance').innerText = '₱' + d.total_advance.toLocaleString();
          } catch(err) {}
        }

        async function loadWorkers() {
          try {
            const res = await fetch('/api/workers'); const data = await res.json();
            const tbody = document.getElementById('worker-table'); const select = document.getElementById('adv-worker');
            tbody.innerHTML = ''; select.innerHTML = '<option value="">Select Worker</option>';
            data.forEach(w => {
              tbody.innerHTML += '<tr><td class="p-2 font-bold text-amber-300">' + w.worker_id + '</td><td class="p-2">' + w.full_name + '</td><td class="p-2">' + w.position + '</td><td class="p-2">' + (w.assigned_project || '—') + '</td><td class="p-2 text-emerald-400">₱' + w.daily_rate + '</td></tr>';
              select.innerHTML += '<option value="' + w.worker_id + '">' + w.full_name + ' (' + w.worker_id + ')</option>';
            });
          } catch(err) {}
        }

        async function loadInventory() {
          try {
            const res = await fetch('/api/inventory'); const data = await res.json();
            const tbody = document.getElementById('inventory-table'); const select = document.getElementById('inv-item');
            tbody.innerHTML = ''; select.innerHTML = '<option value="">Pumili ng Item...</option>';
            data.forEach(i => {
              tbody.innerHTML += '<tr><td class="p-2 font-bold text-amber-300">' + i.item_code + '</td><td class="p-2">' + i.item_name + '</td><td class="p-2">' + i.category + '</td><td class="p-2 font-bold text-emerald-400">' + i.stock_qty + '</td><td class="p-2">' + i.unit + '</td></tr>';
              select.innerHTML += '<option value="' + i.item_code + '">' + i.item_name + ' (Stock: ' + i.stock_qty + ' ' + i.unit + ')</option>';
            });

            const logsRes = await fetch('/api/inventory/logs'); const logsData = await logsRes.json();
            const logsTbody = document.getElementById('inventory-logs-table');
            logsTbody.innerHTML = '';
            if(logsData.length === 0) {
              logsTbody.innerHTML = '<tr><td colspan="5" class="p-2 text-center text-slate-400">Wala pang transaksyon.</td></tr>';
            } else {
              logsData.forEach(l => {
                let badgeColor = l.action_type === 'STOCK IN' ? 'text-emerald-400 font-bold' : 'text-red-400 font-bold';
                let formattedDate = new Date(l.date).toLocaleString();
                logsTbody.innerHTML += '<tr><td class="p-2 text-slate-300">' + formattedDate + '</td><td class="p-2 font-semibold">' + l.item_name + '</td><td class="p-2 ' + badgeColor + '">' + l.action_type + '</td><td class="p-2">' + l.quantity + ' ' + l.unit + '</td><td class="p-2 text-slate-400">' + (l.remarks || '—') + '</td></tr>';
              });
            }
          } catch(err) {}
        }

        async function submitInventory(e) {
          e.preventDefault();
          const alertBox = document.getElementById('inv-alert');
          const body = {
            item_code: document.getElementById('inv-item').value,
            action_type: document.getElementById('inv-action').value,
            quantity: document.getElementById('inv-qty').value,
            remarks: document.getElementById('inv-remarks').value
          };
          try {
            const res = await fetch('/api/inventory/transaction', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) });
            const data = await res.json();
            alertBox.classList.remove('hidden', 'bg-emerald-900', 'bg-red-900', 'text-emerald-200', 'text-red-200');
            if(res.ok) {
              alertBox.classList.add('bg-emerald-900', 'text-emerald-200');
              alertBox.innerText = '✓ Tagumpay! Naitala ang transaksyon. Bagong Stock: ' + data.new_stock;
              loadInventory();
              document.getElementById('inv-qty').value = '';
              document.getElementById('inv-remarks').value = '';
            } else {
              alertBox.classList.add('bg-red-900', 'text-red-200');
              alertBox.innerText = 'X Error: ' + data.error;
            }
          } catch(err) {
            alertBox.classList.remove('hidden');
            alertBox.classList.add('bg-red-900', 'text-red-200');
            alertBox.innerText = 'X May problema sa koneksyon.';
          }
        }

        async function loadPayrollSummary() {
          try {
            const res = await fetch('/api/admin/payroll/summary'); const data = await res.json();
            const tbody = document.getElementById('payroll-table-body'); tbody.innerHTML = '';
            data.forEach(p => {
              tbody.innerHTML += '<tr><td class="p-2">' + p.full_name + '</td><td class="p-2">₱' + p.daily_rate + '</td><td class="p-2">' + p.days_worked + 'd</td><td class="p-2">₱' + p.gross_salary + '</td><td class="p-2 text-red-400">-₱' + p.total_advance + '</td><td class="p-2 font-bold text-emerald-400">₱' + p.net_salary + '</td><td class="p-2 text-center"><button onclick="releasePayout(\'' + p.worker_id + '\')" class="bg-emerald-600 px-2 py-1 rounded text-white font-bold">Release</button></td></tr>';
            });
          } catch(e) {}
        }

        async function releasePayout(workerId) {
          if(!confirm('I-release na ba ang sahod at i-reset sa 0 ang attendance?')) return;
          const res = await fetch('/api/admin/payroll/payout', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ worker_id: workerId }) });
          if(res.ok) { alert('Payout released!'); loadPayrollSummary(); }
        }

        async function addWorker(e) {
          e.preventDefault();
          const body = { worker_id: document.getElementById('wid').value, full_name: document.getElementById('wname'].value, position: document.getElementById('wpos').value, contact_number: document.getElementById('wcontact').value, daily_rate: document.getElementById('wrate').value, assigned_project: document.getElementById('wproject').value };
          const res = await fetch('/api/workers', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) });
          if(res.ok) { alert('Worker saved!'); loadWorkers(); document.getElementById('worker-form').reset(); }
        }

        async function loadAdvances() {
          const res = await fetch('/api/advances'); const data = await res.json();
          const tbody = document.getElementById('advance-table'); tbody.innerHTML = '';
          data.forEach(a => { tbody.innerHTML += '<tr><td class="p-2">' + a.full_name + '</td><td class="p-2">₱' + a.amount + '</td><td class="p-2">' + (a.reason||'—') + '</td><td class="p-2">' + a.status + '</td><td class="p-2">' + a.date + '</td></tr>'; });
        }

        async function addAdvance(e) {
          e.preventDefault();
          const body = { worker_id: document.getElementById('adv-worker').value, amount: document.getElementById('adv-amount').value, reason: document.getElementById('adv-reason').value };
          const res = await fetch('/api/advances', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
          if(res.ok) { alert('Advance saved!'); loadAdvances(); }
        }

        async function postAnnouncement(e) {
          e.preventDefault();
          const body = { title: document.getElementById('ann-title').value, message: document.getElementById('ann-msg').value };
          await fetch('/api/announcements', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
          alert('Posted!');
        }

        async function saveSettings(e) {
          e.preventDefault();
          const body = { company_name: document.getElementById('set-name').value, logo_url: document.getElementById('set-logo').value, address: '', contact_number: '' };
          await fetch('/api/settings', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
          alert('Saved!'); location.reload();
        }

        loadDashboardStats();
      </script>
    </body>
    </html>
  `);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`System running on port ${PORT}`));
