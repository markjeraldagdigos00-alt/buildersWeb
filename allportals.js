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

      -- Updated Attendance Table para sa 4-times a day (In1, Out1, In2, Out2)
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

      -- Bagong Table para sa Stock In / Out sa Admin Portal at Scanner
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
        action_type VARCHAR(20) NOT NULL, -- 'STOCK IN' o 'STOCK OUT'
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
        status VARCHAR(20) DEFAULT 'Pending'
      );

      CREATE TABLE IF NOT EXISTS safety_logs (
        id SERIAL PRIMARY KEY,
        title VARCHAR(150) NOT NULL,
        description TEXT,
        severity VARCHAR(20) DEFAULT 'Low',
        date DATE DATE DEFAULT CURRENT_DATE
      );

      CREATE TABLE IF NOT EXISTS admin_users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        role VARCHAR(50) DEFAULT 'Admin',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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

    const invCheck = await pool.query('SELECT * FROM inventory LIMIT 1');
    if (invCheck.rows.length === 0) {
      await pool.query(`
        INSERT INTO inventory (item_code, item_name, category, stock_qty, unit) VALUES
        ('INV-001', 'Semento (Portland)', 'Materials', 150, bags),
        ('INV-002', 'Deformed Steel Bar 16mm', 'Materials', 80, pcs)
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

// ================= INVENTORY API (STOCK IN/OUT) =================
app.get('/api/inventory', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM inventory ORDER BY id DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/inventory/transaction', async (req, res) => {
  const { item_code, action_type, quantity, remarks } = req.body;
  try {
    const qty = parseInt(quantity);
    const itemRes = await pool.query('SELECT * FROM inventory WHERE item_code = $1', [item_code]);
    if (itemRes.rows.length === 0) return res.status(404).json({ error: 'Item not found!' });
    
    const currentStock = itemRes.rows.length > 0 ? itemRes.rows[0].stock_qty : 0;
    let newStock = currentStock;

    if (action_type === 'STOCK IN') {
      newStock += qty;
    } else if (action_type === 'STOCK OUT') {
      if (currentStock < qty) return res.status(400).json({ error: 'Kulang ang kasalukuyang stock para sa Stock Out na ito.' });
      newStock -= qty;
    } else {
      return res.status(400).json({ error: 'Invalid action type.' });
    }

    await pool.query('UPDATE inventory SET stock_qty = $1 WHERE item_code = $2', [newStock, item_code]);
    await pool.query('INSERT INTO inventory_logs (item_code, action_type, quantity, remarks) VALUES ($1, $2, $3, $4)', [item_code, action_type, qty, remarks || '']);
    
    res.json({ success: true, new_stock: newStock });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ================= 4-TIMES A DAY ATTENDANCE SCANNER API =================
app.get('/api/scanner/dashboard', async (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const company = await getCompanyInfo();
  const presentRes = await pool.query('SELECT COUNT(DISTINCT worker_id) as count FROM attendance WHERE date = $1', [today]);
  const timeIn1Res = await pool.query('SELECT COUNT(*) as count FROM attendance WHERE date = $1 AND time_in_1 IS NOT NULL', [today]);
  const timeOut1Res = await pool.query('SELECT COUNT(*) as count FROM attendance WHERE date = $1 AND time_out_1 IS NOT NULL', [today]);
  const timeIn2Res = await pool.query('SELECT COUNT(*) as count FROM attendance WHERE date = $1 AND time_in_2 IS NOT NULL', [today]);
  const timeOut2Res = await pool.query('SELECT COUNT(*) as count FROM attendance WHERE date = $1 AND time_out_2 IS NOT NULL', [today]);

  res.json({
    company,
    date: today,
    total_present: parseInt(presentRes.rows[0].count) || 0,
    total_time_in_1: parseInt(timeIn1Res.rows[0].count) || 0,
    total_time_out_1: parseInt(timeOut1Res.rows[0].count) || 0,
    total_time_in_2: parseInt(timeIn2Res.rows[0].count) || 0,
    total_time_out_2: parseInt(timeOut2Res.rows[0].count) || 0
  });
});

app.post('/api/scanner/scan', async (req, res) => {
  const { qr_code, scan_mode } = req.body; // scan_mode: 'TIME_IN_1', 'TIME_OUT_1', 'TIME_IN_2', 'TIME_OUT_2' o 'AUTO'
  const today = new Date().toISOString().split('T')[0];

  const workerRes = await pool.query('SELECT * FROM workers WHERE qr_code = $1 OR worker_id = $1', [qr_code]);
  if (workerRes.rows.length === 0) return res.status(404).json({ error: 'Invalid QR Code / Worker ID!' });
  const worker = workerRes.rows[0];

  let attRes = await pool.query('SELECT * FROM attendance WHERE worker_id = $1 AND date = $2', [worker.worker_id, today]);
  const currentTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  let attendanceRow = attRes.rows[0];
  let targetMode = scan_mode;

  // Kung 'AUTO' ang mode, alamin ang susunod na posibleng i-scan (In1 -> Out1 -> In2 -> Out2)
  if (!targetMode || targetMode === 'AUTO') {
    if (!attendanceRow) {
      targetMode = 'TIME_IN_1';
    } else if (!attendanceRow.time_in_1) {
      targetMode = 'TIME_IN_1';
    } else if (!attendanceRow.time_out_1) {
      targetMode = 'TIME_OUT_1';
    } else if (!attendanceRow.time_in_2) {
      targetMode = 'TIME_IN_2';
    } else if (!attendanceRow.time_out_2) {
      targetMode = 'TIME_OUT_2';
    } else {
      return res.status(400).json({ error: `${worker.full_name} ay kumpleto na ang 4-time logs para ngayong araw.` });
    }
  }

  if (!attendanceRow) {
    if (targetMode !== 'TIME_IN_1') return res.status(400).json({ error: 'Dapat mag Time In 1 muna.' });
    await pool.query('INSERT INTO attendance (worker_id, date, time_in_1, status) VALUES ($1, $2, NOW(), $3)', [worker.worker_id, today, 'Present']);
  } else {
    if (targetMode === 'TIME_IN_1') {
      if (attendanceRow.time_in_1) return res.status(400).json({ error: 'Mayroon nang Time In 1.' });
      await pool.query('UPDATE attendance SET time_in_1 = NOW() WHERE id = $1', [attendanceRow.id]);
    } else if (targetMode === 'TIME_OUT_1') {
      if (!attendanceRow.time_in_1) return res.status(400).json({ error: 'Kailangan munang mag Time In 1.' });
      if (attendanceRow.time_out_1) return res.status(400).json({ error: 'Mayroon nang Time Out 1.' });
      await pool.query('UPDATE attendance SET time_out_1 = NOW() WHERE id = $1', [attendanceRow.id]);
    } else if (targetMode === 'TIME_IN_2') {
      if (!attendanceRow.time_out_1) return res.status(400).json({ error: 'Kailangan munang mag Time Out 1.' });
      if (attendanceRow.time_in_2) return res.status(400).json({ error: 'Mayroon nang Time In 2.' });
      await pool.query('UPDATE attendance SET time_in_2 = NOW() WHERE id = $1', [attendanceRow.id]);
    } else if (targetMode === 'TIME_OUT_2') {
      if (!attendanceRow.time_in_2) return res.status(400).json({ error: 'Kailangan munang mag Time In 2.' });
      if (attendanceRow.time_out_2) return res.status(400).json({ error: 'Mayroon nang Time Out 2.' });
      await pool.query('UPDATE attendance SET time_out_2 = NOW() WHERE id = $1', [attendanceRow.id]);
    }
  }

  res.json({ success: true, status_type: targetMode.replace('_', ' '), name: worker.full_name, position: worker.position, time: currentTime });
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
      salary: { daily_rate: dailyRate, days_worked: daysWorked, total_salary: totalSalary, advance: totalAdvance, net_salary: netSalary },
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
      <title>${company.company_name} - Attendance & Stock Scanner</title>
      <script src="https://cdn.tailwindcss.com"></script>
      <script src="https://unpkg.com/html5-qrcode"></script>
    </head>
    <body class="bg-slate-900 text-white min-h-screen flex flex-col">
      <nav class="bg-slate-800 border-b border-slate-700 p-3 flex justify-between items-center max-w-lg mx-auto w-full rounded-b-xl shadow-lg">
        <div class="flex items-center gap-2">
          ${company.logo_url ? `<img src="${company.logo_url}" class="w-7 h-7 rounded-full object-cover border border-amber-400">` : '🏗️'}
          <div>
            <h1 class="text-xs sm:text-sm font-bold text-amber-400">${company.company_name}</h1>
            <p class="text-[9px] text-slate-400">Gate & Inventory Scanner</p>
          </div>
        </div>
        <div class="space-x-1 text-xs">
          <button onclick="switchTab('dashboard')" class="bg-slate-700 px-3 py-1.5 rounded-lg font-semibold">Dash</button>
          <button onclick="switchTab('scan')" class="bg-amber-500 text-slate-900 font-bold px-3 py-1.5 rounded-lg">Scan QR</button>
          <button onclick="switchTab('today')" class="bg-slate-700 px-3 py-1.5 rounded-lg font-semibold">Today</button>
        </div>
      </nav>
      <main class="flex-1 max-w-lg w-full mx-auto p-3 mt-2">
        <section id="tab-dashboard" class="space-y-4">
          <div class="bg-slate-800 p-5 rounded-2xl text-center border border-slate-700 shadow-xl">
            <h2 class="text-lg font-bold text-amber-400">${company.company_name}</h2>
            <p class="text-xs text-slate-400 uppercase font-bold mt-1">Date Today: <span id="d-date" class="text-white">-</span></p>
          </div>
          <div class="grid grid-cols-2 gap-2 text-center">
            <div class="bg-slate-800 p-3 rounded-xl border border-slate-700"><p class="text-[10px] text-slate-400">Workers Present</p><h3 id="d-present" class="text-xl font-bold text-emerald-400 mt-1">0</h3></div>
            <div class="bg-slate-800 p-3 rounded-xl border border-slate-700"><p class="text-[10px] text-slate-400">Time In 1 Today</p><h3 id="d-timein1" class="text-xl font-bold text-blue-400 mt-1">0</h3></div>
          </div>
        </section>

        <section id="tab-scan" class="hidden bg-slate-800 p-4 rounded-2xl text-center space-y-3 border border-slate-700 shadow-xl">
          <h2 class="text-base font-bold text-amber-400">SCAN QR CODE (ATTENDANCE)</h2>
          <div class="flex justify-center gap-1 text-[11px] font-bold">
            <button onclick="setScanMode('AUTO')" id="btn-mode-AUTO" class="bg-amber-500 text-slate-900 px-2 py-1 rounded">Auto (4x)</button>
            <button onclick="setScanMode('TIME_IN_1')" id="btn-mode-TIME_IN_1" class="bg-slate-700 px-2 py-1 rounded">In 1</button>
            <button onclick="setScanMode('TIME_OUT_1')" id="btn-mode-TIME_OUT_1" class="bg-slate-700 px-2 py-1 rounded">Out 1</button>
            <button onclick="setScanMode('TIME_IN_2')" id="btn-mode-TIME_IN_2" class="bg-slate-700 px-2 py-1 rounded">In 2</button>
            <button onclick="setScanMode('TIME_OUT_2')" id="btn-mode-TIME_OUT_2" class="bg-slate-700 px-2 py-1 rounded">Out 2</button>
          </div>
          <div id="reader" class="overflow-hidden rounded-xl bg-black border-2 border-amber-500 mx-auto w-full max-w-xs"></div>
          <div class="flex gap-2 max-w-xs mx-auto">
            <input type="text" id="manual-qr" placeholder="O i-type ID (e.g. W-001)" class="bg-slate-700 border border-slate-600 p-2 rounded-lg w-full text-center text-white font-bold uppercase text-xs">
            <button onclick="processScan(document.getElementById('manual-qr').value)" class="bg-amber-500 text-slate-900 font-bold px-3 rounded-lg text-xs">OK</button>
          </div>
          <div id="scan-result" class="hidden p-3 rounded-xl font-bold text-left space-y-1 text-xs"></div>
        </section>

        <section id="tab-today" class="hidden bg-slate-800 p-4 rounded-2xl space-y-3 border border-slate-700 shadow-xl">
          <h2 class="text-base font-bold text-amber-400">Today's Attendance Logs (4x)</h2>
          <div class="overflow-x-auto max-h-[55vh]">
            <table class="w-full text-left text-[11px]">
              <thead><tr class="bg-slate-700 text-slate-300 border-b border-slate-600"><th class="p-1.5">Worker</th><th class="p-1.5">In 1</th><th class="p-1.5">Out 1</th><th class="p-1.5">In 2</th><th class="p-1.5">Out 2</th></tr></thead>
              <tbody id="today-table-body" class="divide-y divide-slate-700"></tbody>
            </table>
          </div>
        </section>
      </main>
      <script>
        let html5QrCode = null;
        let currentScanMode = 'AUTO';

        function setScanMode(mode) {
          currentScanMode = mode;
          ['AUTO', 'TIME_IN_1', 'TIME_OUT_1', 'TIME_IN_2', 'TIME_OUT_2'].forEach(m => {
            const btn = document.getElementById('btn-mode-' + m);
            if(btn) {
              btn.className = m === mode ? 'bg-amber-500 text-slate-900 px-2 py-1 rounded font-bold' : 'bg-slate-700 text-slate-300 px-2 py-1 rounded';
            }
          });
        }

        function switchTab(tab) {
          document.getElementById('tab-dashboard').classList.add('hidden');
          document.getElementById('tab-scan').classList.add('hidden');
          document.getElementById('tab-today').classList.add('hidden');
          document.getElementById('tab-' + tab).classList.remove('hidden');
          if(tab === 'dashboard') loadDashboard();
          if(tab === 'scan') startCamera();
          if(tab === 'today') loadToday();
          if(tab !== 'scan' && html5QrCode) html5QrCode.stop().catch(e => {});
        }
        async function loadDashboard() {
          try {
            const res = await fetch('/api/scanner/dashboard'); const data = await res.json();
            document.getElementById('d-date').innerText = data.date;
            document.getElementById('d-present').innerText = data.total_present;
            document.getElementById('d-timein1').innerText = data.total_time_in_1;
          } catch(e) {}
        }
        function startCamera() {
          if (!html5QrCode) html5QrCode = new Html5Qrcode("reader");
          html5QrCode.start({ facingMode: "environment" }, { fps: 15, qrbox: { width: 200, height: 200 } }, text => processScan(text), err => {}).catch(err => {});
        }
        async function processScan(code) {
          if (!code) return;
          const box = document.getElementById('scan-result');
          box.classList.remove('hidden', 'bg-emerald-900', 'bg-red-900', 'text-emerald-200', 'text-red-200');
          try {
            const res = await fetch('/api/scanner/scan', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({qr_code: code.trim(), scan_mode: currentScanMode}) });
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
        async function loadToday() {
          try {
            const res = await fetch('/api/scanner/today'); const data = await res.json();
            const tbody = document.getElementById('today-table-body'); tbody.innerHTML = '';
            if(data.length === 0) { tbody.innerHTML = '<tr><td colspan="5" class="p-3 text-center text-slate-400">Wala pang pumasok.</td></tr>'; return; }
            data.forEach(i => {
              let t1 = i.time_in_1 ? new Date(i.time_in_1).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}) : '-';
              let o1 = i.time_out_1 ? new Date(i.time_out_1).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}) : '—';
              let t2 = i.time_in_2 ? new Date(i.time_in_2).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}) : '-';
              let o2 = i.time_out_2 ? new Date(i.time_out_2).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}) : '—';
              tbody.innerHTML += '<tr><td class="p-1.5 font-semibold">' + i.full_name + '</td><td class="p-1.5 text-blue-400">' + t1 + '</td><td class="p-1.5 text-purple-400">' + o1 + '</td><td class="p-1.5 text-blue-300">' + t2 + '</td><td class="p-1.5 text-purple-300">' + o2 + '</td></tr>';
            });
          } catch(e) {}
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
      <title>${company.company_name} - Full Admin Portal</title>
      <script src="https://cdn.tailwindcss.com"></script>
    </head>
    <body class="bg-slate-900 text-white min-h-screen flex flex-col md:flex-row">
      
      <!-- SIDEBAR NAVIGATION -->
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
          <button onclick="switchAdminTab('qr')" class="adm-btn w-full text-left p-2.5 rounded-lg flex items-center gap-2 hover:bg-slate-700 text-slate-300">📱 QR Attendance (4x)</button>
          <button onclick="switchAdminTab('inventory')" class="adm-btn w-full text-left p-2.5 rounded-lg flex items-center gap-2 hover:bg-slate-700 text-slate-300">📦 Stock In/Out</button>
          <button onclick="switchAdminTab('projects')" class="adm-btn w-full text-left p-2.5 rounded-lg flex items-center gap-2 hover:bg-slate-700 text-slate-300">🏢 Projects</button>
          <button onclick="switchAdminTab('schedules')" class="adm-btn w-full text-left p-2.5 rounded-lg flex items-center gap-2 hover:bg-slate-700 text-slate-300">🕒 Schedules</button>
          <button onclick="switchAdminTab('payroll')" class="adm-btn w-full text-left p-2.5 rounded-lg flex items-center gap-2 hover:bg-slate-700 text-slate-300">💰 Payroll</button>
          <button onclick="switchAdminTab('advance')" class="adm-btn w-full text-left p-2.5 rounded-lg flex items-center gap-2 hover:bg-slate-700 text-slate-300">💵 Cash Advance</button>
          <button onclick="switchAdminTab('leave')" class="adm-btn w-full text-left p-2.5 rounded-lg flex items-center gap-2 hover:bg-slate-700 text-slate-300">📝 Leave Requests</button>
          <button onclick="switchAdminTab('announce')" class="adm-btn w-full text-left p-2.5 rounded-lg flex items-center gap-2 hover:bg-slate-700 text-slate-300">📢 Announcements</button>
          <button onclick="switchAdminTab('safety')" class="adm-btn w-full text-left p-2.5 rounded-lg flex items-center gap-2 hover:bg-slate-700 text-slate-300">🦺 Safety Management</button>
          <button onclick="switchAdminTab('reports')" class="adm-btn w-full text-left p-2.5 rounded-lg flex items-center gap-2 hover:bg-slate-700 text-slate-300">📄 Reports</button>
          <button onclick="switchAdminTab('users')" class="adm-btn w-full text-left p-2.5 rounded-lg flex items-center gap-2 hover:bg-slate-700 text-slate-300">👤 User Management</button>
          <button onclick="switchAdminTab('settings')" class="adm-btn w-full text-left p-2.5 rounded-lg flex items-center gap-2 hover:bg-slate-700 text-slate-300">⚙️ Settings</button>
        </nav>
      </aside>

      <!-- MAIN CONTENT AREA -->
      <main class="flex-1 p-4 overflow-y-auto">
        
        <!-- 1. DASHBOARD -->
        <section id="adm-dash" class="space-y-4">
          <h2 class="text-base font-bold text-amber-400">🏠 Dashboard Overview</h2>
          <div class="grid grid-cols-2 md:grid-cols-4 gap-3 text-center">
            <div class="bg-slate-800 p-4 rounded-xl border border-slate-700"><p class="text-xs text-slate-400">Total Workers</p><h3 id="stat-total" class="text-2xl font-bold text-amber-400 mt-1">0</h3></div>
            <div class="bg-slate-800 p-4 rounded-xl border border-slate-700"><p class="text-xs text-slate-400">Present Today</p><h3 id="stat-present" class="text-2xl font-bold text-emerald-400 mt-1">0</h3></div>
            <div class="bg-slate-800 p-4 rounded-xl border border-slate-700"><p class="text-xs text-slate-400">Absent Today</p><h3 id="stat-absent" class="text-2xl font-bold text-red-400 mt-1">0</h3></div>
            <div class="bg-slate-800 p-4 rounded-xl border border-slate-700"><p class="text-xs text-slate-400">Total Advance</p><h3 id="stat-advance" class="text-2xl font-bold text-purple-400 mt-1">₱0</h3></div>
          </div>
        </section>

        <!-- 2. WORKERS -->
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

        <!-- 3. QR ATTENDANCE (4-TIMES) -->
        <section id="adm-qr" class="hidden bg-slate-800 p-4 rounded-xl border border-slate-700 space-y-3">
          <h2 class="text-sm font-bold text-amber-400">📱 QR Attendance Logs (4-Times Daily)</h2>
          <div class="overflow-x-auto"><table class="w-full text-left text-xs">
            <thead><tr class="bg-slate-700 text-slate-300 border-b border-slate-600"><th class="p-2">Worker Name</th><th class="p-2">Date</th><th class="p-2">In 1</th><th class="p-2">Out 1</th><th class="p-2">In 2</th><th class="p-2">Out 2</th></tr></thead>
            <tbody id="attendance-table" class="divide-y divide-slate-700"></tbody>
          </table></div>
        </section>

        <!-- 4. STOCK IN / OUT (INVENTORY) -->
        <section id="adm-inventory" class="hidden space-y-4">
          <div class="bg-slate-800 p-4 rounded-xl border border-slate-700 space-y-3">
            <h2 class="text-sm font-bold text-amber-400">📦 Inventory Stock In / Stock Out</h2>
            <form onsubmit="submitInventory(event)" class="grid grid-cols-1 md:grid-cols-4 gap-2">
              <select id="inv-item" required class="bg-slate-700 border border-slate-600 p-2 rounded text-white text-xs"></select>
              <select id="inv-action" required class="bg-slate-700 border border-slate-600 p-2 rounded text-white text-xs">
                <option value="STOCK IN">STOCK IN (+)</option>
                <option value="STOCK OUT">STOCK OUT (-)</option>
              </select>
              <input type="number" id="inv-qty" placeholder="Quantity" required class="bg-slate-700 border border-slate-600 p-2 rounded text-white text-xs">
              <input type="text" id="inv-remarks" placeholder="Remarks / Project" class="bg-slate-700 border border-slate-600 p-2 rounded text-white text-xs">
              <button type="submit" class="bg-amber-500 text-slate-900 font-bold p-2 rounded col-span-full text-xs">Process Transaction</button>
            </form>
          </div>
          <div class="bg-slate-800 p-4 rounded-xl border border-slate-700 space-y-3">
            <h2 class="text-sm font-bold text-amber-400">Current Inventory Stocks</h2>
            <div class="overflow-x-auto"><table class="w-full text-left text-xs">
              <thead><tr class="bg-slate-700 text-slate-300 border-b border-slate-600"><th class="p-2">Item Code</th><th class="p-2">Item Name</th><th class="p-2">Category</th><th class="p-2">Stock Qty</th><th class="p-2">Unit</th></tr></thead>
              <tbody id="inventory-table" class="divide-y divide-slate-700"></tbody>
            </table></div>
          </div>
        </section>

        <!-- 5. PROJECTS -->
        <section id="adm-projects" class="hidden bg-slate-800 p-4 rounded-xl border border-slate-700 space-y-3">
          <h2 class="text-sm font-bold text-amber-400">🏢 Projects Management</h2>
          <p class="text-xs text-slate-400">Manage site locations and active construction projects.</p>
          <div class="p-3 bg-slate-700/50 rounded-lg text-xs text-slate-300">Sample Active Projects: <b>Building A (Angeles City)</b>, <b>Building B (Clark)</b></div>
        </section>

        <!-- 6. SCHEDULES -->
        <section id="adm-schedules" class="hidden bg-slate-800 p-4 rounded-xl border border-slate-700 space-y-3">
          <h2 class="text-sm font-bold text-amber-400">🕒 Work Schedules</h2>
          <p class="text-xs text-slate-400">Set standard work shifts and overtime schedules.</p>
          <div class="p-3 bg-slate-700/50 rounded-lg text-xs text-slate-300">Standard Shift: 8:00 AM - 5:00 PM (Monday to Saturday)</div>
        </section>

        <!-- 7. PAYROLL -->
        <section id="adm-payroll" class="hidden bg-slate-800 p-4 rounded-xl border border-slate-700 space-y-3">
          <h2 class="text-sm font-bold text-amber-400">💰 Payroll Processing</h2>
          <p class="text-xs text-slate-400">Compute total salaries, deductions, and weekly payslips.</p>
          <div class="p-3 bg-slate-700/50 rounded-lg text-xs text-slate-300">Automatic computation active: Daily Rate x Days Worked - Cash Advances.</div>
        </section>

        <!-- 8. CASH ADVANCE -->
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
              <thead><tr class="bg-slate-700 text-slate-300 border-b border-slate-600"><th class="p-2">Worker</th><th class="p-2">Amount</th><th class="p-2">Reason</th><th class="p-2">Status</th><th class="p-2">Date</th></tr></thead>
              <tbody id="advance-table" class="divide-y divide-slate-700"></tbody>
            </table></div>
          </div>
        </section>

        <!-- 9. LEAVE REQUESTS -->
        <section id="adm-leave" class="hidden bg-slate-800 p-4 rounded-xl border border-slate-700 space-y-3">
          <h2 class="text-sm font-bold text-amber-400">📝 Leave Requests</h2>
          <p class="text-xs text-slate-400">Approve or reject leave applications from workers.</p>
          <div class="p-3 bg-slate-700/50 rounded-lg text-xs text-slate-400 text-center">No pending leave requests.</div>
        </section>

        <!-- 10. ANNOUNCEMENTS -->
        <section id="adm-announce" class="hidden bg-slate-800 p-4 rounded-xl border border-slate-700 space-y-3">
          <h2 class="text-sm font-bold text-amber-400">📢 Post Announcements</h2>
          <form onsubmit="postAnnouncement(event)" class="space-y-2">
            <input type="text" id="ann-title" placeholder="Title" required class="bg-slate-700 border border-slate-600 p-2 rounded w-full text-white text-xs">
            <textarea id="ann-msg" placeholder="Message for workers..." required class="bg-slate-700 border border-slate-600 p-2 rounded w-full text-white text-xs"></textarea>
            <button type="submit" class="bg-blue-600 hover:bg-blue-500 font-bold p-2 rounded w-full text-xs">Publish Announcement</button>
          </form>
        </section>

        <!-- 11. SAFETY MANAGEMENT -->
        <section id="adm-safety" class="hidden bg-slate-800 p-4 rounded-xl border border-slate-700 space-y-3">
          <h2 class="text-sm font-bold text-amber-400">🦺 Safety Management</h2>
          <p class="text-xs text-slate-400">Safety compliance, incident reports, and PPE tracking.</p>
          <div class="p-3 bg-slate-700/50 rounded-lg text-xs text-emerald-400 font-bold">✓ 0 Safety Incidents reported this month.</div>
        </section>

        <!-- 12. REPORTS -->
        <section id="adm-reports" class="hidden bg-slate-800 p-4 rounded-xl border border-slate-700 space-y-3">
          <h2 class="text-sm font-bold text-amber-400">📄 System Reports</h2>
          <p class="text-xs text-slate-400">Export attendance summary, payroll, and advance logs.</p>
          <button onclick="alert('Export feature ready.')" class="bg-slate-700 hover:bg-slate-600 border border-slate-600 px-3 py-2 rounded text-xs font-bold">📥 Export PDF / CSV Summary</button>
        </section>

        <!-- 13. USER MANAGEMENT -->
        <section id="adm-users" class="hidden bg-slate-800 p-4 rounded-xl border border-slate-700 space-y-3">
          <h2 class="text-sm font-bold text-amber-400">👤 User Management</h2>
          <p class="text-xs text-slate-400">Manage admin roles and gate scanner credentials.</p>
          <div class="p-3 bg-slate-700/50 rounded-lg text-xs text-slate-300">Main Admin: <b>admin@abcbuilders.com</b></div>
        </section>

        <!-- 14. SETTINGS -->
        <section id="adm-settings" class="hidden bg-slate-800 p-4 rounded-xl border border-slate-700 space-y-3">
          <h2 class="text-sm font-bold text-amber-400">⚙️ Company Settings</h2>
          <form onsubmit="saveSettings(event)" class="space-y-2">
            <div><label class="text-[10px] text-slate-400">Company Name</label><input type="text" id="set-name" value="${company.company_name}" required class="bg-slate-700 border border-slate-600 p-2 rounded w-full text-white text-xs"></div>
            <div><label class="text-[10px] text-slate-400">Logo URL</label><input type="text" id="set-logo" value="${company.logo_url}" class="bg-slate-700 border border-slate-600 p-2 rounded w-full text-white text-xs"></div>
            <div><label class="text-[10px] text-slate-400">Address</label><input type="text" id="set-address" value="${company.address}" class="bg-slate-700 border border-slate-600 p-2 rounded w-full text-white text-xs"></div>
            <div><label class="text-[10px] text-slate-400">Contact Number</label><input type="text" id="set-contact" value="${company.contact_number}" class="bg-slate-700 border border-slate-600 p-2 rounded w-full text-white text-xs"></div>
            <button type="submit" class="bg-emerald-600 hover:bg-emerald-500 font-bold p-2 rounded w-full text-xs">Save Settings</button>
          </form>
        </section>

      </main>

      <script>
        const tabs = ['dash', 'workers', 'qr', 'inventory', 'projects', 'schedules', 'payroll', 'advance', 'leave', 'announce', 'safety', 'reports', 'users', 'settings'];

        function switchAdminTab(tabName) {
          tabs.forEach(t => {
            const el = document.getElementById('adm-' + t);
            if(el) el.classList.add('hidden');
          });
          const activeEl = document.getElementById('adm-' + tabName);
          if(activeEl) activeEl.classList.remove('hidden');

          document.querySelectorAll('.adm-btn').forEach(btn => {
            btn.classList.remove('bg-amber-500', 'text-slate-900', 'font-bold');
            btn.classList.add('hover:bg-slate-700', 'text-slate-300');
          });
          event.currentTarget.classList.remove('hover:bg-slate-700', 'text-slate-300');
          event.currentTarget.classList.add('bg-amber-500', 'text-slate-900', 'font-bold');

          if(tabName === 'dash') loadDashboardStats();
          if(tabName === 'workers') loadWorkers();
          if(tabName === 'qr') loadAttendance();
          if(tabName === 'inventory') loadInventory();
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
              tbody.innerHTML += '<tr><td class="p-2 font-bold text-amber-300">' + w.worker_id + '</td><td class="p-2">' + w.full_name + '</td><td class="p-2">' + w.position + '</td><td class="p-2">' + (w.assigned_project || '—') + '</td><td class="p-2 text-emerald-400">₱' + w.daily_rate + '</td><td class="p-2 font-mono text-[11px]">' + w.qr_code + '</td></tr>';
              select.innerHTML += '<option value="' + w.worker_id + '">' + w.full_name + ' (' + w.worker_id + ')</option>';
            });
          } catch(err) {}
        }

        async function loadInventory() {
          try {
            const res = await fetch('/api/inventory'); const data = await res.json();
            const tbody = document.getElementById('inventory-table'); const select = document.getElementById('inv-item');
            tbody.innerHTML = ''; select.innerHTML = '<option value="">Select Item</option>';
            data.forEach(i => {
              tbody.innerHTML += '<tr><td class="p-2 font-bold text-amber-300">' + i.item_code + '</td><td class="p-2">' + i.item_name + '</td><td class="p-2">' + i.category + '</td><td class="p-2 font-bold text-emerald-400">' + i.stock_qty + '</td><td class="p-2">' + i.unit + '</td></tr>';
              select.innerHTML += '<option value="' + i.item_code + '">' + i.item_name + ' (' + i.stock_qty + ' ' + i.unit + ')</option>';
            });
          } catch(err) {}
        }

        async function submitInventory(e) {
          e.preventDefault();
          const body = {
            item_code: document.getElementById('inv-item').value,
            action_type: document.getElementById('inv-action').value,
            quantity: document.getElementById('inv-qty').value,
            remarks: document.getElementById('inv-remarks').value
          };
          const res = await fetch('/api/inventory/transaction', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) });
          const data = await res.json();
          if(res.ok) {
            alert('Inventory transaction successful!');
            loadInventory();
            document.getElementById('inv-qty').value = '';
            document.getElementById('inv-remarks').value = '';
          } else {
            alert('Error: ' + data.error);
          }
        }

        async function addWorker(e) {
          e.preventDefault();
          const btn = document.getElementById('save-worker-btn');
          btn.disabled = true; btn.innerText = 'Saving...';
          
          const body = {
            worker_id: document.getElementById('wid').value.trim(),
            full_name: document.getElementById('wname').value.trim(),
            position: document.getElementById('wpos').value.trim(),
            contact_number: document.getElementById('wcontact').value.trim(),
            daily_rate: document.getElementById('wrate').value.trim(),
            assigned_project: document.getElementById('wproject').value.trim()
          };

          try {
            const res = await fetch('/api/workers', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) });
            const result = await res.json();
            if(res.ok) {
              alert('Worker successfully saved!');
              document.getElementById('worker-form').reset();
              loadWorkers();
            } else { alert('Error: ' + result.error); }
          } catch(err) { alert('Network error.'); }
          finally { btn.disabled = false; btn.innerText = 'Save Worker & Generate QR'; }
        }

        async function loadAttendance() {
          try {
            const res = await fetch('/api/admin/attendance'); const data = await res.json();
            const tbody = document.getElementById('attendance-table'); tbody.innerHTML = '';
            data.forEach(a => {
              let t1 = a.time_in_1 ? new Date(a.time_in_1).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}) : '-';
              let o1 = a.time_out_1 ? new Date(a.time_out_1).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}) : '—';
              let t2 = a.time_in_2 ? new Date(a.time_in_2).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}) : '-';
              let o2 = a.time_out_2 ? new Date(a.time_out_2).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}) : '—';
              tbody.innerHTML += '<tr><td class="p-2 font-semibold">' + a.full_name + '</td><td class="p-2">' + a.date + '</td><td class="p-2 text-blue-400">' + t1 + '</td><td class="p-2 text-purple-400">' + o1 + '</td><td class="p-2 text-blue-300">' + t2 + '</td><td class="p-2 text-purple-300">' + o2 + '</td></tr>';
            });
          } catch(err) {}
        }

        async function loadAdvances() {
          try {
            const res = await fetch('/api/advances'); const data = await res.json();
            const tbody = document.getElementById('advance-table'); tbody.innerHTML = '';
            data.forEach(adv => {
              tbody.innerHTML += '<tr><td class="p-2 font-semibold">' + adv.full_name + '</td><td class="p-2 text-purple-400 font-bold">₱' + adv.amount + '</td><td class="p-2 text-slate-300">' + (adv.reason || '—') + '</td><td class="p-2">' + adv.status + '</td><td class="p-2">' + adv.date + '</td></tr>';
            });
          } catch(err) {}
        }

        async function addAdvance(e) {
          e.preventDefault();
          const body = { worker_id: document.getElementById('adv-worker').value, amount: document.getElementById('adv-amount').value, reason: document.getElementById('adv-reason').value };
          const res = await fetch('/api/advances', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
          if(res.ok) { alert('Advance Recorded!'); loadAdvances(); }
        }

        async function postAnnouncement(e) {
          e.preventDefault();
          const body = { title: document.getElementById('ann-title').value, message: document.getElementById('ann-msg').value };
          const res = await fetch('/api/announcements', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
          if(res.ok) { alert('Announcement Posted!'); document.getElementById('ann-title').value=''; document.getElementById('ann-msg').value=''; }
        }

        async function saveSettings(e) {
          e.preventDefault();
          const body = { company_name: document.getElementById('set-name').value, logo_url: document.getElementById('set-logo').value, address: document.getElementById('set-address').value, contact_number: document.getElementById('set-contact').value };
          const res = await fetch('/api/settings', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
          if(res.ok) { alert('Settings Updated!'); location.reload(); }
        }

        loadDashboardStats();
      </script>
    </body>
    </html>
  `);
});

