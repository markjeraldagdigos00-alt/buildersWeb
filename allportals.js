const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const bodyParser = require('body-parser');
const QRCode = require('qrcode');

const app = express();
const PORT = process.env.PORT || 3000;

// PostgreSQL Connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(session({
  secret: 'construction_secret_key_999',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false } // Set to true if using HTTPS in production with secure proxy
}));

// Initialize Database Tables
async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS company_settings (
        id SERIAL PRIMARY KEY,
        company_name VARCHAR(255) DEFAULT 'Apex Construction Corp',
        company_logo TEXT DEFAULT '',
        company_address VARCHAR(255) DEFAULT '123 Builder St, Metro Manila',
        contact_number VARCHAR(50) DEFAULT '+63 912 345 6789'
      );

      CREATE TABLE IF NOT EXISTS work_schedules (
        id SERIAL PRIMARY KEY,
        morning_start VARCHAR(10) DEFAULT '07:00',
        morning_end VARCHAR(10) DEFAULT '12:00',
        afternoon_start VARCHAR(10) DEFAULT '13:00',
        afternoon_end VARCHAR(10) DEFAULT '17:00',
        full_day_hours NUMERIC(4,2) DEFAULT 8.0,
        half_day_hours NUMERIC(4,2) DEFAULT 4.0
      );

      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        full_name VARCHAR(255) NOT NULL,
        username VARCHAR(100) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(50) NOT NULL,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS workers (
        id SERIAL PRIMARY KEY,
        worker_id VARCHAR(50) UNIQUE NOT NULL,
        full_name VARCHAR(255) NOT NULL,
        position VARCHAR(100) NOT NULL,
        contact_number VARCHAR(50) NOT NULL,
        daily_rate NUMERIC(10,2) NOT NULL,
        assigned_project VARCHAR(255) NOT NULL,
        profile_picture TEXT DEFAULT '',
        qr_code TEXT DEFAULT '',
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS attendance_logs (
        id SERIAL PRIMARY KEY,
        worker_id VARCHAR(50) NOT NULL,
        date DATE NOT NULL,
        time TIME NOT NULL,
        attendance_type VARCHAR(10) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS advance_money (
        id SERIAL PRIMARY KEY,
        worker_id VARCHAR(50) NOT NULL,
        amount NUMERIC(10,2) NOT NULL,
        date DATE NOT NULL,
        reason TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS announcements (
        id SERIAL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        content TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Seed Default Company Settings if empty
    const compRes = await pool.query('SELECT * FROM company_settings');
    if (compRes.rows.length === 0) {
      await pool.query('INSERT INTO company_settings (company_name, company_address, contact_number) VALUES ($1, $2, $3)', 
        ['Apex Construction Corp', '123 Builder St, Metro Manila', '+63 912 345 6789']);
    }

    // Seed Default Work Schedule if empty
    const schedRes = await pool.query('SELECT * FROM work_schedules');
    if (schedRes.rows.length === 0) {
      await pool.query('INSERT INTO work_schedules DEFAULT VALUES');
    }

    // Seed Default Admin, Worker, Scanner if empty
    const userRes = await pool.query('SELECT * FROM users');
    if (userRes.rows.length === 0) {
      const hashedPass = await bcrypt.hash('admin123', 10);
      await pool.query('INSERT INTO users (full_name, username, password, role) VALUES ($1, $2, $3, $4)', ['System Admin', 'admin', hashedPass, 'ADMIN']);
      await pool.query('INSERT INTO users (full_name, username, password, role) VALUES ($1, $2, $3, $4)', ['Scanner Staff', 'scanner', hashedPass, 'SCANNER']);
      
      // Default Worker User & Profile
      const workerPass = await bcrypt.hash('worker123', 10);
      await pool.query('INSERT INTO users (full_name, username, password, role) VALUES ($1, $2, $3, $4)', ['Juan Dela Cruz', 'worker', workerPass, 'WORKER']);
      
      const qrData = await QRCode.toDataURL('W-001');
      await pool.query(`INSERT INTO workers (worker_id, full_name, position, contact_number, daily_rate, assigned_project, qr_code) 
        VALUES ($1, $2, $3, $4, $5, $6, $7)`, ['W-001', 'Juan Dela Cruz', 'Mason', '09123456789', 700.00, 'Main Tower Project', qrData]);
    }
    console.log('Database initialized successfully.');
  } catch (err) {
    console.error('Database initialization error:', err);
  }
}
initDB();

// Middleware Helpers
async function getCompanySettings() {
  const res = await pool.query('SELECT * FROM company_settings LIMIT 1');
  return res.rows[0] || { company_name: 'Apex Construction', company_logo: '', company_address: '', contact_number: '' };
}

function isAuthenticated(role) {
  return (req, res, next) => {
    if (req.session && req.session.user && req.session.user.role === role) {
      return next();
    }
    res.redirect(`/${role.toLowerCase()}`);
  };
}

// ==================== CSS STYLING HELPER ====================
const globalStyles = `
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; }
    body { background-color: #f4f6f9; color: #333; display: flex; flex-direction: column; min-height: 100vh; }
    header { background: #1e293b; color: #fff; padding: 1rem 2rem; display: flex; justify-content: space-between; align-items: center; }
    .logo-container { display: flex; align-items: center; gap: 1rem; }
    .logo-container img { height: 40px; width: 40px; object-fit: cover; border-radius: 50%; background: #ccc; }
    nav { background: #334155; padding: 0.5rem 2rem; display: flex; gap: 1.5rem; overflow-x: auto; }
    nav a { color: #cbd5e1; text-decoration: none; font-weight: 600; padding: 0.5rem 1rem; border-radius: 4px; white-space: nowrap; transition: 0.2s; }
    nav a:hover, nav a.active { background: #475569; color: #fff; }
    .container { max-width: 1200px; margin: 2rem auto; padding: 0 1rem; width: 100%; flex: 1; }
    .card { background: #fff; border-radius: 8px; padding: 1.5rem; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); margin-bottom: 1.5rem; }
    .grid-4 { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1rem; margin-bottom: 1.5rem; }
    .stat-card { background: #fff; padding: 1.5rem; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.05); border-left: 5px solid #3b82f6; }
    .stat-card h3 { font-size: 0.9rem; color: #64748b; margin-bottom: 0.5rem; }
    .stat-card p { font-size: 1.8rem; font-weight: bold; color: #1e293b; }
    table { width: 100%; border-collapse: collapse; margin-top: 1rem; background: #fff; border-radius: 8px; overflow: hidden; }
    th, td { padding: 0.75rem 1rem; text-align: left; border-bottom: 1px solid #e2e8f0; font-size: 0.95rem; }
    th { background: #f8fafc; color: #475569; font-weight: 600; }
    .btn { background: #3b82f6; color: #fff; border: none; padding: 0.6rem 1.2rem; border-radius: 6px; cursor: pointer; font-weight: 600; text-decoration: none; display: inline-block; transition: 0.2s; }
    .btn:hover { background: #2563eb; }
    .btn-danger { background: #ef4444; }
    .btn-danger:hover { background: #dc2626; }
    .btn-success { background: #22c55e; }
    .btn-success:hover { background: #16a34a; }
    form label { display: block; margin-bottom: 0.5rem; font-weight: 600; color: #475569; }
    form input, form select, form textarea { width: 100%; padding: 0.75rem; border: 1px solid #cbd5e1; border-radius: 6px; margin-bottom: 1rem; font-size: 1rem; }
    .login-wrapper { display: flex; justify-content: center; align-items: center; height: 100vh; background: #0f172a; }
    .login-card { background: #fff; padding: 2.5rem; border-radius: 12px; width: 100%; max-width: 400px; box-shadow: 0 10px 25px rgba(0,0,0,0.2); text-align: center; }
    .login-card img { height: 60px; width: 60px; object-fit: cover; border-radius: 50%; margin-bottom: 1rem; }
    .badge { padding: 0.3rem 0.6rem; border-radius: 4px; font-size: 0.75rem; font-weight: bold; color: #fff; }
    .badge-success { background: #22c55e; }
    .badge-warning { background: #f59e0b; }
    .badge-danger { background: #ef4444; }
    .badge-info { background: #3b82f6; }
    footer { text-align: center; padding: 1.5rem; background: #1e293b; color: #94a3b8; font-size: 0.9rem; margin-top: auto; }
  </style>
`;

// ==================== MAIN PAGE (/) ====================
app.get('/', async (req, res) => {
  const comp = await getCompanySettings();
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>${comp.company_name} - Construction Management System</title>
      ${globalStyles}
    </head>
    <body class="login-wrapper">
      <div class="login-card" style="max-width: 500px;">
        ${comp.company_logo ? `<img src="${comp.company_logo}" alt="Logo">` : ''}
        <h1 style="font-size: 1.5rem; margin-bottom: 0.5rem; color: #1e293b;">${comp.company_name}</h1>
        <p style="color: #64748b; margin-bottom: 2rem;">Construction Worker Management System</p>
        
        <div style="display: flex; flex-direction: column; gap: 1rem;">
          <a href="/admin" class="btn" style="padding: 1rem; font-size: 1.1rem;">ADMIN PORTAL</a>
          <a href="/worker" class="btn btn-success" style="padding: 1rem; font-size: 1.1rem;">WORKER PORTAL</a>
          <a href="/scanner" class="btn" style="background: #f59e0b; padding: 1rem; font-size: 1.1rem;">ATTENDANCE SCANNER PORTAL</a>
        </div>
      </div>
    </body>
    </html>
  `);
});

// ==================== AUTHENTICATION ROUTES ====================

// LOGIN PAGES
app.get('/admin', (req, res) => renderLogin(res, 'ADMIN', 'Admin Portal Login'));
app.get('/worker', (req, res) => renderLogin(res, 'WORKER', 'Worker Portal Login'));
app.get('/scanner', (req, res) => renderLogin(res, 'SCANNER', 'Attendance Scanner Login'));

async function renderLogin(res, role, title) {
  const comp = await getCompanySettings();
  res.send(`
    <!DOCTYPE html>
    <html>
    <head><title>${title} - ${comp.company_name}</title>${globalStyles}</head>
    <body class="login-wrapper">
      <div class="login-card">
        ${comp.company_logo ? `<img src="${comp.company_logo}" alt="Logo">` : ''}
        <h2>${title}</h2>
        <p style="color: #64748b; margin-bottom: 1.5rem; font-size: 0.9rem;">${comp.company_name}</p>
        <form action="/login" method="POST">
          <input type="hidden" name="expected_role" value="${role}">
          <div style="text-align: left;"><label>Username</label></div>
          <input type="text" name="username" required placeholder="Enter username">
          <div style="text-align: left;"><label>Password</label></div>
          <input type="password" name="password" required placeholder="Enter password">
          <button type="submit" class="btn" style="width: 100%;">Login</button>
        </form>
        <p style="margin-top: 1rem;"><a href="/" style="color: #3b82f6; text-decoration: none; font-size: 0.9rem;">← Back to Main Page</a></p>
      </div>
    </body>
    </html>
  `);
}

app.post('/login', async (req, res) => {
  const { username, password, expected_role } = req.body;
  try {
    const userRes = await pool.query('SELECT * FROM users WHERE username = $1 AND role = $2', [username, expected_role]);
    if (userRes.rows.length === 0) {
      return res.send(`<script>alert('Invalid username or password.'); window.location.href='/${expected_role.toLowerCase()}';</script>`);
    }
    const user = userRes.rows.length ? userRes.rows[0] : null;
    const match = user ? await bcrypt.compare(password, user.password) : false;
    
    if (!match) {
      return res.send(`<script>alert('Invalid username or password.'); window.location.href='/${expected_role.toLowerCase()}';</script>`);
    }

    req.session.user = { id: user.id, username: user.username, role: user.role, full_name: user.full_name };
    
    if (user.role === 'ADMIN') res.redirect('/admin/dashboard');
    else if (user.role === 'WORKER') res.redirect('/worker/dashboard');
    else if (user.role === 'SCANNER') res.redirect('/scanner/dashboard');
    else res.redirect('/');
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

app.get('/logout', (req, res) => {
  const role = req.session.user ? req.session.user.role.toLowerCase() : '';
  req.session.destroy(() => {
    res.redirect(role ? `/${role}` : '/');
  });
});

// ==================== ADMIN PORTAL ====================

app.get('/admin/*', isAuthenticated('ADMIN'), async (req, res, next) => { next(); });

const adminNav = (active) => `
  <nav>
    <a href="/admin/dashboard" class="${active==='dashboard'?'active':''}">Dashboard</a>
    <a href="/admin/workers" class="${active==='workers'?'active':''}">Workers</a>
    <a href="/admin/attendance" class="${active==='attendance'?'active':''}">Attendance</a>
    <a href="/admin/advance" class="${active==='advance'?'active':''}">Advance Money</a>
    <a href="/admin/salary" class="${active==='salary'?'active':''}">Salary</a>
    <a href="/admin/announcements" class="${active==='announcements'?'active':''}">Announcements</a>
    <a href="/admin/settings" class="${active==='settings'?'active':''}">Company Settings</a>
    <a href="/admin/schedule" class="${active==='schedule'?'active':''}">Work Schedule</a>
    <a href="/logout">Logout</a>
  </nav>
`;

async function renderAdminLayout(title, content, activeTab) {
  const comp = await getCompanySettings();
  return `
    <!DOCTYPE html>
    <html>
    <head><title>${title} - ${comp.company_name}</title>${globalStyles}</head>
    <body>
      <header>
        <div class="logo-container">
          ${comp.company_logo ? `<img src="${comp.company_logo}" alt="Logo">` : ''}
          <h2>${comp.company_name} - Admin Portal</h2>
        </div>
        <span>Welcome, Admin</span>
      </header>
      ${adminNav(activeTab)}
      <div class="container">${content}</div>
      <footer>${comp.company_name} Construction Worker Management System</footer>
    </body>
    </html>
  `;
}

// ADMIN DASHBOARD
app.get('/admin/dashboard', isAuthenticated('ADMIN'), async (req, res) => {
  const totalWorkers = (await pool.query('SELECT COUNT(*) FROM workers')).rows[0].count;
  const today = new Date().toISOString().split('T')[0];
  const presentToday = (await pool.query('SELECT COUNT(DISTINCT worker_id) FROM attendance_logs WHERE date = $1', [today])).rows[0].count;
  const recentLogs = await pool.query('SELECT a.*, w.full_name FROM attendance_logs a JOIN workers w ON a.worker_id = w.worker_id WHERE a.date = $1 ORDER BY a.id DESC LIMIT 10', [today]);
  
  const content = `
    <h1>Admin Dashboard</h1>
    <div class="grid-4">
      <div class="stat-card"><h3>Total Workers</h3><p>${totalWorkers}</p></div>
      <div class="stat-card" style="border-left-color: #22c55e;"><h3>Present Today</h3><p>${presentToday}</p></div>
    </div>
    <div class="card">
      <h3>Recent Attendance Logs Today</h3>
      <table>
        <thead><tr><th>Worker ID</th><th>Name</th><th>Time</th><th>Type</th></tr></thead>
        <tbody>
          ${recentLogs.rows.length === 0 ? '<tr><td colspan="4">No attendance recorded today yet.</td></tr>' : 
            recentLogs.rows.map(l => `<tr><td>${l.worker_id}</td><td>${l.full_name}</td><td>${l.time}</td><td><span class="badge ${l.attendance_type==='IN'?'badge-success':'badge-danger'}">${l.attendance_type}</span></td></tr>`).join('')}
        </tbody>
      </table>
    </div>
  `;
  res.send(await renderAdminLayout('Dashboard', content, 'dashboard'));
});

// WORKER MANAGEMENT
app.get('/admin/workers', isAuthenticated('ADMIN'), async (req, res) => {
  const search = req.query.search || '';
  const workers = await pool.query('SELECT * FROM workers WHERE full_name ILIKE $1 OR worker_id ILIKE $1 ORDER BY id DESC', [`%${search}%`]);
  
  const content = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
      <h1>Workers Management</h1>
      <a href="/admin/workers/new" class="btn">+ Register Worker</a>
    </div>
    <div class="card">
      <form method="GET" action="/admin/workers" style="display: flex; gap: 1rem;">
        <input type="text" name="search" placeholder="Search by name or ID..." value="${search}" style="margin-bottom: 0;">
        <button type="submit" class="btn">Search</button>
      </form>
    </div>
    <div class="card">
      <table>
        <thead><tr><th>ID</th><th>Name</th><th>Position</th><th>Project</th><th>Daily Rate</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>
          ${workers.rows.map(w => `
            <tr>
              <td>${w.worker_id}</td>
              <td>${w.full_name}</td>
              <td>${w.position}</td>
              <td>${w.assigned_project}</td>
              <td>₱${parseFloat(w.daily_rate).toFixed(2)}</td>
              <td><span class="badge ${w.is_active?'badge-success':'badge-danger'}">${w.is_active?'Active':'Inactive'}</span></td>
              <td>
                <a href="/admin/workers/edit/${w.id}" class="btn" style="padding: 0.3rem 0.6rem; font-size: 0.8rem;">Edit</a>
                <a href="/admin/workers/qr/${w.id}" class="btn btn-success" style="padding: 0.3rem 0.6rem; font-size: 0.8rem;">QR</a>
                <a href="/admin/workers/delete/${w.id}" class="btn btn-danger" style="padding: 0.3rem 0.6rem; font-size: 0.8rem;" onclick="return confirm('Delete worker?')">Delete</a>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
  res.send(await renderAdminLayout('Workers', content, 'workers'));
});

app.get('/admin/workers/new', isAuthenticated('ADMIN'), async (req, res) => {
  const content = `
    <h1>Register New Worker</h1>
    <div class="card">
      <form action="/admin/workers/new" method="POST">
        <label>Full Name</label>
        <input type="text" name="full_name" required>
        <label>Position</label>
        <input type="text" name="position" required>
        <label>Contact Number</label>
        <input type="text" name="contact_number" required>
        <label>Daily Rate (₱)</label>
        <input type="number" step="0.01" name="daily_rate" required>
        <label>Assigned Project</label>
        <input type="text" name="assigned_project" required>
        <label>Username</label>
        <input type="text" name="username" required>
        <label>Password</label>
        <input type="password" name="password" required>
        <button type="submit" class="btn">Register Worker</button>
      </form>
    </div>
  `;
  res.send(await renderAdminLayout('Register Worker', content, 'workers'));
});

app.post('/admin/workers/new', isAuthenticated('ADMIN'), async (req, res) => {
  const { full_name, position, contact_number, daily_rate, assigned_project, username, password } = req.body;
  try {
    const countRes = await pool.query('SELECT COUNT(*) FROM workers');
    const workerId = `W-${String(parseInt(countRes.rows[0].count) + 1).padStart(3, '0')}`;
    const qrData = await QRCode.toDataURL(workerId);
    
    await pool.query(`INSERT INTO workers (worker_id, full_name, position, contact_number, daily_rate, assigned_project, qr_code) 
      VALUES ($1, $2, $3, $4, $5, $6, $7)`, [workerId, full_name, position, contact_number, daily_rate, assigned_project, qrData]);

    const hashedPass = await bcrypt.hash(password, 10);
    await pool.query('INSERT INTO users (full_name, username, password, role) VALUES ($1, $2, $3, $4)', [full_name, username, hashedPass, 'WORKER']);

    res.redirect('/admin/workers');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error registering worker');
  }
});

app.get('/admin/workers/qr/:id', isAuthenticated('ADMIN'), async (req, res) => {
  const worker = (await pool.query('SELECT * FROM workers WHERE id = $1', [req.params.id])).rows[0];
  const content = `
    <h1>Worker QR Code - ${worker.full_name} (${worker.worker_id})</h1>
    <div class="card" style="text-align: center;">
      <img src="${worker.qr_code}" alt="QR Code" style="width: 250px; height: 250px; border: 1px solid #ccc; padding: 10px; background: #fff;"><br><br>
      <a href="${worker.qr_code}" download="${worker.worker_id}_QR.png" class="btn">Download QR Code</a>
      <a href="/admin/workers" class="btn" style="background: #64748b;">Back to Workers</a>
    </div>
  `;
  res.send(await renderAdminLayout('Worker QR', content, 'workers'));
});

app.get('/admin/workers/delete/:id', isAuthenticated('ADMIN'), async (req, res) => {
  const worker = (await pool.query('SELECT * FROM workers WHERE id = $1', [req.params.id])).rows[0];
  if (worker) {
    await pool.query('DELETE FROM workers WHERE id = $1', [req.params.id]);
    await pool.query('DELETE FROM users WHERE username = $1', [worker.worker_id.toLowerCase()]); // cleanup
  }
  res.redirect('/admin/workers');
});

// ATTENDANCE MANAGEMENT
app.get('/admin/attendance', isAuthenticated('ADMIN'), async (req, res) => {
  const date = req.query.date || new Date().toISOString().split('T')[0];
  const logs = await pool.query('SELECT a.*, w.full_name, w.position FROM attendance_logs a JOIN workers w ON a.worker_id = w.worker_id WHERE a.date = $1 ORDER BY a.time ASC', [date]);
  
  const content = `
    <h1>Attendance Management</h1>
    <div class="card">
      <form method="GET" action="/admin/attendance" style="display: flex; gap: 1rem; align-items: flex-end;">
        <div style="flex: 1;"><label>Select Date</label><input type="date" name="date" value="${date}" style="margin-bottom:0;"></div>
        <button type="submit" class="btn">Filter</button>
      </form>
    </div>
    <div class="card">
      <h3>Attendance Logs for ${date}</h3>
      <table>
        <thead><tr><th>Worker ID</th><th>Name</th><th>Position</th><th>Time</th><th>Type</th></tr></thead>
        <tbody>
          ${logs.rows.length === 0 ? '<tr><td colspan="5">No attendance logs found for this date.</td></tr>' :
            logs.rows.map(l => `<tr><td>${l.worker_id}</td><td>${l.full_name}</td><td>${l.position}</td><td>${l.time}</td><td><span class="badge ${l.attendance_type==='IN'?'badge-success':'badge-danger'}">${l.attendance_type}</span></td></tr>`).join('')}
        </tbody>
      </table>
    </div>
  `;
  res.send(await renderAdminLayout('Attendance', content, 'attendance'));
});

// ADVANCE MONEY
app.get('/admin/advance', isAuthenticated('ADMIN'), async (req, res) => {
  const advances = await pool.query('SELECT am.*, w.full_name FROM advance_money am JOIN workers w ON am.worker_id = w.worker_id ORDER BY am.date DESC');
  const workers = await pool.query('SELECT worker_id, full_name FROM workers');
  
  const content = `
    <h1>Advance Money Management</h1>
    <div class="card">
      <h3>Record Advance Money</h3>
      <form action="/admin/advance" method="POST">
        <label>Worker</label>
        <select name="worker_id" required>
          ${workers.rows.map(w => `<option value="${w.worker_id}">${w.full_name} (${w.worker_id})</option>`).join('')}
        </select>
        <label>Amount (₱)</label>
        <input type="number" step="0.01" name="amount" required>
        <label>Date</label>
        <input type="date" name="date" value="${new Date().toISOString().split('T')[0]}" required>
        <label>Reason / Notes</label>
        <input type="text" name="reason">
        <button type="submit" class="btn">Save Advance</button>
      </form>
    </div>
    <div class="card">
      <h3>Advance History</h3>
      <table>
        <thead><tr><th>Date</th><th>Worker ID</th><th>Name</th><th>Amount</th><th>Reason</th></tr></thead>
        <tbody>
          ${advances.rows.map(a => `<tr><td>${a.date}</td><td>${a.worker_id}</td><td>${a.full_name}</td><td>₱${parseFloat(a.amount).toFixed(2)}</td><td>${a.reason || '-'}</td></tr>`).join('')}
        </tbody>
      </table>
    </div>
  `;
  res.send(await renderAdminLayout('Advance Money', content, 'advance'));
});

app.post('/admin/advance', isAuthenticated('ADMIN'), async (req, res) => {
  const { worker_id, amount, date, reason } = req.body;
  await pool.query('INSERT INTO advance_money (worker_id, amount, date, reason) VALUES ($1, $2, $3, $4)', [worker_id, amount, date, reason]);
  res.redirect('/admin/advance');
});

// SALARY MANAGEMENT
app.get('/admin/salary', isAuthenticated('ADMIN'), async (req, res) => {
  const workers = await pool.query('SELECT * FROM workers');
  
  // Calculate simple salary metrics per worker
  const salaryData = [];
  for (let w of workers.rows) {
    const logs = (await pool.query('SELECT * FROM attendance_logs WHERE worker_id = $1 ORDER BY date, time', [w.worker_id])).rows;
    const advanceRes = (await pool.query('SELECT SUM(amount) as total FROM advance_money WHERE worker_id = $1', [w.worker_id])).rows[0].total || 0;
    
    // Group logs by date to compute full days / half days
    const daysMap = {};
    logs.forEach(l => {
      if (!daysMap[l.date]) daysMap[l.date] = [];
      daysMap[l.date].push(l);
    });

    let fullDays = 0;
    let halfDays = 0;
    Object.keys(daysMap).forEach(date => {
      const dayLogs = daysMap[date];
      if (dayLogs.length >= 4) fullDays++;
      else if (dayLogs.length >= 2) halfDays++;
    });

    const equivalentDays = fullDays + (halfDays * 0.5);
    const totalSalary = equivalentDays * parseFloat(w.daily_rate);
    const netSalary = totalSalary - parseFloat(advanceRes);

    salaryData.push({
      ...w,
      fullDays,
      halfDays,
      equivalentDays,
      totalSalary,
      advance: parseFloat(advanceRes),
      netSalary
    });
  }

  const content = `
    <h1>Salary Calculation & Payroll</h1>
    <div class="card">
      <table>
        <thead><tr><th>Worker ID</th><th>Name</th><th>Daily Rate</th><th>Full Days</th><th>Half Days</th><th>Equivalent</th><th>Total Salary</th><th>Advance</th><th>Net Salary</th></tr></thead>
        <tbody>
          ${salaryData.map(s => `
            <tr>
              <td>${s.worker_id}</td>
              <td>${s.full_name}</td>
              <td>₱${parseFloat(s.daily_rate).toFixed(2)}</td>
              <td>${s.fullDays}</td>
              <td>${s.halfDays}</td>
              <td>${s.equivalentDays}</td>
              <td>₱${s.totalSalary.toFixed(2)}</td>
              <td>₱${s.advance.toFixed(2)}</td>
              <td><strong>₱${s.netSalary.toFixed(2)}</strong></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
  res.send(await renderAdminLayout('Salary Management', content, 'salary'));
});

// ANNOUNCEMENTS
app.get('/admin/announcements', isAuthenticated('ADMIN'), async (req, res) => {
  const anns = await pool.query('SELECT * FROM announcements ORDER BY id DESC');
  const content = `
    <h1>Announcements</h1>
    <div class="card">
      <h3>Create Announcement</h3>
      <form action="/admin/announcements" method="POST">
        <label>Title</label>
        <input type="text" name="title" required>
        <label>Content</label>
        <textarea name="content" rows="3" required></textarea>
        <button type="submit" class="btn">Post Announcement</button>
      </form>
    </div>
    <div class="card">
      <h3>All Announcements</h3>
      ${anns.rows.map(a => `<div style="border-bottom: 1px solid #eee; padding: 1rem 0;"><h4>${a.title}</h4><p>${a.content}</p><a href="/admin/announcements/delete/${a.id}" class="btn btn-danger" style="font-size: 0.7rem; padding: 0.2rem 0.5rem; margin-top: 0.5rem;">Delete</a></div>`).join('')}
    </div>
  `;
  res.send(await renderAdminLayout('Announcements', content, 'announcements'));
});

app.post('/admin/announcements', isAuthenticated('ADMIN'), async (req, res) => {
  const { title, content } = req.body;
  await pool.query('INSERT INTO announcements (title, content) VALUES ($1, $2)', [title, content]);
  res.redirect('/admin/announcements');
});

app.get('/admin/announcements/delete/:id', isAuthenticated('ADMIN'), async (req, res) => {
  await pool.query('DELETE FROM announcements WHERE id = $1', [req.params.id]);
  res.redirect('/admin/announcements');
});

// COMPANY SETTINGS
app.get('/admin/settings', isAuthenticated('ADMIN'), async (req, res) => {
  const comp = await getCompanySettings();
  const content = `
    <h1>Company Settings</h1>
    <div class="card">
      <form action="/admin/settings" method="POST">
        <label>Company Name</label>
        <input type="text" name="company_name" value="${comp.company_name}" required>
        <label>Company Logo URL (Image Link)</label>
        <input type="text" name="company_logo" value="${comp.company_logo || ''}" placeholder="https://example.com/logo.png">
        <label>Company Address</label>
        <input type="text" name="company_address" value="${comp.company_address}">
        <label>Contact Number</label>
        <input type="text" name="contact_number" value="${comp.contact_number}">
        <button type="submit" class="btn">Save Changes</button>
      </form>
    </div>
  `;
  res.send(await renderAdminLayout('Company Settings', content, 'settings'));
});

app.post('/admin/settings', isAuthenticated('ADMIN'), async (req, res) => {
  const { company_name, company_logo, company_address, contact_number } = req.body;
  await pool.query('UPDATE company_settings SET company_name = $1, company_logo = $2, company_address = $3, contact_number = $4', 
    [company_name, company_logo, company_address, contact_number]);
  res.redirect('/admin/settings');
});

// WORK SCHEDULE SETTINGS
app.get('/admin/schedule', isAuthenticated('ADMIN'), async (req, res) => {
  const sched = (await pool.query('SELECT * FROM work_schedules LIMIT 1')).rows[0];
  const content = `
    <h1>Work Schedule Settings</h1>
    <div class="card">
      <form action="/admin/schedule" method="POST">
        <label>Morning Start Time</label>
        <input type="text" name="morning_start" value="${sched.morning_start}">
        <label>Morning End Time</label>
        <input type="text" name="morning_end" value="${sched.morning_end}">
        <label>Afternoon Start Time</label>
        <input type="text" name="afternoon_start" value="${sched.afternoon_start}">
        <label>Afternoon End Time</label>
        <input type="text" name="afternoon_end" value="${sched.afternoon_end}">
        <button type="submit" class="btn">Update Schedule</button>
      </form>
    </div>
  `;
  res.send(await renderAdminLayout('Work Schedule', content, 'schedule'));
});

app.post('/admin/schedule', isAuthenticated('ADMIN'), async (req, res) => {
  const { morning_start, morning_end, afternoon_start, afternoon_end } = req.body;
  await pool.query('UPDATE work_schedules SET morning_start=$1, morning_end=$2, afternoon_start=$3, afternoon_end=$4', 
    [morning_start, morning_end, afternoon_start, afternoon_end]);
  res.redirect('/admin/schedule');
});


// ==================== WORKER PORTAL ====================

app.get('/worker/*', isAuthenticated('WORKER'), async (req, res, next) => { next(); });

const workerNav = (active) => `
  <nav>
    <a href="/worker/dashboard" class="${active==='dashboard'?'active':''}">Dashboard</a>
    <a href="/worker/qr" class="${active==='qr'?'active':''}">My QR Code</a>
    <a href="/worker/attendance" class="${active==='attendance'?'active':''}">My Attendance</a>
    <a href="/worker/advance" class="${active==='advance'?'active':''}">My Advance</a>
    <a href="/worker/salary" class="${active==='salary'?'active':''}">My Salary</a>
    <a href="/worker/announcements" class="${active==='announcements'?'active':''}">Announcements</a>
    <a href="/logout">Logout</a>
  </nav>
`;

async function renderWorkerLayout(title, content, activeTab, sessionUser) {
  const comp = await getCompanySettings();
  return `
    <!DOCTYPE html>
    <html>
    <head><title>${title} - ${comp.company_name}</title>${globalStyles}</head>
    <body>
      <header>
        <div class="logo-container">
          ${comp.company_logo ? `<img src="${comp.company_logo}" alt="Logo">` : ''}
          <h2>${comp.company_name} - Worker Portal</h2>
        </div>
        <span>${sessionUser.full_name}</span>
      </header>
      ${workerNav(activeTab)}
      <div class="container">${content}</div>
      <footer>${comp.company_name} Construction Worker Management System</footer>
    </body>
    </html>
  `;
}

app.get('/worker/dashboard', isAuthenticated('WORKER'), async (req, res) => {
  const workerRes = await pool.query('SELECT * FROM workers WHERE full_name = $1 OR worker_id = (SELECT username FROM users WHERE id = $2)', [req.session.user.full_name, req.session.user.id]);
  const worker = workerRes.rows[0] || { worker_id: 'W-001', position: 'Worker', assigned_project: 'General' };
  
  const content = `
    <h1>Worker Dashboard</h1>
    <div class="card">
      <h2>Welcome, ${worker.full_name}</h2>
      <p><strong>Worker ID:</strong> ${worker.worker_id}</p>
      <p><strong>Position:</strong> ${worker.position}</p>
      <p><strong>Assigned Project:</strong> ${worker.assigned_project}</p>
    </div>
  `;
  res.send(await renderWorkerLayout('Dashboard', content, 'dashboard', req.session.user));
});

app.get('/worker/qr', isAuthenticated('WORKER'), async (req, res) => {
  const worker = (await pool.query('SELECT * FROM workers WHERE full_name = $1', [req.session.user.full_name])).rows[0];
  const content = `
    <h1>My QR Code</h1>
    <div class="card" style="text-align: center;">
      ${worker && worker.qr_code ? `<img src="${worker.qr_code}" alt="QR" style="width: 250px; height: 250px;"><p><strong>Worker ID: ${worker.worker_id}</strong></p>` : '<p>QR Code not generated yet.</p>'}
    </div>
  `;
  res.send(await renderWorkerLayout('My QR', content, 'qr', req.session.user));
});

app.get('/worker/attendance', isAuthenticated('WORKER'), async (req, res) => {
  const worker = (await pool.query('SELECT * FROM workers WHERE full_name = $1', [req.session.user.full_name])).rows[0];
  const logs = worker ? (await pool.query('SELECT * FROM attendance_logs WHERE worker_id = $1 ORDER BY date DESC, time DESC', [worker.worker_id])).rows : [];
  
  const content = `
    <h1>My Attendance Logs</h1>
    <div class="card">
      <table>
        <thead><tr><th>Date</th><th>Time</th><th>Type</th></tr></thead>
        <tbody>
          ${logs.length === 0 ? '<tr><td colspan="3">No attendance records found.</td></tr>' :
            logs.map(l => `<tr><td>${l.date}</td><td>${l.time}</td><td><span class="badge ${l.attendance_type==='IN'?'badge-success':'badge-danger'}">${l.attendance_type}</span></td></tr>`).join('')}
        </tbody>
      </table>
    </div>
  `;
  res.send(await renderWorkerLayout('My Attendance', content, 'attendance', req.session.user));
});

app.get('/worker/advance', isAuthenticated('WORKER'), async (req, res) => {
  const worker = (await pool.query('SELECT * FROM workers WHERE full_name = $1', [req.session.user.full_name])).rows[0];
  const advances = worker ? (await pool.query('SELECT * FROM advance_money WHERE worker_id = $1 ORDER BY date DESC', [worker.worker_id])).rows : [];
  
  const content = `
    <h1>My Advance Money</h1>
    <div class="card">
      <table>
        <thead><tr><th>Date</th><th>Amount</th><th>Reason</th></tr></thead>
        <tbody>
          ${advances.length === 0 ? '<tr><td colspan="3">No advance money records.</td></tr>' :
            advances.map(a => `<tr><td>${a.date}</td><td>₱${parseFloat(a.amount).toFixed(2)}</td><td>${a.reason || '-'}</td></tr>`).join('')}
        </tbody>
      </table>
    </div>
  `;
  res.send(await renderWorkerLayout('My Advance', content, 'advance', req.session.user));
});

app.get('/worker/salary', isAuthenticated('WORKER'), async (req, res) => {
  const worker = (await pool.query('SELECT * FROM workers WHERE full_name = $1', [req.session.user.full_name])).rows[0];
  const content = `
    <h1>My Salary Overview</h1>
    <div class="card">
      <p><strong>Daily Rate:</strong> ₱${worker ? parseFloat(worker.daily_rate).toFixed(2) : 0}</p>
      <p>Contact Admin for complete payroll breakdown.</p>
    </div>
  `;
  res.send(await renderWorkerLayout('My Salary', content, 'salary', req.session.user));
});

app.get('/worker/announcements', isAuthenticated('WORKER'), async (req, res) => {
  const anns = await pool.query('SELECT * FROM announcements ORDER BY id DESC');
  const content = `
    <h1>Company Announcements</h1>
    <div class="card">
      ${anns.rows.map(a => `<div style="border-bottom: 1px solid #eee; padding: 1rem 0;"><h4>${a.title}</h4><p>${a.content}</p></div>`).join('')}
    </div>
  `;
  res.send(await renderWorkerLayout('Announcements', content, 'announcements', req.session.user));
});


// ==================== ATTENDANCE SCANNER PORTAL ====================

app.get('/scanner/*', isAuthenticated('SCANNER'), async (req, res, next) => { next(); });

const scannerNav = (active) => `
  <nav>
    <a href="/scanner/dashboard" class="${active==='dashboard'?'active':''}">Dashboard</a>
    <a href="/scanner/scan" class="${active==='scan'?'active':''}">Scan QR Code</a>
    <a href="/scanner/attendance" class="${active==='attendance'?'active':''}">Today's Attendance</a>
    <a href="/logout">Logout</a>
  </nav>
`;

async function renderScannerLayout(title, content, activeTab) {
  const comp = await getCompanySettings();
  return `
    <!DOCTYPE html>
    <html>
    <head><title>${title} - ${comp.company_name}</title>${globalStyles}</head>
    <body>
      <header>
        <div class="logo-container">
          ${comp.company_logo ? `<img src="${comp.company_logo}" alt="Logo">` : ''}
          <h2>${comp.company_name} - Scanner Portal</h2>
        </div>
        <span>Scanner Staff</span>
      </header>
      ${scannerNav(activeTab)}
      <div class="container">${content}</div>
      <footer>${comp.company_name} Construction Worker Management System</footer>
    </body>
    </html>
  `;
}

app.get('/scanner/dashboard', isAuthenticated('SCANNER'), async (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const presentToday = (await pool.query('SELECT COUNT(DISTINCT worker_id) FROM attendance_logs WHERE date = $1', [today])).rows[0].count;
  
  const content = `
    <h1>Scanner Dashboard</h1>
    <div class="grid-4">
      <div class="stat-card"><h3>Total Present Today</h3><p>${presentToday}</p></div>
    </div>
  `;
  res.send(await renderScannerLayout('Dashboard', content, 'dashboard'));
});

app.get('/scanner/scan', isAuthenticated('SCANNER'), async (req, res) => {
  const content = `
    <h1>Attendance QR Scanner</h1>
    <div class="card" style="text-align: center;">
      <form action="/scanner/scan" method="POST">
        <h3>Select Attendance Type</h3>
        <div style="margin: 1.5rem 0; display: flex; justify-content: center; gap: 1rem;">
          <label style="font-size: 1.2rem; cursor: pointer;"><input type="radio" name="attendance_type" value="IN" required> TIME IN</label>
          <label style="font-size: 1.2rem; cursor: pointer;"><input type="radio" name="attendance_type" value="OUT" required> TIME OUT</label>
        </div>
        <label>Enter or Scan Worker ID (e.g. W-001)</label>
        <input type="text" name="worker_id" required placeholder="Scan Worker QR or Enter ID" style="max-width: 400px; margin: 0 auto 1rem auto; text-align: center; font-size: 1.2rem;">
        <br>
        <button type="submit" class="btn btn-success" style="padding: 1rem 2rem; font-size: 1.1rem;">Record Attendance</button>
      </form>
    </div>
  `;
  res.send(await renderScannerLayout('Scan QR', content, 'scan'));
});

app.post('/scanner/scan', isAuthenticated('SCANNER'), async (req, res) => {
  const { worker_id, attendance_type } = req.body;
  const today = new Date().toISOString().split('T')[0];
  const time = new Date().toTimeString().split(' ')[0];

  const worker = (await pool.query('SELECT * FROM workers WHERE worker_id = $1', [worker_id])).rows[0];
  if (!worker) {
    return res.send(`<script>alert('Worker Not Found!'); window.location.href='/scanner/scan';</script>`);
  }

  // Validate Sequence (Optional check for alternating IN/OUT)
  const lastLog = (await pool.query('SELECT * FROM attendance_logs WHERE worker_id = $1 AND date = $2 ORDER BY id DESC LIMIT 1', [worker_id, today])).rows[0];
  if (lastLog && lastLog.attendance_type === attendance_type) {
    return res.send(`<script>alert('Invalid sequence! Cannot record consecutive ${attendance_type}.'); window.location.href='/scanner/scan';</script>`);
  }

  await pool.query('INSERT INTO attendance_logs (worker_id, date, time, attendance_type) VALUES ($1, $2, $3, $4)', [worker_id, today, time, attendance_type]);
  res.send(`<script>alert('Attendance recorded successfully for ${worker.full_name} (${attendance_type})'); window.location.href='/scanner/scan';</script>`);
});

app.get('/scanner/attendance', isAuthenticated('SCANNER'), async (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const logs = await pool.query('SELECT a.*, w.full_name, w.position FROM attendance_logs a JOIN workers w ON a.worker_id = w.worker_id WHERE a.date = $1 ORDER BY a.id DESC', [today]);
  
  const content = `
    <h1>Today's Attendance Logs</h1>
    <div class="card">
      <table>
        <thead><tr><th>Worker ID</th><th>Name</th><th>Position</th><th>Time</th><th>Type</th></tr></thead>
        <tbody>
          ${logs.rows.length === 0 ? '<tr><td colspan="5">No scans recorded today.</td></tr>' :
            logs.rows.map(l => `<tr><td>${l.worker_id}</td><td>${l.full_name}</td><td>${l.position}</td><td>${l.time}</td><td><span class="badge ${l.attendance_type==='IN'?'badge-success':'badge-danger'}">${l.attendance_type}</span></td></tr>`).join('')}
        </tbody>
      </table>
    </div>
  `;
  res.send(await renderScannerLayout('Today Attendance', content, 'attendance'));
});

// Start Server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
