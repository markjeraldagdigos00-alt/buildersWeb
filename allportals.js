const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const QRCode = require('qrcode');

const app = express();
const PORT = process.env.PORT || 3000;

// PostgreSQL Connection Pool using Render's DATABASE_URL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use(session({
  secret: process.env.SESSION_SECRET || 'construction-management-secret-key-2026',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false } // Set to true if using HTTPS in production
}));

// ==========================================
// DATABASE INITIALIZATION
// ==========================================
async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        full_name VARCHAR(255) NOT NULL,
        username VARCHAR(100) UNIQUE NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        role VARCHAR(50) NOT NULL DEFAULT 'WORKER',
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS workers (
        id SERIAL PRIMARY KEY,
        worker_id VARCHAR(50) UNIQUE NOT NULL,
        full_name VARCHAR(255) NOT NULL,
        position VARCHAR(100) NOT NULL,
        contact_number VARCHAR(50),
        daily_rate NUMERIC(10,2) NOT NULL DEFAULT 0.00,
        assigned_project VARCHAR(255),
        profile_picture TEXT,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS qr_codes (
        id SERIAL PRIMARY KEY,
        worker_id VARCHAR(50) REFERENCES workers(worker_id) ON DELETE CASCADE,
        qr_data TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS attendance_logs (
        id SERIAL PRIMARY KEY,
        worker_id VARCHAR(50) REFERENCES workers(worker_id) ON DELETE CASCADE,
        date DATE NOT NULL,
        time TIME NOT NULL,
        attendance_type VARCHAR(10) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS advance_money (
        id SERIAL PRIMARY KEY,
        worker_id VARCHAR(50) REFERENCES workers(worker_id) ON DELETE CASCADE,
        amount NUMERIC(10,2) NOT NULL,
        date DATE NOT NULL,
        reason TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS salary_records (
        id SERIAL PRIMARY KEY,
        worker_id VARCHAR(50) REFERENCES workers(worker_id) ON DELETE CASCADE,
        full_days INTEGER DEFAULT 0,
        half_days INTEGER DEFAULT 0,
        equivalent_days NUMERIC(5,2) DEFAULT 0.00,
        total_salary NUMERIC(10,2) DEFAULT 0.00,
        advance_deduction NUMERIC(10,2) DEFAULT 0.00,
        net_salary NUMERIC(10,2) DEFAULT 0.00,
        calculated_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS announcements (
        id SERIAL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        message TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS company_settings (
        id SERIAL PRIMARY KEY,
        company_name VARCHAR(255) DEFAULT 'Apex Construction Co.',
        company_logo TEXT DEFAULT '',
        company_address VARCHAR(255) DEFAULT '123 Builder St, Metro Manila',
        contact_number VARCHAR(50) DEFAULT '+63 912 345 6789'
      );

      CREATE TABLE IF NOT EXISTS work_schedules (
        id SERIAL PRIMARY KEY,
        morning_start TIME DEFAULT '07:00:00',
        morning_end TIME DEFAULT '12:00:00',
        afternoon_start TIME DEFAULT '13:00:00',
        afternoon_end TIME DEFAULT '17:00:00',
        full_day_hours NUMERIC(4,2) DEFAULT 8.00,
        half_day_hours NUMERIC(4,2) DEFAULT 4.00
      );
    `);

    // Insert default company settings if empty
    const settingsCheck = await pool.query('SELECT * FROM company_settings LIMIT 1');
    if (settingsCheck.rows.length === 0) {
      await pool.query('INSERT INTO company_settings (company_name, company_address, contact_number) VALUES ($1, $2, $3)', [
        'Apex Construction Co.', '123 Builder St, Metro Manila', '+63 912 345 6789'
      ]);
    }

    // Insert default work schedule if empty
    const scheduleCheck = await pool.query('SELECT * FROM work_schedules LIMIT 1');
    if (scheduleCheck.rows.length === 0) {
      await pool.query('INSERT INTO work_schedules DEFAULT VALUES');
    }

    console.log('Database tables verified and initialized successfully.');
  } catch (err) {
    console.error('Database initialization error:', err);
  }
}

initDB();

// ==========================================
// MIDDLEWARES & HELPERS
// ==========================================
async function getCompanySettings() {
  try {
    const res = await pool.query('SELECT * FROM company_settings LIMIT 1');
    return res.rows[0] || { company_name: 'Construction System', company_logo: '', company_address: '', contact_number: '' };
  } catch {
    return { company_name: 'Construction System', company_logo: '', company_address: '', contact_number: '' };
  }
}

function requireAuth(role) {
  return async (req, res, next) => {
    if (!req.session.user) {
      if (role === 'ADMIN') return res.redirect('/admin');
      if (role === 'WORKER') return res.redirect('/worker');
      if (role === 'SCANNER') return res.redirect('/scanner');
      return res.redirect('/');
    }
    if (role && req.session.user.role !== role) {
      return res.send(renderLayout('Access Denied', `
        <div class="card error-card">
          <h2>Access Denied</h2>
          <p>You do not have permission to access this portal.</p>
          <a href="/" class="btn">Return to Home</a>
        </div>
      `, await getCompanySettings()));
    }
    next();
  };
}

// Global Layout Wrapper
function renderLayout(title, content, company, customScripts = '') {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} - ${company.company_name}</title>
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
    body { background-color: #f1f5f9; color: var(--dark); min-height: 100vh; display: flex; flex-direction: column; }
    header { background: var(--dark); color: white; padding: 1rem 2rem; display: flex; justify-content: space-between; align-items: center; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    .brand { display: flex; align-items: center; gap: 1rem; text-decoration: none; color: white; }
    .brand img { height: 40px; width: 40px; object-fit: cover; border-radius: 50%; background: white; }
    .brand h1 { font-size: 1.25rem; font-weight: 600; }
    .container { max-width: 1200px; margin: 2rem auto; padding: 0 1rem; width: 100%; flex: 1; }
    .card { background: white; border-radius: 8px; padding: 2rem; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); margin-bottom: 1.5rem; }
    .btn { display: inline-block; background: var(--primary); color: white; padding: 0.75rem 1.5rem; border: none; border-radius: 6px; font-weight: 600; cursor: pointer; text-decoration: none; text-align: center; transition: background 0.2s; }
    .btn:hover { background: var(--primary-dark); }
    .btn-danger { background: var(--danger); }
    .btn-danger:hover { background: #dc2626; }
    .btn-success { background: var(--success); }
    .btn-success:hover { background: #16a34a; }
    table { width: 100%; border-collapse: collapse; margin-top: 1rem; }
    th, td { padding: 0.75rem 1rem; text-align: left; border-bottom: 1px solid var(--border); }
    th { background: #f8fafc; font-weight: 600; color: var(--gray); }
    input, select, textarea { width: 100%; padding: 0.75rem; border: 1px solid var(--border); border-radius: 6px; margin-top: 0.5rem; margin-bottom: 1rem; font-size: 1rem; }
    label { font-weight: 600; color: var(--dark); display: block; margin-top: 0.5rem; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 1.5rem; margin-bottom: 1.5rem; }
    .stat-card { background: white; padding: 1.5rem; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.05); border-left: 4px solid var(--primary); }
    .stat-card h3 { color: var(--gray); font-size: 0.9rem; text-transform: uppercase; margin-bottom: 0.5rem; }
    .stat-card p { font-size: 1.8rem; font-weight: 700; color: var(--dark); }
    .nav-links { display: flex; gap: 1rem; align-items: center; flex-wrap: wrap; }
    .nav-links a { color: white; text-decoration: none; padding: 0.5rem 1rem; border-radius: 4px; transition: background 0.2s; }
    .nav-links a:hover { background: rgba(255,255,255,0.1); }
    .error-card { text-align: center; max-width: 500px; margin: 4rem auto; }
    .error-card h2 { color: var(--danger); margin-bottom: 1rem; }
    .alert { padding: 1rem; border-radius: 6px; margin-bottom: 1rem; font-weight: 600; }
    .alert-success { background: #dcfce7; color: #166534; }
    .alert-error { background: #fee2e2; color: #991b1b; }
    footer { text-align: center; padding: 1.5rem; background: white; color: var(--gray); border-top: 1px solid var(--border); margin-top: auto; }
  </style>
</head>
<body>
  <header>
    <a href="/" class="brand">
      ${company.company_logo ? `<img src="${company.company_logo}" alt="Logo">` : `<div style="width:40px;height:40px;background:var(--primary);border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:bold;color:white;">${company.company_name.charAt(0)}</div>`}
      <h1>${company.company_name}</h1>
    </a>
    <div class="nav-links">
      <a href="/">Home</a>
      <a href="/admin">Admin</a>
      <a href="/worker">Worker</a>
      <a href="/scanner">Scanner</a>
    </div>
  </header>
  <div class="container">
    ${content}
  </div>
  <footer>
    &copy; 2026 ${company.company_name}. All rights reserved.
  </footer>
  ${customScripts}
</body>
</html>`;
}

// ==========================================
// ROUTES: MAIN PAGE & SETUP
// ==========================================
app.get('/', async (req, res) => {
  const company = await getCompanySettings();
  const adminCheck = await pool.query("SELECT * FROM users WHERE role = 'ADMIN' LIMIT 1");
  const hasAdmin = adminCheck.rows.length > 0;

  let content = '';
  if (!hasAdmin) {
    content = `
      <div class="card" style="text-align: center; max-width: 600px; margin: 4rem auto;">
        <h2>Welcome to Construction Worker Management System</h2>
        <p style="margin: 1rem 0; color: var(--gray);">No administrator account has been created yet. Please set up your initial system administrator account to get started.</p>
        <a href="/setup" class="btn" style="font-size: 1.2rem; padding: 1rem 2rem;">SET UP SYSTEM</a>
      </div>
    `;
  } else {
    content = `
      <div class="card" style="text-align: center; max-width: 800px; margin: 4rem auto; padding: 3rem;">
        <h2 style="font-size: 2.2rem; margin-bottom: 0.5rem;">${company.company_name}</h2>
        <p style="color: var(--gray); margin-bottom: 2.5rem; font-size: 1.1rem;">Select a portal below to access the management tools.</p>
        <div style="display: flex; gap: 1.5rem; justify-content: center; flex-wrap: wrap;">
          <a href="/admin" class="btn" style="padding: 1.25rem 2.5rem; font-size: 1.1rem;">ADMIN PORTAL</a>
          <a href="/worker" class="btn" style="padding: 1.25rem 2.5rem; font-size: 1.1rem; background: #0284c7;">WORKER PORTAL</a>
          <a href="/scanner" class="btn" style="padding: 1.25rem 2.5rem; font-size: 1.1rem; background: #10b981;">ATTENDANCE SCANNER</a>
        </div>
      </div>
    `;
  }
  res.send(renderLayout('Home', content, company));
});

app.get('/setup', async (req, res) => {
  const adminCheck = await pool.query("SELECT * FROM users WHERE role = 'ADMIN' LIMIT 1");
  if (adminCheck.rows.length > 0) return res.redirect('/admin');

  const company = await getCompanySettings();
  res.send(renderLayout('First-Time Admin Setup', `
    <div class="card" style="max-width: 600px; margin: 2rem auto;">
      <h2>First-Time Admin Setup</h2>
      <p style="color: var(--gray); margin-bottom: 1.5rem;">Create the primary administrator account.</p>
      <form action="/setup" method="POST">
        <label>Full Name</label>
        <input type="text" name="full_name" required>
        <label>Username</label>
        <input type="text" name="username" required>
        <label>Email Address</label>
        <input type="email" name="email" required>
        <label>Password</label>
        <input type="password" name="password" required>
        <label>Confirm Password</label>
        <input type="password" name="confirm_password" required>
        <button type="submit" class="btn" style="width: 100%; margin-top: 1rem;">Create Admin Account</button>
      </form>
    </div>
  `, company));
});

app.post('/setup', async (req, res) => {
  const adminCheck = await pool.query("SELECT * FROM users WHERE role = 'ADMIN' LIMIT 1");
  if (adminCheck.rows.length > 0) return res.redirect('/admin');

  const { full_name, username, email, password, confirm_password } = req.body;
  if (!full_name || !username || !email || !password || password !== confirm_password) {
    return res.send('<script>alert("Invalid input or passwords do not match."); window.location="/setup";</script>');
  }

  const hash = await bcrypt.hash(password, 10);
  const newAdmin = await pool.query(
    'INSERT INTO users (full_name, username, email, password_hash, role) VALUES ($1, $2, $3, $4, $5) RETURNING *',
    [full_name, username, email, hash, 'ADMIN']
  );

  req.session.user = newAdmin.rows[0];
  res.redirect('/admin/company-setup');
});

app.get('/admin/company-setup', requireAuth('ADMIN'), async (req, res) => {
  const company = await getCompanySettings();
  res.send(renderLayout('Company Setup', `
    <div class="card" style="max-width: 600px; margin: 2rem auto;">
      <h2>Company Information Setup</h2>
      <p style="color: var(--gray); margin-bottom: 1.5rem;">Configure your company branding and contact details.</p>
      <form action="/admin/company-setup" method="POST">
        <label>Company / Builder Name</label>
        <input type="text" name="company_name" value="${company.company_name || ''}" required>
        <label>Company Logo (Image URL or Data URL)</label>
        <input type="text" name="company_logo" value="${company.company_logo || ''}" placeholder="https://example.com/logo.png">
        <label>Company Address</label>
        <input type="text" name="company_address" value="${company.company_address || ''}">
        <label>Contact Number</label>
        <input type="text" name="contact_number" value="${company.contact_number || ''}">
        <button type="submit" class="btn" style="width: 100%; margin-top: 1rem;">Save & Continue to Dashboard</button>
      </form>
    </div>
  `, company));
});

app.post('/admin/company-setup', requireAuth('ADMIN'), async (req, res) => {
  const { company_name, company_logo, company_address, contact_number } = req.body;
  await pool.query('UPDATE company_settings SET company_name = $1, company_logo = $2, company_address = $3, contact_number = $4', [
    company_name, company_logo, company_address, contact_number
  ]);
  res.redirect('/admin/dashboard');
});

// ==========================================
// AUTHENTICATION LOGIN / LOGOUT ROUTES
// ==========================================
app.get('/admin', async (req, res) => {
  const adminCheck = await pool.query("SELECT * FROM users WHERE role = 'ADMIN' LIMIT 1");
  if (adminCheck.rows.length === 0) return res.redirect('/setup');
  if (req.session.user && req.session.user.role === 'ADMIN') return res.redirect('/admin/dashboard');

  const company = await getCompanySettings();
  res.send(renderLayout('Admin Login', `
    <div class="card" style="max-width: 400px; margin: 4rem auto;">
      <h2>Admin Login</h2>
      <form action="/admin/login" method="POST">
        <label>Username or Email</label>
        <input type="text" name="username" required>
        <label>Password</label>
        <input type="password" name="password" required>
        <button type="submit" class="btn" style="width: 100%; margin-top: 1rem;">Login</button>
      </form>
    </div>
  `, company));
});

app.post('/admin/login', async (req, res) => {
  const { username, password } = req.body;
  const userRes = await pool.query('SELECT * FROM users WHERE (username = $1 OR email = $1) AND role = $2', [username, 'ADMIN']);
  if (userRes.rows.length === 0) return res.send('<script>alert("Invalid credentials."); window.location="/admin";</script>');

  const user = userRes.rows[0];
  const match = await bcrypt.compare(password, user.password_hash);
  if (!match) return res.send('<script>alert("Invalid credentials."); window.location="/admin";</script>');

  req.session.user = user;
  res.redirect('/admin/dashboard');
});

app.get('/worker', async (req, res) => {
  if (req.session.user && req.session.user.role === 'WORKER') return res.redirect('/worker/dashboard');
  const company = await getCompanySettings();
  res.send(renderLayout('Worker Login', `
    <div class="card" style="max-width: 400px; margin: 4rem auto;">
      <h2>Worker Portal Login</h2>
      <form action="/worker/login" method="POST">
        <label>Username</label>
        <input type="text" name="username" required>
        <label>Password</label>
        <input type="password" name="password" required>
        <button type="submit" class="btn" style="width: 100%; margin-top: 1rem;">Login</button>
      </form>
    </div>
  `, company));
});

app.post('/worker/login', async (req, res) => {
  const { username, password } = req.body;
  const userRes = await pool.query('SELECT * FROM users WHERE username = $1 AND role = $2', [username, 'WORKER']);
  if (userRes.rows.length === 0) return res.send('<script>alert("Invalid credentials."); window.location="/worker";</script>');

  const user = userRes.rows[0];
  const match = await bcrypt.compare(password, user.password_hash);
  if (!match) return res.send('<script>alert("Invalid credentials."); window.location="/worker";</script>');

  req.session.user = user;
  res.redirect('/worker/dashboard');
});

app.get('/scanner', async (req, res) => {
  if (req.session.user && req.session.user.role === 'SCANNER') return res.redirect('/scanner/dashboard');
  const company = await getCompanySettings();
  res.send(renderLayout('Scanner Login', `
    <div class="card" style="max-width: 400px; margin: 4rem auto;">
      <h2>Attendance Scanner Login</h2>
      <form action="/scanner/login" method="POST">
        <label>Username</label>
        <input type="text" name="username" required>
        <label>Password</label>
        <input type="password" name="password" required>
        <button type="submit" class="btn" style="width: 100%; margin-top: 1rem;">Login</button>
      </form>
    </div>
  `, company));
});

app.post('/scanner/login', async (req, res) => {
  const { username, password } = req.body;
  // Allow ADMIN or SCANNER to access scanner portal
  const userRes = await pool.query('SELECT * FROM users WHERE username = $1 AND (role = $2 OR role = $3)', [username, 'SCANNER', 'ADMIN']);
  if (userRes.rows.length === 0) return res.send('<script>alert("Invalid credentials."); window.location="/scanner";</script>');

  const user = userRes.rows[0];
  const match = await bcrypt.compare(password, user.password_hash);
  if (!match) return res.send('<script>alert("Invalid credentials."); window.location="/scanner";</script>');

  req.session.user = user;
  res.redirect('/scanner/dashboard');
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/');
  });
});

// ==========================================
// ADMIN PORTAL ROUTES
// ==========================================
function adminNav(active) {
  return `
    <div style="display: flex; gap: 0.5rem; margin-bottom: 1.5rem; flex-wrap: wrap; background: white; padding: 1rem; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
      <a href="/admin/dashboard" class="btn" style="background: ${active==='dashboard'?'var(--primary-dark)':'var(--primary)'}">Dashboard</a>
      <a href="/admin/workers" class="btn" style="background: ${active==='workers'?'var(--primary-dark)':'var(--primary)'}">Workers</a>
      <a href="/admin/attendance" class="btn" style="background: ${active==='attendance'?'var(--primary-dark)':'var(--primary)'}">Attendance</a>
      <a href="/admin/advance" class="btn" style="background: ${active==='advance'?'var(--primary-dark)':'var(--primary)'}">Advance Money</a>
      <a href="/admin/salary" class="btn" style="background: ${active==='salary'?'var(--primary-dark)':'var(--primary)'}">Salary</a>
      <a href="/admin/announcements" class="btn" style="background: ${active==='announcements'?'var(--primary-dark)':'var(--primary)'}">Announcements</a>
      <a href="/admin/settings" class="btn" style="background: ${active==='settings'?'var(--primary-dark)':'var(--primary)'}">Company Settings</a>
      <a href="/admin/schedule" class="btn" style="background: ${active==='schedule'?'var(--primary-dark)':'var(--primary)'}">Schedule</a>
      <a href="/logout" class="btn btn-danger">Logout</a>
    </div>
  `;
}

app.get('/admin/dashboard', requireAuth('ADMIN'), async (req, res) => {
  const company = await getCompanySettings();
  const today = new Date().toISOString().split('T')[0];

  const totalWorkers = (await pool.query('SELECT COUNT(*) FROM workers')).rows[0].count;
  const presentToday = (await pool.query('SELECT COUNT(DISTINCT worker_id) FROM attendance_logs WHERE date = $1', [today])).rows[0].count;
  const recentLogs = await pool.query('SELECT a.*, w.full_name, w.position FROM attendance_logs a JOIN workers w ON a.worker_id = w.worker_id WHERE a.date = $1 ORDER BY a.created_at DESC LIMIT 10', [today]);

  const content = `
    ${adminNav('dashboard')}
    <h2>Admin Dashboard</h2>
    <div class="grid" style="margin-top: 1.5rem;">
      <div class="stat-card"><h3>Total Workers</h3><p>${totalWorkers}</p></div>
      <div class="stat-card"><h3>Present Today</h3><p>${presentToday}</p></div>
    </div>
    <div class="card">
      <h3>Recent Attendance Today</h3>
      <table>
        <thead><tr><th>Worker ID</th><th>Name</th><th>Position</th><th>Type</th><th>Time</th></tr></thead>
        <tbody>
          ${recentLogs.rows.map(l => `<tr><td>${l.worker_id}</td><td>${l.full_name}</td><td>${l.position}</td><td><strong>${l.attendance_type}</strong></td><td>${l.time}</td></tr>`).join('')}
          ${recentLogs.rows.length === 0 ? '<tr><td colspan="5" style="text-align:center;">No attendance recorded today yet.</td></tr>' : ''}
        </tbody>
      </table>
    </div>
  `;
  res.send(renderLayout('Admin Dashboard', content, company));
});

// Worker Management
app.get('/admin/workers', requireAuth('ADMIN'), async (req, res) => {
  const company = await getCompanySettings();
  const search = req.query.search || '';
  const workers = await pool.query(
    'SELECT w.*, q.qr_data FROM workers w LEFT JOIN qr_codes q ON w.worker_id = q.worker_id WHERE w.full_name ILIKE $1 OR w.worker_id ILIKE $1 ORDER BY w.created_at DESC',
    [`%${search}%`]
  );

  const content = `
    ${adminNav('workers')}
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
      <h2>Worker Management</h2>
      <a href="/admin/workers/new" class="btn">Register New Worker</a>
    </div>
    <div class="card">
      <form method="GET" style="display: flex; gap: 1rem;">
        <input type="text" name="search" placeholder="Search by name or ID..." value="${search}">
        <button type="submit" class="btn" style="margin-top: 0.5rem; height: 42px;">Search</button>
      </form>
      <table>
        <thead><tr><th>ID</th><th>Name</th><th>Position</th><th>Project</th><th>Daily Rate</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>
          ${workers.rows.map(w => `
            <tr>
              <td>${w.worker_id}</td>
              <td>${w.full_name}</td>
              <td>${w.position}</td>
              <td>${w.assigned_project || 'N/A'}</td>
              <td>₱${Number(w.daily_rate).toFixed(2)}</td>
              <td><span style="color: ${w.is_active?'var(--success)':'var(--danger)'}; font-weight: bold;">${w.is_active?'Active':'Inactive'}</span></td>
              <td>
                <a href="/admin/workers/edit/${w.id}" class="btn" style="padding: 0.25rem 0.5rem; font-size: 0.85rem;">Edit</a>
                <a href="/admin/workers/qr/${w.worker_id}" class="btn" style="padding: 0.25rem 0.5rem; font-size: 0.85rem; background: #0284c7;">QR</a>
                <a href="/admin/workers/toggle/${w.id}" class="btn ${w.is_active?'btn-danger':'btn-success'}" style="padding: 0.25rem 0.5rem; font-size: 0.85rem;">${w.is_active?'Deactivate':'Activate'}</a>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
  res.send(renderLayout('Workers', content, company));
});

app.get('/admin/workers/new', requireAuth('ADMIN'), async (req, res) => {
  const company = await getCompanySettings();
  res.send(renderLayout('Register Worker', `
    ${adminNav('workers')}
    <div class="card" style="max-width: 600px; margin: 0 auto;">
      <h2>Register Worker</h2>
      <form action="/admin/workers/new" method="POST">
        <label>Full Name</label>
        <input type="text" name="full_name" required>
        <label>Position</label>
        <input type="text" name="position" required>
        <label>Contact Number</label>
        <input type="text" name="contact_number">
        <label>Daily Rate (₱)</label>
        <input type="number" step="0.01" name="daily_rate" required>
        <label>Assigned Project</label>
        <input type="text" name="assigned_project">
        <label>Profile Picture URL</label>
        <input type="text" name="profile_picture">
        <label>Portal Username</label>
        <input type="text" name="username" required>
        <label>Portal Password</label>
        <input type="password" name="password" required>
        <button type="submit" class="btn" style="width: 100%; margin-top: 1rem;">Register & Generate QR</button>
      </form>
    </div>
  `, company));
});

app.post('/admin/workers/new', requireAuth('ADMIN'), async (req, res) => {
  const { full_name, position, contact_number, daily_rate, assigned_project, profile_picture, username, password } = req.body;
  const countRes = await pool.query('SELECT COUNT(*) FROM workers');
  const workerId = 'W-' + String(Number(countRes.rows[0].count) + 1).padStart(3, '0');

  const hash = await bcrypt.hash(password, 10);
  const userRes = await pool.query(
    'INSERT INTO users (full_name, username, email, password_hash, role) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [full_name, username, `${username}@worker.local`, hash, 'WORKER']
  );
  const userId = userRes.rows[0].id;

  await pool.query(
    'INSERT INTO workers (worker_id, full_name, position, contact_number, daily_rate, assigned_project, profile_picture, user_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
    [workerId, full_name, position, contact_number, daily_rate, assigned_project, profile_picture, userId]
  );

  const qrDataUrl = await QRCode.toDataURL(workerId);
  await pool.query('INSERT INTO qr_codes (worker_id, qr_data) VALUES ($1, $2)', [workerId, qrDataUrl]);

  res.redirect('/admin/workers');
});

app.get('/admin/workers/qr/:worker_id', requireAuth('ADMIN'), async (req, res) => {
  const company = await getCompanySettings();
  const workerId = req.params.worker_id;
  const qrRes = await pool.query('SELECT * FROM qr_codes WHERE worker_id = $1', [workerId]);
  const workerRes = await pool.query('SELECT * FROM workers WHERE worker_id = $1', [workerId]);

  if (qrRes.rows.length === 0) return res.send('QR Code not found.');
  const qr = qrRes.rows[0];
  const worker = workerRes.rows[0];

  res.send(renderLayout('Worker QR Code', `
    ${adminNav('workers')}
    <div class="card" style="max-width: 400px; margin: 0 auto; text-align: center;">
      <h2>Worker QR Code</h2>
      <p style="margin: 0.5rem 0; font-weight: bold;">${worker.full_name} (${worker.worker_id})</p>
      <p style="color: var(--gray); margin-bottom: 1.5rem;">${worker.position}</p>
      <img src="${qr.qr_data}" alt="QR Code" style="width: 250px; height: 250px; border: 1px solid var(--border); padding: 10px; border-radius: 8px;">
      <div style="margin-top: 1.5rem;">
        <button onclick="window.print()" class="btn">Print QR Code</button>
        <a href="/admin/workers" class="btn" style="background: var(--gray); margin-top: 0.5rem;">Back</a>
      </div>
    </div>
  `, company));
});

app.get('/admin/workers/toggle/:id', requireAuth('ADMIN'), async (req, res) => {
  const workerId = req.params.id;
  const workerRes = await pool.query('SELECT is_active FROM workers WHERE id = $1', [workerId]);
  if (workerRes.rows.length > 0) {
    const newState = !workerRes.rows[0].is_active;
    await pool.query('UPDATE workers SET is_active = $1 WHERE id = $2', [newState, workerId]);
  }
  res.redirect('/admin/workers');
});

// Attendance Management
app.get('/admin/attendance', requireAuth('ADMIN'), async (req, res) => {
  const company = await getCompanySettings();
  const date = req.query.date || new Date().toISOString().split('T')[0];
  const logs = await pool.query('SELECT a.*, w.full_name, w.position FROM attendance_logs a JOIN workers w ON a.worker_id = w.worker_id WHERE a.date = $1 ORDER BY a.time ASC', [date]);

  const content = `
    ${adminNav('attendance')}
    <h2>Attendance Records</h2>
    <div class="card">
      <form method="GET" style="display: flex; gap: 1rem; align-items: flex-end;">
        <div style="flex: 1;">
          <label>Select Date</label>
          <input type="date" name="date" value="${date}">
        </div>
        <button type="submit" class="btn" style="height: 42px;">Filter Date</button>
      </form>
      <table>
        <thead><tr><th>Worker ID</th><th>Name</th><th>Position</th><th>Type</th><th>Time</th></tr></thead>
        <tbody>
          ${logs.rows.map(l => `<tr><td>${l.worker_id}</td><td>${l.full_name}</td><td>${l.position}</td><td><strong>${l.attendance_type}</strong></td><td>${l.time}</td></tr>`).join('')}
          ${logs.rows.length === 0 ? '<tr><td colspan="5" style="text-align:center;">No attendance records found for this date.</td></tr>' : ''}
        </tbody>
      </table>
    </div>
  `;
  res.send(renderLayout('Attendance', content, company));
});

// Advance Money Management
app.get('/admin/advance', requireAuth('ADMIN'), async (req, res) => {
  const company = await getCompanySettings();
  const workers = await pool.query('SELECT * FROM workers WHERE is_active = true');
  const advances = await pool.query('SELECT a.*, w.full_name FROM advance_money a JOIN workers w ON a.worker_id = w.worker_id ORDER BY a.date DESC');

  const content = `
    ${adminNav('advance')}
    <h2>Advance Money Management</h2>
    <div class="grid" style="grid-template-columns: 1fr 2fr; gap: 2rem;">
      <div class="card">
        <h3>Add Advance Money</h3>
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
          <textarea name="reason" rows="3"></textarea>
          <button type="submit" class="btn" style="width: 100%;">Record Advance</button>
        </form>
      </div>
      <div class="card">
        <h3>Advance History</h3>
        <table>
          <thead><tr><th>Date</th><th>Worker</th><th>Amount</th><th>Reason</th></tr></thead>
          <tbody>
            ${advances.rows.map(a => `<tr><td>${a.date}</td><td>${a.full_name}</td><td>₱${Number(a.amount).toFixed(2)}</td><td>${a.reason || '-'}</td></tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
  res.send(renderLayout('Advance Money', content, company));
});

app.post('/admin/advance', requireAuth('ADMIN'), async (req, res) => {
  const { worker_id, amount, date, reason } = req.body;
  await pool.query('INSERT INTO advance_money (worker_id, amount, date, reason) VALUES ($1, $2, $3, $4)', [worker_id, amount, date, reason]);
  res.redirect('/admin/advance');
});

// Salary Management
app.get('/admin/salary', requireAuth('ADMIN'), async (req, res) => {
  const company = await getCompanySettings();
  const workers = await pool.query('SELECT * FROM workers WHERE is_active = true');

  // Simple calculation summary per worker
  const salaryData = [];
  for (let w of workers.rows) {
    const logs = await pool.query('SELECT * FROM attendance_logs WHERE worker_id = $1 ORDER BY date, time', [w.worker_id]);
    const advances = await pool.query('SELECT SUM(amount) as total FROM advance_money WHERE worker_id = $1', [w.worker_id]);
    const totalAdvance = Number(advances.rows[0].total || 0);

    // Group logs by date to compute full days / half days
    const daysMap = {};
    logs.rows.forEach(l => {
      if (!daysMap[l.date]) daysMap[l.date] = [];
      daysMap[l.date].push(l);
    });

    let fullDays = 0;
    let halfDays = 0;

    Object.keys(daysMap).forEach(d => {
      const dayLogs = daysMap[d];
      if (dayLogs.length >= 4) fullDays++;
      else if (dayLogs.length >= 2) halfDays++;
    });

    const equivalentDays = fullDays + (halfDays * 0.5);
    const totalSalary = equivalentDays * Number(w.daily_rate);
    const netSalary = totalSalary - totalAdvance;

    salaryData.push({
      worker: w,
      fullDays,
      halfDays,
      equivalentDays,
      totalSalary,
      totalAdvance,
      netSalary
    });
  }

  const content = `
    ${adminNav('salary')}
    <h2>Salary Calculation & Payroll</h2>
    <div class="card">
      <table>
        <thead><tr><th>Worker Name</th><th>Daily Rate</th><th>Full Days</th><th>Half Days</th><th>Equivalent Days</th><th>Total Salary</th><th>Advance Ded.</th><th>Net Salary</th></tr></thead>
        <tbody>
          ${salaryData.map(s => `
            <tr>
              <td>${s.worker.full_name}</td>
              <td>₱${Number(s.worker.daily_rate).toFixed(2)}</td>
              <td>${s.fullDays}</td>
              <td>${s.halfDays}</td>
              <td>${s.equivalentDays}</td>
              <td>₱${s.totalSalary.toFixed(2)}</td>
              <td>₱${s.totalAdvance.toFixed(2)}</td>
              <td><strong>₱${s.netSalary.toFixed(2)}</strong></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
  res.send(renderLayout('Salary', content, company));
});

// Announcements
app.get('/admin/announcements', requireAuth('ADMIN'), async (req, res) => {
  const company = await getCompanySettings();
  const announcements = await pool.query('SELECT * FROM announcements ORDER BY created_at DESC');

  const content = `
    ${adminNav('announcements')}
    <h2>Announcements</h2>
    <div class="grid" style="grid-template-columns: 1fr 2fr; gap: 2rem;">
      <div class="card">
        <h3>Post Announcement</h3>
        <form action="/admin/announcements" method="POST">
          <label>Title</label>
          <input type="text" name="title" required>
          <label>Message</label>
          <textarea name="message" rows="4" required></textarea>
          <button type="submit" class="btn" style="width: 100%;">Publish</button>
        </form>
      </div>
      <div class="card">
        <h3>Active Announcements</h3>
        ${announcements.rows.map(a => `
          <div style="border-bottom: 1px solid var(--border); padding-bottom: 1rem; margin-bottom: 1rem;">
            <h4>${a.title}</h4>
            <p style="color: var(--gray); font-size: 0.9rem; margin: 0.25rem 0;">${a.created_at.toISOString().split('T')[0]}</p>
            <p>${a.message}</p>
          </div>
        `).join('')}
      </div>
    </div>
  `;
  res.send(renderLayout('Announcements', content, company));
});

app.post('/admin/announcements', requireAuth('ADMIN'), async (req, res) => {
  const { title, message } = req.body;
  await pool.query('INSERT INTO announcements (title, message) VALUES ($1, $2)', [title, message]);
  res.redirect('/admin/announcements');
});

// Company Settings
app.get('/admin/settings', requireAuth('ADMIN'), async (req, res) => {
  const company = await getCompanySettings();
  const content = `
    ${adminNav('settings')}
    <div class="card" style="max-width: 600px; margin: 0 auto;">
      <h2>Company Settings</h2>
      <form action="/admin/settings" method="POST">
        <label>Company / Builder Name</label>
        <input type="text" name="company_name" value="${company.company_name}" required>
        <label>Company Logo URL / Data URL</label>
        <input type="text" name="company_logo" value="${company.company_logo || ''}">
        <label>Company Address</label>
        <input type="text" name="company_address" value="${company.company_address || ''}">
        <label>Contact Number</label>
        <input type="text" name="contact_number" value="${company.contact_number || ''}">
        <button type="submit" class="btn" style="width: 100%; margin-top: 1rem;">Update Settings</button>
      </form>
    </div>
  `;
  res.send(renderLayout('Company Settings', content, company));
});

app.post('/admin/settings', requireAuth('ADMIN'), async (req, res) => {
  const { company_name, company_logo, company_address, contact_number } = req.body;
  await pool.query('UPDATE company_settings SET company_name = $1, company_logo = $2, company_address = $3, contact_number = $4', [
    company_name, company_logo, company_address, contact_number
  ]);
  res.redirect('/admin/settings');
});

// Work Schedule Settings
app.get('/admin/schedule', requireAuth('ADMIN'), async (req, res) => {
  const company = await getCompanySettings();
  const schedule = (await pool.query('SELECT * FROM work_schedules LIMIT 1')).rows[0];

  const content = `
    ${adminNav('schedule')}
    <div class="card" style="max-width: 600px; margin: 0 auto;">
      <h2>Work Schedule Settings</h2>
      <form action="/admin/schedule" method="POST">
        <label>Morning Start Time</label>
        <input type="time" name="morning_start" value="${schedule.morning_start}" required>
        <label>Morning End Time</label>
        <input type="time" name="morning_end" value="${schedule.morning_end}" required>
        <label>Afternoon Start Time</label>
        <input type="time" name="afternoon_start" value="${schedule.afternoon_start}" required>
        <label>Afternoon End Time</label>
        <input type="time" name="afternoon_end" value="${schedule.afternoon_end}" required>
        <button type="submit" class="btn" style="width: 100%; margin-top: 1rem;">Save Schedule</button>
      </form>
    </div>
  `;
  res.send(renderLayout('Work Schedule', content, company));
});

app.post('/admin/schedule', requireAuth('ADMIN'), async (req, res) => {
  const { morning_start, morning_end, afternoon_start, afternoon_end } = req.body;
  await pool.query('UPDATE work_schedules SET morning_start = $1, morning_end = $2, afternoon_start = $3, afternoon_end = $4', [
    morning_start, morning_end, afternoon_start, afternoon_end
  ]);
  res.redirect('/admin/schedule');
});

// ==========================================
// WORKER PORTAL ROUTES
// ==========================================
function workerNav(active) {
  return `
    <div style="display: flex; gap: 0.5rem; margin-bottom: 1.5rem; flex-wrap: wrap; background: white; padding: 1rem; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
      <a href="/worker/dashboard" class="btn" style="background: ${active==='dashboard'?'var(--primary-dark)':'var(--primary)'}">Home</a>
      <a href="/worker/qr" class="btn" style="background: ${active==='qr'?'var(--primary-dark)':'var(--primary)'}">My QR Code</a>
      <a href="/worker/attendance" class="btn" style="background: ${active==='attendance'?'var(--primary-dark)':'var(--primary)'}">Attendance</a>
      <a href="/worker/advance" class="btn" style="background: ${active==='advance'?'var(--primary-dark)':'var(--primary)'}">Advance</a>
      <a href="/worker/salary" class="btn" style="background: ${active==='salary'?'var(--primary-dark)':'var(--primary)'}">Salary</a>
      <a href="/worker/announcements" class="btn" style="background: ${active==='announcements'?'var(--primary-dark)':'var(--primary)'}">Announcements</a>
      <a href="/logout" class="btn btn-danger">Logout</a>
    </div>
  `;
}

app.get('/worker/dashboard', requireAuth('WORKER'), async (req, res) => {
  const company = await getCompanySettings();
  const worker = (await pool.query('SELECT * FROM workers WHERE user_id = $1', [req.session.user.id])).rows[0];

  const content = `
    ${workerNav('dashboard')}
    <div class="card">
      <h2>Welcome, ${worker.full_name}</h2>
      <p style="color: var(--gray); margin-bottom: 1.5rem;">Worker ID: ${worker.worker_id} | Position: ${worker.position}</p>
      <p><strong>Assigned Project:</strong> ${worker.assigned_project || 'None'}</p>
      <p><strong>Daily Rate:</strong> ₱${Number(worker.daily_rate).toFixed(2)}</p>
    </div>
  `;
  res.send(renderLayout('Worker Dashboard', content, company));
});

app.get('/worker/qr', requireAuth('WORKER'), async (req, res) => {
  const company = await getCompanySettings();
  const worker = (await pool.query('SELECT * FROM workers WHERE user_id = $1', [req.session.user.id])).rows[0];
  const qr = (await pool.query('SELECT * FROM qr_codes WHERE worker_id = $1', [worker.worker_id])).rows[0];

  const content = `
    ${workerNav('qr')}
    <div class="card" style="max-width: 400px; margin: 0 auto; text-align: center;">
      <h2>My QR Code</h2>
      <p style="margin: 0.5rem 0; font-weight: bold;">${worker.full_name} (${worker.worker_id})</p>
      <img src="${qr.qr_data}" alt="QR Code" style="width: 250px; height: 250px; border: 1px solid var(--border); padding: 10px; border-radius: 8px;">
    </div>
  `;
  res.send(renderLayout('My QR Code', content, company));
});

app.get('/worker/attendance', requireAuth('WORKER'), async (req, res) => {
  const company = await getCompanySettings();
  const worker = (await pool.query('SELECT * FROM workers WHERE user_id = $1', [req.session.user.id])).rows[0];
  const logs = await pool.query('SELECT * FROM attendance_logs WHERE worker_id = $1 ORDER BY date DESC, time DESC', [worker.worker_id]);

  const content = `
    ${workerNav('attendance')}
    <div class="card">
      <h2>My Attendance History</h2>
      <table>
        <thead><tr><th>Date</th><th>Type</th><th>Time</th></tr></thead>
        <tbody>
          ${logs.rows.map(l => `<tr><td>${l.date}</td><td><strong>${l.attendance_type}</strong></td><td>${l.time}</td></tr>`).join('')}
        </tbody>
      </table>
    </div>
  `;
  res.send(renderLayout('My Attendance', content, company));
});

app.get('/worker/advance', requireAuth('WORKER'), async (req, res) => {
  const company = await getCompanySettings();
  const worker = (await pool.query('SELECT * FROM workers WHERE user_id = $1', [req.session.user.id])).rows[0];
  const advances = await pool.query('SELECT * FROM advance_money WHERE worker_id = $1 ORDER BY date DESC', [worker.worker_id]);

  const content = `
    ${workerNav('advance')}
    <div class="card">
      <h2>My Advance Money History</h2>
      <table>
        <thead><tr><th>Date</th><th>Amount</th><th>Reason</th></tr></thead>
        <tbody>
          ${advances.rows.map(a => `<tr><td>${a.date}</td><td>₱${Number(a.amount).toFixed(2)}</td><td>${a.reason || '-'}</td></tr>`).join('')}
        </tbody>
      </table>
    </div>
  `;
  res.send(renderLayout('My Advance', content, company));
});

app.get('/worker/salary', requireAuth('WORKER'), async (req, res) => {
  const company = await getCompanySettings();
  const worker = (await pool.query('SELECT * FROM workers WHERE user_id = $1', [req.session.user.id])).rows[0];
  const logs = await pool.query('SELECT * FROM attendance_logs WHERE worker_id = $1 ORDER BY date, time', [worker.worker_id]);
  const advances = await pool.query('SELECT SUM(amount) as total FROM advance_money WHERE worker_id = $1', [worker.worker_id]);
  const totalAdvance = Number(advances.rows[0].total || 0);

  const daysMap = {};
  logs.rows.forEach(l => {
    if (!daysMap[l.date]) daysMap[l.date] = [];
    daysMap[l.date].push(l);
  });

  let fullDays = 0;
  let halfDays = 0;
  Object.keys(daysMap).forEach(d => {
    const dayLogs = daysMap[d];
    if (dayLogs.length >= 4) fullDays++;
    else if (dayLogs.length >= 2) halfDays++;
  });

  const equivalentDays = fullDays + (halfDays * 0.5);
  const totalSalary = equivalentDays * Number(worker.daily_rate);
  const netSalary = totalSalary - totalAdvance;

  const content = `
    ${workerNav('salary')}
    <div class="card">
      <h2>My Salary Summary</h2>
      <p><strong>Daily Rate:</strong> ₱${Number(worker.daily_rate).toFixed(2)}</p>
      <p><strong>Full Days Worked:</strong> ${fullDays}</p>
      <p><strong>Half Days Worked:</strong> ${halfDays}</p>
      <p><strong>Equivalent Days:</strong> ${equivalentDays}</p>
      <p><strong>Total Salary:</strong> ₱${totalSalary.toFixed(2)}</p>
      <p><strong>Advance Deduction:</strong> ₱${totalAdvance.toFixed(2)}</p>
      <h3>Net Salary: ₱${netSalary.toFixed(2)}</h3>
    </div>
  `;
  res.send(renderLayout('My Salary', content, company));
});

app.get('/worker/announcements', requireAuth('WORKER'), async (req, res) => {
  const company = await getCompanySettings();
  const announcements = await pool.query('SELECT * FROM announcements ORDER BY created_at DESC');

  const content = `
    ${workerNav('announcements')}
    <div class="card">
      <h2>Announcements</h2>
      ${announcements.rows.map(a => `
        <div style="border-bottom: 1px solid var(--border); padding-bottom: 1rem; margin-bottom: 1rem;">
          <h4>${a.title}</h4>
          <p style="color: var(--gray); font-size: 0.9rem; margin: 0.25rem 0;">${a.created_at.toISOString().split('T')[0]}</p>
          <p>${a.message}</p>
        </div>
      `).join('')}
    </div>
  `;
  res.send(renderLayout('Announcements', content, company));
});

// ==========================================
// ATTENDANCE SCANNER PORTAL ROUTES
// ==========================================
function scannerNav(active) {
  return `
    <div style="display: flex; gap: 0.5rem; margin-bottom: 1.5rem; flex-wrap: wrap; background: white; padding: 1rem; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
      <a href="/scanner/dashboard" class="btn" style="background: ${active==='dashboard'?'var(--primary-dark)':'var(--primary)'}">Dashboard</a>
      <a href="/scanner/scan" class="btn" style="background: ${active==='scan'?'var(--primary-dark)':'var(--primary)'}">Scan QR Code</a>
      <a href="/scanner/attendance" class="btn" style="background: ${active==='attendance'?'var(--primary-dark)':'var(--primary)'}">Today's Attendance</a>
      <a href="/logout" class="btn btn-danger">Logout</a>
    </div>
  `;
}

app.get('/scanner/dashboard', requireAuth('SCANNER'), async (req, res) => {
  const company = await getCompanySettings();
  const today = new Date().toISOString().split('T')[0];
  const presentToday = (await pool.query('SELECT COUNT(DISTINCT worker_id) FROM attendance_logs WHERE date = $1', [today])).rows[0].count;

  const content = `
    ${scannerNav('dashboard')}
    <div class="card">
      <h2>Scanner Dashboard</h2>
      <p style="color: var(--gray); margin-bottom: 1.5rem;">Current Date: ${today}</p>
      <div class="stat-card" style="max-width: 300px;">
        <h3>Total Workers Present</h3>
        <p>${presentToday}</p>
      </div>
    </div>
  `;
  res.send(renderLayout('Scanner Dashboard', content, company));
});

app.get('/scanner/scan', requireAuth('SCANNER'), async (req, res) => {
  const company = await getCompanySettings();
  const content = `
    ${scannerNav('scan')}
    <div class="card" style="max-width: 500px; margin: 0 auto; text-align: center;">
      <h2>Scan Worker QR Code</h2>
      <p style="color: var(--gray); margin-bottom: 1.5rem;">Select Attendance Type before entering Worker ID.</p>
      <form action="/scanner/record" method="POST">
        <div style="display: flex; gap: 1rem; justify-content: center; margin-bottom: 1.5rem;">
          <label style="cursor: pointer; background: var(--success); color: white; padding: 1rem 2rem; border-radius: 6px;">
            <input type="radio" name="attendance_type" value="IN" required style="display:none;" onclick="this.parentNode.style.opacity=1"> TIME IN
          </label>
          <label style="cursor: pointer; background: var(--danger); color: white; padding: 1rem 2rem; border-radius: 6px;">
            <input type="radio" name="attendance_type" value="OUT" required style="display:none;" onclick="this.parentNode.style.opacity=1"> TIME OUT
          </label>
        </div>
        <label>Worker ID (Simulated QR Scan input)</label>
        <input type="text" name="worker_id" placeholder="e.g. W-001" required style="text-align: center; font-size: 1.2rem;">
        <button type="submit" class="btn" style="width: 100%; margin-top: 1rem; padding: 1rem;">RECORD ATTENDANCE</button>
      </form>
    </div>
  `;
  res.send(renderLayout('Scan QR', content, company));
});

app.post('/scanner/record', requireAuth('SCANNER'), async (req, res) => {
  const { worker_id, attendance_type } = req.body;
  const today = new Date().toISOString().split('T')[0];
  const time = new Date().toTimeString().split(' ')[0];

  const workerRes = await pool.query('SELECT * FROM workers WHERE worker_id = $1', [worker_id]);
  if (workerRes.rows.length === 0) {
    return res.send('<script>alert("Worker Not Found."); window.location="/scanner/scan";</script>');
  }
  const worker = workerRes.rows[0];
  if (!worker.is_active) {
    return res.send('<script>alert("Worker Account is Inactive."); window.location="/scanner/scan";</script>');
  }

  // Validate sequence
  const lastLogRes = await pool.query('SELECT * FROM attendance_logs WHERE worker_id = $1 AND date = $2 ORDER BY time DESC LIMIT 1', [worker_id, today]);
  const lastLog = lastLogRes.rows[0];

  if (!lastLog && attendance_type === 'OUT') {
    return res.send('<script>alert("Cannot Record OUT as First Attendance."); window.location="/scanner/scan";</script>');
  }
  if (lastLog && lastLog.attendance_type === attendance_type) {
    return res.send(`<script>alert("Invalid sequence: Cannot Record Two Consecutive ${attendance_type}."); window.location="/scanner/scan";</script>');
  }

  await pool.query('INSERT INTO attendance_logs (worker_id, date, time, attendance_type) VALUES ($1, $2, $3, $4)', [worker_id, today, time, attendance_type]);
  res.send(`<script>alert("SUCCESS: Recorded ${attendance_type} for ${worker.full_name} at ${time}"); window.location="/scanner/scan";</script>`);
});

app.get('/scanner/attendance', requireAuth('SCANNER'), async (req, res) => {
  const company = await getCompanySettings();
  const today = new Date().toISOString().split('T')[0];
  const logs = await pool.query('SELECT a.*, w.full_name, w.position FROM attendance_logs a JOIN workers w ON a.worker_id = w.worker_id WHERE a.date = $1 ORDER BY a.time DESC', [today]);

  const content = `
    ${scannerNav('attendance')}
    <div class="card">
      <h2>Today's Attendance (${today})</h2>
      <table>
        <thead><tr><th>Worker ID</th><th>Name</th><th>Position</th><th>Type</th><th>Time</th></tr></thead>
        <tbody>
          ${logs.rows.map(l => `<tr><td>${l.worker_id}</td><td>${l.full_name}</td><td>${l.position}</td><td><strong>${l.attendance_type}</strong></td><td>${l.time}</td></tr>`).join('')}
        </tbody>
      </table>
    </div>
  `;
  res.send(renderLayout("Today's Attendance", content, company));
});

// ==========================================
// SERVER START
// ==========================================
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
