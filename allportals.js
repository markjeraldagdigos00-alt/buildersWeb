const express = require('express');
const { Pool } = require('pg');
const QRCode = require('qrcode');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Database Configuration using Render environment variable
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// Initialize Database Tables Automatically on Startup
async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS company_settings (
        id SERIAL PRIMARY KEY,
        company_name VARCHAR(255) DEFAULT 'BuildCorp Construction',
        logo_url TEXT DEFAULT '',
        address VARCHAR(255) DEFAULT '123 Construction Ave, City',
        contact_number VARCHAR(50) DEFAULT '555-0199'
      );

      CREATE TABLE IF NOT EXISTS work_schedules (
        id SERIAL PRIMARY KEY,
        morning_start VARCHAR(10) DEFAULT '07:00',
        morning_end VARCHAR(10) DEFAULT '12:00',
        afternoon_start VARCHAR(10) DEFAULT '13:00',
        afternoon_end VARCHAR(10) DEFAULT '17:00',
        full_day_hours NUMERIC DEFAULT 8,
        half_day_hours NUMERIC DEFAULT 4
      );

      CREATE TABLE IF NOT EXISTS workers (
        id SERIAL PRIMARY KEY,
        worker_id VARCHAR(50) UNIQUE NOT NULL,
        full_name VARCHAR(255) NOT NULL,
        position VARCHAR(100) NOT NULL,
        contact_number VARCHAR(50),
        daily_rate NUMERIC(10,2) NOT NULL DEFAULT 0,
        assigned_project VARCHAR(255),
        profile_picture TEXT,
        qr_code TEXT,
        status VARCHAR(20) DEFAULT 'Active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS attendance_logs (
        id SERIAL PRIMARY KEY,
        worker_id VARCHAR(50) NOT NULL,
        attendance_date DATE NOT NULL,
        attendance_time TIME NOT NULL,
        attendance_type VARCHAR(10) NOT NULL, -- IN or OUT
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS advance_money (
        id SERIAL PRIMARY KEY,
        worker_id VARCHAR(50) NOT NULL,
        amount NUMERIC(10,2) NOT NULL,
        advance_date DATE NOT NULL,
        reason TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS announcements (
        id SERIAL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        message TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS materials (
        id SERIAL PRIMARY KEY,
        material_name VARCHAR(255) NOT NULL,
        category VARCHAR(100) NOT NULL,
        unit VARCHAR(50) NOT NULL,
        current_quantity NUMERIC(10,2) NOT NULL DEFAULT 0,
        minimum_stock_level NUMERIC(10,2) NOT NULL DEFAULT 0,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS stock_transactions (
        id SERIAL PRIMARY KEY,
        material_id INT NOT NULL,
        transaction_type VARCHAR(10) NOT NULL, -- IN or OUT
        quantity NUMERIC(10,2) NOT NULL,
        transaction_date DATE NOT NULL,
        transaction_time TIME NOT NULL,
        supplier VARCHAR(255),
        issued_to VARCHAR(255),
        project VARCHAR(255),
        purpose TEXT,
        notes TEXT,
        recorded_from VARCHAR(50) NOT NULL,
        stock_after_transaction NUMERIC(10,2) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Insert Default Settings if empty
    const settingsCheck = await pool.query('SELECT * FROM company_settings WHERE id = 1');
    if (settingsCheck.rows.length === 0) {
      await pool.query(`INSERT INTO company_settings (company_name, logo_url, address, contact_number) VALUES ('BuildCorp Construction', '', '123 Main Street', '555-0199')`);
    }

    const scheduleCheck = await pool.query('SELECT * FROM work_schedules WHERE id = 1');
    if (scheduleCheck.rows.length === 0) {
      await pool.query(`INSERT INTO work_schedules (morning_start, morning_end, afternoon_start, afternoon_end, full_day_hours, half_day_hours) VALUES ('07:00', '12:00', '13:00', '17:00', 8, 4)`);
    }

    console.log("Database tables verified/initialized successfully.");
  } catch (err) {
    console.error("Database initialization error:", err);
  }
}

initDB();

// Helper: Get Company Settings
async function getSettings() {
  const res = await pool.query('SELECT * FROM company_settings WHERE id = 1');
  return res.rows[0] || { company_name: 'BuildCorp Construction', logo_url: '', address: '', contact_number: '' };
}

// Helper: Generate Worker ID
async function generateWorkerID() {
  const res = await pool.query('SELECT worker_id FROM workers ORDER BY id DESC LIMIT 1');
  if (res.rows.length === 0) return 'W-0001';
  const lastIdNum = parseInt(res.rows[0].worker_id.split('-')[1]);
  const nextNum = lastIdNum + 1;
  return `W-${String(nextNum).padStart(4, '0')}`;
}

// Helper: Calculate Worker Attendance Status & Hours for a specific date
async function getAttendanceSummary(workerId, dateStr) {
  const logsRes = await pool.query(
    'SELECT * FROM attendance_logs WHERE worker_id = $1 AND attendance_date = $2 ORDER BY attendance_time ASC',
    [workerId, dateStr]
  );
  const logs = logsRes.rows;
  if (logs.length === 0) return { status: 'ABSENT', hours: 0, logs: [] };

  let totalMinutes = 0;
  let lastInTime = null;
  let hasIncomplete = false;

  for (let log of logs) {
    if (log.attendance_type === 'IN') {
      if (lastInTime !== null) hasIncomplete = true;
      lastInTime = log.attendance_time;
    } else if (log.attendance_type === 'OUT') {
      if (lastInTime === null) {
        hasIncomplete = true;
      } else {
        // Calculate difference, subtract lunch break if spans across 12:00 to 13:00
        const inParts = lastInTime.split(':').map(Number);
        const outParts = log.attendance_time.split(':').map(Number);
        let inMins = inParts[0] * 60 + inParts[1];
        let outMins = outParts[0] * 60 + outParts[1];
        
        // Remove lunch break overlap (12:00 [720 mins] to 13:00 [780 mins])
        let diff = outMins - inMins;
        if (inMins < 780 && outMins > 720) {
          const overlapStart = Math.max(inMins, 720);
          const overlapEnd = Math.min(outMins, 780);
          if (overlapEnd > overlapStart) {
            diff -= (overlapEnd - overlapStart);
          }
        }
        if (diff > 0) totalMinutes += diff;
        lastInTime = null;
      }
    }
  }

  if (lastInTime !== null) hasIncomplete = true;

  const hours = parseFloat((totalMinutes / 60).toFixed(2));
  let status = 'PRESENT';
  if (hasIncomplete && logs.length % 2 !== 0) status = 'INCOMPLETE';
  else if (hours >= 7) status = 'FULL DAY';
  else if (hours >= 3.5) status = 'HALF DAY';
  else status = 'INCOMPLETE';

  return { status, hours, logs };
}

// Shared Global UI Layout wrapper
async function renderLayout(title, content, activeTab = '') {
  const settings = await getSettings();
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${title} - ${settings.company_name}</title>
      <style>
        :root {
          --primary: #f59e0b;
          --primary-dark: #d97706;
          --dark: #1e293b;
          --light: #f8fafc;
          --danger: #ef4444;
          --success: #10b981;
          --gray: #64748b;
        }
        * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; }
        body { background-color: #f1f5f9; color: var(--dark); line-height: 1.6; }
        header { background: var(--dark); color: white; padding: 1rem 2rem; display: flex; justify-content: space-between; align-items: center; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .brand { display: flex; align-items: center; gap: 15px; }
        .brand img { height: 45px; width: 45px; object-fit: contain; border-radius: 5px; background: white; padding: 2px; }
        .brand h1 { font-size: 1.3rem; font-weight: 600; color: white; }
        .nav-links { display: flex; gap: 15px; align-items: center; }
        .nav-links a { color: #cbd5e1; text-decoration: none; font-size: 0.9rem; transition: color 0.2s; }
        .nav-links a:hover, .nav-links a.active { color: var(--primary); }
        .container { max-width: 1200px; margin: 2rem auto; padding: 0 1rem; }
        .card { background: white; border-radius: 8px; padding: 1.5rem; box-shadow: 0 1px 3px rgba(0,0,0,0.1); margin-bottom: 1.5rem; }
        h2, h3 { margin-bottom: 1rem; color: var(--dark); }
        .btn { display: inline-block; background: var(--primary); color: white; padding: 0.6rem 1.2rem; border-radius: 6px; text-decoration: none; font-weight: 600; border: none; cursor: pointer; transition: background 0.2s; }
        .btn:hover { background: var(--primary-dark); }
        .btn-danger { background: var(--danger); }
        .btn-danger:hover { background: #dc2626; }
        .btn-success { background: var(--success); }
        .btn-success:hover { background: #059669; }
        .btn-secondary { background: var(--gray); color: white; }
        .btn-secondary:hover { background: #475569; }
        table { width: 100%; border-collapse: collapse; margin-top: 1rem; }
        th, td { padding: 0.75rem; text-align: left; border-bottom: 1px solid #e2e8f0; font-size: 0.95rem; }
        th { background: #f8fafc; font-weight: 600; color: var(--gray); }
        .form-group { margin-bottom: 1rem; }
        label { display: block; margin-bottom: 0.5rem; font-weight: 500; font-size: 0.9rem; }
        input, select, textarea { width: 100%; padding: 0.7rem; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 1rem; }
        input:focus, select:focus, textarea:focus { outline: none; border-color: var(--primary); box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.1); }
        .grid-2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1.5rem; }
        .grid-4 { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1rem; }
        .stat-card { background: white; padding: 1.2rem; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); border-left: 4px solid var(--primary); }
        .stat-card h4 { font-size: 0.85rem; color: var(--gray); text-transform: uppercase; margin-bottom: 0.5rem; }
        .stat-card .value { font-size: 1.8rem; font-weight: 700; color: var(--dark); }
        .badge { display: inline-block; padding: 0.25rem 0.6rem; font-size: 0.75rem; font-weight: 600; border-radius: 9999px; }
        .badge-success { background: #d1fae5; color: #065f46; }
        .badge-danger { background: #fee2e2; color: #991b1b; }
        .badge-warning { background: #fef3c7; color: #92400e; }
        .badge-info { background: #e0f2fe; color: #0369a1; }
        .flex-between { display: flex; justify-content: space-between; align-items: center; }
        .text-center { text-align: center; }
        .mt-2 { margin-top: 1rem; }
        @media(max-width: 768px) { header { flex-direction: column; gap: 10px; text-align: center; } .nav-links { flex-wrap: wrap; justify-content: center; } }
      </style>
    </head>
    <body>
      <header>
        <div class="brand">
          ${settings.logo_url ? `<img src="${settings.logo_url}" alt="Logo">` : `<img src="https://api.iconify.design/lucide:hard-hat.svg?color=%23f59e0b" alt="Logo">`}
          <h1>${settings.company_name}</h1>
        </div>
        <div class="nav-links">
          <a href="/">Main Page</a>
          <a href="/admin">Admin</a>
          <a href="/worker">Worker Portal</a>
          <a href="/scanner">Scanner</a>
        </div>
      </header>
      <div class="container">
        ${content}
      </div>
    </body>
    </html>
  `;
}

// ==========================================
// 1. MAIN PAGE ( / )
// ==========================================
app.get('/', async (req, res) => {
  const settings = await getSettings();
  const html = `
    <div style="text-align: center; padding: 4rem 1rem;">
      ${settings.logo_url ? `<img src="${settings.logo_url}" alt="Logo" style="height: 90px; width: 90px; object-fit: contain; margin-bottom: 1.5rem; border-radius: 12px; background: white; padding: 5px; box-shadow: 0 4px 6px rgba(0,0,0,0.05);">` : `<div style="font-size: 4rem; margin-bottom: 1rem;">🏗️</div>`}
      <h1 style="font-size: 2.5rem; color: var(--dark); margin-bottom: 0.5rem;">${settings.company_name}</h1>
      <p style="color: var(--gray); font-size: 1.1rem; margin-bottom: 3rem;">Construction Worker & Inventory Management System</p>
      
      <div style="display: flex; justify-content: center; gap: 20px; flex-wrap: wrap; max-width: 800px; margin: 0 auto;">
        <a href="/admin" class="btn" style="padding: 1.2rem 2.5rem; font-size: 1.1rem; flex: 1; min-width: 220px; text-align: center;">👑 ADMIN PORTAL</a>
        <a href="/worker" class="btn btn-success" style="padding: 1.2rem 2.5rem; font-size: 1.1rem; flex: 1; min-width: 220px; text-align: center;">👷 WORKER PORTAL</a>
        <a href="/scanner" class="btn btn-secondary" style="padding: 1.2rem 2.5rem; font-size: 1.1rem; flex: 1; min-width: 220px; text-align: center;">📷 ATTENDANCE & STOCK SCANNER</a>
      </div>
    </div>
  `;
  res.send(await renderLayout('Main Page', html));
});

// ==========================================
// 2. ADMIN PORTAL ( /admin )
// ==========================================
app.get('/admin', async (req, res) => {
  const tab = req.query.tab || 'dashboard';
  const todayStr = new Date().toISOString().split('T')[0];

  let content = `
    <div class="card" style="background: var(--dark); color: white; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 15px;">
      <div>
        <h2 style="color: white; margin-bottom: 5px;">Admin Control Panel</h2>
        <p style="color: #94a3b8; font-size: 0.9rem;">Manage workforce, inventory, payroll, and company settings.</p>
      </div>
      <div style="display: flex; gap: 8px; flex-wrap: wrap;">
        <a href="/admin?tab=dashboard" class="btn ${tab === 'dashboard' ? '' : 'btn-secondary'}">Dashboard</a>
        <a href="/admin?tab=workers" class="btn ${tab === 'workers' ? '' : 'btn-secondary'}">Workers</a>
        <a href="/admin?tab=attendance" class="btn ${tab === 'attendance' ? '' : 'btn-secondary'}">Attendance</a>
        <a href="/admin?tab=inventory" class="btn ${tab === 'inventory' ? '' : 'btn-secondary'}">Stock Inventory</a>
        <a href="/admin?tab=advance" class="btn ${tab === 'advance' ? '' : 'btn-secondary'}">Advance Money</a>
        <a href="/admin?tab=salary" class="btn ${tab === 'salary' ? '' : 'btn-secondary'}">Salary</a>
        <a href="/admin?tab=announcements" class="btn ${tab === 'announcements' ? '' : 'btn-secondary'}">Announcements</a>
        <a href="/admin?tab=settings" class="btn ${tab === 'settings' ? '' : 'btn-secondary'}">Settings</a>
        <a href="/admin?tab=schedule" class="btn ${tab === 'schedule' ? '' : 'btn-secondary'}">Work Schedule</a>
        <a href="/" class="btn btn-danger">Exit</a>
      </div>
    </div>
  `;

  if (tab === 'dashboard') {
    const workersRes = await pool.query('SELECT * FROM workers');
    const workers = workersRes.rows;
    let presentToday = 0, fullToday = 0, halfToday = 0, absentToday = 0;

    for (let w of workers) {
      const summary = await getAttendanceSummary(w.worker_id, todayStr);
      if (summary.status === 'FULL DAY') { presentToday++; fullToday++; }
      else if (summary.status === 'HALF DAY') { presentToday++; halfToday++; }
      else if (summary.status === 'PRESENT') { presentToday++; }
      else { absentToday++; }
    }

    const materialsRes = await pool.query('SELECT * FROM materials');
    const materials = materialsRes.rows;
    const lowStock = materials.filter(m => parseFloat(m.current_quantity) <= parseFloat(m.minimum_stock_level));

    const stockInRecent = await pool.query("SELECT * FROM stock_transactions WHERE transaction_type = 'IN' ORDER BY created_at DESC LIMIT 5");
    const stockOutRecent = await pool.query("SELECT * FROM stock_transactions WHERE transaction_type = 'OUT' ORDER BY created_at DESC LIMIT 5");

    content += `
      <h3 class="mt-2">Worker Statistics</h3>
      <div class="grid-4">
        <div class="stat-card"><h4>Total Workers</h4><div class="value">${workers.length}</div></div>
        <div class="stat-card" style="border-left-color: var(--success);"><h4>Present Today</h4><div class="value">${presentToday}</div></div>
        <div class="stat-card" style="border-left-color: #3b82f6;"><h4>Full Day</h4><div class="value">${fullToday}</div></div>
        <div class="stat-card" style="border-left-color: var(--danger);"><h4>Absent Today</h4><div class="value">${absentToday}</div></div>
      </div>

      <h3 class="mt-2" style="margin-top: 2rem;">Stock Statistics</h3>
      <div class="grid-4">
        <div class="stat-card"><h4>Total Materials</h4><div class="value">${materials.length}</div></div>
        <div class="stat-card" style="border-left-color: var(--danger);"><h4>Low Stock Items</h4><div class="value">${lowStock.length}</div></div>
        <div class="stat-card" style="border-left-color: var(--success);"><h4>Recent Stock IN</h4><div class="value">${stockInRecent.rows.length}</div></div>
        <div class="stat-card" style="border-left-color: var(--primary);"><h4>Recent Stock OUT</h4><div class="value">${stockOutRecent.rows.length}</div></div>
      </div>

      ${lowStock.length > 0 ? `
        <div class="card mt-2" style="border-left: 5px solid var(--danger); background: #fef2f2;">
          <h3 style="color: var(--danger);">⚠️ Low Stock Alerts</h3>
          <table>
            <tr><th>Material</th><th>Category</th><th>Current</th><th>Minimum</th><th>Unit</th></tr>
            ${lowStock.map(m => `<tr><td><b>${m.material_name}</b></td><td>${m.category}</td><td style="color:red; font-weight:bold;">${m.current_quantity}</td><td>${m.minimum_stock_level}</td><td>${m.unit}</td></tr>`).join('')}
          </table>
        </div>
      ` : ''}
    `;
  } else if (tab === 'workers') {
    const search = req.query.search || '';
    const queryStr = search ? `SELECT * FROM workers WHERE full_name ILIKE $1 OR worker_id ILIKE $1 OR position ILIKE $1 ORDER BY id DESC` : `SELECT * FROM workers ORDER BY id DESC`;
    const workers = (await pool.query(queryStr, search ? [`%${search}%`] : [])).rows;

    content += `
      <div class="card">
        <div class="flex-between">
          <h3>Worker Management</h3>
          <button class="btn" onclick="document.getElementById('addWorkerModal').style.display='block'">+ Register New Worker</button>
        </div>
        <form method="GET" action="/admin" style="margin-top: 1rem; display: flex; gap: 10px;">
          <input type="hidden" name="tab" value="workers">
          <input type="text" name="search" placeholder="Search by name, ID or position..." value="${search}">
          <button type="submit" class="btn">Search</button>
        </form>
        <table>
          <tr><th>ID</th><th>Name</th><th>Position</th><th>Daily Rate</th><th>Project</th><th>Status</th><th>Actions</th></tr>
          ${workers.map(w => `
            <tr>
              <td><b>${w.worker_id}</b></td>
              <td>${w.full_name}</td>
              <td>${w.position}</td>
              <td>₱${w.daily_rate}</td>
              <td>${w.assigned_project || 'None'}</td>
              <td><span class="badge ${w.status === 'Active' ? 'badge-success' : 'badge-danger'}">${w.status}</span></td>
              <td>
                <a href="/admin/worker-profile?id=${w.worker_id}" class="btn" style="padding: 0.3rem 0.6rem; font-size: 0.8rem;">Profile & QR</a>
                <a href="/admin/toggle-worker?id=${w.worker_id}" class="btn btn-secondary" style="padding: 0.3rem 0.6rem; font-size: 0.8rem;">${w.status === 'Active' ? 'Deactivate' : 'Activate'}</a>
                <a href="/admin/delete-worker?id=${w.worker_id}" class="btn btn-danger" style="padding: 0.3rem 0.6rem; font-size: 0.8rem;" onclick="return confirm('Delete worker?')">Delete</a>
              </td>
            </tr>
          `).join('')}
        </table>
      </div>

      <!-- Add Worker Modal -->
      <div id="addWorkerModal" style="display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); overflow-y:auto; padding: 2rem;">
        <div class="card" style="max-width: 600px; margin: 0 auto; background: white;">
          <div class="flex-between"><h3>Register New Worker</h3><button onclick="document.getElementById('addWorkerModal').style.display='none'" class="btn btn-danger" style="padding:0.2rem 0.6rem;">X</button></div>
          <form method="POST" action="/admin/add-worker">
            <div class="form-group"><label>Full Name</label><input type="text" name="full_name" required></div>
            <div class="form-group"><label>Position</label><input type="text" name="position" required placeholder="e.g. Mason, Carpenter"></div>
            <div class="form-group"><label>Contact Number</label><input type="text" name="contact_number"></div>
            <div class="form-group"><label>Daily Rate (₱)</label><input type="number" step="0.01" name="daily_rate" required></div>
            <div class="form-group"><label>Assigned Project</label><input type="text" name="assigned_project"></div>
            <div class="form-group"><label>Profile Picture URL (Optional)</label><input type="text" name="profile_picture" placeholder="https://..."></div>
            <button type="submit" class="btn">Register Worker & Generate QR</button>
          </form>
        </div>
      </div>
    `;
  } else if (tab === 'attendance') {
    const dateQuery = req.query.date || todayStr;
    const search = req.query.search || '';
    const workersRes = await pool.query('SELECT * FROM workers ORDER BY full_name ASC');
    const workers = workersRes.rows;

    content += `
      <div class="card">
        <h3>Daily & History Attendance Management</h3>
        <form method="GET" action="/admin" style="display: flex; gap: 10px; margin-top: 1rem; flex-wrap: wrap;">
          <input type="hidden" name="tab" value="attendance">
          <input type="date" name="date" value="${dateQuery}" style="max-width: 200px;">
          <input type="text" name="search" placeholder="Search worker name..." value="${search}" style="max-width: 250px;">
          <button type="submit" class="btn">Filter Attendance</button>
        </form>
        <table>
          <tr><th>Worker ID</th><th>Name</th><th>Position</th><th>Date</th><th>All Records (IN / OUT)</th><th>Hours</th><th>Status</th></tr>
          ${await Promise.all(workers.map(async w => {
            if (search && !w.full_name.toLowerCase().includes(search.toLowerCase()) && !w.worker_id.toLowerCase().includes(search.toLowerCase())) return '';
            const summary = await getAttendanceSummary(w.worker_id, dateQuery);
            let badgeClass = 'badge-success';
            if (summary.status === 'ABSENT') badgeClass = 'badge-danger';
            else if (summary.status === 'HALF DAY') badgeClass = 'badge-warning';
            else if (summary.status === 'INCOMPLETE') badgeClass = 'badge-info';

            return `
              <tr>
                <td><b>${w.worker_id}</b></td>
                <td>${w.full_name}</td>
                <td>${w.position}</td>
                <td>${dateQuery}</td>
                <td>${summary.logs.map(l => `${l.attendance_type}: ${l.attendance_time}`).join(' | ') || 'No Records'}</td>
                <td><b>${summary.hours} hrs</b></td>
                <td><span class="badge ${badgeClass}">${summary.status}</span></td>
              </tr>
            `;
          })).then(arr => arr.join(''))}
        </table>
      </div>
    `;
  } else if (tab === 'inventory') {
    const materials = (await pool.query('SELECT * FROM materials ORDER BY material_name ASC')).rows;
    const stockHistory = (await pool.query('SELECT * FROM stock_transactions ORDER BY id DESC LIMIT 20')).rows;

    content += `
      <div class="card">
        <div class="flex-between">
          <h3>Stock Inventory</h3>
          <div style="display:flex; gap:10px;">
            <button class="btn" onclick="document.getElementById('addMaterialModal').style.display='block'">+ Add New Material</button>
            <button class="btn btn-success" onclick="document.getElementById('stockInModal').style.display='block'">Record Stock IN</button>
            <button class="btn btn-danger" onclick="document.getElementById('stockOutModal').style.display='block'">Record Stock OUT</button>
          </div>
        </div>
        <table>
          <tr><th>Material Name</th><th>Category</th><th>Current Stock</th><th>Minimum Level</th><th>Unit</th><th>Status</th></tr>
          ${materials.map(m => {
            const isLow = parseFloat(m.current_quantity) <= parseFloat(m.minimum_stock_level);
            return `
              <tr>
                <td><b>${m.material_name}</b><br><small>${m.notes || ''}</small></td>
                <td>${m.category}</td>
                <td style="font-weight:bold; font-size: 1.1rem;">${m.current_quantity}</td>
                <td>${m.minimum_stock_level}</td>
                <td>${m.unit}</td>
                <td>${isLow ? '<span class="badge badge-danger">LOW STOCK</span>' : '<span class="badge badge-success">SUFFICIENT</span>'}</td>
              </tr>
            `;
          }).join('')}
        </table>
      </div>

      <div class="card mt-2">
        <h3>Recent Stock Movement History</h3>
        <table>
          <tr><th>Date & Time</th><th>Material</th><th>Type</th><th>Qty</th><th>Supplier / Issued To</th><th>Project</th><th>Recorded From</th><th>Stock After</th></tr>
          ${stockHistory.map(tx => `
            <tr>
              <td>${tx.transaction_date} ${tx.transaction_time}</td>
              <td><b>${materials.find(m => m.id === tx.material_id)?.material_name || 'Item'}</b></td>
              <td><span class="badge ${tx.transaction_type === 'IN' ? 'badge-success' : 'badge-danger'}">${tx.transaction_type}</span></td>
              <td><b>${tx.quantity}</b></td>
              <td>${tx.supplier || tx.issued_to || '-'}</td>
              <td>${tx.project || '-'}</td>
              <td><span class="badge badge-info">${tx.recorded_from}</span></td>
              <td><b>${tx.stock_after_transaction}</b></td>
            </tr>
          `).join('')}
        </table>
      </div>

      <!-- Add Material Modal -->
      <div id="addMaterialModal" style="display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); padding:2rem; overflow-y:auto;">
        <div class="card" style="max-width:500px; margin:0 auto; background:white;">
          <div class="flex-between"><h3>Add New Material</h3><button onclick="document.getElementById('addMaterialModal').style.display='none'" class="btn btn-danger" style="padding:0.2rem 0.6rem;">X</button></div>
          <form method="POST" action="/admin/add-material">
            <div class="form-group"><label>Material Name</label><input type="text" name="material_name" required></div>
            <div class="form-group"><label>Category</label><input type="text" name="category" required placeholder="e.g. Cement, Steel"></div>
            <div class="form-group"><label>Unit</label><input type="text" name="unit" required placeholder="e.g. Bags, Pcs, Tons"></div>
            <div class="form-group"><label>Initial Quantity</label><input type="number" step="0.01" name="current_quantity" required value="0"></div>
            <div class="form-group"><label>Minimum Stock Level</label><input type="number" step="0.01" name="minimum_stock_level" required value="10"></div>
            <div class="form-group"><label>Notes</label><textarea name="notes"></textarea></div>
            <button type="submit" class="btn">Save Material</button>
          </form>
        </div>
      </div>

      <!-- Stock IN Modal -->
      <div id="stockInModal" style="display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); padding:2rem; overflow-y:auto;">
        <div class="card" style="max-width:500px; margin:0 auto; background:white;">
          <div class="flex-between"><h3>Record Stock IN</h3><button onclick="document.getElementById('stockInModal').style.display='none'" class="btn btn-danger" style="padding:0.2rem 0.6rem;">X</button></div>
          <form method="POST" action="/admin/stock-in">
            <div class="form-group"><label>Select Material</label>
              <select name="material_id" required>
                ${materials.map(m => `<option value="${m.id}">${m.material_name} (Current: ${m.current_quantity} ${m.unit})</option>`).join('')}
              </select>
            </div>
            <div class="form-group"><label>Quantity Received</label><input type="number" step="0.01" name="quantity" required></div>
            <div class="form-group"><label>Supplier</label><input type="text" name="supplier" required></div>
            <div class="form-group"><label>Delivery Reference / Notes</label><input type="text" name="notes"></div>
            <button type="submit" class="btn btn-success">Confirm Stock IN</button>
          </form>
        </div>
      </div>

      <!-- Stock OUT Modal -->
      <div id="stockOutModal" style="display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); padding:2rem; overflow-y:auto;">
        <div class="card" style="max-width:500px; margin:0 auto; background:white;">
          <div class="flex-between"><h3>Record Stock OUT</h3><button onclick="document.getElementById('stockOutModal').style.display='none'" class="btn btn-danger" style="padding:0.2rem 0.6rem;">X</button></div>
          <form method="POST" action="/admin/stock-out">
            <div class="form-group"><label>Select Material</label>
              <select name="material_id" required>
                ${materials.map(m => `<option value="${m.id}">${m.material_name} (Available: ${m.current_quantity} ${m.unit})</option>`).join('')}
              </select>
            </div>
            <div class="form-group"><label>Quantity Issued</label><input type="number" step="0.01" name="quantity" required></div>
            <div class="form-group"><label>Issued To (Crew / Person)</label><input type="text" name="issued_to" required></div>
            <div class="form-group"><label>Project</label><input type="text" name="project" required></div>
            <div class="form-group"><label>Purpose</label><input type="text" name="purpose" required></div>
            <button type="submit" class="btn btn-danger">Confirm Stock OUT</button>
          </form>
        </div>
      </div>
    `;
  } else if (tab === 'advance') {
    const workers = (await pool.query('SELECT * FROM workers ORDER BY full_name ASC')).rows;
    const advances = (await pool.query('SELECT a.*, w.full_name FROM advance_money a JOIN workers w ON a.worker_id = w.worker_id ORDER BY a.id DESC')).rows;

    content += `
      <div class="card">
        <h3>Advance Money Management</h3>
        <button class="btn" onclick="document.getElementById('addAdvanceModal').style.display='block'">+ Add Advance Money</button>
        <table>
          <tr><th>Worker ID</th><th>Name</th><th>Amount</th><th>Date</th><th>Reason</th></tr>
          ${advances.map(a => `
            <tr>
              <td><b>${a.worker_id}</b></td>
              <td>${a.full_name}</td>
              <td style="color:var(--danger); font-weight:bold;">₱${a.amount}</td>
              <td>${a.advance_date}</td>
              <td>${a.reason || '-'}</td>
            </tr>
          `).join('')}
        </table>
      </div>

      <div id="addAdvanceModal" style="display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); padding:2rem; overflow-y:auto;">
        <div class="card" style="max-width:500px; margin:0 auto; background:white;">
          <div class="flex-between"><h3>Add Advance Money</h3><button onclick="document.getElementById('addAdvanceModal').style.display='none'" class="btn btn-danger" style="padding:0.2rem 0.6rem;">X</button></div>
          <form method="POST" action="/admin/add-advance">
            <div class="form-group"><label>Select Worker</label>
              <select name="worker_id" required>
                ${workers.map(w => `<option value="${w.worker_id}">${w.worker_id} - ${w.full_name}</option>`).join('')}
              </select>
            </div>
            <div class="form-group"><label>Amount (₱)</label><input type="number" step="0.01" name="amount" required></div>
            <div class="form-group"><label>Reason / Notes</label><input type="text" name="reason"></div>
            <button type="submit" class="btn">Save Advance</button>
          </form>
        </div>
      </div>
    `;
  } else if (tab === 'salary') {
    const workers = (await pool.query('SELECT * FROM workers ORDER BY full_name ASC')).rows;
    const monthQuery = req.query.month || new Date().toISOString().slice(0, 7); // YYYY-MM

    content += `
      <div class="card">
        <h3>Salary & Payroll Calculation (${monthQuery})</h3>
        <form method="GET" action="/admin" style="margin-top: 1rem; display:flex; gap:10px;">
          <input type="hidden" name="tab" value="salary">
          <input type="month" name="month" value="${monthQuery}" style="max-width: 250px;">
          <button type="submit" class="btn">Calculate Payroll</button>
        </form>
        <table>
          <tr><th>Worker ID</th><th>Name</th><th>Daily Rate</th><th>Full Days</th><th>Half Days</th><th>Equivalent Days</th><th>Total Salary</th><th>Advance Ded.</th><th>Net Salary</th></tr>
          ${await Promise.all(workers.map(async w => {
            // Calculate days for the month
            let fullDays = 0, halfDays = 0;
            // Scan all days in the month
            const [year, month] = monthQuery.split('-').map(Number);
            const daysInMonth = new Date(year, month, 0).getDate();
            
            for (let d = 1; d <= daysInMonth; d++) {
              const dayStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
              const summary = await getAttendanceSummary(w.worker_id, dayStr);
              if (summary.status === 'FULL DAY') fullDays++;
              else if (summary.status === 'HALF DAY') halfDays++;
            }

            const equivalentDays = fullDays + (halfDays * 0.5);
            const totalSalary = equivalentDays * parseFloat(w.daily_rate);

            // Get total advances for this worker
            const advRes = await pool.query('SELECT SUM(amount) as total FROM advance_money WHERE worker_id = $1', [w.worker_id]);
            const totalAdvance = parseFloat(advRes.rows[0]?.total || 0);
            const netSalary = totalSalary - totalAdvance;

            return `
              <tr>
                <td><b>${w.worker_id}</b></td>
                <td>${w.full_name}</td>
                <td>₱${w.daily_rate}</td>
                <td>${fullDays}</td>
                <td>${halfDays}</td>
                <td><b>${equivalentDays} Days</b></td>
                <td>₱${totalSalary.toFixed(2)}</td>
                <td style="color:var(--danger);">₱${totalAdvance.toFixed(2)}</td>
                <td style="color:var(--success); font-weight:bold;">₱${netSalary.toFixed(2)}</td>
              </tr>
            `;
          })).then(arr => arr.join(''))}
        </table>
      </div>
    `;
  } else if (tab === 'announcements') {
    const announcements = (await pool.query('SELECT * FROM announcements ORDER BY id DESC')).rows;
    content += `
      <div class="card">
        <h3>Company Announcements</h3>
        <form method="POST" action="/admin/add-announcement">
          <div class="form-group"><label>Title</label><input type="text" name="title" required></div>
          <div class="form-group"><label>Message</label><textarea name="message" rows="3" required></textarea></div>
          <button type="submit" class="btn">Post Announcement</button>
        </form>
        <hr style="margin: 2rem 0; border:0; border-top:1px solid #e2e8f0;">
        <table>
          <tr><th>Date</th><th>Title</th><th>Message</th><th>Action</th></tr>
          ${announcements.map(ann => `
            <tr>
              <td>${ann.created_at.toISOString().slice(0, 10)}</td>
              <td><b>${ann.title}</b></td>
              <td>${ann.message}</td>
              <td><a href="/admin/delete-announcement?id=${ann.id}" class="btn btn-danger" style="padding:0.2rem 0.5rem; font-size:0.8rem;">Delete</a></td>
            </tr>
          `).join('')}
        </table>
      </div>
    `;
  } else if (tab === 'settings') {
    const settings = await getSettings();
    content += `
      <div class="card" style="max-width: 600px; margin: 0 auto;">
        <h3>Company Settings</h3>
        <form method="POST" action="/admin/update-settings">
          <div class="form-group"><label>Company Name</label><input type="text" name="company_name" value="${settings.company_name}" required></div>
          <div class="form-group"><label>Company Logo URL</label><input type="text" name="logo_url" value="${settings.logo_url || ''}" placeholder="https://image-link.com/logo.png"></div>
          <div class="form-group"><label>Company Address</label><input type="text" name="address" value="${settings.address || ''}"></div>
          <div class="form-group"><label>Contact Number</label><input type="text" name="contact_number" value="${settings.contact_number || ''}"></div>
          <button type="submit" class="btn">Save Settings</button>
        </form>
      </div>
    `;
  } else if (tab === 'schedule') {
    const schedRes = await pool.query('SELECT * FROM work_schedules WHERE id = 1');
    const sched = schedRes.rows[0];
    content += `
      <div class="card" style="max-width: 600px; margin: 0 auto;">
        <h3>Work Schedule Configuration</h3>
        <form method="POST" action="/admin/update-schedule">
          <div class="form-group"><label>Morning Start Time</label><input type="time" name="morning_start" value="${sched.morning_start}" required></div>
          <div class="form-group"><label>Morning End Time</label><input type="time" name="morning_end" value="${sched.morning_end}" required></div>
          <div class="form-group"><label>Afternoon Start Time</label><input type="time" name="afternoon_start" value="${sched.afternoon_start}" required></div>
          <div class="form-group"><label>Afternoon End Time</label><input type="time" name="afternoon_end" value="${sched.afternoon_end}" required></div>
          <div class="form-group"><label>Full Day Hours Threshold</label><input type="number" step="0.5" name="full_day_hours" value="${sched.full_day_hours}" required></div>
          <div class="form-group"><label>Half Day Hours Threshold</label><input type="number" step="0.5" name="half_day_hours" value="${sched.half_day_hours}" required></div>
          <button type="submit" class="btn">Update Schedule</button>
        </form>
      </div>
    `;
  }

  res.send(await renderLayout('Admin Portal', content));
});

// Admin Actions
app.post('/admin/add-worker', async (req, res) => {
  const { full_name, position, contact_number, daily_rate, assigned_project, profile_picture } = req.body;
  const worker_id = await generateWorkerID();
  const qrData = await QRCode.toDataURL(worker_id);

  await pool.query(
    'INSERT INTO workers (worker_id, full_name, position, contact_number, daily_rate, assigned_project, profile_picture, qr_code) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
    [worker_id, full_name, position, contact_number, daily_rate, assigned_project, profile_picture, qrData]
  );
  res.redirect('/admin?tab=workers');
});

app.get('/admin/toggle-worker', async (req, res) => {
  const { id } = req.query;
  const w = (await pool.query('SELECT status FROM workers WHERE worker_id = $1', [id])).rows[0];
  const newStatus = w.status === 'Active' ? 'Inactive' : 'Active';
  await pool.query('UPDATE workers SET status = $1 WHERE worker_id = $2', [newStatus, id]);
  res.redirect('/admin?tab=workers');
});

app.get('/admin/delete-worker', async (req, res) => {
  const { id } = req.query;
  await pool.query('DELETE FROM workers WHERE worker_id = $1', [id]);
  res.redirect('/admin?tab=workers');
});

app.get('/admin/worker-profile', async (req, res) => {
  const { id } = req.query;
  const w = (await pool.query('SELECT * FROM workers WHERE worker_id = $1', [id])).rows[0];
  const content = `
    <div class="card" style="max-width: 600px; margin: 0 auto; text-align: center;">
      <h3>Worker Profile & QR Code</h3>
      <div style="margin: 1.5rem 0;">
        ${w.profile_picture ? `<img src="${w.profile_picture}" style="width:120px; height:120px; border-radius:50%; object-fit:cover; border:3px solid var(--primary);">` : `<div style="font-size:4rem;">👷</div>`}
      </div>
      <h2>${w.full_name} (${w.worker_id})</h2>
      <p style="color:var(--gray);">${w.position} | Project: ${w.assigned_project || 'None'}</p>
      <p style="margin-top:0.5rem; font-weight:600;">Daily Rate: ₱${w.daily_rate}</p>
      
      <div style="margin: 2rem 0; background: #f8fafc; padding: 1.5rem; display:inline-block; border-radius:8px;">
        <img src="${w.qr_code}" alt="QR Code" style="width: 200px; height: 200px;"><br>
        <a href="${w.qr_code}" download="${w.worker_id}-QR.png" class="btn mt-2" style="font-size:0.9rem;">Download QR Code</a>
      </div>
      <div>
        <a href="/admin?tab=workers" class="btn btn-secondary">Back to Workers</a>
      </div>
    </div>
  `;
  res.send(await renderLayout('Worker Profile', content));
});

app.post('/admin/add-material', async (req, res) => {
  const { material_name, category, unit, current_quantity, minimum_stock_level, notes } = req.body;
  await pool.query(
    'INSERT INTO materials (material_name, category, unit, current_quantity, minimum_stock_level, notes) VALUES ($1, $2, $3, $4, $5, $6)',
    [material_name, category, unit, current_quantity, minimum_stock_level, notes]
  );
  res.redirect('/admin?tab=inventory');
});

app.post('/admin/stock-in', async (req, res) => {
  const { material_id, quantity, supplier, notes } = req.body;
  const qty = parseFloat(quantity);
  const mat = (await pool.query('SELECT * FROM materials WHERE id = $1', [material_id])).rows[0];
  const newStock = parseFloat(mat.current_quantity) + qty;

  await pool.query('UPDATE materials SET current_quantity = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [newStock, material_id]);
  const dateStr = new Date().toISOString().split('T')[0];
  const timeStr = new Date().toTimeString().split(' ')[0];

  await pool.query(
    'INSERT INTO stock_transactions (material_id, transaction_type, quantity, transaction_date, transaction_time, supplier, notes, recorded_from, stock_after_transaction) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
    [material_id, 'IN', qty, dateStr, timeStr, supplier, notes, 'Admin', newStock]
  );
  res.redirect('/admin?tab=inventory');
});

app.post('/admin/stock-out', async (req, res) => {
  const { material_id, quantity, issued_to, project, purpose } = req.body;
  const qty = parseFloat(quantity);
  const mat = (await pool.query('SELECT * FROM materials WHERE id = $1', [material_id])).rows[0];
  if (parseFloat(mat.current_quantity) < qty) {
    return res.send(`<script>alert('Insufficient Stock!'); window.location.href='/admin?tab=inventory';</script>`);
  }
  const newStock = parseFloat(mat.current_quantity) - qty;

  await pool.query('UPDATE materials SET current_quantity = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [newStock, material_id]);
  const dateStr = new Date().toISOString().split('T')[0];
  const timeStr = new Date().toTimeString().split(' ')[0];

  await pool.query(
    'INSERT INTO stock_transactions (material_id, transaction_type, quantity, transaction_date, transaction_time, issued_to, project, purpose, recorded_from, stock_after_transaction) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
    [material_id, 'OUT', qty, dateStr, timeStr, issued_to, project, purpose, 'Admin', newStock]
  );
  res.redirect('/admin?tab=inventory');
});

app.post('/admin/add-advance', async (req, res) => {
  const { worker_id, amount, reason } = req.body;
  const dateStr = new Date().toISOString().split('T')[0];
  await pool.query('INSERT INTO advance_money (worker_id, amount, advance_date, reason) VALUES ($1, $2, $3, $4)', [worker_id, amount, dateStr, reason]);
  res.redirect('/admin?tab=advance');
});

app.post('/admin/add-announcement', async (req, res) => {
  const { title, message } = req.body;
  await pool.query('INSERT INTO announcements (title, message) VALUES ($1, $2)', [title, message]);
  res.redirect('/admin?tab=announcements');
});

app.get('/admin/delete-announcement', async (req, res) => {
  await pool.query('DELETE FROM announcements WHERE id = $1', [req.query.id]);
  res.redirect('/admin?tab=announcements');
});

app.post('/admin/update-settings', async (req, res) => {
  const { company_name, logo_url, address, contact_number } = req.body;
  await pool.query('UPDATE company_settings SET company_name = $1, logo_url = $2, address = $3, contact_number = $4 WHERE id = 1', [company_name, logo_url, address, contact_number]);
  res.redirect('/admin?tab=settings');
});

app.post('/admin/update-schedule', async (req, res) => {
  const { morning_start, morning_end, afternoon_start, afternoon_end, full_day_hours, half_day_hours } = req.body;
  await pool.query('UPDATE work_schedules SET morning_start=$1, morning_end=$2, afternoon_start=$3, afternoon_end=$4, full_day_hours=$5, half_day_hours=$6 WHERE id=1', [morning_start, morning_end, afternoon_start, afternoon_end, full_day_hours, half_day_hours]);
  res.redirect('/admin?tab=schedule');
});


// ==========================================
// 3. WORKER PORTAL ( /worker )
// ==========================================
app.get('/worker', async (req, res) => {
  const workerId = req.query.id;
  const tab = req.query.subtab || 'home';

  if (!workerId) {
    const content = `
      <div class="card" style="max-width: 500px; margin: 4rem auto; text-align: center;">
        <h2>👷 WORKER PORTAL</h2>
        <p style="color:var(--gray); margin-bottom: 1.5rem;">Enter your unique Worker ID to view your dashboard, attendance, and salary.</p>
        <form method="GET" action="/worker">
          <div class="form-group">
            <input type="text" name="id" placeholder="e.g. W-0001" required style="text-align: center; font-size: 1.2rem; font-weight: bold; text-transform: uppercase;">
          </div>
          <button type="submit" class="btn btn-success" style="width: 100%; padding: 0.8rem;">VIEW MY INFORMATION</button>
        </form>
        <div class="mt-2"><a href="/" style="color: var(--gray); text-decoration:none;">← Return to Main Page</a></div>
      </div>
    `;
    return res.send(await renderLayout('Worker Login', content));
  }

  const worker = (await pool.query('SELECT * FROM workers WHERE worker_id = $1', [workerId])).rows[0];
  if (!worker) {
    return res.send(await renderLayout('Error', `<div class="card text-center"><h3>Worker Not Found</h3><p>The Worker ID "${workerId}" was not found.</p><a href="/worker" class="btn mt-2">Try Again</a></div>`));
  }

  const todayStr = new Date().toISOString().split('T')[0];
  const summary = await getAttendanceSummary(workerId, todayStr);

  let workerContent = `
    <div class="card" style="background: var(--dark); color: white; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 15px;">
      <div>
        <h2 style="color: white; margin-bottom: 5px;">Welcome, ${worker.full_name}</h2>
        <p style="color: #94a3b8; font-size: 0.9rem;">ID: ${worker.worker_id} | Position: ${worker.position}</p>
      </div>
      <div style="display: flex; gap: 8px; flex-wrap: wrap;">
        <a href="/worker?id=${workerId}&subtab=home" class="btn ${tab === 'home' ? '' : 'btn-secondary'}">Home</a>
        <a href="/worker?id=${workerId}&subtab=qr" class="btn ${tab === 'qr' ? '' : 'btn-secondary'}">My QR</a>
        <a href="/worker?id=${workerId}&subtab=attendance" class="btn ${tab === 'attendance' ? '' : 'btn-secondary'}">Attendance</a>
        <a href="/worker?id=${workerId}&subtab=advance" class="btn ${tab === 'advance' ? '' : 'btn-secondary'}">Advance</a>
        <a href="/worker?id=${workerId}&subtab=salary" class="btn ${tab === 'salary' ? '' : 'btn-secondary'}">Salary</a>
        <a href="/worker?id=${workerId}&subtab=announcements" class="btn ${tab === 'announcements' ? '' : 'btn-secondary'}">Announcements</a>
        <a href="/worker" class="btn btn-danger">Logout</a>
      </div>
    </div>
  `;

  if (tab === 'home') {
    workerContent += `
      <div class="grid-2">
        <div class="card">
          <h3>Personal Details</h3>
          <p><b>Worker ID:</b> ${worker.worker_id}</p>
          <p><b>Full Name:</b> ${worker.full_name}</p>
          <p><b>Position:</b> ${worker.position}</p>
          <p><b>Assigned Project:</b> ${worker.assigned_project || 'None'}</p>
          <p><b>Contact Number:</b> ${worker.contact_number || '-'}</p>
          <p><b>Daily Rate:</b> ₱${worker.daily_rate}</p>
        </div>
        <div class="card" style="text-align: center;">
          <h3>Today's Attendance Status</h3>
          <div style="font-size: 3rem; margin: 1rem 0;">📅</div>
          <h2 style="color: var(--primary);">${summary.status}</h2>
          <p>Total Hours Today: <b>${summary.hours} hrs</b></p>
        </div>
      </div>
    `;
  } else if (tab === 'qr') {
    workerContent += `
      <div class="card text-center" style="max-width: 500px; margin: 0 auto;">
        <h3>My Personal QR Code</h3>
        <p style="color:var(--gray); margin-bottom: 1.5rem;">Use this QR code at the scanner portal for attendance.</p>
        <img src="${worker.qr_code}" alt="QR Code" style="width: 220px; height: 220px; border: 5px solid #f1f5f9; border-radius: 10px;">
        <h4 class="mt-2">${worker.full_name}</h4>
        <p><b>${worker.worker_id}</b></p>
      </div>
    `;
  } else if (tab === 'attendance') {
    const logsRes = await pool.query('SELECT * FROM attendance_logs WHERE worker_id = $1 ORDER BY attendance_date DESC, attendance_time DESC', [workerId]);
    workerContent += `
      <div class="card">
        <h3>My Attendance History</h3>
        <table>
          <tr><th>Date</th><th>Type (IN/OUT)</th><th>Time</th></tr>
          ${logsRes.rows.map(l => `
            <tr>
              <td>${l.attendance_date}</td>
              <td><span class="badge ${l.attendance_type === 'IN' ? 'badge-success' : 'badge-danger'}">${l.attendance_type}</span></td>
              <td>${l.attendance_time}</td>
            </tr>
          `).join('')}
        </table>
      </div>
    `;
  } else if (tab === 'advance') {
    const advRes = await pool.query('SELECT * FROM advance_money WHERE worker_id = $1 ORDER BY id DESC', [workerId]);
    const totalAdv = advRes.rows.reduce((sum, a) => sum + parseFloat(a.amount), 0);
    workerContent += `
      <div class="card">
        <h3>My Advance Money History</h3>
        <p style="font-size: 1.1rem; margin-bottom: 1rem;">Total Advance Taken: <b style="color:var(--danger);">₱${totalAdv.toFixed(2)}</b></p>
        <table>
          <tr><th>Date</th><th>Amount</th><th>Reason</th></tr>
          ${advRes.rows.map(a => `
            <tr>
              <td>${a.advance_date}</td>
              <td style="color:var(--danger); font-weight:bold;">₱${a.amount}</td>
              <td>${a.reason || '-'}</td>
            </tr>
          `).join('')}
        </table>
      </div>
    `;
  } else if (tab === 'salary') {
    // Current month calculation
    const currentMonth = new Date().toISOString().slice(0, 7);
    const [year, month] = currentMonth.split('-').map(Number);
    const daysInMonth = new Date(year, month, 0).getDate();
    let fullDays = 0, halfDays = 0;

    for (let d = 1; d <= daysInMonth; d++) {
      const dayStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const sum = await getAttendanceSummary(workerId, dayStr);
      if (sum.status === 'FULL DAY') fullDays++;
      else if (sum.status === 'HALF DAY') halfDays++;
    }

    const equivalentDays = fullDays + (halfDays * 0.5);
    const totalSalary = equivalentDays * parseFloat(worker.daily_rate);
    const advRes = await pool.query('SELECT SUM(amount) as total FROM advance_money WHERE worker_id = $1', [workerId]);
    const advanceDeduction = parseFloat(advRes.rows[0]?.total || 0);
    const netSalary = totalSalary - advanceDeduction;

    workerContent += `
      <div class="card" style="max-width: 600px; margin: 0 auto;">
        <h3>My Salary Breakdown (${currentMonth})</h3>
        <p><b>Daily Rate:</b> ₱${worker.daily_rate}</p>
        <p><b>Full Days Worked:</b> ${fullDays}</p>
        <p><b>Half Days Worked:</b> ${halfDays}</p>
        <p><b>Equivalent Days:</b> ${equivalentDays} Days</p>
        <hr style="margin: 1rem 0; border:0; border-top:1px solid #e2e8f0;">
        <p><b>Total Salary:</b> ₱${totalSalary.toFixed(2)}</p>
        <p><b>Advance Deduction:</b> -₱${advanceDeduction.toFixed(2)}</p>
        <h3 style="color:var(--success); margin-top:1rem;">Net Salary: ₱${netSalary.toFixed(2)}</h3>
      </div>
    `;
  } else if (tab === 'announcements') {
    const anns = (await pool.query('SELECT * FROM announcements ORDER BY id DESC')).rows;
    workerContent += `
      <div class="card">
        <h3>Company Announcements</h3>
        ${anns.map(ann => `
          <div style="background:#f8fafc; padding:1rem; border-radius:6px; margin-bottom:1rem; border-left:4px solid var(--primary);">
            <h4>${ann.title}</h4>
            <small style="color:var(--gray);">${ann.created_at.toISOString().slice(0, 10)}</small>
            <p style="margin-top:0.5rem;">${ann.message}</p>
          </div>
        `).join('')}
      </div>
    `;
  }

  res.send(await renderLayout('Worker Portal', workerContent));
});


// ==========================================
// 4. ATTENDANCE & STOCK SCANNER PORTAL ( /scanner )
// ==========================================
app.get('/scanner', async (req, res) => {
  const tab = req.query.tab || 'dashboard';
  const materials = (await pool.query('SELECT * FROM materials ORDER BY material_name ASC')).rows;

  let content = `
    <div class="card" style="background: var(--dark); color: white; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 15px;">
      <div>
        <h2 style="color: white; margin-bottom: 5px;">Attendance & Stock Scanner</h2>
        <p style="color: #94a3b8; font-size: 0.9rem;">Quick scanner portal for staff.</p>
      </div>
      <div style="display: flex; gap: 8px; flex-wrap: wrap;">
        <a href="/scanner?tab=dashboard" class="btn ${tab === 'dashboard' ? '' : 'btn-secondary'}">Dashboard</a>
        <a href="/scanner?tab=attendance" class="btn ${tab === 'attendance' ? '' : 'btn-secondary'}">Worker Attendance</a>
        <a href="/scanner?tab=stockin" class="btn ${tab === 'stockin' ? '' : 'btn-secondary'}">Stock IN</a>
        <a href="/scanner?tab=stockout" class="btn ${tab === 'stockout' ? '' : 'btn-secondary'}">Stock OUT</a>
        <a href="/scanner?tab=history" class="btn ${tab === 'history' ? '' : 'btn-secondary'}">Stock History</a>
        <a href="/" class="btn btn-danger">Exit</a>
      </div>
    </div>
  `;

  if (tab === 'dashboard') {
    content += `
      <div class="card text-center" style="padding: 3rem;">
        <h2>📷 Quick Scanner Terminal</h2>
        <p style="color: var(--gray); margin-bottom: 2rem;">Select an action below to process worker attendance or scan materials.</p>
        <div style="display:flex; justify-content:center; gap:20px; flex-wrap:wrap;">
          <a href="/scanner?tab=attendance" class="btn" style="padding: 1rem 2rem; font-size: 1.1rem;">Worker Attendance Scanner</a>
          <a href="/scanner?tab=stockin" class="btn btn-success" style="padding: 1rem 2rem; font-size: 1.1rem;">Scanner Stock IN</a>
          <a href="/scanner?tab=stockout" class="btn btn-danger" style="padding: 1rem 2rem; font-size: 1.1rem;">Scanner Stock OUT</a>
        </div>
      </div>
    `;
  } else if (tab === 'attendance') {
    content += `
      <div class="card" style="max-width: 600px; margin: 0 auto;">
        <h3>Worker Attendance Scanner</h3>
        <form method="POST" action="/scanner/process-attendance">
          <div class="form-group">
            <label><b>1. Select Attendance Type (REQUIRED):</b></label>
            <div style="display:flex; gap: 20px; margin-top: 5px;">
              <label style="font-weight:normal; cursor:pointer;"><input type="radio" name="attendance_type" value="IN" required> TIME IN</label>
              <label style="font-weight:normal; cursor:pointer;"><input type="radio" name="attendance_type" value="OUT" required> TIME OUT</label>
            </div>
          </div>
          <div class="form-group">
            <label><b>2. Enter Worker ID or Scan QR Code:</b></label>
            <input type="text" name="worker_id" placeholder="e.g. W-0001" required style="font-size: 1.2frem; text-transform:uppercase;">
          </div>
          <button type="submit" class="btn btn-success" style="width:100%; padding: 0.8rem;">SUBMIT ATTENDANCE</button>
        </form>
      </div>
    `;
  } else if (tab === 'stockin') {
    content += `
      <div class="card" style="max-width: 600px; margin: 0 auto;">
        <h3>Scanner Stock IN</h3>
        <form method="POST" action="/scanner/stock-in">
          <div class="form-group"><label>Select Material</label>
            <select name="material_id" required>
              ${materials.map(m => `<option value="${m.id}">${m.material_name} (Current: ${m.current_quantity} ${m.unit})</option>`).join('')}
            </select>
          </div>
          <div class="form-group"><label>Quantity Received</label><input type="number" step="0.01" name="quantity" required></div>
          <div class="form-group"><label>Supplier</label><input type="text" name="supplier" required></div>
          <div class="form-group"><label>Notes</label><input type="text" name="notes"></div>
          <button type="submit" class="btn btn-success" style="width:100%;">Record Stock IN</button>
        </form>
      </div>
    `;
  } else if (tab === 'stockout') {
    content += `
      <div class="card" style="max-width: 600px; margin: 0 auto;">
        <h3>Scanner Stock OUT</h3>
        <form method="POST" action="/scanner/stock-out">
          <div class="form-group"><label>Select Material</label>
            <select name="material_id" required>
              ${materials.map(m => `<option value="${m.id}">${m.material_name} (Available: ${m.current_quantity} ${m.unit})</option>`).join('')}
            </select>
          </div>
          <div class="form-group"><label>Quantity Issued</label><input type="number" step="0.01" name="quantity" required></div>
          <div class="form-group"><label>Issued To</label><input type="text" name="issued_to" required></div>
          <div class="form-group"><label>Project</label><input type="text" name="project" required></div>
          <div class="form-group"><label>Purpose</label><input type="text" name="purpose" required></div>
          <button type="submit" class="btn btn-danger" style="width:100%;">Record Stock OUT</button>
        </form>
      </div>
    `;
  } else if (tab === 'history') {
    const history = (await pool.query('SELECT * FROM stock_transactions ORDER BY id DESC LIMIT 20')).rows;
    content += `
      <div class="card">
        <h3>Stock Movement History</h3>
        <table>
          <tr><th>Date & Time</th><th>Material</th><th>Type</th><th>Qty</th><th>Supplier / Issued To</th><th>Project</th><th>Recorded From</th><th>Stock After</th></tr>
          ${history.map(tx => `
            <tr>
              <td>${tx.transaction_date} ${tx.transaction_time}</td>
              <td><b>${materials.find(m => m.id === tx.material_id)?.material_name || 'Item'}</b></td>
              <td><span class="badge ${tx.transaction_type === 'IN' ? 'badge-success' : 'badge-danger'}">${tx.transaction_type}</span></td>
              <td><b>${tx.quantity}</b></td>
              <td>${tx.supplier || tx.issued_to || '-'}</td>
              <td>${tx.project || '-'}</td>
              <td><span class="badge badge-info">${tx.recorded_from}</span></td>
              <td><b>${tx.stock_after_transaction}</b></td>
            </tr>
          `).join('')}
        </table>
      </div>
    `;
  }

  res.send(await renderLayout('Scanner Portal', content));
});

// Scanner Attendance Processing & Validation Routine
app.post('/scanner/process-attendance', async (req, res) => {
  const { worker_id, attendance_type } = req.body;
  const workerRes = await pool.query('SELECT * FROM workers WHERE worker_id = $1', [worker_id]);
  if (workerRes.rows.length === 0) {
    return res.send(`<script>alert('Worker Not Found!'); window.location.href='/scanner?tab=attendance';</script>`);
  }
  const worker = workerRes.rows[0];
  if (worker.status !== 'Active') {
    return res.send(`<script>alert('Worker is Inactive!'); window.location.href='/scanner?tab=attendance';</script>`);
  }

  const todayStr = new Date().toISOString().split('T')[0];
  const timeStr = new Date().toTimeString().split(' ')[0];

  // Fetch today's existing records for validation sequence (IN -> OUT -> IN -> OUT)
  const logsRes = await pool.query('SELECT * FROM attendance_logs WHERE worker_id = $1 AND attendance_date = $2 ORDER BY attendance_time ASC', [worker_id, todayStr]);
  const logs = logsRes.rows;

  if (logs.length === 0 && attendance_type === 'OUT') {
    return res.send(`<script>alert('Cannot Record OUT as First Attendance!'); window.location.href='/scanner?tab=attendance';</script>`);
  }

  if (logs.length > 0) {
    const lastType = logs[logs.length - 1].attendance_type;
    if (lastType === 'IN' && attendance_type === 'IN') {
      return res.send(`<script>alert('Cannot Record Two Consecutive IN!'); window.location.href='/scanner?tab=attendance';</script>`);
    }
    if (lastType === 'OUT' && attendance_type === 'OUT') {
      return res.send(`<script>alert('Cannot Record Two Consecutive OUT!'); window.location.href='/scanner?tab=attendance';</script>`);
    }
  }

  await pool.query('INSERT INTO attendance_logs (worker_id, attendance_date, attendance_time, attendance_type) VALUES ($1, $2, $3, $4)', [worker_id, todayStr, timeStr, attendance_type]);
  res.send(`<script>alert('Successfully Recorded ${attendance_type} for ${worker.full_name} at ${timeStr}'); window.location.href='/scanner?tab=attendance';</script>`);
});

app.post('/scanner/stock-in', async (req, res) => {
  const { material_id, quantity, supplier, notes } = req.body;
  const qty = parseFloat(quantity);
  const mat = (await pool.query('SELECT * FROM materials WHERE id = $1', [material_id])).rows[0];
  const newStock = parseFloat(mat.current_quantity) + qty;

  await pool.query('UPDATE materials SET current_quantity = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [newStock, material_id]);
  const dateStr = new Date().toISOString().split('T')[0];
  const timeStr = new Date().toTimeString().split(' ')[0];

  await pool.query(
    'INSERT INTO stock_transactions (material_id, transaction_type, quantity, transaction_date, transaction_time, supplier, notes, recorded_from, stock_after_transaction) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
    [material_id, 'IN', qty, dateStr, timeStr, supplier, notes, 'Scanner', newStock]
  );
  res.redirect('/scanner?tab=stockin');
});

app.post('/scanner/stock-out', async (req, res) => {
  const { material_id, quantity, issued_to, project, purpose } = req.body;
  const qty = parseFloat(quantity);
  const mat = (await pool.query('SELECT * FROM materials WHERE id = $1', [material_id])).rows[0];
  if (parseFloat(mat.current_quantity) < qty) {
    return res.send(`<script>alert('Insufficient Stock!'); window.location.href='/scanner?tab=stockout';</script>`);
  }
  const newStock = parseFloat(mat.current_quantity) - qty;

  await pool.query('UPDATE materials SET current_quantity = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [newStock, material_id]);
  const dateStr = new Date().toISOString().split('T')[0];
  const timeStr = new Date().toTimeString().split(' ')[0];

  await pool.query(
    'INSERT INTO stock_transactions (material_id, transaction_type, quantity, transaction_date, transaction_time, issued_to, project, purpose, recorded_from, stock_after_transaction) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
    [material_id, 'OUT', qty, dateStr, timeStr, issued_to, project, purpose, 'Scanner', newStock]
  );
  res.redirect('/scanner?tab=stockout');
});

// Start Server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
