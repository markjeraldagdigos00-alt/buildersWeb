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
        time_in TIMESTAMP,
        time_out TIMESTAMP,
        status VARCHAR(20) DEFAULT 'Present'
      );

      CREATE TABLE IF NOT EXISTS advances (
        id SERIAL PRIMARY KEY,
        worker_id VARCHAR(50) NOT NULL,
        amount DECIMAL(10,2) NOT NULL,
        reason VARCHAR(255),
        status VARCHAR(20) DEFAULT 'Unpaid',
        date DATE DEFAULT CURRENT_DATE
      );

      CREATE TABLE IF NOT EXISTS announcements (
        id SERIAL PRIMARY KEY,
        title VARCHAR(150) NOT NULL,
        message TEXT NOT NULL,
        date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS projects (
        id SERIAL PRIMARY KEY,
        project_name VARCHAR(150) NOT NULL,
        location VARCHAR(255),
        status VARCHAR(50) DEFAULT 'Ongoing'
      );

      CREATE TABLE IF NOT EXISTS schedules (
        id SERIAL PRIMARY KEY,
        worker_id VARCHAR(50) NOT NULL,
        shift_start TIME DEFAULT '08:00',
        shift_end TIME DEFAULT '17:00',
        work_days VARCHAR(100) DEFAULT 'Mon-Sat'
      );

      CREATE TABLE IF NOT EXISTS leave_requests (
        id SERIAL PRIMARY KEY,
        worker_id VARCHAR(50) NOT NULL,
        leave_type VARCHAR(50) NOT NULL,
        start_date DATE NOT NULL,
        end_date DATE NOT NULL,
        reason TEXT,
        status VARCHAR(20) DEFAULT 'Pending',
        date DATE DEFAULT CURRENT_DATE
      );

      CREATE TABLE IF NOT EXISTS safety_logs (
        id SERIAL PRIMARY KEY,
        title VARCHAR(150) NOT NULL,
        description TEXT,
        severity VARCHAR(20) DEFAULT 'Low',
        date DATE DEFAULT CURRENT_DATE
      );

      CREATE TABLE IF NOT EXISTS equipment (
        id SERIAL PRIMARY KEY,
        item_code VARCHAR(50) UNIQUE NOT NULL,
        item_name VARCHAR(150) NOT NULL,
        category VARCHAR(50),
        quantity INT DEFAULT 0,
        status VARCHAR(50) DEFAULT 'Available'
      );

      CREATE TABLE IF NOT EXISTS stock_logs (
        id SERIAL PRIMARY KEY,
        item_code VARCHAR(50) NOT NULL,
        action_type VARCHAR(20) NOT NULL,
        quantity INT NOT NULL,
        personnel VARCHAR(100),
        notes TEXT,
        date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS admin_users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        role VARCHAR(50) DEFAULT 'Admin',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS payroll_records (
        id SERIAL PRIMARY KEY,
        worker_id VARCHAR(50) NOT NULL,
        amount_paid DECIMAL(10,2) NOT NULL,
        date_paid TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    const compCheck = await pool.query('SELECT * FROM company_settings LIMIT 1');
    if (compCheck.rows.length === 0) {
      await pool.query(`INSERT INTO company_settings (company_name, address, contact_number) VALUES ('ABC Builders', 'Angeles City', '09123456789')`);
    }

    const workerCheck = await pool.query('SELECT * FROM workers LIMIT 1');
    if (workerCheck.rows.length === 0) {
      await pool.query(`
        INSERT INTO workers (worker_id, full_name, contact_number, position, daily_rate, assigned_project, qr_code) VALUES
        ('W-001', 'Juan Dela Cruz', '09123456789', 'Mason', 700.00, 'Building A', 'W-001'),
        ('W-002', 'Pedro Santos', '09987654321', 'Carpenter', 650.00, 'Building B', 'W-002')
      `);
    }

    console.log('Database tables successfully verified and ready!');
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
  await pool.query('UPDATE company_settings SET company_name = $1, logo_url = $2, address = $3, contact_number = $4 WHERE id = 1', [company_name, logo_url, address, contact_number]);
  res.json({ success: true });
});

app.get('/api/workers', async (req, res) => {
  const result = await pool.query('SELECT * FROM workers ORDER BY id DESC');
  res.json(result.rows);
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

app.get('/api/scanner/dashboard', async (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const company = await getCompanyInfo();
  const presentRes = await pool.query('SELECT COUNT(DISTINCT worker_id) as count FROM attendance WHERE date = $1', [today]);
  const timeInRes = await pool.query('SELECT COUNT(*) as count FROM attendance WHERE date = $1 AND time_in IS NOT NULL', [today]);
  const timeOutRes = await pool.query('SELECT COUNT(*) as count FROM attendance WHERE date = $1 AND time_out IS NOT NULL', [today]);

  res.json({
    company,
    date: today,
    total_present: parseInt(presentRes.rows[0].count) || 0,
    total_time_in: parseInt(timeInRes.rows[0].count) || 0,
    total_time_out: parseInt(timeOutRes.rows[0].count) || 0
  });
});

app.post('/api/scanner/scan', async (req, res) => {
  const { qr_code, status_override } = req.body; // Pwedeng magpasa ng 'Present' o 'Half Day'
  const today = new Date().toISOString().split('T')[0];

  const workerRes = await pool.query('SELECT * FROM workers WHERE qr_code = $1 OR worker_id = $1', [qr_code]);
  if (workerRes.rows.length === 0) return res.status(404).json({ error: 'Invalid QR Code / Worker ID!' });
  const worker = workerRes.rows[0];

  const attRes = await pool.query('SELECT * FROM attendance WHERE worker_id = $1 AND date = $2', [worker.worker_id, today]);
  const currentTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  let attendanceStatus = status_override || 'Present';

  if (attRes.rows.length === 0) {
    await pool.query('INSERT INTO attendance (worker_id, date, time_in, status) VALUES ($1, $2, NOW(), $3)', [worker.worker_id, today, attendanceStatus]);
    res.json({ success: true, status_type: 'TIME IN (' + attendanceStatus + ')', name: worker.full_name, position: worker.position, time: currentTime });
  } else if (!attRes.rows[0].time_out) {
    await pool.query('UPDATE attendance SET time_out = NOW() WHERE id = $1', [attRes.rows[0].id]);
    res.json({ success: true, status_type: 'TIME OUT', name: worker.full_name, position: worker.position, time: currentTime });
  } else {
    res.status(400).json({ error: `${worker.full_name} ay nakapag-Time In at Time Out na ngayong araw.` });
  }
});

// Admin manual attendance update (para ma-edit o gawing Half Day)
app.post('/api/admin/attendance/update', async (req, res) => {
  const { attendance_id, status } = req.body;
  try {
    await pool.query('UPDATE attendance SET status = $1 WHERE id = $2', [status, attendance_id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/equipment', async (req, res) => {
  const result = await pool.query('SELECT * FROM equipment ORDER BY id DESC');
  res.json(result.rows);
});

app.post('/api/equipment', async (req, res) => {
  const { item_code, item_name, category, quantity } = req.body;
  try {
    await pool.query(
      `INSERT INTO equipment (item_code, item_name, category, quantity) VALUES ($1, $2, $3, $4)
       ON CONFLICT (item_code) DO UPDATE SET item_name = EXCLUDED.item_name, category = EXCLUDED.category, quantity = EXCLUDED.quantity`,
      [item_code, item_name, category, quantity]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/stock/transaction', async (req, res) => {
  const { item_code, action_type, quantity, personnel, notes } = req.body;
  try {
    const itemRes = await pool.query('SELECT * FROM equipment WHERE item_code = $1', [item_code]);
    if (itemRes.rows.length === 0) return res.status(404).json({ error: 'Item code not found in inventory!' });
    const item = itemRes.rows[0];

    let newQty = item.quantity;
    const qtyNum = parseInt(quantity);

    if (action_type === 'STOCK IN') {
      newQty += qtyNum;
    } else if (action_type === 'STOCK OUT') {
      if (item.quantity < qtyNum) return res.status(400).json({ error: 'Insufficient stock quantity for Stock Out!' });
      newQty -= qtyNum;
    }

    await pool.query('UPDATE equipment SET quantity = $1 WHERE item_code = $2', [newQty, item_code]);
    await pool.query('INSERT INTO stock_logs (item_code, action_type, quantity, personnel, notes) VALUES ($1, $2, $3, $4, $5)', [item_code, action_type, qtyNum, personnel || 'Admin/Scanner', notes || '']);

    res.json({ success: true, new_quantity: newQty, item_name: item.item_name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/stock/logs', async (req, res) => {
  const result = await pool.query(`
    SELECT s.*, e.item_name FROM stock_logs s
    JOIN equipment e ON s.item_code = e.item_code
    ORDER BY s.id DESC LIMIT 50
  `);
  res.json(result.rows);
});

app.get('/api/scanner/today', async (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const result = await pool.query(`
    SELECT a.*, w.full_name, w.position FROM attendance a 
    JOIN workers w ON a.worker_id = w.worker_id 
    WHERE a.date = $1 
    ORDER BY a.id DESC
  `, [today]);
  res.json(result.rows);
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

app.get('/api/leave-requests', async (req, res) => {
  const result = await pool.query(`
    SELECT l.*, w.full_name FROM leave_requests l 
    JOIN workers w ON l.worker_id = w.worker_id 
    ORDER BY l.id DESC
  `);
  res.json(result.rows);
});

app.post('/api/leave-requests', async (req, res) => {
  const { worker_id, leave_type, start_date, end_date, reason } = req.body;
  try {
    await pool.query(
      'INSERT INTO leave_requests (worker_id, leave_type, start_date, end_date, reason) VALUES ($1, $2, $3, $4, $5)',
      [worker_id, leave_type, start_date, end_date, reason]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Payroll na kinakalkula ang Present (1 day) at Half Day (0.5 day)
app.get('/api/admin/payroll-list', async (req, res) => {
  try {
    const workers = await pool.query('SELECT * FROM workers ORDER BY id DESC');
    const payrollData = [];
    for (let w of workers.rows) {
      // Kunin ang attendance records para sa worker na ito na hindi pa bayad
      const attRes = await pool.query("SELECT status FROM attendance WHERE worker_id = $1 AND time_in IS NOT NULL AND status != 'Paid'", [w.worker_id]);
      
      let effectiveDays = 0;
      attRes.rows.forEach(att => {
        if (att.status === 'Present') effectiveDays += 1;
        else if (att.status === 'Half Day') effectiveDays += 0.5;
      });

      const totalSalary = effectiveDays * parseFloat(w.daily_rate);
      
      const advRes = await pool.query('SELECT SUM(amount) as total FROM advances WHERE worker_id = $1 AND status = $2', [w.worker_id, 'Unpaid']);
      const totalAdvance = parseFloat(advRes.rows[0].total || 0);
      const netSalary = totalSalary - totalAdvance;

      payrollData.push({
        worker_id: w.worker_id,
        full_name: w.full_name,
        position: w.position,
        daily_rate: w.daily_rate,
        days_worked: effectiveDays,
        total_salary: totalSalary,
        advance: totalAdvance,
        net_salary: netSalary < 0 ? 0 : netSalary
      });
    }
    res.json(payrollData);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/pay-worker', async (req, res) => {
  const { worker_id, amount_paid } = req.body;
  try {
    await pool.query('INSERT INTO payroll_records (worker_id, amount_paid) VALUES ($1, $2)', [worker_id, amount_paid]);
    await pool.query("UPDATE attendance SET status = 'Paid' WHERE worker_id = $1 AND status != 'Paid'", [worker_id]);
    await pool.query("UPDATE advances SET status = 'Paid' WHERE worker_id = $1 AND status = 'Unpaid'", [worker_id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/worker/:id', async (req, res) => {
  const workerId = req.params.id.trim();
  const company = await getCompanyInfo();
  
  try {
    const workerRes = await pool.query('SELECT * FROM workers WHERE worker_id ILIKE $1 OR qr_code ILIKE $1', [workerId]);
    if (workerRes.rows.length === 0) return res.status(404).json({ error: 'Worker ID not found. Pakisuri ang iyong ID.' });
    
    const worker = workerRes.rows[0];
    const today = new Date().toISOString().split('T')[0];
    const todayAtt = await pool.query('SELECT * FROM attendance WHERE worker_id = $1 AND date = $2', [worker.worker_id, today]);
    const attendanceHistory = await pool.query('SELECT * FROM attendance WHERE worker_id = $1 ORDER BY date DESC LIMIT 30', [worker.worker_id]);
    const advancesRes = await pool.query('SELECT * FROM advances WHERE worker_id = $1 ORDER BY id DESC', [worker.worker_id]);
    const totalAdvancesRes = await pool.query('SELECT SUM(amount) as total FROM advances WHERE worker_id = $1 AND status = $2', [worker.worker_id, 'Unpaid']);
    const annRes = await pool.query('SELECT * FROM announcements ORDER BY id DESC LIMIT 5');
    const leavesRes = await pool.query('SELECT * FROM leave_requests WHERE worker_id = $1 ORDER BY id DESC', [worker.worker_id]);

    const attRes = await pool.query("SELECT status FROM attendance WHERE worker_id = $1 AND time_in IS NOT NULL AND status != 'Paid'", [worker.worker_id]);
    let effectiveDays = 0;
    attRes.rows.forEach(att => {
      if (att.status === 'Present') effectiveDays += 1;
      else if (att.status === 'Half Day') effectiveDays += 0.5;
    });

    const dailyRate = parseFloat(worker.daily_rate) || 0;
    const totalSalary = effectiveDays * dailyRate;
    const totalAdvance = parseFloat(totalAdvancesRes.rows[0].total || 0);
    const netSalary = totalSalary - totalAdvance;

    res.json({
      company,
      worker,
      today_attendance: todayAtt.rows[0] || null,
      attendance: attendanceHistory.rows,
      advances: advancesRes.rows,
      leave_requests: leavesRes.rows,
      salary: { daily_rate: dailyRate, days_worked: effectiveDays, total_salary: totalSalary, advance: totalAdvance, net_salary: netSalary < 0 ? 0 : netSalary },
      announcements: annRes.rows
    });
  } catch (err) {
    res.status(500).json({ error: 'Database error: ' + err.message });
  }
});

// ================= 1. SCANNER PORTAL ( / ) =================
app.get('/', async (req, res) => {
  const company = await getCompanyInfo();
  res.send(`
    <!DOCTYPE html>
    <html lang="tl">
    <head>
      <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${company.company_name} - Scanner & Stock Portal</title>
      <script src="https://cdn.tailwindcss.com"></script>
      <script src="https://unpkg.com/html5-qrcode"></script>
    </head>
    <body class="bg-slate-900 text-white min-h-screen flex flex-col">
      <nav class="bg-slate-800 border-b border-slate-700 p-3 flex justify-between items-center max-w-lg mx-auto w-full rounded-b-xl shadow-lg">
        <div class="flex items-center gap-2">
          ${company.logo_url ? `<img src="${company.logo_url}" class="w-7 h-7 rounded-full object-cover border border-amber-400">` : '🏗️'}
          <div>
            <h1 class="text-xs sm:text-sm font-bold text-amber-400">${company.company_name}</h1>
            <p class="text-[9px] text-slate-400">Gate & Stock Scanner</p>
          </div>
        </div>
        <div class="space-x-1 text-xs">
          <button onclick="switchTab('dashboard')" class="bg-slate-700 px-2 py-1.5 rounded-lg font-semibold">Dash</button>
          <button onclick="switchTab('scan')" class="bg-amber-500 text-slate-900 font-bold px-2 py-1.5 rounded-lg">Scan QR</button>
          <button onclick="switchTab('stock')" class="bg-purple-600 px-2 py-1.5 rounded-lg font-bold">Stock In/Out</button>
        </div>
      </nav>
      <main class="flex-1 max-w-lg w-full mx-auto p-3 mt-2">
        <section id="tab-dashboard" class="space-y-4">
          <div class="bg-slate-800 p-5 rounded-2xl text-center border border-slate-700 shadow-xl">
            <h2 class="text-lg font-bold text-amber-400">${company.company_name}</h2>
            <p class="text-xs text-slate-400 uppercase font-bold mt-1">Date Today: <span id="d-date" class="text-white">-</span></p>
          </div>
          <div class="grid grid-cols-3 gap-2 text-center">
            <div class="bg-slate-800 p-3 rounded-xl border border-slate-700"><p class="text-[10px] text-slate-400">Present</p><h3 id="d-present" class="text-xl font-bold text-emerald-400 mt-1">0</h3></div>
            <div class="bg-slate-800 p-3 rounded-xl border border-slate-700"><p class="text-[10px] text-slate-400">Time In</p><h3 id="d-timein" class="text-xl font-bold text-blue-400 mt-1">0</h3></div>
            <div class="bg-slate-800 p-3 rounded-xl border border-slate-700"><p class="text-[10px] text-slate-400">Time Out</p><h3 id="d-timeout" class="text-xl font-bold text-purple-400 mt-1">0</h3></div>
          </div>
        </section>

        <section id="tab-scan" class="hidden bg-slate-800 p-4 rounded-2xl text-center space-y-3 border border-slate-700 shadow-xl">
          <h2 class="text-base font-bold text-amber-400">SCAN WORKER QR CODE</h2>
          <div class="flex justify-center gap-3 text-xs mb-2">
            <label class="flex items-center gap-1 cursor-pointer font-bold text-emerald-400">
              <input type="radio" name="scan-status" value="Present" checked class="accent-amber-500"> Full Day
            </label>
            <label class="flex items-center gap-1 cursor-pointer font-bold text-amber-300">
              <input type="radio" name="scan-status" value="Half Day" class="accent-amber-500"> Half Day
            </label>
          </div>
          <div id="reader" class="overflow-hidden rounded-xl bg-black border-2 border-amber-500 mx-auto w-full max-w-xs"></div>
          <div class="flex gap-2 max-w-xs mx-auto">
            <input type="text" id="manual-qr" placeholder="O i-type ID (e.g. W-001)" class="bg-slate-700 border border-slate-600 p-2 rounded-lg w-full text-center text-white font-bold uppercase text-xs">
            <button onclick="processScan(document.getElementById('manual-qr').value)" class="bg-amber-500 text-slate-900 font-bold px-3 rounded-lg text-xs">OK</button>
          </div>
          <div id="scan-result" class="hidden p-3 rounded-xl font-bold text-left space-y-1 text-xs"></div>
        </section>

        <section id="tab-stock" class="hidden bg-slate-800 p-4 rounded-2xl space-y-3 border border-slate-700 shadow-xl">
          <h2 class="text-base font-bold text-purple-400">📦 Quick Stock In / Stock Out</h2>
          <form onsubmit="scannerStockTx(event)" class="space-y-2 text-xs">
            <div>
              <label class="text-[10px] text-slate-400">Select Item</label>
              <select id="st-item-code" required class="bg-slate-700 border border-slate-600 p-2 rounded w-full text-white"></select>
            </div>
            <div class="grid grid-cols-2 gap-2">
              <div>
                <label class="text-[10px] text-slate-400">Action Type</label>
                <select id="st-action" required class="bg-slate-700 border border-slate-600 p-2 rounded w-full text-white">
                  <option value="STOCK IN">STOCK IN (+)</option>
                  <option value="STOCK OUT">STOCK OUT (-)</option>
                </select>
              </div>
              <div>
                <label class="text-[10px] text-slate-400">Quantity</label>
                <input type="number" id="st-qty" min="1" value="1" required class="bg-slate-700 border border-slate-600 p-2 rounded w-full text-white">
              </div>
            </div>
            <div>
              <label class="text-[10px] text-slate-400">Personnel / Gate Guard</label>
              <input type="text" id="st-personnel" placeholder="Pangalan mo..." required class="bg-slate-700 border border-slate-600 p-2 rounded w-full text-white">
            </div>
            <button type="submit" class="bg-purple-600 hover:bg-purple-500 font-bold p-2.5 rounded w-full">Submit Stock Transaction</button>
          </form>
          <div id="st-result" class="hidden p-2 rounded text-xs font-bold"></div>
        </section>
      </main>
      <script>
        let html5QrCode = null;
        function switchTab(tab) {
          document.getElementById('tab-dashboard').classList.add('hidden');
          document.getElementById('tab-scan').classList.add('hidden');
          document.getElementById('tab-stock').classList.add('hidden');
          document.getElementById('tab-' + tab).classList.remove('hidden');
          if(tab === 'dashboard') loadDashboard();
          if(tab === 'scan') startCamera();
          if(tab === 'stock') loadStockItems();
          if(tab !== 'scan' && html5QrCode) html5QrCode.stop().catch(e => {});
        }
        async function loadDashboard() {
          try {
            const res = await fetch('/api/scanner/dashboard'); const data = await res.json();
            document.getElementById('d-date').innerText = data.date;
            document.getElementById('d-present').innerText = data.total_present;
            document.getElementById('d-timein').innerText = data.total_time_in;
            document.getElementById('d-timeout').innerText = data.total_time_out;
          } catch(e) {}
        }
        function startCamera() {
          if (!html5QrCode) html5QrCode = new Html5Qrcode("reader");
          html5QrCode.start({ facingMode: "environment" }, { fps: 15, qrbox: { width: 200, height: 200 } }, text => processScan(text), err => {}).catch(err => {});
        }
        async function processScan(code) {
          if (!code) return;
          const statusOverride = document.querySelector('input[name="scan-status"]:checked').value;
          const box = document.getElementById('scan-result');
          box.classList.remove('hidden', 'bg-emerald-900', 'bg-red-900', 'text-emerald-200', 'text-red-200');
          try {
            const res = await fetch('/api/scanner/scan', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({qr_code: code.trim(), status_override: statusOverride}) });
            const data = await res.json();
            if(res.ok) {
              box.classList.add('bg-emerald-900', 'text-emerald-200');
              box.innerHTML = '<div class="text-emerald-400 font-extrabold text-sm">✓ ' + data.status_type + ' RECORDED</div><div>Name: ' + data.name + '</div><div>Position: ' + data.position + '</div><div>Time: ' + data.time + '</div>';
            } else {
              box.classList.add('bg-red-900', 'text-red-200');
              box.innerHTML = '<div class="text-red-400 font-bold">X ERROR</div><div>' + data.error + '</div>';
            }
          } catch(e) {
            box.classList.add('bg-red-900', 'text-red-200');
            box.innerHTML = '<div class="text-red-400 font-bold">X ERROR</div><div>Connection problem.</div>';
          }
          document.getElementById('manual-qr').value = '';
        }
        async function loadStockItems() {
          try {
            const res = await fetch('/api/equipment'); const data = await res.json();
            const sel = document.getElementById('st-item-code'); sel.innerHTML = '<option value="">Pili ng Materyales/Gamit</option>';
            data.forEach(i => {
              sel.innerHTML += '<option value="' + i.item_code + '">' + i.item_name + ' (Stock: ' + i.quantity + ')</option>';
            });
          } catch(e) {}
        }
        async function scannerStockTx(e) {
          e.preventDefault();
          const body = {
            item_code: document.getElementById('st-item-code').value,
            action_type: document.getElementById('st-action').value,
            quantity: document.getElementById('st-qty').value,
            personnel: document.getElementById('st-personnel').value
          };
          const resBox = document.getElementById('st-result');
          try {
            const res = await fetch('/api/stock/transaction', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
            const data = await res.json();
            resBox.classList.remove('hidden', 'bg-emerald-900', 'bg-red-900');
            if(res.ok) {
              resBox.classList.add('bg-emerald-900', 'text-emerald-200');
              resBox.innerText = '✓ Success! Bagong stock ng ' + data.item_name + ': ' + data.new_quantity;
              loadStockItems();
            } else {
              resBox.classList.add('bg-red-900', 'text-red-200');
              resBox.innerText = 'X Error: ' + data.error;
            }
          } catch(err) { alert('Network error'); }
        }
        loadDashboard();
      </script>
    </body>
    </html>
  `);
});

// ================= 2. ADMIN PORTAL ( /admin ) =================
app.get('/admin', async (req, res) => {
  const company = await getCompanyInfo();
  res.send(`
    <!DOCTYPE html>
    <html lang="tl">
    <head>
      <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${company.company_name} - Admin Portal</title>
      <script src="https://cdn.tailwindcss.com"></script>
      <style>
        @media print {
          body * { visibility: hidden; }
          #printable-payroll, #printable-payroll * { visibility: visible; }
          #printable-payroll { position: absolute; left: 0; top: 0; width: 100%; background: white; color: black; }
        }
      </style>
    </head>
    <body class="bg-slate-900 text-white min-h-screen flex flex-col md:flex-row">
      
      <aside class="w-full md:w-64 bg-slate-800 border-r border-slate-700 flex-shrink-0 p-4 space-y-4">
        <div class="flex items-center gap-3 border-b border-slate-700 pb-3">
          ${company.logo_url ? `<img src="${company.logo_url}" class="w-8 h-8 rounded-full object-cover border border-amber-400">` : '🏗️'}
          <div>
            <h1 class="font-bold text-amber-400 text-sm">${company.company_name}</h1>
            <p class="text-[10px] text-slate-400 uppercase tracking-wider font-bold">Admin Panel</p>
          </div>
        </div>

        <nav class="space-y-1 text-xs font-semibold overflow-x-auto md:overflow-y-auto max-h-[75vh] flex md:block gap-2 md:gap-0 pb-2">
          <button onclick="switchAdminTab('dash')" class="adm-btn w-full text-left p-2.5 rounded-lg flex items-center gap-2 bg-amber-500 text-slate-900 font-bold">🏠 Dashboard</button>
          <button onclick="switchAdminTab('workers')" class="adm-btn w-full text-left p-2.5 rounded-lg flex items-center gap-2 hover:bg-slate-700 text-slate-300">👷 Workers</button>
          <button onclick="switchAdminTab('qr')" class="adm-btn w-full text-left p-2.5 rounded-lg flex items-center gap-2 hover:bg-slate-700 text-slate-300">📱 QR Attendance</button>
          <button onclick="switchAdminTab('payroll')" class="adm-btn w-full text-left p-2.5 rounded-lg flex items-center gap-2 hover:bg-slate-700 text-slate-300">💰 Payroll</button>
          <button onclick="switchAdminTab('advance')" class="adm-btn w-full text-left p-2.5 rounded-lg flex items-center gap-2 hover:bg-slate-700 text-slate-300">💵 Cash Advance</button>
          <button onclick="switchAdminTab('stock')" class="adm-btn w-full text-left p-2.5 rounded-lg flex items-center gap-2 hover:bg-slate-700 text-slate-300">📦 Stock In/Out</button>
          <button onclick="switchAdminTab('leave')" class="adm-btn w-full text-left p-2.5 rounded-lg flex items-center gap-2 hover:bg-slate-700 text-slate-300">📝 Leave Requests</button>
          <button onclick="switchAdminTab('announce')" class="adm-btn w-full text-left p-2.5 rounded-lg flex items-center gap-2 hover:bg-slate-700 text-slate-300">📢 Announcements</button>
          <button onclick="switchAdminTab('settings')" class="adm-btn w-full text-left p-2.5 rounded-lg flex items-center gap-2 hover:bg-slate-700 text-slate-300">⚙️ Settings</button>
        </nav>
      </aside>

      <main class="flex-1 p-4 overflow-y-auto">
        
        <section id="adm-dash" class="space-y-4">
          <h2 class="text-base font-bold text-amber-400">🏠 Dashboard Overview</h2>
          <div class="grid grid-cols-2 md:grid-cols-4 gap-3 text-center">
            <div class="bg-slate-800 p-4 rounded-xl border border-slate-700"><p class="text-xs text-slate-400">Total Workers</p><h3 id="stat-total" class="text-2xl font-bold text-amber-400 mt-1">0</h3></div>
            <div class="bg-slate-800 p-4 rounded-xl border border-slate-700"><p class="text-xs text-slate-400">Present Today</p><h3 id="stat-present" class="text-2xl font-bold text-emerald-400 mt-1">0</h3></div>
            <div class="bg-slate-800 p-4 rounded-xl border border-slate-700"><p class="text-xs text-slate-400">Absent Today</p><h3 id="stat-absent" class="text-2xl font-bold text-red-400 mt-1">0</h3></div>
            <div class="bg-slate-800 p-4 rounded-xl border border-slate-700"><p class="text-xs text-slate-400">Total Advance</p><h3 id="stat-advance" class="text-2xl font-bold text-purple-400 mt-1">₱0</h3></div>
          </div>
        </section>

        <section id="adm-workers" class="hidden space-y-4">
          <div class="bg-slate-800 p-4 rounded-xl border border-slate-700 space-y-3">
            <h2 class="text-sm font-bold text-amber-400">👷 Add / Update Worker</h2>
            <form id="worker-form" onsubmit="addWorker(event)" class="grid grid-cols-1 md:grid-cols-3 gap-2">
              <input type="text" id="wid" placeholder="Worker ID (e.g. W-003)" required class="bg-slate-700 border border-slate-600 p-2 rounded text-white text-xs">
              <input type="text" id="wname" placeholder="Full Name" required class="bg-slate-700 border border-slate-600 p-2 rounded text-white text-xs">
              <input type="text" id="wpos" placeholder="Position (e.g. Mason)" required class="bg-slate-700 border border-slate-600 p-2 rounded text-white text-xs">
              <input type="text" id="wcontact" placeholder="Contact Number" class="bg-slate-700 border border-slate-600 p-2 rounded text-white text-xs">
              <input type="number" id="wrate" placeholder="Daily Rate (₱)" required class="bg-slate-700 border border-slate-600 p-2 rounded text-white text-xs">
              <input type="text" id="wproject" placeholder="Assigned Project" class="bg-slate-700 border border-slate-600 p-2 rounded text-white text-xs">
              <button type="submit" id="save-worker-btn" class="bg-emerald-600 hover:bg-emerald-500 font-bold p-2 rounded col-span-full text-xs">Save Worker & Generate QR</button>
            </form>
          </div>
          <div class="bg-slate-800 p-4 rounded-xl border border-slate-700 space-y-3">
            <h2 class="text-sm font-bold text-amber-400">Workers List</h2>
            <div class="overflow-x-auto"><table class="w-full text-left text-xs">
              <thead><tr class="bg-slate-700 text-slate-300 border-b border-slate-600"><th class="p-2">ID</th><th class="p-2">Name</th><th class="p-2">Position</th><th class="p-2">Project</th><th class="p-2">Rate</th><th class="p-2">QR Code</th></tr></thead>
              <tbody id="worker-table" class="divide-y divide-slate-700"></tbody>
            </table></div>
          </div>
        </section>

        <section id="adm-qr" class="hidden bg-slate-800 p-4 rounded-xl border border-slate-700 space-y-3">
          <h2 class="text-sm font-bold text-amber-400">📱 QR Attendance Logs & Status Editor</h2>
          <div class="overflow-x-auto"><table class="w-full text-left text-xs">
            <thead><tr class="bg-slate-700 text-slate-300 border-b border-slate-600"><th class="p-2">Worker Name</th><th class="p-2">Date</th><th class="p-2">Time In</th><th class="p-2">Time Out</th><th class="p-2">Status</th><th class="p-2">Change Status</th></tr></thead>
            <tbody id="attendance-table" class="divide-y divide-slate-700"></tbody>
          </table></div>
        </section>

        <section id="adm-payroll" class="hidden space-y-4">
          <div class="bg-slate-800 p-4 rounded-xl border border-slate-700 space-y-3" id="printable-payroll">
            <div class="flex justify-between items-center">
              <h2 class="text-sm font-bold text-amber-400">💰 Payroll Processing & Salary Reset</h2>
              <button onclick="window.print()" class="bg-emerald-600 hover:bg-emerald-500 font-bold px-3 py-1.5 rounded text-xs no-print">🖨️ Print / Save Payroll</button>
            </div>
            <p class="text-xs text-slate-400 no-print">Note: Ang Half Day ay awtomatikong kinakalkula bilang kalahati (0.5) ng Daily Rate.</p>
            <div class="overflow-x-auto">
              <table class="w-full text-left text-xs">
                <thead>
                  <tr class="bg-slate-700 text-slate-300 border-b border-slate-600">
                    <th class="p-2">Worker ID</th>
                    <th class="p-2">Name</th>
                    <th class="p-2">Equivalent Days</th>
                    <th class="p-2">Total Salary</th>
                    <th class="p-2">Advance</th>
                    <th class="p-2 text-emerald-400">Net Salary</th>
                    <th class="p-2 no-print">Action</th>
                  </tr>
                </thead>
                <tbody id="payroll-table" class="divide-y divide-slate-700"></tbody>
              </table>
            </div>
          </div>
        </section>

        <section id="adm-advance" class="hidden space-y-4">
          <div class="bg-slate-800 p-4 rounded-xl border border-slate-700 space-y-3">
            <h2 class="text-sm font-bold text-amber-400">💵 Add Cash Advance</h2>
            <form onsubmit="addAdvance(event)" class="grid grid-cols-1 md:grid-cols-3 gap-2">
              <select id="adv-worker" required class="bg-slate-700 border border-slate-600 p-2 rounded text-white text-xs"></select>
              <input type="number" id="adv-amount" placeholder="Amount (₱)" required class="bg-slate-700 border border-slate-600 p-2 rounded text-white text-xs">
              <input type="text" id="adv-reason" placeholder="Reason (Optional)" class="bg-slate-700 border border-slate-600 p-2 rounded text-white text-xs">
              <button type="submit" class="bg-purple-600 hover:bg-purple-500 font-bold p-2 rounded col-span-full text-xs">Record Advance</button>
            </form>
          </div>
          <div class="bg-slate-800 p-4 rounded-xl border border-slate-700 space-y-3">
            <h2 class="text-sm font-bold text-amber-400">Advances History</h2>
            <div class="overflow-x-auto"><table class="w-full text-left text-xs">
              <thead><tr class="bg-slate-700
