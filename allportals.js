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
        worker_id VARCHAR(50) REFERENCES workers(worker_id) ON DELETE CASCADE,
        date DATE DEFAULT CURRENT_DATE,
        time_in TIMESTAMP,
        time_out TIMESTAMP,
        status VARCHAR(20) DEFAULT 'Present'
      );

      CREATE TABLE IF NOT EXISTS advances (
        id SERIAL PRIMARY KEY,
        worker_id VARCHAR(50) REFERENCES workers(worker_id) ON DELETE CASCADE,
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
    `);

    // Auto-add column kung sakaling lumang table ang nandoon sa database
    await pool.query(`ALTER TABLE workers ADD COLUMN IF NOT EXISTS profile_pic TEXT DEFAULT '';`);

    const compCheck = await pool.query('SELECT count(*) FROM company_settings');
    if (parseInt(compCheck.rows[0].count) === 0) {
      await pool.query(`INSERT INTO company_settings (company_name, address, contact_number) VALUES ('ABC Builders', 'Angeles City', '09123456789')`);
    }

    const check = await pool.query('SELECT count(*) FROM workers');
    if (parseInt(check.rows[0].count) === 0) {
      await pool.query(`
        INSERT INTO workers (worker_id, full_name, contact_number, position, daily_rate, assigned_project, qr_code) VALUES
        ('W-001', 'Juan Dela Cruz', '09123456789', 'Mason', 700.00, 'Building A', 'W-001'),
        ('W-002', 'Pedro Santos', '09987654321', 'Carpenter', 650.00, 'Building B', 'W-002')
        ON CONFLICT (worker_id) DO NOTHING;
      `);
    }
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
app.get('/api/settings', async (req, res) => {
  await ensureTables();
  res.json(await getCompanyInfo());
});

app.post('/api/settings', async (req, res) => {
  const { company_name, logo_url, address, contact_number } = req.body;
  await pool.query('UPDATE company_settings SET company_name = $1, logo_url = $2, address = $3, contact_number = $4 WHERE id = 1', [company_name, logo_url, address, contact_number]);
  res.json({ success: true });
});

app.get('/api/workers', async (req, res) => {
  await ensureTables();
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
      [worker_id, full_name, contact_number, position, daily_rate, assigned_project, profile_pic || '']
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
  const { qr_code } = req.body;
  const today = new Date().toISOString().split('T')[0];

  const workerRes = await pool.query('SELECT * FROM workers WHERE qr_code = $1 OR worker_id = $1', [qr_code]);
  if (workerRes.rows.length === 0) return res.status(404).json({ error: 'Invalid QR Code o walang katumbas na Worker!' });
  const worker = workerRes.rows[0];

  const attRes = await pool.query('SELECT * FROM attendance WHERE worker_id = $1 AND date = $2', [worker.worker_id, today]);
  const currentTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  if (attRes.rows.length === 0) {
    await pool.query('INSERT INTO attendance (worker_id, date, time_in, status) VALUES ($1, $2, NOW(), $3)', [worker.worker_id, today, 'Present']);
    res.json({ success: true, status_type: 'TIME IN', name: worker.full_name, position: worker.position, time: currentTime });
  } else if (!attRes.rows[0].time_out) {
    await pool.query('UPDATE attendance SET time_out = NOW() WHERE id = $1', [attRes.rows[0].id]);
    res.json({ success: true, status_type: 'TIME OUT', name: worker.full_name, position: worker.position, time: currentTime });
  } else {
    res.status(400).json({ error: `${worker.full_name} ay nakapag-Time In at Time Out na ngayong araw.` });
  }
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

// WORKER PORTAL API ENDPOINT (FIXED)
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
    const advances = await pool.query('SELECT SUM(amount) as total FROM advances WHERE worker_id = $1 AND status = $2', [worker.worker_id, 'Unpaid']);
    const annRes = await pool.query('SELECT * FROM announcements ORDER BY id DESC LIMIT 5');

    const daysWorkedRes = await pool.query('SELECT COUNT(*) FROM attendance WHERE worker_id = $1 AND time_in IS NOT NULL', [worker.worker_id]);
    const daysWorked = parseInt(daysWorkedRes.rows[0].count) || 0;
    const dailyRate = parseFloat(worker.daily_rate) || 0;
    const totalSalary = daysWorked * dailyRate;
    const totalAdvance = parseFloat(advances.rows[0].total || 0);
    const netSalary = totalSalary - totalAdvance;

    res.json({
      company,
      worker,
      today_attendance: todayAtt.rows[0] || null,
      attendance: attendanceHistory.rows,
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
      <title>${company.company_name} - Attendance Scanner</title>
      <script src="https://cdn.tailwindcss.com"></script>
      <script src="https://unpkg.com/html5-qrcode"></script>
    </head>
    <body class="bg-slate-900 text-white min-h-screen flex flex-col">
      <nav class="bg-slate-800 border-b border-slate-700 p-3 flex justify-between items-center max-w-lg mx-auto w-full rounded-b-xl shadow-lg">
        <div class="flex items-center gap-2">
          ${company.logo_url ? `<img src="${company.logo_url}" class="w-7 h-7 rounded-full object-cover border border-amber-400">` : '🏗️'}
          <div>
            <h1 class="text-xs sm:text-sm font-bold text-amber-400">${company.company_name}</h1>
            <p class="text-[9px] text-slate-400">Gate Scanner Only</p>
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
          <div class="grid grid-cols-3 gap-2 text-center">
            <div class="bg-slate-800 p-3 rounded-xl border border-slate-700"><p class="text-[10px] text-slate-400">Present</p><h3 id="d-present" class="text-xl font-bold text-emerald-400 mt-1">0</h3></div>
            <div class="bg-slate-800 p-3 rounded-xl border border-slate-700"><p class="text-[10px] text-slate-400">Time In</p><h3 id="d-timein" class="text-xl font-bold text-blue-400 mt-1">0</h3></div>
            <div class="bg-slate-800 p-3 rounded-xl border border-slate-700"><p class="text-[10px] text-slate-400">Time Out</p><h3 id="d-timeout" class="text-xl font-bold text-purple-400 mt-1">0</h3></div>
          </div>
        </section>

        <section id="tab-scan" class="hidden bg-slate-800 p-4 rounded-2xl text-center space-y-3 border border-slate-700 shadow-xl">
          <h2 class="text-base font-bold text-amber-400">SCAN WORKER QR CODE</h2>
          <div id="reader" class="overflow-hidden rounded-xl bg-black border-2 border-amber-500 mx-auto w-full max-w-xs"></div>
          <div class="flex gap-2 max-w-xs mx-auto">
            <input type="text" id="manual-qr" placeholder="O i-type ID (e.g. W-001)" class="bg-slate-700 border border-slate-600 p-2 rounded-lg w-full text-center text-white font-bold uppercase text-xs">
            <button onclick="processScan(document.getElementById('manual-qr').value)" class="bg-amber-500 text-slate-900 font-bold px-3 rounded-lg text-xs">OK</button>
          </div>
          <div id="scan-result" class="hidden p-3 rounded-xl font-bold text-left space-y-1 text-xs"></div>
        </section>

        <section id="tab-today" class="hidden bg-slate-800 p-4 rounded-2xl space-y-3 border border-slate-700 shadow-xl">
          <h2 class="text-base font-bold text-amber-400">Today's Attendance</h2>
          <div class="overflow-x-auto max-h-[55vh]">
            <table class="w-full text-left text-xs">
              <thead><tr class="bg-slate-700 text-slate-300 border-b border-slate-600"><th class="p-2">Worker</th><th class="p-2">Pos</th><th class="p-2">In</th><th class="p-2">Out</th></tr></thead>
              <tbody id="today-table-body" class="divide-y divide-slate-700"></tbody>
            </table>
          </div>
        </section>
      </main>
      <script>
        let html5QrCode = null;
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
          const box = document.getElementById('scan-result');
          box.classList.remove('hidden', 'bg-emerald-900', 'bg-red-900', 'text-emerald-200', 'text-red-200');
          try {
            const res = await fetch('/api/scanner/scan', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({qr_code: code.trim()}) });
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
            if(data.length === 0) { tbody.innerHTML = '<tr><td colspan="4" class="p-3 text-center text-slate-400">Wala pang pumasok.</td></tr>'; return; }
            data.forEach(i => {
              tbody.innerHTML += '<tr><td class="p-2 font-semibold">' + i.full_name + '</td><td class="p-2 text-slate-300">' + i.position + '</td><td class="p-2 text-blue-400 font-bold">' + (i.time_in?new Date(i.time_in).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}):'-') + '</td><td class="p-2 text-purple-400 font-bold">' + (i.time_out?new Date(i.time_out).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}):'—') + '</td></tr>';
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
      <title>${company.company_name} - Admin Dashboard</title>
      <script src="https://cdn.tailwindcss.com"></script>
    </head>
    <body class="bg-slate-900 text-white min-h-screen p-3 flex flex-col">
      <div class="max-w-5xl mx-auto w-full space-y-3">
        <div class="bg-slate-800 p-3 rounded-xl flex justify-between items-center shadow-lg border border-slate-700">
          <div class="flex items-center gap-2">
            ${company.logo_url ? `<img src="${company.logo_url}" class="w-8 h-8 rounded-full object-cover border border-blue-400">` : '🛠️'}
            <div>
              <h1 class="text-xs sm:text-sm font-bold text-blue-400">${company.company_name} - Admin Portal</h1>
              <p class="text-[9px] text-slate-400">Manager Access Only</p>
            </div>
          </div>
          <div class="space-x-1 text-[11px]">
            <button onclick="switchAdminTab('dash')" class="bg-blue-600 px-2.5 py-1 rounded font-bold">Dash</button>
            <button onclick="switchAdminTab('workers')" class="bg-slate-700 px-2.5 py-1 rounded">Workers</button>
            <button onclick="switchAdminTab('attendance')" class="bg-slate-700 px-2.5 py-1 rounded">Logs</button>
            <button onclick="switchAdminTab('advance')" class="bg-slate-700 px-2.5 py-1 rounded">Advance</button>
            <button onclick="switchAdminTab('announce')" class="bg-slate-700 px-2.5 py-1 rounded">Notice</button>
            <button onclick="switchAdminTab('settings')" class="bg-slate-700 px-2.5 py-1 rounded">Config</button>
          </div>
        </div>

        <section id="adm-dash" class="space-y-3">
          <div class="grid grid-cols-2 md:grid-cols-4 gap-2 text-center">
            <div class="bg-slate-800 p-3 rounded-xl border border-slate-700"><p class="text-[10px] text-slate-400">Total Workers</p><h3 id="stat-total" class="text-xl font-bold text-amber-400 mt-1">0</h3></div>
            <div class="bg-slate-800 p-3 rounded-xl border border-slate-700"><p class="text-[10px] text-slate-400">Present Today</p><h3 id="stat-present" class="text-xl font-bold text-emerald-400 mt-1">0</h3></div>
            <div class="bg-slate-800 p-3 rounded-xl border border-slate-700"><p class="text-[10px] text-slate-400">Absent Today</p><h3 id="stat-absent" class="text-xl font-bold text-red-400 mt-1">0</h3></div>
            <div class="bg-slate-800 p-3 rounded-xl border border-slate-700"><p class="text-[10px] text-slate-400">Total Advance</p><h3 id="stat-advance" class="text-xl font-bold text-purple-400 mt-1">₱0</h3></div>
          </div>
        </section>

        <section id="adm-workers" class="hidden space-y-3">
          <div class="bg-slate-800 p-4 rounded-xl space-y-3 border border-slate-700">
            <h2 class="text-sm font-bold text-amber-400">Register New Worker</h2>
            <form id="worker-form" onsubmit="addWorker(event)" class="grid grid-cols-1 md:grid-cols-3 gap-2">
              <input type="text" id="wid" placeholder="Worker ID (e.g. W-003)" required class="bg-slate-700 border border-slate-600 p-2 rounded text-white text-xs">
              <input type="text" id="wname" placeholder="Full Name" required class="bg-slate-700 border border-slate-600 p-2 rounded text-white text-xs">
              <input type="text" id="wpos" placeholder="Position (e.g. Mason)" required class="bg-slate-700 border border-slate-600 p-2 rounded text-white text-xs">
              <input type="text" id="wcontact" placeholder="Contact Number" class="bg-slate-700 border border-slate-600 p-2 rounded text-white text-xs">
              <input type="number" id="wrate" placeholder="Daily Rate (₱)" required class="bg-slate-700 border border-slate-600 p-2 rounded text-white text-xs">
              <input type="text" id="wproject" placeholder="Assigned Project" class="bg-slate-700 border border-slate-600 p-2 rounded text-white text-xs">
              <button type="submit" id="save-worker-btn" class="bg-emerald-600 hover:bg-emerald-500 font-bold p-2 rounded col-span-full text-xs">Save Worker & QR</button>
            </form>
          </div>
          <div class="bg-slate-800 p-4 rounded-xl space-y-3 border border-slate-700">
            <h2 class="text-sm font-bold text-amber-400">Workers List</h2>
            <div class="overflow-x-auto"><table class="w-full text-left text-xs">
              <thead><tr class="bg-slate-700 text-slate-300 border-b border-slate-600"><th class="p-2">ID</th><th class="p-2">Name</th><th class="p-2">Position</th><th class="p-2">Project</th><th class="p-2">Rate</th><th class="p-2">QR Code</th></tr></thead>
              <tbody id="worker-table" class="divide-y divide-slate-700"></tbody>
            </table></div>
          </div>
        </section>

        <section id="adm-attendance" class="hidden bg-slate-800 p-4 rounded-xl space-y-3 border border-slate-700">
          <h2 class="text-sm font-bold text-amber-400">Attendance Logs</h2>
          <div class="overflow-x-auto"><table class="w-full text-left text-xs">
            <thead><tr class="bg-slate-700 text-slate-300 border-b border-slate-600"><th class="p-2">Worker Name</th><th class="p-2">Date</th><th class="p-2">Time In</th><th class="p-2">Time Out</th><th class="p-2">Status</th></tr></thead>
            <tbody id="attendance-table" class="divide-y divide-slate-700"></tbody>
          </table></div>
        </section>

        <section id="adm-advance" class="hidden space-y-3">
          <div class="bg-slate-800 p-4 rounded-xl space-y-3 border border-slate-700">
            <h2 class="text-sm font-bold text-amber-400">Add Advance Money</h2>
            <form onsubmit="addAdvance(event)" class="grid grid-cols-1 md:grid-cols-3 gap-2">
              <select id="adv-worker" required class="bg-slate-700 border border-slate-600 p-2 rounded text-white text-xs"></select>
              <input type="number" id="adv-amount" placeholder="Amount (₱)" required class="bg-slate-700 border border-slate-600 p-2 rounded text-white text-xs">
              <input type="text" id="adv-reason" placeholder="Reason (Optional)" class="bg-slate-700 border border-slate-600 p-2 rounded text-white text-xs">
              <button type="submit" class="bg-purple-600 hover:bg-purple-500 font-bold p-2 rounded col-span-full text-xs">Record Advance</button>
            </form>
          </div>
          <div class="bg-slate-800 p-4 rounded-xl space-y-3 border border-slate-700">
            <h2 class="text-sm font-bold text-amber-400">Advances History</h2>
            <div class="overflow-x-auto"><table class="w-full text-left text-xs">
              <thead><tr class="bg-slate-700 text-slate-300 border-b border-slate-600"><th class="p-2">Worker</th><th class="p-2">Amount</th><th class="p-2">Reason</th><th class="p-2">Status</th><th class="p-2">Date</th></tr></thead>
              <tbody id="advance-table" class="divide-y divide-slate-700"></tbody>
            </table></div>
          </div>
        </section>

        <section id="adm-announce" class="hidden space-y-3">
          <div class="bg-slate-800 p-4 rounded-xl space-y-3 border border-slate-700">
            <h2 class="text-sm font-bold text-amber-400">Post Announcement</h2>
            <form onsubmit="postAnnouncement(event)" class="space-y-2">
              <input type="text" id="ann-title" placeholder="Title" required class="bg-slate-700 border border-slate-600 p-2 rounded w-full text-white text-xs">
              <textarea id="ann-msg" placeholder="Message for workers..." required class="bg-slate-700 border border-slate-600 p-2 rounded w-full text-white text-xs"></textarea>
              <button type="submit" class="bg-blue-600 hover:bg-blue-500 font-bold p-2 rounded w-full text-xs">Publish</button>
            </form>
          </div>
        </section>

        <section id="adm-settings" class="hidden bg-slate-800 p-4 rounded-xl space-y-3 border border-slate-700">
          <h2 class="text-sm font-bold text-amber-400">Company Settings</h2>
          <form onsubmit="saveSettings(event)" class="space-y-2">
            <div><label class="text-[10px] text-slate-400">Company Name</label><input type="text" id="set-name" value="${company.company_name}" required class="bg-slate-700 border border-slate-600 p-2 rounded w-full text-white text-xs"></div>
            <div><label class="text-[10px] text-slate-400">Logo URL</label><input type="text" id="set-logo" value="${company.logo_url}" class="bg-slate-700 border border-slate-600 p-2 rounded w-full text-white text-xs"></div>
            <div><label class="text-[10px] text-slate-400">Address</label><input type="text" id="set-address" value="${company.address}" class="bg-slate-700 border border-slate-600 p-2 rounded w-full text-white text-xs"></div>
            <div><label class="text-[10px] text-slate-400">Contact Number</label><input type="text" id="set-contact" value="${company.contact_number}" class="bg-slate-700 border border-slate-600 p-2 rounded w-full text-white text-xs"></div>
            <button type="submit" class="bg-emerald-600 hover:bg-emerald-500 font-bold p-2 rounded w-full text-xs">Save Changes</button>
          </form>
        </section>
      </div>
      <script>
        function switchAdminTab(tab) {
          ['dash', 'workers', 'attendance', 'advance', 'announce', 'settings'].forEach(t => {
            const el = document.getElementById('adm-' + t);
            if(el) el.classList.add('hidden');
          });
          const target = document.getElementById('adm-' + tab);
          if(target) target.classList.remove('hidden');
          if(tab === 'dash') loadDashboardStats();
          if(tab === 'workers') loadWorkers();
          if(tab === 'attendance') loadAttendance();
          if(tab === 'advance') loadAdvances();
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
        async function addWorker(e) {
          e.preventDefault();
          const btn = document.getElementById('save-worker-btn');
          btn.disabled = true;
          btn.innerText = 'Saving...';
          
          const body = {
            worker_id: document.getElementById('wid').value.trim(),
            full_name: document.getElementById('wname').value.trim(),
            position: document.getElementById('wpos').value.trim(),
            contact_number: document.getElementById('wcontact').value.trim(),
            daily_rate: document.getElementById('wrate').value.trim(),
            assigned_project: document.getElementById('wproject').value.trim()
          };

          try {
            const res = await fetch('/api/workers', { 
              method: 'POST', 
              headers: {'Content-Type':'application/json'}, 
              body: JSON.stringify(body) 
            });
            const result = await res.json();
            if(res.ok) {
              alert('Worker successfully registered!');
              document.getElementById('worker-form').reset();
              loadWorkers();
            } else {
              alert('Error: ' + (result.error || 'Hindi ma-save ang worker.'));
            }
          } catch(err) {
            alert('Network error. Subukan ulit.');
          } finally {
            btn.disabled = false;
            btn.innerText = 'Save Worker & QR';
          }
        }
        async function loadAttendance() {
          try {
            const res = await fetch('/api/admin/attendance'); const data = await res.json();
            const tbody = document.getElementById('attendance-table'); tbody.innerHTML = '';
            data.forEach(a => {
              tbody.innerHTML += '<tr><td class="p-2 font-semibold">' + a.full_name + '</td><td class="p-2">' + a.date + '</td><td class="p-2 text-blue-400">' + (a.time_in ? new Date(a.time_in).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}) : '-') + '</td><td class="p-2 text-purple-400">' + (a.time_out ? new Date(a.time_out).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}) : '—') + '</td><td class="p-2 text-emerald-400">' + a.status + '</td></tr>';
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
          if(res.ok) { alert('Advance Recorded!'); switchAdminTab('advance'); }
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
    </head>
    <body class="bg-slate-900 text-white min-h-screen p-3 flex flex-col items-center justify-center">
      <div class="max-w-md w-full bg-slate-800 p-5 rounded-2xl shadow-xl space-y-3 text-center border border-slate-700">
        ${company.logo_url ? `<img src="${company.logo_url}" class="w-10 h-10 rounded-full object-cover mx-auto border-2 border-purple-400">` : '👷'}
        <h1 class="text-base font-bold text-purple-400">${company.company_name}</h1>
        <p class="text-[10px] text-slate-400">ILAGAY ANG WORKER ID</p>
        <div class="flex gap-2">
          <input type="text" id="worker-id-input" placeholder="e.g. W-001" class="bg-slate-700 border border-slate-600 p-2 rounded w-full text-center font-bold uppercase text-white text-xs">
          <button onclick="checkWorker()" class="bg-purple-600 hover:bg-purple-500 px-3 rounded font-bold text-xs">Login</button>
        </div>
        <div id="worker-dashboard" class="hidden text-left space-y-2 mt-3 bg-slate-700/40 p-3 rounded-xl text-xs border border-slate-600"></div>
      </div>
      <script>
        async function checkWorker() {
          const id = document.getElementById('worker-id-input').value.trim();
          if(!id) return;
          const box = document.getElementById('worker-dashboard');
          box.classList.remove('hidden');
          box.innerHTML = '<div class="text-center text-slate-400">Naglo-load...</div>';
          
          try {
            const res = await fetch('/api/worker/' + encodeURIComponent(id));
            const data = await res.json();
            if(res.ok) {
              let attStatus = '<span class="text-red-400 font-bold">WALA PA / ABSENT</span>';
              if(data.today_attendance) {
                attStatus = '<span class="text-emerald-400 font-bold">PRESENT (In: ' + new Date(data.today_attendance.time_in).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}) + ')</span>';
              }
              
              let annHTML = '';
              if(data.announcements.length > 0) {
                annHTML = '<div class="mt-2 p-2 bg-slate-800 rounded border border-slate-600"><div class="font-bold text-amber-400 text-[11px]">📢 ' + data.announcements[0].title + '</div><div class="text-[10px] text-slate-300">' + data.announcements[0].message + '</div></div>';
              }

              box.innerHTML = '<div class="text-center pb-2 border-b border-slate-600"><div class="font-extrabold text-amber-300 text-sm">' + data.worker.full_name + '</div><div class="text-[10px] text-slate-300">' + data.worker.position + ' | ID: ' + data.worker.worker_id + '</div></div>' +
                '<div><b>Today:</b> ' + attStatus + '</div>' +
                '<div><b>Daily Rate:</b> ₱' + data.worker.daily_rate + '</div>' +
                '<div><b>Total Salary:</b> ₱' + data.salary.total_salary.toLocaleString() + ' (' + data.salary.days_worked + ' days)</div>' +
                '<div><b>Advance Deducted:</b> ₱' + data.salary.advance.toLocaleString() + '</div>' +
                '<div class="font-bold text-emerald-400 text-sm">NET SALARY: ₱' + data.salary.net_salary.toLocaleString() + '</div>' +
                '<div class="text-center pt-1"><p class="text-[10px] text-slate-400 mb-1">QR CODE ID:</p><div class="bg-white p-2 inline-block rounded text-slate-900 font-mono font-black text-sm tracking-widest">' + data.worker.qr_code + '</div></div>' +
                annHTML;
            } else {
              box.innerHTML = '<div class="text-red-400 font-bold text-center">' + (data.error || 'Hindi makita ang worker.') + '</div>';
            }
          } catch(err) {
            box.innerHTML = '<div class="text-red-400 font-bold text-center">May problema sa koneksyon. Subukang muli.</div>';
          }
        }
      </script>
    </body>
    </html>
  `);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`System running smoothly on port ${PORT}`));