// ================= 3. WORKER PORTAL ( /worker ) =================
app.get('/worker', async (req, res) => {
  const company = await getCompanyInfo();
  res.send(`
    <!DOCTYPE html>
    <html lang="tl">
    <head>
      <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${company.company_name} - Worker Portal</title>
      <script src="https://cdn.tailwindcss.com"></script>
      <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
    </head>
    <body class="bg-slate-900 text-white min-h-screen p-3 flex flex-col items-center justify-center">
      <div class="max-w-md w-full bg-slate-800 p-5 rounded-2xl shadow-xl space-y-4 border border-slate-700">
        
        <!-- LOGIN SCREEN -->
        <div id="login-screen" class="space-y-3 text-center">
          ${company.logo_url ? `<img src="${company.logo_url}" class="w-12 h-12 rounded-full object-cover mx-auto border-2 border-purple-400">` : '👷'}
          <h1 class="text-base font-bold text-purple-400">${company.company_name}</h1>
          <p class="text-[10px] text-slate-400 tracking-wider">ILAGAY ANG WORKER ID</p>
          <div class="flex gap-2">
            <input type="text" id="worker-id-input" placeholder="e.g. W-001" class="bg-slate-700 border border-slate-600 p-2.5 rounded-lg w-full text-center font-bold uppercase text-white text-xs">
            <button onclick="checkWorker()" class="bg-purple-600 hover:bg-purple-500 px-4 rounded-lg font-bold text-xs">Login</button>
          </div>
          <div id="login-error" class="text-red-400 text-xs font-bold hidden"></div>
        </div>

        <!-- DASHBOARD CONTAINER -->
        <div id="worker-dashboard" class="hidden space-y-4">
          
          <div class="text-center pb-3 border-b border-slate-700 flex items-center justify-between">
            <div class="flex items-center gap-2 text-left">
              ${company.logo_url ? `<img src="${company.logo_url}" class="w-8 h-8 rounded-full object-cover border border-purple-400">` : '🏗️'}
              <div>
                <h2 id="w-comp-name" class="font-bold text-amber-400 text-xs">${company.company_name}</h2>
                <p id="w-pos-id" class="text-[10px] text-slate-400">-</p>
              </div>
            </div>
            <div class="text-right">
              <div id="w-name" class="font-bold text-sm text-white">-</div>
            </div>
          </div>

          <!-- WORKER TABS -->
          <div id="tab-home" class="worker-tab space-y-3">
            <div class="bg-slate-700/50 p-4 rounded-xl border border-slate-600 text-center space-y-2">
              <div class="text-xs text-slate-400 font-semibold uppercase">Today's Attendance Status (4x)</div>
              <div id="w-today-status" class="text-base font-extrabold text-red-400">WALA PA / ABSENT</div>
            </div>
          </div>

          <div id="tab-qr" class="worker-tab hidden space-y-3 text-center">
            <div class="text-xs font-bold text-purple-400 uppercase">My QR Code</div>
            <div class="bg-white p-4 inline-block rounded-xl shadow-inner">
              <div id="qrcode" class="mx-auto flex justify-center"></div>
            </div>
            <div class="text-xs text-slate-300 font-mono font-bold" id="w-qr-text">-</div>
          </div>

          <div id="tab-attendance" class="worker-tab hidden space-y-2">
            <div class="text-xs font-bold text-purple-400 uppercase">Attendance History</div>
            <div class="overflow-x-auto max-h-48">
              <table class="w-full text-left text-[11px]">
                <thead><tr class="bg-slate-700 text-slate-300 border-b border-slate-600"><th class="p-1.5">Date</th><th class="p-1.5">In 1</th><th class="p-1.5">Out 1</th><th class="p-1.5">In 2</th><th class="p-1.5">Out 2</th></tr></thead>
                <tbody id="w-attendance-table" class="divide-y divide-slate-700"></tbody>
              </table>
            </div>
          </div>

          <div id="tab-advance" class="worker-tab hidden space-y-2">
            <div class="text-xs font-bold text-purple-400 uppercase">Advances / Cash Advance</div>
            <div class="overflow-x-auto max-h-48">
              <table class="w-full text-left text-[11px]">
                <thead><tr class="bg-slate-700 text-slate-300 border-b border-slate-600"><th class="p-1.5">Date</th><th class="p-1.5">Amount</th><th class="p-1.5">Reason</th><th class="p-1.5">Status</th></tr></thead>
                <tbody id="w-advance-table" class="divide-y divide-slate-700"></tbody>
              </table>
            </div>
          </div>

          <div id="tab-salary" class="worker-tab hidden space-y-2">
            <div class="text-xs font-bold text-purple-400 uppercase">Salary Breakdown</div>
            <div class="bg-slate-700/50 p-3 rounded-xl border border-slate-600 space-y-1.5 text-xs">
              <div class="flex justify-between"><span>Daily Rate:</span> <span id="s-rate" class="font-bold">₱0</span></div>
              <div class="flex justify-between"><span>Days Worked:</span> <span id="s-days" class="font-bold">0 days</span></div>
              <div class="flex justify-between border-t border-slate-600 pt-1"><span>Total Salary:</span> <span id="s-total" class="font-bold text-amber-400">₱0</span></div>
              <div class="flex justify-between"><span>Advance Deducted:</span> <span id="s-advance" class="font-bold text-red-400">₱0</span></div>
              <div class="flex justify-between border-t border-slate-600 pt-1 font-extrabold text-sm text-emerald-400"><span>Net Salary:</span> <span id="s-net">₱0</span></div>
            </div>
          </div>

          <!-- WORKER BOTTOM MENU -->
          <div class="grid grid-cols-6 gap-1 pt-2 border-t border-slate-700 text-[10px]">
            <button onclick="switchWorkerTab('home')" class="worker-nav-btn bg-purple-600 text-white font-bold p-1.5 rounded text-center">🏠<br>Home</button>
            <button onclick="switchWorkerTab('qr')" class="worker-nav-btn bg-slate-700 text-slate-300 p-1.5 rounded text-center">📱<br>QR</button>
            <button onclick="switchWorkerTab('attendance')" class="worker-nav-btn bg-slate-700 text-slate-300 p-1.5 rounded text-center">📅<br>Logs</button>
            <button onclick="switchWorkerTab('advance')" class="worker-nav-btn bg-slate-700 text-slate-300 p-1.5 rounded text-center">💵<br>Advance</button>
            <button onclick="switchWorkerTab('salary')" class="worker-nav-btn bg-slate-700 text-slate-300 p-1.5 rounded text-center">💰<br>Salary</button>
            <button onclick="logoutWorker()" class="bg-red-900/60 text-red-300 p-1.5 rounded text-center font-bold">🚪<br>Exit</button>
          </div>

        </div>
      </div>

      <script>
        let globalWorkerData = null;

        function switchWorkerTab(tabName) {
          document.querySelectorAll('.worker-tab').forEach(el => el.classList.add('hidden'));
          document.getElementById('tab-' + tabName).classList.remove('hidden');
          
          document.querySelectorAll('.worker-nav-btn').forEach(btn => {
            btn.classList.remove('bg-purple-600', 'text-white');
            btn.classList.add('bg-slate-700', 'text-slate-300');
          });
          event.currentTarget.classList.remove('bg-slate-700', 'text-slate-300');
          event.currentTarget.classList.add('bg-purple-600', 'text-white');
        }

        async function checkWorker() {
          const id = document.getElementById('worker-id-input').value.trim();
          const errBox = document.getElementById('login-error');
          if(!id) return;
          errBox.classList.add('hidden');
          
          try {
            const res = await fetch('/api/worker/' + encodeURIComponent(id));
            const data = await res.json();
            if(res.ok) {
              globalWorkerData = data;
              document.getElementById('login-screen').classList.add('hidden');
              document.getElementById('worker-dashboard').classList.remove('hidden');

              document.getElementById('w-name').innerText = data.worker.full_name;
              document.getElementById('w-pos-id').innerText = data.worker.position + ' | ID: ' + data.worker.worker_id;
              
              let attStatusHTML = '<span class="text-red-400">WALA PA / ABSENT</span>';
              if(data.today_attendance) {
                let t1 = data.today_attendance.time_in_1 ? new Date(data.today_attendance.time_in_1).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}) : '-';
                attStatusHTML = '<span class="text-emerald-400">PRESENT</span><br><span class="text-xs text-slate-300">In 1: ' + t1 + '</span>';
              }
              document.getElementById('w-today-status').innerHTML = attStatusHTML;

              document.getElementById('w-qr-text').innerText = data.worker.qr_code;
              document.getElementById('qrcode').innerHTML = '';
              new QRCode(document.getElementById("qrcode"), { text: data.worker.qr_code, width: 128, height: 128 });

              const attTbody = document.getElementById('w-attendance-table');
              attTbody.innerHTML = '';
              if(data.attendance.length === 0) {
                attTbody.innerHTML = '<tr><td colspan="5" class="p-2 text-center text-slate-400">Walang attendance history.</td></tr>';
              } else {
                data.attendance.forEach(att => {
                  let t1 = att.time_in_1 ? new Date(att.time_in_1).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}) : '-';
                  let o1 = att.time_out_1 ? new Date(att.time_out_1).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}) : '—';
                  let t2 = att.time_in_2 ? new Date(att.time_in_2).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}) : '-';
                  let o2 = att.time_out_2 ? new Date(att.time_out_2).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}) : '—';
                  attTbody.innerHTML += '<tr><td class="p-1.5">' + att.date + '</td><td class="p-1.5 text-blue-400">' + t1 + '</td><td class="p-1.5 text-purple-400">' + o1 + '</td><td class="p-1.5 text-blue-300">' + t2 + '</td><td class="p-1.5 text-purple-300">' + o2 + '</td></tr>';
                });
              }

              const advTbody = document.getElementById('w-advance-table');
              advTbody.innerHTML = '';
              if(data.advances.length === 0) {
                advTbody.innerHTML = '<tr><td colspan="4" class="p-2 text-center text-slate-400">Walang cash advance history.</td></tr>';
              } else {
                data.advances.forEach(adv => {
                  advTbody.innerHTML += '<tr><td class="p-1.5">' + adv.date + '</td><td class="p-1.5 text-purple-400 font-bold">₱' + adv.amount + '</td><td class="p-1.5 text-slate-300">' + (adv.reason || '—') + '</td><td class="p-1.5">' + adv.status + '</td></tr>';
                });
              }

              document.getElementById('s-rate').innerText = '₱' + data.salary.daily_rate.toLocaleString();
              document.getElementById('s-days').innerText = data.salary.days_worked + ' days';
              document.getElementById('s-total').innerText = '₱' + data.salary.total_salary.toLocaleString();
              document.getElementById('s-advance').innerText = '-₱' + data.salary.advance.toLocaleString();
              document.getElementById('s-net').innerText = '₱' + data.salary.net_salary.toLocaleString();

            } else {
              errBox.innerText = data.error || 'Hindi makita ang worker.';
              errBox.classList.remove('hidden');
            }
          } catch(err) {
            errBox.innerText = 'May problema sa koneksyon.';
            errBox.classList.remove('hidden');
          }
        }

        function logoutWorker() {
          document.getElementById('worker-dashboard').classList.add('hidden');
          document.getElementById('login-screen').classList.remove('hidden');
          document.getElementById('worker-id-input').value = '';
          globalWorkerData = null;
        }
      </script>
    </body>
    </html>
  `);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`System running smoothly on port ${PORT}`));
