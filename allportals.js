const express = require('express');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// PostgreSQL Connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// Initialize Database Tables & Default Config
async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS company_settings (
        id SERIAL PRIMARY KEY,
        company_name VARCHAR(255) DEFAULT 'Apex Builder Construction',
        company_logo TEXT DEFAULT '',
        company_address VARCHAR(255) DEFAULT '123 Main Street',
        contact_number VARCHAR(50) DEFAULT '555-0199'
      );

      CREATE TABLE IF NOT EXISTS work_schedules (
        id SERIAL PRIMARY KEY,
        morning_start VARCHAR(10) DEFAULT '07:00 AM',
        morning_end VARCHAR(10) DEFAULT '12:00 PM',
        afternoon_start VARCHAR(10) DEFAULT '01:00 PM',
        afternoon_end VARCHAR(10) DEFAULT '05:00 PM',
        full_day_hours NUMERIC DEFAULT 9,
        half_day_hours NUMERIC DEFAULT 5
      );

      CREATE TABLE IF NOT EXISTS workers (
        id SERIAL PRIMARY KEY,
        worker_id VARCHAR(50) UNIQUE NOT NULL,
        full_name VARCHAR(255) NOT NULL,
        position VARCHAR(100),
        contact_number VARCHAR(50),
        daily_rate NUMERIC(10,2) DEFAULT 0,
        assigned_project VARCHAR(255),
        profile_picture TEXT,
        status VARCHAR(20) DEFAULT 'Active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS attendance_logs (
        id SERIAL PRIMARY KEY,
        worker_id VARCHAR(50) NOT NULL,
        attendance_date DATE NOT NULL,
        attendance_time TIME NOT NULL,
        attendance_type VARCHAR(10) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS materials (
        id SERIAL PRIMARY KEY,
        material_name VARCHAR(255) NOT NULL,
        category VARCHAR(100),
        unit VARCHAR(50),
        current_quantity NUMERIC(10,2) DEFAULT 0,
        minimum_stock_level NUMERIC(10,2) DEFAULT 5,
        notes TEXT
      );

      CREATE TABLE IF NOT EXISTS stock_transactions (
        id SERIAL PRIMARY KEY,
        material_id INT REFERENCES materials(id) ON DELETE CASCADE,
        transaction_type VARCHAR(10) NOT NULL, -- IN or OUT
        quantity NUMERIC(10,2) NOT NULL,
        stock_after NUMERIC(10,2) NOT NULL,
        supplier VARCHAR(255),
        issued_to VARCHAR(255),
        project VARCHAR(255),
        purpose TEXT,
        notes TEXT,
        recorded_from VARCHAR(50),
        transaction_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS advance_money (
        id SERIAL PRIMARY KEY,
        worker_id VARCHAR(50) NOT NULL,
        amount NUMERIC(10,2) NOT NULL,
        advance_date DATE NOT NULL,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS announcements (
        id SERIAL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        message TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Insert default settings if empty
    const settingsCheck = await client.query('SELECT COUNT(*) FROM company_settings');
    if (parseInt(settingsCheck.rows[0].count) === 0) {
      await client.query(`INSERT INTO company_settings (company_name, company_logo, company_address, contact_number) VALUES ('Apex Builder Construction', '', '123 Main Street', '555-0199')`);
    }

    const scheduleCheck = await client.query('SELECT COUNT(*) FROM work_schedules');
    if (parseInt(scheduleCheck.rows[0].count) === 0) {
      await client.query(`INSERT INTO work_schedules (morning_start, morning_end, afternoon_start, afternoon_end, full_day_hours, half_day_hours) VALUES ('07:00 AM', '12:00 PM', '01:00 PM', '05:00 PM', 9, 5)`);
    }

    console.log('Database initialized successfully.');
  } catch (err) {
    console.error('Error initializing database:', err);
  } finally {
    client.release();
  }
}

initDB();

// Helper: Get Settings
async function getCompanySettings() {
  const res = await pool.query('SELECT * FROM company_settings LIMIT 1');
  return res.rows[0] || { company_name: 'Apex Builder', company_logo: '', company_address: '', contact_number: '' };
}

// ---------------------------------------------------------
// FRONTEND LAYOUT WRAPPER
// ---------------------------------------------------------
function renderLayout(title, content, activePortal = '') {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <script src="https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/html5-qrcode.min.js"></script>
  <style>
    :root {
      --primary: #f59e0b;
      --primary-dark: #d97706;
      --dark: #1e293b;
      --light: #f8fafc;
      --danger: #ef4444;
      --success: #22c55e;
      --gray: #64748b;
      --border: #e2e8f0;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; }
    body { background-color: var(--light); color: var(--dark); line-height: 1.6; }
    header { background: var(--dark); color: white; padding: 1rem 2rem; display: flex; justify-content: space-between; align-items: center; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    .brand { display: flex; align-items: center; gap: 1rem; }
    .brand img { height: 45px; width: 45px; object-fit: cover; border-radius: 50%; background: #fff; }
    .brand h1 { font-size: 1.25rem; font-weight: 600; color: #f1f5f9; }
    nav a { color: #cbd5e1; text-decoration: none; margin-left: 1.5rem; font-weight: 500; transition: color 0.2s; }
    nav a:hover, nav a.active { color: var(--primary); }
    .container { max-width: 1200px; margin: 2rem auto; padding: 0 1rem; }
    .card { background: white; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); padding: 1.5rem; margin-bottom: 1.5rem; }
    .btn { background: var(--primary); color: white; border: none; padding: 0.6rem 1.2rem; border-radius: 6px; cursor: pointer; font-weight: 600; text-decoration: none; display: inline-block; transition: background 0.2s; }
    .btn:hover { background: var(--primary-dark); }
    .btn-danger { background: var(--danger); }
    .btn-danger:hover { background: #dc2626; }
    .btn-success { background: var(--success); }
    .btn-success:hover { background: #16a34a; }
    .btn-secondary { background: var(--gray); color: white; }
    .btn-secondary:hover { background: #475569; }
    table { width: 100%; border-collapse: collapse; margin-top: 1rem; background: white; border-radius: 6px; overflow: hidden; }
    th, td { padding: 0.75rem 1rem; text-align: left; border-bottom: 1px solid var(--border); font-size: 0.95rem; }
    th { background: #f1f5f9; font-weight: 600; color: #475569; }
    tr:hover { background: #f8fafc; }
    input, select, textarea { width: 100%; padding: 0.6rem; border: 1px solid var(--border); border-radius: 6px; margin-top: 0.3rem; margin-bottom: 1rem; font-size: 1rem; }
    label { font-weight: 500; font-size: 0.9rem; color: #475569; display: block; margin-top: 0.5rem; }
    .grid-2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1.5rem; }
    .grid-4 { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; }
    .stat-card { background: white; padding: 1.2rem; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); border-left: 4px solid var(--primary); }
    .stat-card h3 { font-size: 0.85rem; color: var(--gray); text-transform: uppercase; }
    .stat-card p { font-size: 1.8rem; font-weight: bold; margin-top: 0.3rem; }
    .badge { padding: 0.25rem 0.6rem; border-radius: 4px; font-size: 0.75rem; font-weight: bold; display: inline-block; }
    .badge-success { background: #dcfce7; color: #166534; }
    .badge-warning { background: #fef9c3; color: #854d0e; }
    .badge-danger { background: #fee2e2; color: #991b1b; }
    .alert { padding: 1rem; border-radius: 6px; margin-bottom: 1rem; font-weight: 500; }
    .alert-danger { background: #fee2e2; color: #991b1b; border: 1px solid #fca5a5; }
    .alert-success { background: #dcfce7; color: #166534; border: 1px solid #86efac; }
    .flex-between { display: flex; justify-content: space-between; align-items: center; }
    .center { text-align: center; }
  </style>
</head>
<body>
  ${content}
</body>
</html>`;
}

// ---------------------------------------------------------
// 1. MAIN PAGE (/)
// ---------------------------------------------------------
app.get('/', async (req, res) => {
  const settings = await getCompanySettings();
  const html = `
    <header>
      <div class="brand">
        ${settings.company_logo ? `<img src="${settings.company_logo}" alt="Logo">` : `<div style="width:45px;height:45px;background:var(--primary);border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:bold;">ABC</div>`}
        <h1>${settings.company_name}</h1>
      </div>
    </header>
    <div class="container" style="text-align: center; margin-top: 4rem;">
      <div class="card" style="max-width: 700px; margin: 0 auto; padding: 3rem;">
        ${settings.company_logo ? `<img src="${settings.company_logo}" alt="Logo" style="height: 100px; width: 100px; object-fit: cover; border-radius: 50%; margin-bottom: 1rem;">` : ''}
        <h2 style="font-size: 2.2rem; margin-bottom: 0.5rem; color: var(--dark);">${settings.company_name}</h2>
        <p style="color: var(--gray); margin-bottom: 2.5rem;">Construction Worker & Inventory Management Portal System</p>
        
        <div style="display: flex; flex-direction: column; gap: 1rem; max-width: 400px; margin: 0 auto;">
          <a href="/admin" class="btn" style="padding: 1rem; font-size: 1.1rem;">[ ADMIN PORTAL ]</a>
          <a href="/worker" class="btn btn-secondary" style="padding: 1rem; font-size: 1.1rem;">[ WORKER PORTAL ]</a>
          <a href="/scanner" class="btn btn-success" style="padding: 1rem; font-size: 1.1rem;">[ SCANNER PORTAL ]</a>
        </div>
      </div>
    </div>
  `;
  res.send(renderLayout('Welcome - ' + settings.company_name, html));
});

// ---------------------------------------------------------
// 2. ADMIN PORTAL (/admin)
// ---------------------------------------------------------
app.get('/admin', async (req, res) => {
  const settings = await getCompanySettings();
  const tab = req.query.tab || 'dashboard';

  let contentHtml = '';

  if (tab === 'dashboard') {
    const workerStats = await pool.query(`
      SELECT 
        (SELECT COUNT(*) FROM workers WHERE status = 'Active') as total,
        (SELECT COUNT(DISTINCT worker_id) FROM attendance_logs WHERE attendance_date = CURRENT_DATE) as present_today
    `);
    const stockStats = await pool.query(`
      SELECT 
        (SELECT COUNT(*) FROM materials) as total_materials,
        (SELECT COUNT(*) FROM materials WHERE current_quantity <= minimum_stock_level) as low_stock
    `);
    const recentAttendance = await pool.query(`
      SELECT a.*, w.full_name FROM attendance_logs a 
      JOIN workers w ON a.worker_id = w.worker_id 
      ORDER BY a.created_at DESC LIMIT 5
    `);
    const lowStockItems = await pool.query(`SELECT * FROM materials WHERE current_quantity <= minimum_stock_level`);
    const recentIN = await pool.query(`SELECT t.*, m.material_name FROM stock_transactions t JOIN materials m ON t.material_id = m.id WHERE t.transaction_type = 'IN' ORDER BY t.transaction_date DESC LIMIT 5`);
    const recentOUT = await pool.query(`SELECT t.*, m.material_name FROM stock_transactions t JOIN materials m ON t.material_id = m.id WHERE t.transaction_type = 'OUT' ORDER BY t.transaction_date DESC LIMIT 5`);

    contentHtml = `
      <h2>Admin Dashboard</h2>
      <div class="grid-4" style="margin-top: 1rem;">
        <div class="stat-card"><h3>Total Workers</h3><p>${workerStats.rows[0].total || 0}</p></div>
        <div class="stat-card"><h3>Present Today</h3><p>${workerStats.rows[0].present_today || 0}</p></div>
        <div class="stat-card" style="border-left-color: var(--success);"><h3>Total Materials</h3><p>${stockStats.rows[0].total_materials || 0}</p></div>
        <div class="stat-card" style="border-left-color: var(--danger);"><h3>Low Stock Items</h3><p>${stockStats.rows[0].low_stock || 0}</p></div>
      </div>

      ${lowStockItems.rows.length > 0 ? `
        <div class="alert alert-danger" style="margin-top: 1.5rem;">
          <strong>LOW STOCK ALERT - PLEASE RESTOCK:</strong>
          <ul>
            ${lowStockItems.rows.map(i => `<li>${i.material_name} (Current: ${i.current_quantity} ${i.unit}, Min: ${i.minimum_stock_level})</li>`).join('')}
          </ul>
        </div>
      ` : ''}

      <div class="grid-2" style="margin-top: 1.5rem;">
        <div class="card">
          <h3>Recent Attendance Logs</h3>
          <table>
            <tr><th>Worker</th><th>Type</th><th>Date/Time</th></tr>
            ${recentAttendance.rows.map(r => `<tr><td>${r.full_name} (${r.worker_id})</td><td><span class="badge ${r.attendance_type === 'IN' ? 'badge-success' : 'badge-warning'}">${r.attendance_type}</span></td><td>${r.attendance_date.toISOString().split('T')[0]} ${r.attendance_time}</td></tr>`).join('')}
          </table>
        </div>
        <div class="card">
          <h3>Stock Transactions</h3>
          <h4 style="font-size:0.9rem; color:var(--gray); margin-top:0.5rem;">Recent Stock IN</h4>
          <table>
            <tr><th>Material</th><th>Qty</th><th>Supplier</th></tr>
            ${recentIN.rows.map(r => `<tr><td>${r.material_name}</td><td>+${r.quantity}</td><td>${r.supplier || '-'}</td></tr>`).join('')}
          </table>
          <h4 style="font-size:0.9rem; color:var(--gray); margin-top:1rem;">Recent Stock OUT</h4>
          <table>
            <tr><th>Material</th><th>Qty</th><th>Project</th></tr>
            ${recentOUT.rows.map(r => `<tr><td>${r.material_name}</td><td>-${r.quantity}</td><td>${r.project || '-'}</td></tr>`).join('')}
          </table>
        </div>
      </div>
    `;
  } else if (tab === 'workers') {
    const search = req.query.search || '';
    const workers = await pool.query(`SELECT * FROM workers WHERE full_name ILIKE $1 OR worker_id ILIKE $1 ORDER BY created_at DESC`, [`%${search}%`]);

    contentHtml = `
      <div class="flex-between">
        <h2>Worker Management</h2>
        <a href="/admin/worker/new" class="btn">+ Register Worker</a>
      </div>
      <form method="GET" action="/admin" style="margin-top: 1rem; display: flex; gap: 0.5rem;">
        <input type="hidden" name="tab" value="workers">
        <input type="text" name="search" placeholder="Search by name or ID..." value="${search}" style="margin:0;">
        <button type="submit" class="btn">Search</button>
      </form>
      <table>
        <tr><th>ID</th><th>Name</th><th>Position</th><th>Project</th><th>Daily Rate</th><th>Status</th><th>Actions</th></tr>
        ${workers.rows.map(w => `
          <tr>
            <td><strong>${w.worker_id}</strong></td>
            <td>${w.full_name}</td>
            <td>${w.position || '-'}</td>
            <td>${w.assigned_project || '-'}</td>
            <td>₱${w.daily_rate}</td>
            <td><span class="badge ${w.status === 'Active' ? 'badge-success' : 'badge-danger'}">${w.status}</span></td>
            <td>
              <a href="/admin/worker/qr?id=${w.worker_id}" class="btn" style="padding:0.2rem 0.5rem; font-size:0.8rem;">QR</a>
              <a href="/admin/worker/edit?id=${w.worker_id}" class="btn btn-secondary" style="padding:0.2rem 0.5rem; font-size:0.8rem;">Edit</a>
              <a href="/admin/worker/status?id=${w.worker_id}&status=${w.status === 'Active' ? 'Inactive' : 'Active'}" class="btn ${w.status === 'Active' ? 'btn-danger' : 'btn-success'}" style="padding:0.2rem 0.5rem; font-size:0.8rem;">${w.status === 'Active' ? 'Deactivate' : 'Activate'}</a>
            </td>
          </tr>
        `).join('')}
      </table>
    `;
  } else if (tab === 'attendance') {
    const logs = await pool.query(`SELECT a.*, w.full_name FROM attendance_logs a JOIN workers w ON a.worker_id = w.worker_id ORDER BY a.attendance_date DESC, a.attendance_time DESC LIMIT 50`);
    contentHtml = `
      <h2>Attendance Records History</h2>
      <table>
        <tr><th>Worker ID</th><th>Worker Name</th><th>Date</th><th>Type</th><th>Time</th></tr>
        ${logs.rows.map(l => `
          <tr>
            <td>${l.worker_id}</td>
            <td>${l.full_name}</td>
            <td>${l.attendance_date.toISOString().split('T')[0]}</td>
            <td><span class="badge ${l.attendance_type === 'IN' ? 'badge-success' : 'badge-warning'}">${l.attendance_type}</span></td>
            <td>${l.attendance_time}</td>
          </tr>
        `).join('')}
      </table>
    `;
  } else if (tab === 'inventory') {
    const materials = await pool.query(`SELECT * FROM materials ORDER BY material_name ASC`);
    contentHtml = `
      <div class="flex-between">
        <h2>Stock Inventory Management</h2>
        <div>
          <a href="/admin/stock/in" class="btn btn-success">+ Stock IN</a>
          <a href="/admin/stock/out" class="btn btn-danger">- Stock OUT</a>
          <a href="/admin/material/new" class="btn">+ Add Material</a>
        </div>
      </div>
      <table>
        <tr><th>Material Name</th><th>Category</th><th>Unit</th><th>Current Qty</th><th>Min Level</th><th>Status</th></tr>
        ${materials.rows.map(m => `
          <tr>
            <td><strong>${m.material_name}</strong></td>
            <td>${m.category || '-'}</td>
            <td>${m.unit || '-'}</td>
            <td>${m.current_quantity}</td>
            <td>${m.minimum_stock_level}</td>
            <td>${m.current_quantity <= m.minimum_stock_level ? '<span class="badge badge-danger">LOW STOCK</span>' : '<span class="badge badge-success">OK</span>'}</td>
          </tr>
        `).join('')}
      </table>
    `;
  } else if (tab === 'advance') {
    const advances = await pool.query(`SELECT adv.*, w.full_name FROM advance_money adv JOIN workers w ON adv.worker_id = w.worker_id ORDER BY adv.advance_date DESC`);
    contentHtml = `
      <div class="flex-between">
        <h2>Advance Money Management</h2>
        <a href="/admin/advance/new" class="btn">+ Add Advance Money</a>
      </div>
      <table>
        <tr><th>Worker ID</th><th>Worker Name</th><th>Amount</th><th>Date</th><th>Notes</th></tr>
        ${advances.rows.map(a => `
          <tr>
            <td>${a.worker_id}</td>
            <td>${a.full_name}</td>
            <td>₱${a.amount}</td>
            <td>${a.advance_date.toISOString().split('T')[0]}</td>
            <td>${a.notes || '-'}</td>
          </tr>
        `).join('')}
      </table>
    `;
  } else if (tab === 'salary') {
    const workers = await pool.query(`SELECT * FROM workers WHERE status = 'Active'`);
    const scheduleRes = await pool.query(`SELECT * FROM work_schedules LIMIT 1`);
    const schedule = scheduleRes.rows[0] || { full_day_hours: 9, half_day_hours: 5 };

    let salaryData = [];
    for (let w of workers.rows) {
      const att = await pool.query(`SELECT * FROM attendance_logs WHERE worker_id = $1 ORDER BY attendance_date ASC, attendance_time ASC`, [w.worker_id]);
      let logsByDate = {};
      att.rows.forEach(l => {
        let dStr = l.attendance_date.toISOString().split('T')[0];
        if (!logsByDate[dStr]) logsByDate[dStr] = [];
        logsByDate[dStr].push(l);
      });

      let fullDays = 0;
      let halfDays = 0;

      Object.keys(logsByDate).forEach(date => {
        let dayLogs = logsByDate[date];
        let totalHours = 0;
        let i = 0;
        while (i < dayLogs.length - 1) {
          if (dayLogs[i].attendance_type === 'IN' && dayLogs[i+1].attendance_type === 'OUT') {
            let t1 = new Date(`1970-01-01T${dayLogs[i].attendance_time}`);
            let t2 = new Date(`1970-01-01T${dayLogs[i+1].attendance_time}`);
            let diffHours = (t2 - t1) / (1000 * 60 * 60);
            if (diffHours > 4) diffHours -= 1;
            if (diffHours > 0) totalHours += diffHours;
            i += 2;
          } else {
            i++;
          }
        }
        if (totalHours >= (schedule.full_day_hours - 1)) {
          fullDays += 1;
        } else if (totalHours >= (schedule.half_day_hours)) {
          halfDays += 1;
        }
      });

      let equivalentDays = fullDays + (halfDays * 0.5);
      let totalSalary = equivalentDays * parseFloat(w.daily_rate);

      const advRes = await pool.query(`SELECT SUM(amount) as total FROM advance_money WHERE worker_id = $1`, [w.worker_id]);
      let totalAdvance = parseFloat(advRes.rows[0].total || 0);
      let netSalary = totalSalary - totalAdvance;

      salaryData.push({ ...w, fullDays, halfDays, equivalentDays, totalSalary, totalAdvance, netSalary });
    }

    contentHtml = `
      <h2>Worker Salary Calculation</h2>
      <table>
        <tr><th>Worker</th><th>Daily Rate</th><th>Full Days</th><th>Half Days</th><th>Eq. Days</th><th>Total Salary</th><th>Advance Ded.</th><th>Net Salary</th></tr>
        ${salaryData.map(s => `
          <tr>
            <td>${s.full_name}<br><small>${s.worker_id}</small></td>
            <td>₱${s.daily_rate}</td>
            <td>${s.fullDays}</td>
            <td>${s.halfDays}</td>
            <td>${s.equivalentDays}</td>
            <td>₱${s.totalSalary.toFixed(2)}</td>
            <td>₱${s.totalAdvance.toFixed(2)}</td>
            <td><strong>₱${s.netSalary.toFixed(2)}</strong></td>
          </tr>
        `).join('')}
      </table>
    `;
  } else if (tab === 'announcements') {
    const anns = await pool.query(`SELECT * FROM announcements ORDER BY created_at DESC`);
    contentHtml = `
      <div class="flex-between">
        <h2>Announcements Management</h2>
        <a href="/admin/announcement/new" class="btn">+ New Announcement</a>
      </div>
      <table>
        <tr><th>Title</th><th>Message</th><th>Date</th><th>Action</th></tr>
        ${anns.rows.map(a => `
          <tr>
            <td><strong>${a.title}</strong></td>
            <td>${a.message}</td>
            <td>${a.created_at.toISOString().split('T')[0]}</td>
            <td><a href="/admin/announcement/delete?id=${a.id}" class="btn btn-danger" style="padding:0.2rem 0.5rem; font-size:0.8rem;">Delete</a></td>
          </tr>
        `).join('')}
      </table>
    `;
  } else if (tab === 'settings') {
    const scheduleRes = await pool.query(`SELECT * FROM work_schedules LIMIT 1`);
    const sched = scheduleRes.rows[0] || {};
    contentHtml = `
      <h2>Company Settings & Work Schedule</h2>
      <div class="card" style="max-width: 600px;">
        <form method="POST" action="/admin/settings/save">
          <h3>Company Information</h3>
          <label>Company Name</label>
          <input type="text" name="company_name" value="${settings.company_name}" required>
          <label>Company Logo Image URL</label>
          <input type="text" name="company_logo" value="${settings.company_logo}" placeholder="https://example.com/logo.png">
          <label>Company Address</label>
          <input type="text" name="company_address" value="${settings.company_address}">
          <label>Contact Number</label>
          <input type="text" name="contact_number" value="${settings.contact_number}">

          <h3 style="margin-top: 1.5rem;">Work Schedule & Hours Configuration</h3>
          <div class="grid-2">
            <div>
              <label>Morning Start</label>
              <input type="text" name="morning_start" value="${sched.morning_start || '07:00 AM'}">
            </div>
            <div>
              <label>Morning End</label>
              <input type="text" name="morning_end" value="${sched.morning_end || '12:00 PM'}">
            </div>
            <div>
              <label>Afternoon Start</label>
              <input type="text" name="afternoon_start" value="${sched.afternoon_start || '01:00 PM'}">
            </div>
            <div>
              <label>Afternoon End</label>
              <input type="text" name="afternoon_end" value="${sched.afternoon_end || '05:00 PM'}">
            </div>
            <div>
              <label>Full Day Hours</label>
              <input type="number" step="0.5" name="full_day_hours" value="${sched.full_day_hours || 9}">
            </div>
            <div>
              <label>Half Day Hours</label>
              <input type="number" step="0.5" name="half_day_hours" value="${sched.half_day_hours || 5}">
            </div>
          </div>
          <button type="submit" class="btn" style="margin-top: 1rem;">Save Configuration</button>
        </form>
      </div>
    `;
  }

  const html = `
    <header>
      <div class="brand">
        ${settings.company_logo ? `<img src="${settings.company_logo}" alt="Logo">` : `<div style="width:45px;height:45px;background:var(--primary);border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:bold;">ABC</div>`}
        <h1>${settings.company_name} - Admin Portal</h1>
      </div>
      <nav>
        <a href="/">Main Page</a>
      </nav>
    </header>
    <div class="container">
      <div style="display: flex; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 1.5rem; background: white; padding: 0.75rem; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
        <a href="/admin?tab=dashboard" class="btn ${tab === 'dashboard' ? '' : 'btn-secondary'}">Dashboard</a>
        <a href="/admin?tab=workers" class="btn ${tab === 'workers' ? '' : 'btn-secondary'}">Workers</a>
        <a href="/admin?tab=attendance" class="btn ${tab === 'attendance' ? '' : 'btn-secondary'}">Attendance</a>
        <a href="/admin?tab=inventory" class="btn ${tab === 'inventory' ? '' : 'btn-secondary'}">Stock Inventory</a>
        <a href="/admin?tab=advance" class="btn ${tab === 'advance' ? '' : 'btn-secondary'}">Advance Money</a>
        <a href="/admin?tab=salary" class="btn ${tab === 'salary' ? '' : 'btn-secondary'}">Salary</a>
        <a href="/admin?tab=announcements" class="btn ${tab === 'announcements' ? '' : 'btn-secondary'}">Announcements</a>
        <a href="/admin?tab=settings" class="btn ${tab === 'settings' ? '' : 'btn-secondary'}">Settings</a>
      </div>
      ${contentHtml}
    </div>
  `;
  res.send(renderLayout('Admin Portal - ' + settings.company_name, html));
});

// Admin Sub-Routes
app.get('/admin/worker/new', async (req, res) => {
  const settings = await getCompanySettings();
  res.send(renderLayout('Register Worker', `
    <header><div class="brand"><h1>Register Worker</h1></div><nav><a href="/admin?tab=workers">Back</a></nav></header>
    <div class="container" style="max-width: 600px;">
      <div class="card">
        <form method="POST" action="/admin/worker/save">
          <label>Full Name</label>
          <input type="text" name="full_name" required>
          <label>Position</label>
          <input type="text" name="position" placeholder="e.g. Mason, Electrician">
          <label>Contact Number</label>
          <input type="text" name="contact_number">
          <label>Daily Rate (₱)</label>
          <input type="number" step="0.01" name="daily_rate" required value="500">
          <label>Assigned Project</label>
          <input type="text" name="assigned_project">
          <label>Profile Picture URL</label>
          <input type="text" name="profile_picture" placeholder="https://...">
          <button type="submit" class="btn" style="margin-top:1rem;">Register & Generate QR Code</button>
        </form>
      </div>
    </div>
  `));
});

app.post('/admin/worker/save', async (req, res) => {
  const { full_name, position, contact_number, daily_rate, assigned_project, profile_picture } = req.body;
  const countRes = await pool.query('SELECT COUNT(*) FROM workers');
  const nextIdNum = parseInt(countRes.rows[0].count) + 1;
  const worker_id = `W-${String(nextIdNum).padStart(4, '0')}`;

  await pool.query(
    'INSERT INTO workers (worker_id, full_name, position, contact_number, daily_rate, assigned_project, profile_picture) VALUES ($1, $2, $3, $4, $5, $6, $7)',
    [worker_id, full_name, position, contact_number, daily_rate, assigned_project, profile_picture]
  );
  res.redirect(`/admin/worker/qr?id=${worker_id}`);
});

app.get('/admin/worker/qr', async (req, res) => {
  const worker_id = req.query.id;
  const settings = await getCompanySettings();
  const workerRes = await pool.query('SELECT * FROM workers WHERE worker_id = $1', [worker_id]);
  if (workerRes.rows.length === 0) return res.send('Worker not found');
  const worker = workerRes.rows[0];

  res.send(renderLayout(`QR Code - ${worker.full_name}`, `
    <header><div class="brand"><h1>Worker QR Code</h1></div><nav><a href="/admin?tab=workers">Back to Workers</a></nav></header>
    <div class="container" style="max-width: 500px; text-align: center;">
      <div class="card" id="qr-card" style="padding: 2rem;">
        ${settings.company_logo ? `<img src="${settings.company_logo}" style="height:60px;width:60px;border-radius:50%;object-fit:cover;">` : ''}
        <h3 style="margin-top:0.5rem;">${settings.company_name}</h3>
        <hr style="margin: 1rem 0; border:0; border-top:1px solid var(--border);">
        ${worker.profile_picture ? `<img src="${worker.profile_picture}" style="height:100px;width:100px;border-radius:50%;object-fit:cover;margin-bottom:0.5rem;">` : ''}
        <h2 style="font-size: 1.5rem;">${worker.full_name}</h2>
        <p style="color:var(--gray);">${worker.position || 'Construction Worker'} | <strong>${worker.worker_id}</strong></p>
        
        <div id="qrcode-container" style="margin: 1.5rem auto; display: inline-block; padding: 10px; background: white; border: 1px solid var(--border); border-radius: 8px;">
          <div id="qrcode"></div>
        </div>
        <p style="font-size: 0.85rem; color: var(--gray);">Scan this QR Code at the Scanner Portal for Attendance.</p>
        <div style="margin-top: 1.5rem;">
          <button onclick="window.print()" class="btn">Print QR Card</button>
        </div>
      </div>
    </div>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
    <script>
      new QRCode(document.getElementById("qrcode"), {
        text: "${worker.worker_id}",
        width: 180,
        height: 180,
        colorDark: "#000000",
        colorLight: "#ffffff",
        correctLevel: QRCode.CorrectLevel.H
      });
    </script>
  `));
});

app.get('/admin/worker/status', async (req, res) => {
  const { id, status } = req.query;
  await pool.query('UPDATE workers SET status = $1 WHERE worker_id = $2', [status, id]);
  res.redirect('/admin?tab=workers');
});

app.post('/admin/settings/save', async (req, res) => {
  const { company_name, company_logo, company_address, contact_number, morning_start, morning_end, afternoon_start, afternoon_end, full_day_hours, half_day_hours } = req.body;
  await pool.query('UPDATE company_settings SET company_name=$1, company_logo=$2, company_address=$3, contact_number=$4 WHERE id=(SELECT id FROM company_settings LIMIT 1)', [company_name, company_logo, company_address, contact_number]);
  await pool.query('UPDATE work_schedules SET morning_start=$1, morning_end=$2, afternoon_start=$3, afternoon_end=$4, full_day_hours=$5, half_day_hours=$6 WHERE id=(SELECT id FROM work_schedules LIMIT 1)', [morning_start, morning_end, afternoon_start, afternoon_end, full_day_hours, half_day_hours]);
  res.redirect('/admin?tab=settings');
});

app.get('/admin/material/new', async (req, res) => {
  res.send(renderLayout('Add Material', `
    <header><div class="brand"><h1>Add Material</h1></div><nav><a href="/admin?tab=inventory">Back</a></nav></header>
    <div class="container" style="max-width: 600px;">
      <div class="card">
        <form method="POST" action="/admin/material/save">
          <label>Material Name</label>
          <input type="text" name="material_name" required>
          <label>Category</label>
          <input type="text" name="category" placeholder="e.g. Cement, Steel">
          <label>Unit</label>
          <input type="text" name="unit" placeholder="e.g. bags, pcs, kg" required>
          <label>Initial Quantity</label>
          <input type="number" step="0.01" name="current_quantity" value="0" required>
          <label>Minimum Stock Level (Alert Threshold)</label>
          <input type="number" step="0.01" name="minimum_stock_level" value="10" required>
          <label>Notes</label>
          <textarea name="notes"></textarea>
          <button type="submit" class="btn" style="margin-top:1rem;">Save Material</button>
        </form>
      </div>
    </div>
  `));
});

app.post('/admin/material/save', async (req, res) => {
  const { material_name, category, unit, current_quantity, minimum_stock_level, notes } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const matRes = await client.query(
      'INSERT INTO materials (material_name, category, unit, current_quantity, minimum_stock_level, notes) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
      [material_name, category, unit, current_quantity, minimum_stock_level, notes]
    );
    if (parseFloat(current_quantity) > 0) {
      await client.query(
        'INSERT INTO stock_transactions (material_id, transaction_type, quantity, stock_after, supplier, notes, recorded_from) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [matRes.rows[0].id, 'IN', current_quantity, current_quantity, 'Initial Stock', 'Initial Inventory Setup', 'Admin']
      );
    }
    await client.query('COMMIT');
  } catch(e) {
    await client.query('ROLLBACK');
  } finally {
    client.release();
  }
  res.redirect('/admin?tab=inventory');
});

app.get('/admin/stock/in', async (req, res) => {
  const materials = await pool.query('SELECT * FROM materials ORDER BY material_name ASC');
  res.send(renderLayout('Stock IN', `
    <header><div class="brand"><h1>Record Stock IN</h1></div><nav><a href="/admin?tab=inventory">Back</a></nav></header>
    <div class="container" style="max-width: 600px;">
      <div class="card">
        <form method="POST" action="/admin/stock/in">
          <label>Select Material</label>
          <select name="material_id" required>
            ${materials.rows.map(m => `<option value="${m.id}">${m.material_name} (Current: ${m.current_quantity} ${m.unit})</option>`).join('')}
          </select>
          <label>Quantity Received</label>
          <input type="number" step="0.01" name="quantity" required>
          <label>Supplier</label>
          <input type="text" name="supplier">
          <label>Notes</label>
          <textarea name="notes"></textarea>
          <button type="submit" class="btn btn-success" style="margin-top:1rem;">Record Stock IN</button>
        </form>
      </div>
    </div>
  `));
});

app.post('/admin/stock/in', async (req, res) => {
  const { material_id, quantity, supplier, notes } = req.body;
  const qty = parseFloat(quantity);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const mat = await client.query('SELECT current_quantity FROM materials WHERE id = $1', [material_id]);
    const newStock = parseFloat(mat.rows[0].current_quantity) + qty;
    await client.query('UPDATE materials SET current_quantity = $1 WHERE id = $2', [newStock, material_id]);
    await client.query(
      'INSERT INTO stock_transactions (material_id, transaction_type, quantity, stock_after, supplier, notes, recorded_from) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [material_id, 'IN', qty, newStock, supplier, notes, 'Admin']
    );
    await client.query('COMMIT');
  } catch(e) {
    await client.query('ROLLBACK');
  } finally {
    client.release();
  }
  res.redirect('/admin?tab=inventory');
});

app.get('/admin/stock/out', async (req, res) => {
  const materials = await pool.query('SELECT * FROM materials ORDER BY material_name ASC');
  res.send(renderLayout('Stock OUT', `
    <header><div class="brand"><h1>Record Stock OUT</h1></div><nav><a href="/admin?tab=inventory">Back</a></nav></header>
    <div class="container" style="max-width: 600px;">
      <div class="card">
        <form method="POST" action="/admin/stock/out">
          <label>Select Material</label>
          <select name="material_id" required>
            ${materials.rows.map(m => `<option value="${m.id}">${m.material_name} (Current: ${m.current_quantity} ${m.unit})</option>`).join('')}
          </select>
          <label>Quantity Issued</label>
          <input type="number" step="0.01" name="quantity" required>
          <label>Issued To</label>
          <input type="text" name="issued_to">
          <label>Project</label>
          <input type="text" name="project">
          <label>Purpose</label>
          <input type="text" name="purpose">
          <label>Notes</label>
          <textarea name="notes"></textarea>
          <button type="submit" class="btn btn-danger" style="margin-top:1rem;">Record Stock OUT</button>
        </form>
      </div>
    </div>
  `));
});

app.post('/admin/stock/out', async (req, res) => {
  const { material_id, quantity, issued_to, project, purpose, notes } = req.body;
  const qty = parseFloat(quantity);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const mat = await client.query('SELECT current_quantity, material_name FROM materials WHERE id = $1', [material_id]);
    const current = parseFloat(mat.rows[0].current_quantity);
    if (qty > current) {
      return res.send(renderLayout('Error', `<div class="container"><div class="alert alert-danger">Insufficient Stock! Available: ${current}. <a href="/admin/stock/out">Go Back</a></div></div>`));
    }
    const newStock = current - qty;
    await client.query('UPDATE materials SET current_quantity = $1 WHERE id = $2', [newStock, material_id]);
    await client.query(
      'INSERT INTO stock_transactions (material_id, transaction_type, quantity, stock_after, issued_to, project, purpose, notes, recorded_from) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
      [material_id, 'OUT', qty, newStock, issued_to, project, purpose, notes, 'Admin']
    );
    await client.query('COMMIT');
  } catch(e) {
    await client.query('ROLLBACK');
  } finally {
    client.release();
  }
  res.redirect('/admin?tab=inventory');
});

app.get('/admin/advance/new', async (req, res) => {
  const workers = await pool.query("SELECT * FROM workers WHERE status = 'Active'");
  res.send(renderLayout('Add Advance Money', `
    <header><div class="brand"><h1>Add Advance Money</h1></div><nav><a href="/admin?tab=advance">Back</a></nav></header>
    <div class="container" style="max-width: 600px;">
      <div class="card">
        <form method="POST" action="/admin/advance/save">
          <label>Select Worker</label>
          <select name="worker_id" required>
            ${workers.rows.map(w => `<option value="${w.worker_id}">${w.full_name} (${w.worker_id})</option>`).join('')}
          </select>
          <label>Amount (₱)</label>
          <input type="number" step="0.01" name="amount" required>
          <label>Advance Date</label>
          <input type="date" name="advance_date" value="${new Date().toISOString().split('T')[0]}" required>
          <label>Notes</label>
          <textarea name="notes"></textarea>
          <button type="submit" class="btn" style="margin-top:1rem;">Save Advance</button>
        </form>
      </div>
    </div>
  `));
});

app.post('/admin/advance/save', async (req, res) => {
  const { worker_id, amount, advance_date, notes } = req.body;
  await pool.query('INSERT INTO advance_money (worker_id, amount, advance_date, notes) VALUES ($1, $2, $3, $4)', [worker_id, amount, advance_date, notes]);
  res.redirect('/admin?tab=advance');
});

app.get('/admin/announcement/new', async (req, res) => {
  res.send(renderLayout('New Announcement', `
    <header><div class="brand"><h1>New Announcement</h1></div><nav><a href="/admin?tab=announcements">Back</a></nav></header>
    <div class="container" style="max-width: 600px;">
      <div class="card">
        <form method="POST" action="/admin/announcement/save">
          <label>Title</label>
          <input type="text" name="title" required>
          <label>Message</label>
          <textarea name="message" rows="4" required></textarea>
          <button type="submit" class="btn" style="margin-top:1rem;">Post Announcement</button>
        </form>
      </div>
    </div>
  `));
});

app.post('/admin/announcement/save', async (req, res) => {
  const { title, message } = req.body;
  await pool.query('INSERT INTO announcements (title, message) VALUES ($1, $2)', [title, message]);
  res.redirect('/admin?tab=announcements');
});

app.get('/admin/announcement/delete', async (req, res) => {
  await pool.query('DELETE FROM announcements WHERE id = $1', [req.query.id]);
  res.redirect('/admin?tab=announcements');
});

// ---------------------------------------------------------
// 3. WORKER PORTAL (/worker)
// ---------------------------------------------------------
app.get('/worker', async (req, res) => {
  const settings = await getCompanySettings();
  const worker_id = req.query.worker_id || '';
  const view = req.query.view || 'home';

  let worker = null;
  if (worker_id) {
    const resW = await pool.query('SELECT * FROM workers WHERE worker_id = $1', [worker_id]);
    if (resW.rows.length > 0) worker = resW.rows[0];
  }

  let contentHtml = '';
  if (!worker) {
    contentHtml = `
      <div class="card" style="max-width: 500px; margin: 3rem auto; text-align: center; padding: 2rem;">
        <h3>Worker Portal Login</h3>
        <p style="color:var(--gray); margin-bottom: 1.5rem;">Enter your unique Worker ID to access your portal.</p>
        <form method="GET" action="/worker">
          <input type="text" name="worker_id" placeholder="e.g. W-0001" required style="text-align: center; font-size: 1.2rem; font-weight: bold;">
          <button type="submit" class="btn" style="width: 100%; padding: 0.8rem;">Access Portal</button>
        </form>
      </div>
    `;
  } else {
    let subContent = '';
    if (view === 'home' || view === '') {
      subContent = `
        <h3>Welcome, ${worker.full_name}!</h3>
        <p style="color: var(--gray); margin-bottom: 1.5rem;">Position: ${worker.position || '-'} | Project: ${worker.assigned_project || '-'}</p>
        <div class="grid-2">
          <div class="stat-card"><h3>Daily Rate</h3><p>₱${worker.daily_rate}</p></div>
          <div class="stat-card" style="border-left-color: var(--success);"><h3>Status</h3><p style="font-size: 1.2rem; margin-top:0.5rem;"><span class="badge badge-success">${worker.status}</span></p></div>
        </div>
      `;
    } else if (view === 'qrcode') {
      subContent = `
        <h3>My QR Code</h3>
        <p style="color: var(--gray); margin-bottom: 1rem;">Use this QR code for verification or identification.</p>
        <div style="text-align: center; padding: 1.5rem; background: #fff; border: 1px solid var(--border); border-radius: 8px; display: inline-block;">
          ${settings.company_logo ? `<img src="${settings.company_logo}" style="height:50px;width:50px;border-radius:50%;object-fit:cover;">` : ''}
          <h4>${settings.company_name}</h4>
          <h2 style="margin: 0.5rem 0;">${worker.full_name}</h2>
          <p style="color:var(--gray);">ID: ${worker.worker_id}</p>
          <div id="qrcode" style="margin: 1rem auto; display: inline-block;"></div>
        </div>
        <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
        <script>
          new QRCode(document.getElementById("qrcode"), { text: "${worker.worker_id}", width: 160, height: 160 });
        </script>
      `;
    } else if (view === 'attendance') {
      const logs = await pool.query('SELECT * FROM attendance_logs WHERE worker_id = $1 ORDER BY attendance_date DESC, attendance_time DESC', [worker.worker_id]);
      subContent = `
        <h3>My Attendance Logs</h3>
        <table>
          <tr><th>Date</th><th>Type</th><th>Time</th></tr>
          ${logs.rows.map(l => `<tr><td>${l.attendance_date.toISOString().split('T')[0]}</td><td><span class="badge ${l.attendance_type === 'IN' ? 'badge-success' : 'badge-warning'}">${l.attendance_type}</span></td><td>${l.attendance_time}</td></tr>`).join('')}
        </table>
      `;
    } else if (view === 'advance') {
      const advs = await pool.query('SELECT * FROM advance_money WHERE worker_id = $1 ORDER BY advance_date DESC', [worker.worker_id]);
      subContent = `
        <h3>My Advance Money History</h3>
        <table>
          <tr><th>Date</th><th>Amount</th><th>Notes</th></tr>
          ${advs.rows.map(a => `<tr><td>${a.advance_date.toISOString().split('T')[0]}</td><td>₱${a.amount}</td><td>${a.notes || '-'}</td></tr>`).join('')}
        </table>
      `;
    } else if (view === 'salary') {
      const advRes = await pool.query('SELECT SUM(amount) as total FROM advance_money WHERE worker_id = $1', [worker.worker_id]);
      const totalAdvance = parseFloat(advRes.rows[0].total || 0);
      subContent = `
        <h3>My Salary Overview</h3>
        <div class="card" style="background: #f8fafc;">
          <p><strong>Daily Rate:</strong> ₱${worker.daily_rate}</p>
          <p><strong>Total Advance Deductions:</strong> ₱${totalAdvance.toFixed(2)}</p>
          <p style="margin-top: 1rem; font-size: 1.1rem;">(Salary calculations are automatically generated based on verified attendance sequence pairs).</p>
        </div>
      `;
    } else if (view === 'announcements') {
      const anns = await pool.query('SELECT * FROM announcements ORDER BY created_at DESC');
      subContent = `
        <h3>Company Announcements</h3>
        ${anns.rows.map(a => `
          <div class="card" style="background: #fff; margin-bottom: 1rem;">
            <h4>${a.title}</h4>
            <p style="font-size: 0.85rem; color: var(--gray); margin-bottom: 0.5rem;">${a.created_at.toISOString().split('T')[0]}</p>
            <p>${a.message}</p>
          </div>
        `).join('')}
      `;
    }

    contentHtml = `
      <div style="display: flex; gap: 1rem; align-items: flex-start; flex-wrap: wrap;">
        <div class="card" style="flex: 1; min-width: 240px;">
          <div style="text-align: center; margin-bottom: 1rem;">
            ${worker.profile_picture ? `<img src="${worker.profile_picture}" style="height:80px;width:80px;border-radius:50%;object-fit:cover;">` : `<div style="width:80px;height:80px;background:var(--primary);color:#fff;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:1.5rem;font-weight:bold;">${worker.full_name[0]}</div>`}
            <h4 style="margin-top: 0.5rem;">${worker.full_name}</h4>
            <p style="font-size: 0.85rem; color: var(--gray);">${worker.worker_id}</p>
          </div>
          <hr style="border:0; border-top:1px solid var(--border); margin: 1rem 0;">
          <div style="display: flex; flex-direction: column; gap: 0.5rem;">
            <a href="/worker?worker_id=${worker.worker_id}&view=home" class="btn ${view === 'home' ? '' : 'btn-secondary'}">Home</a>
            <a href="/worker?worker_id=${worker.worker_id}&view=qrcode" class="btn ${view === 'qrcode' ? '' : 'btn-secondary'}">My QR Code</a>
            <a href="/worker?worker_id=${worker.worker_id}&view=attendance" class="btn ${view === 'attendance' ? '' : 'btn-secondary'}">My Attendance</a>
            <a href="/worker?worker_id=${worker.worker_id}&view=advance" class="btn ${view === 'advance' ? '' : 'btn-secondary'}">My Advance</a>
            <a href="/worker?worker_id=${worker.worker_id}&view=salary" class="btn ${view === 'salary' ? '' : 'btn-secondary'}">My Salary</a>
            <a href="/worker?worker_id=${worker.worker_id}&view=announcements" class="btn ${view === 'announcements' ? '' : 'btn-secondary'}">Announcements</a>
            <a href="/worker" class="btn btn-danger" style="margin-top: 1rem;">Switch Worker / Logout</a>
          </div>
        </div>
        <div class="card" style="flex: 3; min-width: 300px;">
          ${subContent}
        </div>
      </div>
    `;
  }

  const html = `
    <header>
      <div class="brand">
        ${settings.company_logo ? `<img src="${settings.company_logo}" alt="Logo">` : `<div style="width:45px;height:45px;background:var(--primary);border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:bold;">ABC</div>`}
        <h1>${settings.company_name} - Worker Portal</h1>
      </div>
      <nav><a href="/">Main Page</a></nav>
    </header>
    <div class="container">${contentHtml}</div>
  `;
  res.send(renderLayout('Worker Portal', html));
});

// ---------------------------------------------------------
// 4. SCANNER PORTAL (/scanner)
// ---------------------------------------------------------
app.get('/scanner', async (req, res) => {
  const settings = await getCompanySettings();
  const sub = req.query.sub || 'attendance';

  let subContent = '';
  if (sub === 'attendance') {
    subContent = `
      <h2>Worker QR Attendance Scanner</h2>
      <div class="card" style="text-align: center; max-width: 600px; margin: 1rem auto;">
        <div id="mode-display" style="padding: 1rem; font-size: 1.2rem; font-weight: bold; background: #e2e8f0; border-radius: 6px; margin-bottom: 1rem;">
          CURRENT SCAN MODE: <span id="mode-text" style="color: var(--primary-dark);">NOT SELECTED</span>
        </div>
        <div style="display: flex; gap: 1rem; justify-content: center; margin-bottom: 1.5rem;">
          <button onclick="setMode('IN')" class="btn btn-success" style="padding: 0.8rem 1.5rem; font-size: 1.1rem;">[ TIME IN ]</button>
          <button onclick="setMode('OUT')" class="btn btn-danger" style="padding: 0.8rem 1.5rem; font-size: 1.1rem;">[ TIME OUT ]</button>
        </div>

        <div id="scanner-container" style="display: none; margin-top: 1rem;">
          <div id="reader" style="width: 100%; max-width: 400px; margin: 0 auto;"></div>
          <button onclick="stopScanner()" class="btn btn-secondary" style="margin-top: 1rem;">Stop Scanner</button>
        </div>

        <div id="start-scan-wrapper" style="margin-top: 1rem;">
          <button onclick="startScanner()" class="btn" style="padding: 0.8rem 2rem; font-size: 1.1rem;">[ START QR SCANNER ]</button>
        </div>

        <div id="scan-result" style="margin-top: 1.5rem;"></div>
      </div>

      <script>
        let currentMode = '';
        let html5QrCode = null;

        function setMode(mode) {
          currentMode = mode;
          document.getElementById('mode-text').innerText = mode === 'IN' ? 'TIME IN' : 'TIME OUT';
          document.getElementById('mode-display').style.background = mode === 'IN' ? '#dcfce7' : '#fee2e2';
        }

        function startScanner() {
          if (!currentMode) {
            alert('Please Select TIME IN or TIME OUT First.');
            return;
          }
          document.getElementById('scanner-container').style.display = 'block';
          document.getElementById('start-scan-wrapper').style.display = 'none';

          html5QrCode = new Html5Qrcode("reader");
          html5QrCode.start(
            { facingMode: "environment" },
            { fps: 10, qrbox: 250 },
            async (decodedText) => {
              stopScanner();
              await processAttendance(decodedText, currentMode);
            },
            (errorMessage) => {}
          ).catch(err => {
            alert('Unable to start camera: ' + err);
            document.getElementById('scanner-container').style.display = 'none';
            document.getElementById('start-scan-wrapper').style.display = 'block';
          });
        }

        function stopScanner() {
          if (html5QrCode) {
            html5QrCode.stop().then(() => {
              document.getElementById('scanner-container').style.display = 'none';
              document.getElementById('start-scan-wrapper').style.display = 'block';
            }).catch(err => console.log(err));
          } else {
            document.getElementById('scanner-container').style.display = 'none';
            document.getElementById('start-scan-wrapper').style.display = 'block';
          }
        }

        async function processAttendance(workerId, type) {
          try {
            let response = await fetch('/api/attendance/scan', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ worker_id: workerId, attendance_type: type })
            });
            let result = await response.json();
            let resDiv = document.getElementById('scan-result');
            if (result.success) {
              resDiv.innerHTML = \`
                <div class="alert alert-success">
                  <strong>SUCCESS!</strong><br>
                  \${result.worker.full_name}<br>
                  Worker ID: \${result.worker.worker_id}<br>
                  TIME \${type}<br>
                  \${result.date} - \${result.time}
                </div>
              \`;
            } else {
              resDiv.innerHTML = \`<div class="alert alert-danger"><strong>ERROR:</strong> \${result.message}</div>\`;
            }
            setTimeout(() => {
              resDiv.innerHTML = '';
            }, 4000);
          } catch(e) {
            alert('Network error recording attendance');
          }
        }
      </script>
    `;
  } else if (sub === 'stock_in') {
    const materials = await pool.query('SELECT * FROM materials ORDER BY material_name ASC');
    subContent = `
      <h2>Scanner - Stock IN</h2>
      <div class="card" style="max-width: 600px; margin: 0 auto;">
        <form method="POST" action="/scanner/stock/in">
          <label>Select Material</label>
          <select name="material_id" required>
            ${materials.rows.map(m => `<option value="${m.id}">${m.material_name} (Current: ${m.current_quantity} ${m.unit})</option>`).join('')}
          </select>
          <label>Quantity Received</label>
          <input type="number" step="0.01" name="quantity" required>
          <label>Supplier</label>
          <input type="text" name="supplier">
          <label>Notes</label>
          <textarea name="notes"></textarea>
          <button type="submit" class="btn btn-success" style="margin-top:1rem;">Record Stock IN</button>
        </form>
      </div>
    `;
  } else if (sub === 'stock_out') {
    const materials = await pool.query('SELECT * FROM materials ORDER BY material_name ASC');
    subContent = `
      <h2>Scanner - Stock OUT</h2>
      <div class="card" style="max-width: 600px; margin: 0 auto;">
        <form method="POST" action="/scanner/stock/out">
          <label>Select Material</label>
          <select name="material_id" required>
            ${materials.rows.map(m => `<option value="${m.id}">${m.material_name} (Current: ${m.current_quantity} ${m.unit})</option>`).join('')}
          </select>
          <label>Quantity Issued</label>
          <input type="number" step="0.01" name="quantity" required>
          <label>Issued To</label>
          <input type="text" name="issued_to">
          <label>Project</label>
          <input type="text" name="project">
          <label>Purpose</label>
          <input type="text" name="purpose">
          <label>Notes</label>
          <textarea name="notes"></textarea>
          <button type="submit" class="btn btn-danger" style="margin-top:1rem;">Record Stock OUT</button>
        </form>
      </div>
    `;
  } else if (sub === 'current_stock') {
    const materials = await pool.query('SELECT * FROM materials ORDER BY material_name ASC');
    subContent = `
      <h2>Current Stock Inventory</h2>
      <table>
        <tr><th>Material Name</th><th>Category</th><th>Unit</th><th>Current Qty</th><th>Min Level</th></tr>
        ${materials.rows.map(m => `
          <tr>
            <td><strong>${m.material_name}</strong></td>
            <td>${m.category || '-'}</td>
            <td>${m.unit || '-'}</td>
            <td>${m.current_quantity}</td>
            <td>${m.minimum_stock_level}</td>
          </tr>
        `).join('')}
      </table>
    `;
  } else if (sub === 'history') {
    const tx = await pool.query('SELECT t.*, m.material_name FROM stock_transactions t JOIN materials m ON t.material_id = m.id ORDER BY t.transaction_date DESC LIMIT 30');
    subContent = `
      <h2>Stock Transaction History</h2>
      <table>
        <tr><th>Date/Time</th><th>Material</th><th>Type</th><th>Qty</th><th>Project / Supplier</th><th>Recorded From</th></tr>
        ${tx.rows.map(t => `
          <tr>
            <td>${t.transaction_date.toISOString().replace('T', ' ').substring(0, 19)}</td>
            <td>${t.material_name}</td>
            <td><span class="badge ${t.transaction_type === 'IN' ? 'badge-success' : 'badge-danger'}">${t.transaction_type}</span></td>
            <td>${t.quantity}</td>
            <td>${t.project || t.supplier || '-'}</td>
            <td>${t.recorded_from}</td>
          </tr>
        `).join('')}
      </table>
    `;
  }

  const html = `
    <header>
      <div class="brand">
        ${settings.company_logo ? `<img src="${settings.company_logo}" alt="Logo">` : `<div style="width:45px;height:45px;background:var(--primary);border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:bold;">ABC</div>`}
        <h1>${settings.company_name} - Scanner Portal</h1>
      </div>
      <nav><a href="/">Main Page</a></nav>
    </header>
    <div class="container">
      <div style="display: flex; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 1.5rem; background: white; padding: 0.75rem; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
        <a href="/scanner?sub=attendance" class="btn ${sub === 'attendance' ? '' : 'btn-secondary'}">QR Attendance</a>
        <a href="/scanner?sub=stock_in" class="btn ${sub === 'stock_in' ? '' : 'btn-secondary'}">Stock IN</a>
        <a href="/scanner?sub=stock_out" class="btn ${sub === 'stock_out' ? '' : 'btn-secondary'}">Stock OUT</a>
        <a href="/scanner?sub=current_stock" class="btn ${sub === 'current_stock' ? '' : 'btn-secondary'}">Current Stock</a>
        <a href="/scanner?sub=history" class="btn ${sub === 'history' ? '' : 'btn-secondary'}">Stock History</a>
      </div>
      ${subContent}
    </div>
  `;
  res.send(renderLayout('Scanner Portal', html));
});

// Scanner Stock Actions
app.post('/scanner/stock/in', async (req, res) => {
  const { material_id, quantity, supplier, notes } = req.body;
  const qty = parseFloat(quantity);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const mat = await client.query('SELECT current_quantity FROM materials WHERE id = $1', [material_id]);
    const newStock = parseFloat(mat.rows[0].current_quantity) + qty;
    await client.query('UPDATE materials SET current_quantity = $1 WHERE id = $2', [newStock, material_id]);
    await client.query(
      'INSERT INTO stock_transactions (material_id, transaction_type, quantity, stock_after, supplier, notes, recorded_from) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [material_id, 'IN', qty, newStock, supplier, notes, 'Scanner']
    );
    await client.query('COMMIT');
  } catch(e) {
    await client.query('ROLLBACK');
  } finally {
    client.release();
  }
  res.redirect('/scanner?sub=current_stock');
});

app.post('/scanner/stock/out', async (req, res) => {
  const { material_id, quantity, issued_to, project, purpose, notes } = req.body;
  const qty = parseFloat(quantity);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const mat = await client.query('SELECT current_quantity FROM materials WHERE id = $1', [material_id]);
    const current = parseFloat(mat.rows[0].current_quantity);
    if (qty > current) {
      return res.send(renderLayout('Error', `<div class="container"><div class="alert alert-danger">Insufficient Stock! Available: ${current}. <a href="/scanner?sub=stock_out">Go Back</a></div></div>`));
    }
    const newStock = current - qty;
    await client.query('UPDATE materials SET current_quantity = $1 WHERE id = $2', [newStock, material_id]);
    await client.query(
      'INSERT INTO stock_transactions (material_id, transaction_type, quantity, stock_after, issued_to, project, purpose, notes, recorded_from) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
      [material_id, 'OUT', qty, newStock, issued_to, project, purpose, notes, 'Scanner']
    );
    await client.query('COMMIT');
  } catch(e) {
    await client.query('ROLLBACK');
  } finally {
    client.release();
  }
  res.redirect('/scanner?sub=current_stock');
});

// ---------------------------------------------------------
// API: ATTENDANCE SCAN VALIDATION ENDPOINT
// ---------------------------------------------------------
app.post('/api/attendance/scan', async (req, res) => {
  const { worker_id, attendance_type } = req.body;
  
  const workerRes = await pool.query("SELECT * FROM workers WHERE worker_id = $1 AND status = 'Active'", [worker_id]);
  if (workerRes.rows.length === 0) {
    return res.json({ success: false, message: 'Worker not found or inactive.' });
  }
  const worker = workerRes.rows[0];

  const now = new Date();
  const currentDate = now.toISOString().split('T')[0];
  const currentTime = now.toTimeString().split(' ')[0];

  const lastLogRes = await pool.query(
    'SELECT * FROM attendance_logs WHERE worker_id = $1 AND attendance_date = $2 ORDER BY attendance_time DESC LIMIT 1',
    [worker_id, currentDate]
  );
  const lastLog = lastLogRes.rows[0];

  if (!lastLog) {
    if (attendance_type !== 'IN') {
      return res.json({ success: false, message: 'Cannot record TIME OUT as the first attendance.' });
    }
  } else {
    if (lastLog.attendance_type === 'IN' && attendance_type === 'IN') {
      return res.json({ success: false, message: 'Cannot record two consecutive TIME IN records.' });
    }
    if (lastLog.attendance_type === 'OUT' && attendance_type === 'OUT') {
      return res.json({ success: false, message: 'Cannot record two consecutive TIME OUT records.' });
    }
  }

  await pool.query(
    'INSERT INTO attendance_logs (worker_id, attendance_date, attendance_time, attendance_type) VALUES ($1, $2, $3, $4)',
    [worker_id, currentDate, currentTime, attendance_type]
  );

  res.json({
    success: true,
    worker: worker,
    date: currentDate,
    time: currentTime,
    type: attendance_type
  });
});

// Start Server bound explicitly to 0.0.0.0 for Render
const PORT_NUM = process.env.PORT || 3000;
app.listen(PORT_NUM, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT_NUM}`);
});
