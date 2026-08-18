/*******************************************************************************
 * server.js - Construction Worker Management System
 * Fully functional Single-File Node.js / Express / PostgreSQL Web Application
 *******************************************************************************/

const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

// Database Connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json({ limit: '10mb' }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'construction_system_secure_secret_key',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false } // Set to true if using HTTPS in production
}));

// ============================================================================
// DATABASE INITIALIZATION
// ============================================================================
async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS company_settings (
        id SERIAL PRIMARY KEY,
        company_name VARCHAR(255) DEFAULT 'BuildCorp Construction',
        company_logo TEXT DEFAULT '',
        company_address VARCHAR(255) DEFAULT '123 Builder Lane, Construction City',
        contact_number VARCHAR(50) DEFAULT '+1 234 567 8900'
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

      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(100) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(50) NOT NULL, -- 'admin', 'worker', 'scanner'
        worker_id INT REFERENCES workers(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS workers (
        id SERIAL PRIMARY KEY,
        unique_worker_id VARCHAR(50) UNIQUE NOT NULL,
        full_name VARCHAR(255) NOT NULL,
        position VARCHAR(100) NOT NULL,
        contact_number VARCHAR(50) NOT NULL,
        daily_rate NUMERIC(10,2) NOT NULL DEFAULT 0,
        assigned_project VARCHAR(255) NOT NULL,
        profile_picture TEXT DEFAULT '',
        qr_code TEXT DEFAULT '',
        status VARCHAR(20) DEFAULT 'Active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- Re-verify users table foreign key linkage safely if needed
      CREATE TABLE IF NOT EXISTS attendance_logs (
        id SERIAL PRIMARY KEY,
        worker_id INT REFERENCES workers(id) ON DELETE CASCADE,
        date DATE NOT NULL,
        time TIME NOT NULL,
        attendance_type VARCHAR(10) NOT NULL, -- 'IN' or 'OUT'
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS advance_money (
        id SERIAL PRIMARY KEY,
        worker_id INT REFERENCES workers(id) ON DELETE CASCADE,
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

    // Seed default settings if empty
    const settingsCheck = await pool.query('SELECT * FROM company_settings LIMIT 1');
    if (settingsCheck.rows.length === 0) {
      await pool.query(`INSERT INTO company_settings (company_name, company_logo, company_address, contact_number) VALUES ('Apex Builders & Construction', '', '456 Scaffold Ave, Metro City', '+1 800 555-WORK')`);
    }

    const scheduleCheck = await pool.query('SELECT * FROM work_schedules LIMIT 1');
    if (scheduleCheck.rows.length === 0) {
      await pool.query(`INSERT INTO work_schedules (morning_start, morning_end, afternoon_start, afternoon_end, full_day_hours, half_day_hours) VALUES ('07:00', '12:00', '13:00', '17:00', 8, 4)`);
    }

    // Seed default admin and scanner accounts if they don't exist
    const adminCheck = await pool.query("SELECT * FROM users WHERE username = 'admin'");
    if (adminCheck.rows.length === 0) {
      const hashedPass = await bcrypt.hash('admin123', 10);
      await pool.query("INSERT INTO users (username, password, role) VALUES ('admin', $1, 'admin')", [hashedPass]);
    }

    const scannerCheck = await pool.query("SELECT * FROM users WHERE username = 'scanner'");
    if (scannerCheck.rows.length === 0) {
      const hashedPass = await bcrypt.hash('scanner123', 10);
      await pool.query("INSERT INTO users (username, password, role) VALUES ('scanner', $1, 'scanner')", [hashedPass]);
    }

    console.log('Database initialized successfully.');
  } catch (err) {
    console.error('Database initialization error:', err);
  }
}
initDB();

// ============================================================================
// HELPER FUNCTIONS & DATA RETRIEVAL
// ============================================================================
async function getCompanySettings() {
  const res = await pool.query('SELECT * FROM company_settings LIMIT 1');
  return res.rows[0] || { company_name: 'Construction System', company_logo: '', company_address: '', contact_number: '' };
}

async function getWorkSchedule() {
  const res = await pool.query('SELECT * FROM work_schedules LIMIT 1');
  return res.rows[0] || { morning_start: '07:00', morning_end: '12:00', afternoon_start: '13:00', afternoon_end: '17:00', full_day_hours: 8, half_day_hours: 4 };
}

// Authentication & Role Check Middlewares
function requireAuth(role) {
  return (req, res, next) => {
    if (!req.session.user) {
      if (role === 'admin') return res.redirect('/admin');
      if (role === 'worker') return res.redirect('/worker');
      if (role === 'scanner') return res.redirect('/scanner');
      return res.redirect('/');
    }
    if (role && req.session.user.role !== role) {
      return res.send(renderErrorPage("Access Denied: You do not have permission to access this portal.", req.session.user.role));
    }
    next();
  };
}

function renderErrorPage(message, role) {
  let homeLink = '/';
  if (role === 'admin') homeLink = '/admin/dashboard';
  else if (role === 'worker') homeLink = '/worker/dashboard';
  else if (role === 'scanner') homeLink = '/scanner/dashboard';

  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>Access Denied</title>
      <style>
        body { font-family: Arial, sans-serif; background: #f4f6f9; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
        .card { background: white; padding: 40px; border-radius: 8px; box-shadow: 0 4px 15px rgba(0,0,0,0.1); text-align: center; max-width: 400px; }
        h1 { color: #e74c3c; margin-bottom: 20px; }
        p { color: #555; margin-bottom: 30px; }
        a { background: #3498db; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px; font-weight: bold; }
        a:hover { background: #2980b9; }
      </style>
    </head>
    <body>
      <div class="card">
        <h1>Access Denied</h1>
        <p>${message}</p>
        <a href="${homeLink}">Return to Portal</a>
      </div>
    </body>
    </html>
  `;
}

// Shared CSS styles for all generated pages
const globalStyles = `
  * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; }
  body { background: #f4f7f6; color: #333; display: flex; min-height: 100vh; }
  .sidebar { width: 260px; background: #2c3e50; color: white; display: flex; flex-direction: column; position: fixed; height: 100%; top: 0; left: 0; overflow-y: auto; }
  .sidebar-header { padding: 20px; text-align: center; background: #1a252f; border-bottom: 1px solid #34495e; }
  .sidebar-header img { max-height: 50px; max-width: 100%; margin-bottom: 10px; object-fit: contain; }
  .sidebar-header h2 { font-size: 16px; color: #ecf0f1; }
  .sidebar-menu { list-style: none; padding: 20px 0; flex: 1; }
  .sidebar-menu li a { display: block; padding: 12px 20px; color: #bdc3c7; text-decoration: none; font-size: 15px; transition: 0.3s; }
  .sidebar-menu li a:hover, .sidebar-menu li a.active { background: #34495e; color: white; border-left: 4px solid #3498db; }
  .main-content { margin-left: 260px; flex: 1; padding: 30px; background: #f4f7f6; min-height: 100vh; }
  .top-bar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 30px; background: white; padding: 15px 25px; border-radius: 8px; box-shadow: 0 2px 5px rgba(0,0,0,0.05); }
  .card-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 20px; margin-bottom: 30px; }
  .stat-card { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 5px rgba(0,0,0,0.05); border-left: 5px solid #3498db; }
  .stat-card h3 { font-size: 14px; color: #7f8c8d; margin-bottom: 8px; text-transform: uppercase; }
  .stat-card p { font-size: 24px; font-weight: bold; color: #2c3e50; }
  .panel { background: white; padding: 25px; border-radius: 8px; box-shadow: 0 2px 5px rgba(0,0,0,0.05); margin-bottom: 30px; }
  .panel h2 { margin-bottom: 20px; font-size: 18px; color: #2c3e50; border-bottom: 2px solid #ecf0f1; padding-bottom: 10px; }
  table { width: 100%; border-collapse: collapse; margin-top: 10px; }
  th, td { padding: 12px 15px; text-align: left; border-bottom: 1px solid #ecf0f1; font-size: 14px; }
  th { background: #f8f9fa; color: #2c3e50; font-weight: 600; }
  tr:hover { background: #f8f9fa; }
  .btn { display: inline-block; padding: 8px 16px; background: #3498db; color: white; border: none; border-radius: 4px; cursor: pointer; text-decoration: none; font-size: 14px; transition: 0.2s; }
  .btn:hover { background: #2980b9; }
  .btn-danger { background: #e74c3c; }
  .btn-danger:hover { background: #c0392b; }
  .btn-success { background: #2ecc71; }
  .btn-success:hover { background: #27ae60; }
  .form-group { margin-bottom: 15px; }
  .form-group label { display: block; margin-bottom: 5px; font-weight: 600; font-size: 13px; color: #555; }
  .form-group input, .form-group select, .form-group textarea { width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px; }
  .badge { padding: 5px 10px; border-radius: 12px; font-size: 11px; font-weight: bold; text-transform: uppercase; }
  .badge-success { background: #e8f8f5; color: #27ae60; }
  .badge-warning { background: #fef9e7; color: #f39c12; }
  .badge-danger { background: #fdedec; color: #c0392b; }
  .badge-info { background: #ebf5fb; color: #2980b9; }
  .alert { padding: 12px 15px; border-radius: 4px; margin-bottom: 20px; font-size: 14px; }
  .alert-success { background: #e8f8f5; color: #27ae60; border: 1px solid #a3e4d7; }
  .alert-danger { background: #fdedec; color: #c0392b; border: 1px solid #f5b7b1; }
  @media(max-width: 768px) {
    .sidebar { width: 70px; }
    .sidebar-header h2, .sidebar-menu span { display: none; }
    .main-content { margin-left: 70px; }
  }
`;

// ============================================================================
// MAIN PAGE ROUTE (/)
// ============================================================================
app.get('/', async (req, res) => {
  const settings = await getCompanySettings();
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>${settings.company_name} - Management System</title>
      <style>
        ${globalStyles}
        body { display: flex; justify-content: center; align-items: center; background: linear-gradient(135deg, #2c3e50, #3498db); }
        .welcome-card { background: white; padding: 50px; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.2); text-align: center; width: 100%; max-width: 500px; }
        .welcome-card img { max-height: 80px; margin-bottom: 20px; object-fit: contain; }
        .welcome-card h1 { font-size: 24px; color: #2c3e50; margin-bottom: 10px; }
        .welcome-card p { color: #7f8c8d; margin-bottom: 30px; font-size: 14px; }
        .portal-btns { display: flex; flex-direction: column; gap: 15px; }
        .portal-btn { display: block; padding: 15px; background: #34495e; color: white; border-radius: 6px; text-decoration: none; font-size: 16px; font-weight: bold; transition: 0.3s; }
        .portal-btn:hover { background: #2980b9; transform: translateY(-2px); }
        .portal-btn.admin { background: #2c3e50; }
        .portal-btn.worker { background: #27ae60; }
        .portal-btn.scanner { background: #e67e22; }
      </style>
    </head>
    <body>
      <div class="welcome-card">
        ${settings.company_logo ? `<img src="${settings.company_logo}" alt="Logo">` : ''}
        <h1>${settings.company_name}</h1>
        <p>Construction Worker Management & Attendance System</p>
        <div class="portal-btns">
          <a href="/admin" class="portal-btn admin">ADMIN PORTAL</a>
          <a href="/worker" class="portal-btn worker">WORKER PORTAL</a>
          <a href="/scanner" class="portal-btn scanner">ATTENDANCE SCANNER</a>
        </div>
      </div>
    </body>
    </html>
  `);
});

// ============================================================================
// AUTHENTICATION & PORTAL LOGIN ROUTES
// ============================================================================

// --- ADMIN LOGIN / PORTAL ---
app.get('/admin', async (req, res) => {
  if (req.session.user && req.session.user.role === 'admin') return res.redirect('/admin/dashboard');
  const settings = await getCompanySettings();
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>Admin Portal Login - ${settings.company_name}</title>
      <style>
        ${globalStyles}
        body { display: flex; justify-content: center; align-items: center; background: #2c3e50; }
        .login-box { background: white; padding: 40px; border-radius: 8px; width: 100%; max-width: 400px; box-shadow: 0 4px 15px rgba(0,0,0,0.2); text-align: center; }
        .login-box img { max-height: 60px; margin-bottom: 15px; object-fit: contain; }
        .login-box h2 { margin-bottom: 20px; color: #2c3e50; font-size: 20px; }
      </style>
    </head>
    <body>
      <div class="login-box">
        ${settings.company_logo ? `<img src="${settings.company_logo}" alt="Logo">` : ''}
        <h2>Admin Portal Login</h2>
        ${req.query.error ? `<div class="alert alert-danger">${req.query.error}</div>` : ''}
        <form action="/admin/login" method="POST">
          <div class="form-group" style="text-align: left;">
            <label>Username</label>
            <input type="text" name="username" required>
          </div>
          <div class="form-group" style="text-align: left;">
            <label>Password</label>
            <input type="password" name="password" required>
          </div>
          <button type="submit" class="btn" style="width: 100%; padding: 12px;">Login to Admin</button>
        </form>
        <div style="margin-top: 15px;"><a href="/" style="color: #7f8c8d; text-decoration: none; font-size: 13px;">← Back to Main Page</a></div>
      </div>
    </body>
    </html>
  `);
});

app.post('/admin/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const userRes = await pool.query("SELECT * FROM users WHERE username = $1 AND role = 'admin'", [username]);
    if (userRes.rows.length === 0) return res.redirect('/admin?error=Invalid username or password');
    const user = userRes.rows[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.redirect('/admin?error=Invalid username or password');

    req.session.user = { id: user.id, username: user.username, role: 'admin' };
    res.redirect('/admin/dashboard');
  } catch (err) {
    res.redirect('/admin?error=Server error during login');
  }
});

// --- WORKER LOGIN / PORTAL ---
app.get('/worker', async (req, res) => {
  if (req.session.user && req.session.user.role === 'worker') return res.redirect('/worker/dashboard');
  const settings = await getCompanySettings();
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>Worker Portal Login - ${settings.company_name}</title>
      <style>
        ${globalStyles}
        body { display: flex; justify-content: center; align-items: center; background: #27ae60; }
        .login-box { background: white; padding: 40px; border-radius: 8px; width: 100%; max-width: 400px; box-shadow: 0 4px 15px rgba(0,0,0,0.2); text-align: center; }
        .login-box img { max-height: 60px; margin-bottom: 15px; object-fit: contain; }
        .login-box h2 { margin-bottom: 20px; color: #2c3e50; font-size: 20px; }
      </style>
    </head>
    <body>
      <div class="login-box">
        ${settings.company_logo ? `<img src="${settings.company_logo}" alt="Logo">` : ''}
        <h2>Worker Portal Login</h2>
        ${req.query.error ? `<div class="alert alert-danger">${req.query.error}</div>` : ''}
        <form action="/worker/login" method="POST">
          <div class="form-group" style="text-align: left;">
            <label>Username</label>
            <input type="text" name="username" required>
          </div>
          <div class="form-group" style="text-align: left;">
            <label>Password</label>
            <input type="password" name="password" required>
          </div>
          <button type="submit" class="btn btn-success" style="width: 100%; padding: 12px;">Login to Worker Portal</button>
        </form>
        <div style="margin-top: 15px;"><a href="/" style="color: #7f8c8d; text-decoration: none; font-size: 13px;">← Back to Main Page</a></div>
      </div>
    </body>
    </html>
  `);
});

app.post('/worker/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const userRes = await pool.query("SELECT * FROM users WHERE username = $1 AND role = 'worker'", [username]);
    if (userRes.rows.length === 0) return res.redirect('/worker?error=Invalid username or password');
    const user = userRes.rows[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.redirect('/worker?error=Invalid username or password');

    req.session.user = { id: user.id, username: user.username, role: 'worker', worker_id: user.worker_id };
    res.redirect('/worker/dashboard');
  } catch (err) {
    res.redirect('/worker?error=Server error during login');
  }
});

// --- SCANNER LOGIN / PORTAL ---
app.get('/scanner', async (req, res) => {
  if (req.session.user && req.session.user.role === 'scanner') return res.redirect('/scanner/dashboard');
  const settings = await getCompanySettings();
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>Attendance Scanner Login - ${settings.company_name}</title>
      <style>
        ${globalStyles}
        body { display: flex; justify-content: center; align-items: center; background: #e67e22; }
        .login-box { background: white; padding: 40px; border-radius: 8px; width: 100%; max-width: 400px; box-shadow: 0 4px 15px rgba(0,0,0,0.2); text-align: center; }
        .login-box img { max-height: 60px; margin-bottom: 15px; object-fit: contain; }
        .login-box h2 { margin-bottom: 20px; color: #2c3e50; font-size: 20px; }
      </style>
    </head>
    <body>
      <div class="login-box">
        ${settings.company_logo ? `<img src="${settings.company_logo}" alt="Logo">` : ''}
        <h2>Attendance Scanner Login</h2>
        ${req.query.error ? `<div class="alert alert-danger">${req.query.error}</div>` : ''}
        <form action="/scanner/login" method="POST">
          <div class="form-group" style="text-align: left;">
            <label>Username</label>
            <input type="text" name="username" required>
          </div>
          <div class="form-group" style="text-align: left;">
            <label>Password</label>
            <input type="password" name="password" required>
          </div>
          <button type="submit" class="btn" style="width: 100%; padding: 12px; background: #e67e22;">Login to Scanner</button>
        </form>
        <div style="margin-top: 15px;"><a href="/" style="color: #7f8c8d; text-decoration: none; font-size: 13px;">← Back to Main Page</a></div>
      </div>
    </body>
    </html>
  `);
});

app.post('/scanner/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const userRes = await pool.query("SELECT * FROM users WHERE username = $1 AND role = 'scanner'", [username]);
    if (userRes.rows.length === 0) return res.redirect('/scanner?error=Invalid username or password');
    const user = userRes.rows[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.redirect('/scanner?error=Invalid username or password');

    req.session.user = { id: user.id, username: user.username, role: 'scanner' };
    res.redirect('/scanner/dashboard');
  } catch (err) {
    res.redirect('/scanner?error=Server error during login');
  }
});

// Logout Route
app.get('/logout', (req, res) => {
  const role = req.session.user ? req.session.user.role : '';
  req.session.destroy(() => {
    if (role === 'admin') res.redirect('/admin');
    else if (role === 'worker') res.redirect('/worker');
    else if (role === 'scanner') res.redirect('/scanner');
    else res.redirect('/');
  });
});

// ============================================================================
// ATTENDANCE CALCULATION LOGIC & HELPER
// ============================================================================
async function calculateAttendanceStatusForDate(workerId, dateStr) {
  const logsRes = await pool.query(
    "SELECT * FROM attendance_logs WHERE worker_id = $1 AND date = $2 ORDER BY time ASC",
    [workerId, dateStr]
  );
  const logs = logsRes.rows;
  if (logs.length === 0) return { status: 'ABSENT', totalHours: 0, logs: [] };

  let totalWorkingMs = 0;
  let lastInTime = null;

  for (let log of logs) {
    if (log.attendance_type === 'IN') {
      lastInTime = log.time;
    } else if (log.attendance_type === 'OUT' && lastInTime) {
      // Calculate diff between lastInTime and log.time
      const [inH, inM, inS] = lastInTime.split(':').map(Number);
      const [outH, outM, outS] = log.time.split(':').map(Number);
      const inDate = new Date(2000, 0, 1, inH, inM, inS || 0);
      const outDate = new Date(2000, 0, 1, outH, outM, outS || 0);
      let diffMs = outDate - inDate;
      if (diffMs > 0) totalWorkingMs += diffMs;
      lastInTime = null;
    }
  }

  const totalHours = parseFloat((totalWorkingMs / (1000 * 60 * 60)).toFixed(2));
  const schedule = await getWorkSchedule();

  let status = 'INCOMPLETE';
  if (lastInTime !== null && logs.length % 2 !== 0) {
    status = 'INCOMPLETE';
  } else if (totalHours >= (schedule.full_day_hours || 8)) {
    status = 'FULL DAY';
  } else if (totalHours >= (schedule.half_day_hours || 4)) {
    status = 'HALF DAY';
  } else if (totalHours > 0) {
    status = 'HALF DAY';
  } else {
    status = 'PRESENT';
  }

  return { status, totalHours, logs };
}

// ============================================================================
// ADMIN PORTAL ROUTES
// ============================================================================
app.get('/admin/dashboard', requireAuth('admin'), async (req, res) => {
  const settings = await getCompanySettings();
  const todayStr = new Date().toISOString().split('T')[0];

  const workersCountRes = await pool.query('SELECT COUNT(*) FROM workers');
  const totalWorkers = parseInt(workersCountRes.rows[0].count);

  const workersRes = await pool.query('SELECT id FROM workers WHERE status = $1', ['Active']);
  let presentToday = 0;
  let fullDayToday = 0;
  let halfDayToday = 0;

  for (let w of workersRes.rows) {
    const calc = await calculateAttendanceStatusForDate(w.id, todayStr);
    if (calc.status !== 'ABSENT') {
      presentToday++;
      if (calc.status === 'FULL DAY') fullDayToday++;
      if (calc.status === 'HALF DAY') halfDayToday++;
    }
  }
  const absentToday = totalWorkers - presentToday;

  const recentLogsRes = await pool.query(`
    SELECT a.*, w.full_name, w.unique_worker_id, w.position 
    FROM attendance_logs a 
    JOIN workers w ON a.worker_id = w.id 
    ORDER BY a.created_at DESC LIMIT 10
  `);

  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>Admin Dashboard - ${settings.company_name}</title>
      <style>${globalStyles}</style>
    </head>
    <body>
      <div class="sidebar">
        <div class="sidebar-header">
          ${settings.company_logo ? `<img src="${settings.company_logo}" alt="Logo">` : ''}
          <h2>${settings.company_name}</h2>
        </div>
        <ul class="sidebar-menu">
          <li><a href="/admin/dashboard" class="active">📊 Dashboard</a></li>
          <li><a href="/admin/workers">👷 Workers</a></li>
          <li><a href="/admin/attendance">📋 Attendance</a></li>
          <li><a href="/admin/advance">💰 Advance Money</a></li>
          <li><a href="/admin/salary">💵 Salary</a></li>
          <li><a href="/admin/announcements">📢 Announcements</a></li>
          <li><a href="/admin/settings">⚙️ Company Settings</a></li>
          <li><a href="/admin/schedule">⏰ Work Schedule</a></li>
          <li><a href="/logout">🚪 Logout</a></li>
        </ul>
      </div>
      <div class="main-content">
        <div class="top-bar">
          <h2>Admin Dashboard</h2>
          <span>Welcome, Administrator</span>
        </div>
        <div class="card-grid">
          <div class="stat-card"><h3>Total Workers</h3><p>${totalWorkers}</p></div>
          <div class="stat-card" style="border-left-color: #2ecc71;"><h3>Present Today</h3><p>${presentToday}</p></div>
          <div class="stat-card" style="border-left-color: #3498db;"><h3>Full Day Today</h3><p>${fullDayToday}</p></div>
          <div class="stat-card" style="border-left-color: #f39c12;"><h3>Half Day Today</h3><p>${halfDayToday}</p></div>
          <div class="stat-card" style="border-left-color: #e74c3c;"><h3>Absent Today</h3><p>${absentToday}</p></div>
        </div>
        <div class="panel">
          <h2>Recent Attendance Activities</h2>
          <table>
            <thead>
              <tr><th>Worker ID</th><th>Name</th><th>Position</th><th>Date</th><th>Time</th><th>Type</th></tr>
            </thead>
            <tbody>
              ${recentLogsRes.rows.map(l => `
                <tr>
                  <td>${l.unique_worker_id}</td>
                  <td>${l.full_name}</td>
                  <td>${l.position}</td>
                  <td>${l.date.toISOString().split('T')[0]}</td>
                  <td>${l.time}</td>
                  <td><span class="badge ${l.attendance_type === 'IN' ? 'badge-success' : 'badge-danger'}">${l.attendance_type}</span></td>
                </tr>
              `).join('')}
              ${recentLogsRes.rows.length === 0 ? '<tr><td colspan="6" style="text-align: center;">No attendance records found for today.</td></tr>' : ''}
            </tbody>
          </table>
        </div>
      </div>
    </body>
    </html>
  `);
});

// --- WORKER MANAGEMENT ---
app.get('/admin/workers', requireAuth('admin'), async (req, res) => {
  const settings = await getCompanySettings();
  const search = req.query.search || '';
  const queryStr = search ? 
    `SELECT * FROM workers WHERE full_name ILIKE $1 OR unique_worker_id ILIKE $1 OR position ILIKE $1 ORDER BY id DESC` :
    `SELECT * FROM workers ORDER BY id DESC`;
  const workersRes = await pool.query(queryStr, search ? [`%${search}%`] : []);

  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>Worker Management - ${settings.company_name}</title>
      <style>${globalStyles}</style>
    </head>
    <body>
      <div class="sidebar">
        <div class="sidebar-header">
          ${settings.company_logo ? `<img src="${settings.company_logo}" alt="Logo">` : ''}
          <h2>${settings.company_name}</h2>
        </div>
        <ul class="sidebar-menu">
          <li><a href="/admin/dashboard">📊 Dashboard</a></li>
          <li><a href="/admin/workers" class="active">👷 Workers</a></li>
          <li><a href="/admin/attendance">📋 Attendance</a></li>
          <li><a href="/admin/advance">💰 Advance Money</a></li>
          <li><a href="/admin/salary">💵 Salary</a></li>
          <li><a href="/admin/announcements">📢 Announcements</a></li>
          <li><a href="/admin/settings">⚙️ Company Settings</a></li>
          <li><a href="/admin/schedule">⏰ Work Schedule</a></li>
          <li><a href="/logout">🚪 Logout</a></li>
        </ul>
      </div>
      <div class="main-content">
        <div class="top-bar">
          <h2>Worker Management</h2>
          <a href="/admin/workers/register" class="btn btn-success">+ Register New Worker</a>
        </div>
        ${req.query.msg ? `<div class="alert alert-success">${req.query.msg}</div>` : ''}
        <div class="panel">
          <form method="GET" action="/admin/workers" style="margin-bottom: 20px; display: flex; gap: 10px;">
            <input type="text" name="search" placeholder="Search by name, ID or position..." value="${search}" style="flex: 1; padding: 10px; border: 1px solid #ddd; border-radius: 4px;">
            <button type="submit" class="btn">Search</button>
            ${search ? `<a href="/admin/workers" class="btn" style="background: #7f8c8d;">Reset</a>` : ''}
          </form>
          <table>
            <thead>
              <tr><th>Worker ID</th><th>Photo</th><th>Name</th><th>Position</th><th>Project</th><th>Daily Rate</th><th>Status</th><th>Actions</th></tr>
            </thead>
            <tbody>
              ${workersRes.rows.map(w => `
                <tr>
                  <td><strong>${w.unique_worker_id}</strong></td>
                  <td>${w.profile_picture ? `<img src="${w.profile_picture}" width="40" height="40" style="object-fit:cover; border-radius:50%;">` : 'N/A'}</td>
                  <td>${w.full_name}</td>
                  <td>${w.position}</td>
                  <td>${w.assigned_project}</td>
                  <td>₱${parseFloat(w.daily_rate).toFixed(2)}</td>
                  <td><span class="badge ${w.status === 'Active' ? 'badge-success' : 'badge-danger'}">${w.status}</span></td>
                  <td>
                    <a href="/admin/workers/profile/${w.id}" class="btn" style="padding: 4px 8px; font-size: 12px;">View</a>
                    <a href="/admin/workers/edit/${w.id}" class="btn" style="padding: 4px 8px; font-size: 12px; background: #f39c12;">Edit</a>
                    <a href="/admin/workers/qr/${w.id}" class="btn" style="padding: 4px 8px; font-size: 12px; background: #9b59b6;">QR Code</a>
                    <a href="/admin/workers/toggle/${w.id}" class="btn" style="padding: 4px 8px; font-size: 12px; background: ${w.status === 'Active' ? '#e74c3c' : '#2ecc71'};">${w.status === 'Active' ? 'Deactivate' : 'Activate'}</a>
                  </td>
                </tr>
              `).join('')}
              ${workersRes.rows.length === 0 ? '<tr><td colspan="8" style="text-align: center;">No workers found.</td></tr>' : ''}
            </tbody>
          </table>
        </div>
      </div>
    </body>
    </html>
  `);
});

app.get('/admin/workers/register', requireAuth('admin'), async (req, res) => {
  const settings = await getCompanySettings();
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>Register Worker - ${settings.company_name}</title>
      <style>${globalStyles}</style>
    </head>
    <body>
      <div class="sidebar">
        <div class="sidebar-header">
          ${settings.company_logo ? `<img src="${settings.company_logo}" alt="Logo">` : ''}
          <h2>${settings.company_name}</h2>
        </div>
        <ul class="sidebar-menu">
          <li><a href="/admin/dashboard">📊 Dashboard</a></li>
          <li><a href="/admin/workers" class="active">👷 Workers</a></li>
          <li><a href="/admin/attendance">📋 Attendance</a></li>
          <li><a href="/admin/advance">💰 Advance Money</a></li>
          <li><a href="/admin/salary">💵 Salary</a></li>
          <li><a href="/admin/announcements">📢 Announcements</a></li>
          <li><a href="/admin/settings">⚙️ Company Settings</a></li>
          <li><a href="/admin/schedule">⏰ Work Schedule</a></li>
          <li><a href="/logout">🚪 Logout</a></li>
        </ul>
      </div>
      <div class="main-content">
        <div class="top-bar">
          <h2>Register New Worker</h2>
          <a href="/admin/workers" class="btn" style="background: #7f8c8d;">← Back to Workers</a>
        </div>
        <div class="panel" style="max-width: 700px; margin: 0 auto;">
          ${req.query.error ? `<div class="alert alert-danger">${req.query.error}</div>` : ''}
          <form action="/admin/workers/register" method="POST">
            <div class="form-group">
              <label>Full Name</label>
              <input type="text" name="full_name" required>
            </div>
            <div class="form-group">
              <label>Position / Role</label>
              <input type="text" name="position" placeholder="e.g. Mason, Electrician, Carpenter" required>
            </div>
            <div class="form-group">
              <label>Contact Number</label>
              <input type="text" name="contact_number" required>
            </div>
            <div class="form-group">
              <label>Daily Rate (₱)</label>
              <input type="number" step="0.01" name="daily_rate" required>
            </div>
            <div class="form-group">
              <label>Assigned Project</label>
              <input type="text" name="assigned_project" required>
            </div>
            <div class="form-group">
              <label>Profile Picture URL (Optional)</label>
              <input type="text" name="profile_picture" placeholder="https://example.com/photo.jpg">
            </div>
            <div class="form-group">
              <label>Worker Portal Username</label>
              <input type="text" name="username" required>
            </div>
            <div class="form-group">
              <label>Worker Portal Password</label>
              <input type="password" name="password" required>
            </div>
            <button type="submit" class="btn btn-success" style="width: 100%; padding: 12px;">Register Worker & Generate QR Code</button>
          </form>
        </div>
      </div>
    </body>
    </html>
  `);
});

app.post('/admin/workers/register', requireAuth('admin'), async (req, res) => {
  const { full_name, position, contact_number, daily_rate, assigned_project, profile_picture, username, password } = req.body;
  try {
    // Generate unique Worker ID
    const countRes = await pool.query('SELECT COUNT(*) FROM workers');
    const nextIdNum = parseInt(countRes.rows[0].count) + 1;
    const unique_worker_id = `W-${String(nextIdNum).padStart(3, '0')}`;
    const qr_code = unique_worker_id; // Unique identifier encoded in QR code

    const workerResult = await pool.query(
      `INSERT INTO workers (unique_worker_id, full_name, position, contact_number, daily_rate, assigned_project, profile_picture, qr_code) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [unique_worker_id, full_name, position, contact_number, daily_rate, assigned_project, profile_picture, qr_code]
    );
    const workerId = workerResult.rows[0].id;

    // Create worker login user
    const hashedPass = await bcrypt.hash(password, 10);
    await pool.query("INSERT INTO users (username, password, role, worker_id) VALUES ($1, $2, 'worker', $3)", [username, hashedPass, workerId]);

    res.redirect('/admin/workers?msg=Worker registered successfully with QR code and login credentials.');
  } catch (err) {
    res.redirect('/admin/workers/register?error=' + encodeURIComponent(err.message));
  }
});

app.get('/admin/workers/edit/:id', requireAuth('admin'), async (req, res) => {
  const settings = await getCompanySettings();
  const workerRes = await pool.query('SELECT * FROM workers WHERE id = $1', [req.params.id]);
  if (workerRes.rows.length === 0) return res.redirect('/admin/workers');
  const worker = workerRes.rows[0];

  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>Edit Worker - ${settings.company_name}</title>
      <style>${globalStyles}</style>
    </head>
    <body>
      <div class="sidebar">
        <div class="sidebar-header">
          ${settings.company_logo ? `<img src="${settings.company_logo}" alt="Logo">` : ''}
          <h2>${settings.company_name}</h2>
        </div>
        <ul class="sidebar-menu">
          <li><a href="/admin/dashboard">📊 Dashboard</a></li>
          <li><a href="/admin/workers" class="active">👷 Workers</a></li>
          <li><a href="/admin/attendance">📋 Attendance</a></li>
          <li><a href="/admin/advance">💰 Advance Money</a></li>
          <li><a href="/admin/salary">💵 Salary</a></li>
          <li><a href="/admin/announcements">📢 Announcements</a></li>
          <li><a href="/admin/settings">⚙️ Company Settings</a></li>
          <li><a href="/admin/schedule">⏰ Work Schedule</a></li>
          <li><a href="/logout">🚪 Logout</a></li>
        </ul>
      </div>
      <div class="main-content">
        <div class="top-bar">
          <h2>Edit Worker: ${worker.full_name}</h2>
          <a href="/admin/workers" class="btn" style="background: #7f8c8d;">← Back to Workers</a>
        </div>
        <div class="panel" style="max-width: 700px; margin: 0 auto;">
          <form action="/admin/workers/edit/${worker.id}" method="POST">
            <div class="form-group">
              <label>Full Name</label>
              <input type="text" name="full_name" value="${worker.full_name}" required>
            </div>
            <div class="form-group">
              <label>Position / Role</label>
              <input type="text" name="position" value="${worker.position}" required>
            </div>
            <div class="form-group">
              <label>Contact Number</label>
              <input type="text" name="contact_number" value="${worker.contact_number}" required>
            </div>
            <div class="form-group">
              <label>Daily Rate (₱)</label>
              <input type="number" step="0.01" name="daily_rate" value="${worker.daily_rate}" required>
            </div>
            <div class="form-group">
              <label>Assigned Project</label>
              <input type="text" name="assigned_project" value="${worker.assigned_project}" required>
            </div>
            <div class="form-group">
              <label>Profile Picture URL</label>
              <input type="text" name="profile_picture" value="${worker.profile_picture || ''}">
            </div>
            <button type="submit" class="btn" style="width: 100%; padding: 12px;">Update Worker Information</button>
          </form>
        </div>
      </div>
    </body>
    </html>
  `);
});

app.post('/admin/workers/edit/:id', requireAuth('admin'), async (req, res) => {
  const { full_name, position, contact_number, daily_rate, assigned_project, profile_picture } = req.body;
  try {
    await pool.query(
      `UPDATE workers SET full_name = $1, position = $2, contact_number = $3, daily_rate = $4, assigned_project = $5, profile_picture = $6 WHERE id = $7`,
      [full_name, position, contact_number, daily_rate, assigned_project, profile_picture, req.params.id]
    );
    res.redirect('/admin/workers?msg=Worker updated successfully.');
  } catch (err) {
    res.redirect('/admin/workers?msg=Error updating worker.');
  }
});

app.get('/admin/workers/toggle/:id', requireAuth('admin'), async (req, res) => {
  try {
    const workerRes = await pool.query('SELECT status FROM workers WHERE id = $1', [req.params.id]);
    if (workerRes.rows.length > 0) {
      const newStatus = workerRes.rows[0].status === 'Active' ? 'Inactive' : 'Active';
      await pool.query('UPDATE workers SET status = $1 WHERE id = $2', [newStatus, req.params.id]);
    }
    res.redirect('/admin/workers?msg=Worker status updated successfully.');
  } catch (err) {
    res.redirect('/admin/workers');
  }
});

app.get('/admin/workers/qr/:id', requireAuth('admin'), async (req, res) => {
  const settings = await getCompanySettings();
  const workerRes = await pool.query('SELECT * FROM workers WHERE id = $1', [req.params.id]);
  if (workerRes.rows.length === 0) return res.redirect('/admin/workers');
  const worker = workerRes.rows[0];

  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>QR Code - ${worker.full_name}</title>
      <style>
        ${globalStyles}
        .qr-card { background: white; padding: 40px; border-radius: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.1); text-align: center; max-width: 400px; margin: 40px auto; border-top: 6px solid #3498db; }
        .qr-card img.logo { max-height: 50px; margin-bottom: 15px; object-fit: contain; }
        .qr-placeholder { background: #f8f9fa; border: 3px dashed #cbd5e1; padding: 30px; border-radius: 8px; margin: 20px 0; font-family: monospace; font-size: 24px; font-weight: bold; color: #2c3e50; }
      </style>
    </head>
    <body>
      <div class="sidebar">
        <div class="sidebar-header">
          ${settings.company_logo ? `<img src="${settings.company_logo}" alt="Logo">` : ''}
          <h2>${settings.company_name}</h2>
        </div>
        <ul class="sidebar-menu">
          <li><a href="/admin/dashboard">📊 Dashboard</a></li>
          <li><a href="/admin/workers" class="active">👷 Workers</a></li>
          <li><a href="/admin/attendance">📋 Attendance</a></li>
          <li><a href="/admin/advance">💰 Advance Money</a></li>
          <li><a href="/admin/salary">💵 Salary</a></li>
          <li><a href="/admin/announcements">📢 Announcements</a></li>
          <li><a href="/admin/settings">⚙️ Company Settings</a></li>
          <li><a href="/admin/schedule">⏰ Work Schedule</a></li>
          <li><a href="/logout">🚪 Logout</a></li>
        </ul>
      </div>
      <div class="main-content">
        <div class="top-bar">
          <h2>Worker QR Code Card</h2>
          <a href="/admin/workers" class="btn" style="background: #7f8c8d;">← Back to Workers</a>
        </div>
        <div class="qr-card">
          ${settings.company_logo ? `<img src="${settings.company_logo}" class="logo" alt="Company Logo">` : ''}
          <h3 style="color: #2c3e50; margin-bottom: 5px;">${settings.company_name}</h3>
          <p style="color: #7f8c8d; font-size: 13px; margin-bottom: 20px;">Official Worker Identification Badge</p>
          ${worker.profile_picture ? `<img src="${worker.profile_picture}" width="90" height="90" style="object-fit:cover; border-radius:50%; margin-bottom:15px; border: 3px solid #3498db;">` : ''}
          <h2 style="font-size: 20px; color: #2c3e50;">${worker.full_name}</h2>
          <p style="color: #e67e22; font-weight: bold; margin-bottom: 15px;">${worker.position}</p>
          <div class="qr-placeholder">
            <div>${worker.unique_worker_id}</div>
            <div style="font-size: 11px; color: #64748b; font-weight: normal; margin-top: 5px;">SCANABLE QR TOKEN</div>
          </div>
          <p style="font-size: 12px; color: #7f8c8d; margin-bottom: 20px;">Assigned Project: ${worker.assigned_project}</p>
          <button onclick="window.print()" class="btn" style="width: 100%;">Print QR Code Badge</button>
        </div>
      </div>
    </body>
    </html>
  `);
});

app.get('/admin/workers/profile/:id', requireAuth('admin'), async (req, res) => {
  const settings = await getCompanySettings();
  const workerRes = await pool.query('SELECT * FROM workers WHERE id = $1', [req.params.id]);
  if (workerRes.rows.length === 0) return res.redirect('/admin/workers');
  const worker = workerRes.rows[0];

  const attendanceRes = await pool.query('SELECT * FROM attendance_logs WHERE worker_id = $1 ORDER BY date DESC, time DESC LIMIT 20', [worker.id]);

  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>Worker Profile - ${worker.full_name}</title>
      <style>${globalStyles}</style>
    </head>
    <body>
      <div class="sidebar">
        <div class="sidebar-header">
          ${settings.company_logo ? `<img src="${settings.company_logo}" alt="Logo">` : ''}
          <h2>${settings.company_name}</h2>
        </div>
        <ul class="sidebar-menu">
          <li><a href="/admin/dashboard">📊 Dashboard</a></li>
          <li><a href="/admin/workers" class="active">👷 Workers</a></li>
          <li><a href="/admin/attendance">📋 Attendance</a></li>
          <li><a href="/admin/advance">💰 Advance Money</a></li>
          <li><a href="/admin/salary">💵 Salary</a></li>
          <li><a href="/admin/announcements">📢 Announcements</a></li>
          <li><a href="/admin/settings">⚙️ Company Settings</a></li>
          <li><a href="/admin/schedule">⏰ Work Schedule</a></li>
          <li><a href="/logout">🚪 Logout</a></li>
        </ul>
      </div>
      <div class="main-content">
        <div class="top-bar">
          <h2>Worker Profile: ${worker.full_name}</h2>
          <a href="/admin/workers" class="btn" style="background: #7f8c8d;">← Back to Workers</a>
        </div>
        <div class="panel" style="display: flex; gap: 30px; align-items: center;">
          ${worker.profile_picture ? `<img src="${worker.profile_picture}" width="120" height="120" style="object-fit:cover; border-radius: 8px; border: 3px solid #3498db;">` : '<div style="width:120px;height:120px;background:#e2e8f0;display:flex;align-items:center;justify-content:center;border-radius:8px;">No Photo</div>'}
          <div>
            <h3 style="font-size: 22px; color: #2c3e50; margin-bottom: 5px;">${worker.full_name}</h3>
            <p style="color: #3498db; font-weight: bold; margin-bottom: 10px;">${worker.position} (${worker.unique_worker_id})</p>
            <p style="color: #555; font-size: 14px; margin-bottom: 5px;"><strong>Contact:</strong> ${worker.contact_number}</p>
            <p style="color: #555; font-size: 14px; margin-bottom: 5px;"><strong>Project:</strong> ${worker.assigned_project}</p>
            <p style="color: #555; font-size: 14px; margin-bottom: 5px;"><strong>Daily Rate:</strong> ₱${parseFloat(worker.daily_rate).toFixed(2)}</p>
            <p style="color: #555; font-size: 14px;"><strong>Status:</strong> <span class="badge ${worker.status === 'Active' ? 'badge-success' : 'badge-danger'}">${worker.status}</span></p>
          </div>
        </div>
        <div class="panel">
          <h2>Recent Attendance Logs</h2>
          <table>
            <thead>
              <tr><th>Date</th><th>Time</th><th>Type</th></tr>
            </thead>
            <tbody>
              ${attendanceRes.rows.map(a => `
                <tr>
                  <td>${a.date.toISOString().split('T')[0]}</td>
                  <td>${a.time}</td>
                  <td><span class="badge ${a.attendance_type === 'IN' ? 'badge-success' : 'badge-danger'}">${a.attendance_type}</span></td>
                </tr>
              `).join('')}
              ${attendanceRes.rows.length === 0 ? '<tr><td colspan="3" style="text-align: center;">No attendance logs found.</td></tr>' : ''}
            </tbody>
          </table>
        </div>
      </div>
    </body>
    </html>
  `);
});

// --- ADMIN ATTENDANCE MANAGEMENT ---
app.get('/admin/attendance', requireAuth('admin'), async (req, res) => {
  const settings = await getCompanySettings();
  const dateFilter = req.query.date || new Date().toISOString().split('T')[0];
  const search = req.query.search || '';

  let workersQuery = 'SELECT * FROM workers';
  let queryParams = [];
  if (search) {
    workersQuery += ' WHERE full_name ILIKE $1 OR unique_worker_id ILIKE $1 OR position ILIKE $1';
    queryParams.push(`%${search}%`);
  }
  workersQuery += ' ORDER BY full_name ASC';
  const workersRes = await pool.query(workersQuery, queryParams);

  let attendanceSummary = [];
  for (let w of workersRes.rows) {
    const calc = await calculateAttendanceStatusForDate(w.id, dateFilter);
    let firstIn = 'N/A', firstOut = 'N/A', secondIn = 'N/A', finalOut = 'N/A';
    if (calc.logs.length > 0) {
      const ins = calc.logs.filter(l => l.attendance_type === 'IN');
      const outs = calc.logs.filter(l => l.attendance_type === 'OUT');
      if (ins.length > 0) firstIn = ins[0].time;
      if (outs.length > 0) firstOut = outs[0].time;
      if (ins.length > 1) secondIn = ins[1].time;
      if (outs.length > 1) finalOut = outs[outs.length - 1].time;
    }
    attendanceSummary.push({
      worker: w,
      date: dateFilter,
      firstIn, firstOut, secondIn, finalOut,
      totalHours: calc.totalHours,
      status: calc.status
    });
  }

  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>Attendance Management - ${settings.company_name}</title>
      <style>${globalStyles}</style>
    </head>
    <body>
      <div class="sidebar">
        <div class="sidebar-header">
          ${settings.company_logo ? `<img src="${settings.company_logo}" alt="Logo">` : ''}
          <h2>${settings.company_name}</h2>
        </div>
        <ul class="sidebar-menu">
          <li><a href="/admin/dashboard">📊 Dashboard</a></li>
          <li><a href="/admin/workers">👷 Workers</a></li>
          <li><a href="/admin/attendance" class="active">📋 Attendance</a></li>
          <li><a href="/admin/advance">💰 Advance Money</a></li>
          <li><a href="/admin/salary">💵 Salary</a></li>
          <li><a href="/admin/announcements">📢 Announcements</a></li>
          <li><a href="/admin/settings">⚙️ Company Settings</a></li>
          <li><a href="/admin/schedule">⏰ Work Schedule</a></li>
          <li><a href="/logout">🚪 Logout</a></li>
        </ul>
      </div>
      <div class="main-content">
        <div class="top-bar">
          <h2>Attendance Records & Management</h2>
          <span>Date: ${dateFilter}</span>
        </div>
        <div class="panel">
          <form method="GET" action="/admin/attendance" style="margin-bottom: 20px; display: flex; gap: 10px; flex-wrap: wrap;">
            <input type="date" name="date" value="${dateFilter}" style="padding: 10px; border: 1px solid #ddd; border-radius: 4px;">
            <input type="text" name="search" placeholder="Search worker name or ID..." value="${search}" style="flex: 1; min-width: 200px; padding: 10px; border: 1px solid #ddd; border-radius: 4px;">
            <button type="submit" class="btn">Filter</button>
            <a href="/admin/attendance" class="btn" style="background: #7f8c8d;">Reset</a>
          </form>
          <table>
            <thead>
              <tr><th>Worker</th><th>ID</th><th>Position</th><th>1st IN</th><th>1st OUT</th><th>2nd IN</th><th>Final OUT</th><th>Hours</th><th>Status</th></tr>
            </thead>
            <tbody>
              ${attendanceSummary.map(item => `
                <tr>
                  <td><strong>${item.worker.full_name}</strong></td>
                  <td>${item.worker.unique_worker_id}</td>
                  <td>${item.worker.position}</td>
                  <td>${item.firstIn}</td>
                  <td>${item.firstOut}</td>
                  <td>${item.secondIn}</td>
                  <td>${item.finalOut}</td>
                  <td>${item.totalHours} hrs</td>
                  <td><span class="badge ${item.status === 'FULL DAY' ? 'badge-success' : item.status === 'HALF DAY' ? 'badge-warning' : item.status === 'INCOMPLETE' ? 'badge-info' : 'badge-danger'}">${item.status}</span></td>
                </tr>
              `).join('')}
              ${attendanceSummary.length === 0 ? '<tr><td colspan="9" style="text-align: center;">No workers found.</td></tr>' : ''}
            </tbody>
          </table>
        </div>
      </div>
    </body>
    </html>
  `);
});

// --- ADVANCE MONEY MANAGEMENT ---
app.get('/admin/advance', requireAuth('admin'), async (req, res) => {
  const settings = await getCompanySettings();
  const workersRes = await pool.query('SELECT id, full_name, unique_worker_id FROM workers WHERE status = $1 ORDER BY full_name ASC', ['Active']);
  const advancesRes = await pool.query(`
    SELECT am.*, w.full_name, w.unique_worker_id 
    FROM advance_money am 
    JOIN workers w ON am.worker_id = w.id 
    ORDER BY am.date DESC, am.id DESC
  `);

  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>Advance Money - ${settings.company_name}</title>
      <style>${globalStyles}</style>
    </head>
    <body>
      <div class="sidebar">
        <div class="sidebar-header">
          ${settings.company_logo ? `<img src="${settings.company_logo}" alt="Logo">` : ''}
          <h2>${settings.company_name}</h2>
        </div>
        <ul class="sidebar-menu">
          <li><a href="/admin/dashboard">📊 Dashboard</a></li>
          <li><a href="/admin/workers">👷 Workers</a></li>
          <li><a href="/admin/attendance">📋 Attendance</a></li>
          <li><a href="/admin/advance" class="active">💰 Advance Money</a></li>
          <li><a href="/admin/salary">💵 Salary</a></li>
          <li><a href="/admin/announcements">📢 Announcements</a></li>
          <li><a href="/admin/settings">⚙️ Company Settings</a></li>
          <li><a href="/admin/schedule">⏰ Work Schedule</a></li>
          <li><a href="/logout">🚪 Logout</a></li>
        </ul>
      </div>
      <div class="main-content">
        <div class="top-bar">
          <h2>Advance Money Management</h2>
        </div>
        ${req.query.msg ? `<div class="alert alert-success">${req.query.msg}</div>` : ''}
        <div class="panel" style="max-width: 600px; margin-bottom: 30px;">
          <h2>Record Advance Money</h2>
          <form action="/admin/advance" method="POST">
            <div class="form-group">
              <label>Select Worker</label>
              <select name="worker_id" required>
                <option value="">-- Choose Worker --</option>
                ${workersRes.rows.map(w => `<option value="${w.id}">${w.full_name} (${w.unique_worker_id})</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label>Advance Amount (₱)</label>
              <input type="number" step="0.01" name="amount" required>
            </div>
            <div class="form-group">
              <label>Date</label>
              <input type="date" name="date" value="${new Date().toISOString().split('T')[0]}" required>
            </div>
            <div class="form-group">
              <label>Reason / Notes</label>
              <textarea name="reason" rows="3"></textarea>
            </div>
            <button type="submit" class="btn btn-success" style="width: 100%;">Record Advance</button>
          </form>
        </div>
        <div class="panel">
          <h2>Advance Money History</h2>
          <table>
            <thead>
              <tr><th>Date</th><th>Worker ID</th><th>Worker Name</th><th>Amount</th><th>Reason</th></tr>
            </thead>
            <tbody>
              ${advancesRes.rows.map(adv => `
                <tr>
                  <td>${adv.date.toISOString().split('T')[0]}</td>
                  <td>${adv.unique_worker_id}</td>
                  <td>${adv.full_name}</td>
                  <td>₱${parseFloat(adv.amount).toFixed(2)}</td>
                  <td>${adv.reason || 'N/A'}</td>
                </tr>
              `).join('')}
              ${advancesRes.rows.length === 0 ? '<tr><td colspan="5" style="text-align: center;">No advance money records found.</td></tr>' : ''}
            </tbody>
          </table>
        </div>
      </div>
    </body>
    </html>
  `);
});

app.post('/admin/advance', requireAuth('admin'), async (req, res) => {
  const { worker_id, amount, date, reason } = req.body;
  try {
    await pool.query('INSERT INTO advance_money (worker_id, amount, date, reason) VALUES ($1, $2, $3, $4)', [worker_id, amount, date, reason]);
    res.redirect('/admin/advance?msg=Advance money recorded successfully.');
  } catch (err) {
    res.redirect('/admin/advance?msg=Error recording advance money.');
  }
});

// --- SALARY MANAGEMENT ---
app.get('/admin/salary', requireAuth('admin'), async (req, res) => {
  const settings = await getCompanySettings();
  const workersRes = await pool.query('SELECT * FROM workers ORDER BY full_name ASC');

  let salaryReports = [];
  for (let w of workersRes.rows) {
    // Calculate total full days and half days for this worker across all logs or current month
    const logsRes = await pool.query('SELECT DISTINCT date FROM attendance_logs WHERE worker_id = $1', [w.id]);
    let fullDays = 0;
    let halfDays = 0;

    for (let row of logsRes.rows) {
      const dateStr = row.date.toISOString().split('T')[0];
      const calc = await calculateAttendanceStatusForDate(w.id, dateStr);
      if (calc.status === 'FULL DAY') fullDays++;
      else if (calc.status === 'HALF DAY') halfDays++;
    }

    const equivalentDays = fullDays + (halfDays * 0.5);
    const totalSalary = equivalentDays * parseFloat(w.daily_rate);

    // Sum total advance money for worker
    const advRes = await pool.query('SELECT SUM(amount) as total_adv FROM advance_money WHERE worker_id = $1', [w.id]);
    const totalAdvance = parseFloat(advRes.rows[0].total_adv || 0);
    const netSalary = totalSalary - totalAdvance;

    salaryReports.push({
      worker: w,
      fullDays,
      halfDays,
      equivalentDays,
      totalSalary,
      totalAdvance,
      netSalary
    });
  }

  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>Salary Management - ${settings.company_name}</title>
      <style>${globalStyles}</style>
    </head>
    <body>
      <div class="sidebar">
        <div class="sidebar-header">
          ${settings.company_logo ? `<img src="${settings.company_logo}" alt="Logo">` : ''}
          <h2>${settings.company_name}</h2>
        </div>
        <ul class="sidebar-menu">
          <li><a href="/admin/dashboard">📊 Dashboard</a></li>
          <li><a href="/admin/workers">👷 Workers</a></li>
          <li><a href="/admin/attendance">📋 Attendance</a></li>
          <li><a href="/admin/advance">💰 Advance Money</a></li>
          <li><a href="/admin/salary" class="active">💵 Salary</a></li>
          <li><a href="/admin/announcements">📢 Announcements</a></li>
          <li><a href="/admin/settings">⚙️ Company Settings</a></li>
          <li><a href="/admin/schedule">⏰ Work Schedule</a></li>
          <li><a href="/logout">🚪 Logout</a></li>
        </ul>
      </div>
      <div class="main-content">
        <div class="top-bar">
          <h2>Salary Calculation & Payroll</h2>
        </div>
        <div class="panel">
          <table>
            <thead>
              <tr><th>Worker</th><th>Daily Rate</th><th>Full Days</th><th>Half Days</th><th>Eq. Days</th><th>Total Salary</th><th>Advance Ded.</th><th>Net Salary</th></tr>
            </thead>
            <tbody>
              ${salaryReports.map(rep => `
                <tr>
                  <td><strong>${rep.worker.full_name}</strong><br><small>${rep.worker.unique_worker_id}</small></td>
                  <td>₱${parseFloat(rep.worker.daily_rate).toFixed(2)}</td>
                  <td>${rep.fullDays}</td>
                  <td>${rep.halfDays}</td>
                  <td>${rep.equivalentDays}</td>
                  <td>₱${rep.totalSalary.toFixed(2)}</td>
                  <td style="color: #e74c3c;">-₱${rep.totalAdvance.toFixed(2)}</td>
                  <td><strong style="color: #27ae60;">₱${rep.netSalary.toFixed(2)}</strong></td>
                </tr>
              `).join('')}
              ${salaryReports.length === 0 ? '<tr><td colspan="8" style="text-align: center;">No salary reports available.</td></tr>' : ''}
            </tbody>
          </table>
        </div>
      </div>
    </body>
    </html>
  `);
});

// --- ANNOUNCEMENTS ---
app.get('/admin/announcements', requireAuth('admin'), async (req, res) => {
  const settings = await getCompanySettings();
  const annRes = await pool.query('SELECT * FROM announcements ORDER BY created_at DESC');

  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>Announcements - ${settings.company_name}</title>
      <style>${globalStyles}</style>
    </head>
    <body>
      <div class="sidebar">
        <div class="sidebar-header">
          ${settings.company_logo ? `<img src="${settings.company_logo}" alt="Logo">` : ''}
          <h2>${settings.company_name}</h2>
        </div>
        <ul class="sidebar-menu">
          <li><a href="/admin/dashboard">📊 Dashboard</a></li>
          <li><a href="/admin/workers">👷 Workers</a></li>
          <li><a href="/admin/attendance">📋 Attendance</a></li>
          <li><a href="/admin/advance">💰 Advance Money</a></li>
          <li><a href="/admin/salary">💵 Salary</a></li>
          <li><a href="/admin/announcements" class="active">📢 Announcements</a></li>
          <li><a href="/admin/settings">⚙️ Company Settings</a></li>
          <li><a href="/admin/schedule">⏰ Work Schedule</a></li>
          <li><a href="/logout">🚪 Logout</a></li>
        </ul>
      </div>
      <div class="main-content">
        <div class="top-bar">
          <h2>Announcements Management</h2>
        </div>
        ${req.query.msg ? `<div class="alert alert-success">${req.query.msg}</div>` : ''}
        <div class="panel" style="max-width: 600px; margin-bottom: 30px;">
          <h2>Post New Announcement</h2>
          <form action="/admin/announcements" method="POST">
            <div class="form-group">
              <label>Title</label>
              <input type="text" name="title" required>
            </div>
            <div class="form-group">
              <label>Content</label>
              <textarea name="content" rows="4" required></textarea>
            </div>
            <button type="submit" class="btn btn-success" style="width: 100%;">Publish Announcement</button>
          </form>
        </div>
        <div class="panel">
          <h2>Active Announcements</h2>
          ${annRes.rows.map(a => `
            <div style="background: #f8f9fa; padding: 15px; border-radius: 6px; margin-bottom: 15px; border-left: 4px solid #3498db;">
              <h3 style="font-size: 16px; color: #2c3e50; margin-bottom: 5px;">${a.title}</h3>
              <p style="color: #555; font-size: 14px; margin-bottom: 10px;">${a.content}</p>
              <div style="display: flex; justify-content: space-between; align-items: center; font-size: 12px; color: #7f8c8d;">
                <span>Posted: ${a.created_at.toISOString().split('T')[0]}</span>
                <a href="/admin/announcements/delete/${a.id}" class="btn btn-danger" style="padding: 2px 8px; font-size: 11px;">Delete</a>
              </div>
            </div>
          `).join('')}
          ${annRes.rows.length === 0 ? '<p>No announcements found.</p>' : ''}
        </div>
      </div>
    </body>
    </html>
  `);
});

app.post('/admin/announcements', requireAuth('admin'), async (req, res) => {
  const { title, content } = req.body;
  try {
    await pool.query('INSERT INTO announcements (title, content) VALUES ($1, $2)', [title, content]);
    res.redirect('/admin/announcements?msg=Announcement published successfully.');
  } catch (err) {
    res.redirect('/admin/announcements?msg=Error publishing announcement.');
  }
});

app.get('/admin/announcements/delete/:id', requireAuth('admin'), async (req, res) => {
  try {
    await pool.query('DELETE FROM announcements WHERE id = $1', [req.params.id]);
    res.redirect('/admin/announcements?msg=Announcement deleted.');
  } catch (err) {
    res.redirect('/admin/announcements');
  }
});

// --- COMPANY SETTINGS ---
app.get('/admin/settings', requireAuth('admin'), async (req, res) => {
  const settings = await getCompanySettings();
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>Company Settings - ${settings.company_name}</title>
      <style>${globalStyles}</style>
    </head>
    <body>
      <div class="sidebar">
        <div class="sidebar-header">
          ${settings.company_logo ? `<img src="${settings.company_logo}" alt="Logo">` : ''}
          <h2>${settings.company_name}</h2>
        </div>
        <ul class="sidebar-menu">
          <li><a href="/admin/dashboard">📊 Dashboard</a></li>
          <li><a href="/admin/workers">👷 Workers</a></li>
          <li><a href="/admin/attendance">📋 Attendance</a></li>
          <li><a href="/admin/advance">💰 Advance Money</a></li>
          <li><a href="/admin/salary">💵 Salary</a></li>
          <li><a href="/admin/announcements">📢 Announcements</a></li>
          <li><a href="/admin/settings" class="active">⚙️ Company Settings</a></li>
          <li><a href="/admin/schedule">⏰ Work Schedule</a></li>
          <li><a href="/logout">🚪 Logout</a></li>
        </ul>
      </div>
      <div class="main-content">
        <div class="top-bar">
          <h2>Company Customization Settings</h2>
        </div>
        ${req.query.msg ? `<div class="alert alert-success">${req.query.msg}</div>` : ''}
        <div class="panel" style="max-width: 600px; margin: 0 auto;">
          <form action="/admin/settings" method="POST">
            <div class="form-group">
              <label>Builder / Company Name</label>
              <input type="text" name="company_name" value="${settings.company_name}" required>
            </div>
            <div class="form-group">
              <label>Company Logo URL</label>
              <input type="text" name="company_logo" value="${settings.company_logo || ''}" placeholder="https://example.com/logo.png">
              <small style="color: #7f8c8d;">Render compatible: Stored securely in database.</small>
            </div>
            <div class="form-group">
              <label>Company Address</label>
              <input type="text" name="company_address" value="${settings.company_address || ''}">
            </div>
            <div class="form-group">
              <label>Contact Number</label>
              <input type="text" name="contact_number" value="${settings.contact_number || ''}">
            </div>
            <button type="submit" class="btn btn-success" style="width: 100%; padding: 12px;">Save Settings</button>
          </form>
        </div>
      </div>
    </body>
    </html>
  `);
});

app.post('/admin/settings', requireAuth('admin'), async (req, res) => {
  const { company_name, company_logo, company_address, contact_number } = req.body;
  try {
    await pool.query('UPDATE company_settings SET company_name = $1, company_logo = $2, company_address = $3, contact_number = $4', [company_name, company_logo, company_address, contact_number]);
    res.redirect('/admin/settings?msg=Company settings updated successfully.');
  } catch (err) {
    res.redirect('/admin/settings?msg=Error updating settings.');
  }
});

// --- WORK SCHEDULE SETTINGS ---
app.get('/admin/schedule', requireAuth('admin'), async (req, res) => {
  const settings = await getCompanySettings();
  const schedule = await getWorkSchedule();

  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>Work Schedule - ${settings.company_name}</title>
      <style>${globalStyles}</style>
    </head>
    <body>
      <div class="sidebar">
        <div class="sidebar-header">
          ${settings.company_logo ? `<img src="${settings.company_logo}" alt="Logo">` : ''}
          <h2>${settings.company_name}</h2>
        </div>
        <ul class="sidebar-menu">
          <li><a href="/admin/dashboard">📊 Dashboard</a></li>
          <li><a href="/admin/workers">👷 Workers</a></li>
          <li><a href="/admin/attendance">📋 Attendance</a></li>
          <li><a href="/admin/advance">💰 Advance Money</a></li>
          <li><a href="/admin/salary">💵 Salary</a></li>
          <li><a href="/admin/announcements">📢 Announcements</a></li>
          <li><a href="/admin/settings">⚙️ Company Settings</a></li>
          <li><a href="/admin/schedule" class="active">⏰ Work Schedule</a></li>
          <li><a href="/logout">🚪 Logout</a></li>
        </ul>
      </div>
      <div class="main-content">
        <div class="top-bar">
          <h2>Work Schedule Settings</h2>
        </div>
        ${req.query.msg ? `<div class="alert alert-success">${req.query.msg}</div>` : ''}
        <div class="panel" style="max-width: 600px; margin: 0 auto;">
          <form action="/admin/schedule" method="POST">
            <div class="form-group">
              <label>Morning Start Time</label>
              <input type="text" name="morning_start" value="${schedule.morning_start}" required>
            </div>
            <div class="form-group">
              <label>Morning End Time</label>
              <input type="text" name="morning_end" value="${schedule.morning_end}" required>
            </div>
            <div class="form-group">
              <label>Afternoon Start Time</label>
              <input type="text" name="afternoon_start" value="${schedule.afternoon_start}" required>
            </div>
            <div class="form-group">
              <label>Afternoon End Time</label>
              <input type="text" name="afternoon_end" value="${schedule.afternoon_end}" required>
            </div>
            <div class="form-group">
              <label>Full Day Hours Threshold</label>
              <input type="number" step="0.5" name="full_day_hours" value="${schedule.full_day_hours}" required>
            </div>
            <div class="form-group">
              <label>Half Day Hours Threshold</label>
              <input type="number" step="0.5" name="half_day_hours" value="${schedule.half_day_hours}" required>
            </div>
            <button type="submit" class="btn btn-success" style="width: 100%; padding: 12px;">Update Schedule Rules</button>
          </form>
        </div>
      </div>
    </body>
    </html>
  `);
});

app.post('/admin/schedule', requireAuth('admin'), async (req, res) => {
  const { morning_start, morning_end, afternoon_start, afternoon_end, full_day_hours, half_day_hours } = req.body;
  try {
    await pool.query('UPDATE work_schedules SET morning_start = $1, morning_end = $2, afternoon_start = $3, afternoon_end = $4, full_day_hours = $5, half_day_hours = $6', [morning_start, morning_end, afternoon_start, afternoon_end, full_day_hours, half_day_hours]);
    res.redirect('/admin/schedule?msg=Work schedule settings updated successfully.');
  } catch (err) {
    res.redirect('/admin/schedule?msg=Error updating work schedule.');
  }
});

// ============================================================================
// WORKER PORTAL ROUTES (/worker)
// ============================================================================
app.get('/worker/dashboard', requireAuth('worker'), async (req, res) => {
  const settings = await getCompanySettings();
  const workerRes = await pool.query('SELECT * FROM workers WHERE id = $1', [req.session.user.worker_id]);
  const worker = workerRes.rows[0];
  const todayStr = new Date().toISOString().split('T')[0];
  const calc = await calculateAttendanceStatusForDate(worker.id, todayStr);

  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>Worker Portal - ${settings.company_name}</title>
      <style>${globalStyles}</style>
    </head>
    <body>
      <div class="sidebar" style="background: #27ae60;">
        <div class="sidebar-header" style="background: #1e8449;">
          ${settings.company_logo ? `<img src="${settings.company_logo}" alt="Logo">` : ''}
          <h2>${settings.company_name}</h2>
        </div>
        <ul class="sidebar-menu">
          <li><a href="/worker/dashboard" class="active">🏠 Home</a></li>
          <li><a href="/worker/qr">📱 My QR Code</a></li>
          <li><a href="/worker/attendance">📋 My Attendance</a></li>
          <li><a href="/worker/advance">💰 My Advance</a></li>
          <li><a href="/worker/salary">💵 My Salary</a></li>
          <li><a href="/worker/announcements">📢 Announcements</a></li>
          <li><a href="/logout">🚪 Logout</a></li>
        </ul>
      </div>
      <div class="main-content">
        <div class="top-bar">
          <h2>Worker Portal Dashboard</h2>
          <span>Welcome, ${worker.full_name}</span>
        </div>
        <div class="panel" style="display: flex; gap: 30px; align-items: center;">
          ${worker.profile_picture ? `<img src="${worker.profile_picture}" width="100" height="100" style="object-fit:cover; border-radius:50%; border:3px solid #27ae60;">` : ''}
          <div>
            <h3 style="font-size: 20px; color: #2c3e50; margin-bottom: 5px;">${worker.full_name}</h3>
            <p style="color: #27ae60; font-weight: bold; margin-bottom: 5px;">${worker.position} (${worker.unique_worker_id})</p>
            <p style="color: #555; font-size: 14px; margin-bottom: 5px;"><strong>Project:</strong> ${worker.assigned_project}</p>
            <p style="color: #555; font-size: 14px;"><strong>Today's Status:</strong> <span class="badge badge-info">${calc.status}</span> (${calc.totalHours} hrs)</p>
          </div>
        </div>
      </div>
    </body>
    </html>
  `);
});

app.get('/worker/qr', requireAuth('worker'), async (req, res) => {
  const settings = await getCompanySettings();
  const workerRes = await pool.query('SELECT * FROM workers WHERE id = $1', [req.session.user.worker_id]);
  const worker = workerRes.rows[0];

  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>My QR Code - ${settings.company_name}</title>
      <style>
        ${globalStyles}
        .qr-card { background: white; padding: 40px; border-radius: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.1); text-align: center; max-width: 400px; margin: 40px auto; border-top: 6px solid #27ae60; }
        .qr-placeholder { background: #f8f9fa; border: 3px dashed #cbd5e1; padding: 30px; border-radius: 8px; margin: 20px 0; font-family: monospace; font-size: 24px; font-weight: bold; color: #2c3e50; }
      </style>
    </head>
    <body>
      <div class="sidebar" style="background: #27ae60;">
        <div class="sidebar-header" style="background: #1e8449;">
          ${settings.company_logo ? `<img src="${settings.company_logo}" alt="Logo">` : ''}
          <h2>${settings.company_name}</h2>
        </div>
        <ul class="sidebar-menu">
          <li><a href="/worker/dashboard">🏠 Home</a></li>
          <li><a href="/worker/qr" class="active">📱 My QR Code</a></li>
          <li><a href="/worker/attendance">📋 My Attendance</a></li>
          <li><a href="/worker/advance">💰 My Advance</a></li>
          <li><a href="/worker/salary">💵 My Salary</a></li>
          <li><a href="/worker/announcements">📢 Announcements</a></li>
          <li><a href="/logout">🚪 Logout</a></li>
        </ul>
      </div>
      <div class="main-content">
        <div class="top-bar">
          <h2>My Personal QR Code</h2>
        </div>
        <div class="qr-card">
          ${settings.company_logo ? `<img src="${settings.company_logo}" style="max-height:50px; margin-bottom:15px; object-fit:contain;" alt="Logo">` : ''}
          <h3 style="color: #2c3e50; margin-bottom: 5px;">${settings.company_name}</h3>
          <p style="color: #7f8c8d; font-size: 13px; margin-bottom: 20px;">Official Worker Badge</p>
          ${worker.profile_picture ? `<img src="${worker.profile_picture}" width="90" height="90" style="object-fit:cover; border-radius:50%; margin-bottom:15px; border: 3px solid #27ae60;">` : ''}
          <h2 style="font-size: 20px; color: #2c3e50;">${worker.full_name}</h2>
          <p style="color: #27ae60; font-weight: bold; margin-bottom: 15px;">${worker.position}</p>
          <div class="qr-placeholder">
            <div>${worker.unique_worker_id}</div>
            <div style="font-size: 11px; color: #64748b; font-weight: normal; margin-top: 5px;">UNIQUE QR CODE TOKEN</div>
          </div>
          <button onclick="window.print()" class="btn btn-success" style="width: 100%;">Print QR Code</button>
        </div>
      </div>
    </body>
    </html>
  `);
});

app.get('/worker/attendance', requireAuth('worker'), async (req, res) => {
  const settings = await getCompanySettings();
  const workerRes = await pool.query('SELECT * FROM workers WHERE id = $1', [req.session.user.worker_id]);
  const worker = workerRes.rows[0];
  const logsRes = await pool.query('SELECT DISTINCT date FROM attendance_logs WHERE worker_id = $1 ORDER BY date DESC', [worker.id]);

  let attendanceHistory = [];
  for (let row of logsRes.rows) {
    const dateStr = row.date.toISOString().split('T')[0];
    const calc = await calculateAttendanceStatusForDate(worker.id, dateStr);
    attendanceHistory.push({
      date: dateStr,
      logs: calc.logs,
      totalHours: calc.totalHours,
      status: calc.status
    });
  }

  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>My Attendance - ${settings.company_name}</title>
      <style>${globalStyles}</style>
    </head>
    <body>
      <div class="sidebar" style="background: #27ae60;">
        <div class="sidebar-header" style="background: #1e8449;">
          ${settings.company_logo ? `<img src="${settings.company_logo}" alt="Logo">` : ''}
          <h2>${settings.company_name}</h2>
        </div>
        <ul class="sidebar-menu">
          <li><a href="/worker/dashboard">🏠 Home</a></li>
          <li><a href="/worker/qr">📱 My QR Code</a></li>
          <li><a href="/worker/attendance" class="active">📋 My Attendance</a></li>
          <li><a href="/worker/advance">💰 My Advance</a></li>
          <li><a href="/worker/salary">💵 My Salary</a></li>
          <li><a href="/worker/announcements">📢 Announcements</a></li>
          <li><a href="/logout">🚪 Logout</a></li>
        </ul>
      </div>
      <div class="main-content">
        <div class="top-bar">
          <h2>My Attendance Logs</h2>
        </div>
        <div class="panel">
          <table>
            <thead>
              <tr><th>Date</th><th>Records (IN / OUT)</th><th>Total Working Hours</th><th>Status</th></tr>
            </thead>
            <tbody>
              ${attendanceHistory.map(item => `
                <tr>
                  <td><strong>${item.date}</strong></td>
                  <td>${item.logs.map(l => `${l.attendance_type}: ${l.time}`).join(' | ')}</td>
                  <td>${item.totalHours} Hours</td>
                  <td><span class="badge ${item.status === 'FULL DAY' ? 'badge-success' : 'badge-warning'}">${item.status}</span></td>
                </tr>
              `).join('')}
              ${attendanceHistory.length === 0 ? '<tr><td colspan="4" style="text-align: center;">No attendance records found.</td></tr>' : ''}
            </tbody>
          </table>
        </div>
      </div>
    </body>
    </html>
  `);
});

app.get('/worker/advance', requireAuth('worker'), async (req, res) => {
  const settings = await getCompanySettings();
  const workerRes = await pool.query('SELECT * FROM workers WHERE id = $1', [req.session.user.worker_id]);
  const worker = workerRes.rows[0];
  const advRes = await pool.query('SELECT * FROM advance_money WHERE worker_id = $1 ORDER BY date DESC', [worker.id]);
  const totalAdvRes = await pool.query('SELECT SUM(amount) as total FROM advance_money WHERE worker_id = $1', [worker.id]);
  const totalRemainingBalance = parseFloat(totalAdvRes.rows[0].total || 0);

  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>My Advance Money - ${settings.company_name}</title>
      <style>${globalStyles}</style>
    </head>
    <body>
      <div class="sidebar" style="background: #27ae60;">
        <div class="sidebar-header" style="background: #1e8449;">
          ${settings.company_logo ? `<img src="${settings.company_logo}" alt="Logo">` : ''}
          <h2>${settings.company_name}</h2>
        </div>
        <ul class="sidebar-menu">
          <li><a href="/worker/dashboard">🏠 Home</a></li>
          <li><a href="/worker/qr">📱 My QR Code</a></li>
          <li><a href="/worker/attendance">📋 My Attendance</a></li>
          <li><a href="/worker/advance" class="active">💰 My Advance</a></li>
          <li><a href="/worker/salary">💵 My Salary</a></li>
          <li><a href="/worker/announcements">📢 Announcements</a></li>
          <li><a href="/logout">🚪 Logout</a></li>
        </ul>
      </div>
      <div class="main-content">
        <div class="top-bar">
          <h2>My Advance Money Records</h2>
          <span>Total Balance: <strong>₱${totalRemainingBalance.toFixed(2)}</strong></span>
        </div>
        <div class="panel">
          <table>
            <thead>
              <tr><th>Date</th><th>Amount</th><th>Reason</th></tr>
            </thead>
            <tbody>
              ${advRes.rows.map(adv => `
                <tr>
                  <td>${adv.date.toISOString().split('T')[0]}</td>
                  <td>₱${parseFloat(adv.amount).toFixed(2)}</td>
                  <td>${adv.reason || 'N/A'}</td>
                </tr>
              `).join('')}
              ${advRes.rows.length === 0 ? '<tr><td colspan="3" style="text-align: center;">No advance money records found.</td></tr>' : ''}
            </tbody>
          </table>
        </div>
      </div>
    </body>
    </html>
  `);
});

app.get('/worker/salary', requireAuth('worker'), async (req, res) => {
  const settings = await getCompanySettings();
  const workerRes = await pool.query('SELECT * FROM workers WHERE id = $1', [req.session.user.worker_id]);
  const worker = workerRes.rows[0];

  const logsRes = await pool.query('SELECT DISTINCT date FROM attendance_logs WHERE worker_id = $1', [worker.id]);
  let fullDays = 0, halfDays = 0;
  for (let row of logsRes.rows) {
    const dateStr = row.date.toISOString().split('T')[0];
    const calc = await calculateAttendanceStatusForDate(worker.id, dateStr);
    if (calc.status === 'FULL DAY') fullDays++;
    else if (calc.status === 'HALF DAY') halfDays++;
  }

  const equivalentDays = fullDays + (halfDays * 0.5);
  const totalSalary = equivalentDays * parseFloat(worker.daily_rate);
  const advRes = await pool.query('SELECT SUM(amount) as total_adv FROM advance_money WHERE worker_id = $1', [worker.id]);
  const totalAdvance = parseFloat(advRes.rows[0].total_adv || 0);
  const netSalary = totalSalary - totalAdvance;

  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>My Salary - ${settings.company_name}</title>
      <style>${globalStyles}</style>
    </head>
    <body>
      <div class="sidebar" style="background: #27ae60;">
        <div class="sidebar-header" style="background: #1e8449;">
          ${settings.company_logo ? `<img src="${settings.company_logo}" alt="Logo">` : ''}
          <h2>${settings.company_name}</h2>
        </div>
        <ul class="sidebar-menu">
          <li><a href="/worker/dashboard">🏠 Home</a></li>
          <li><a href="/worker/qr">📱 My QR Code</a></li>
          <li><a href="/worker/attendance">📋 My Attendance</a></li>
          <li><a href="/worker/advance">💰 My Advance</a></li>
          <li><a href="/worker/salary" class="active">💵 My Salary</a></li>
          <li><a href="/worker/announcements">📢 Announcements</a></li>
          <li><a href="/logout">🚪 Logout</a></li>
        </ul>
      </div>
      <div class="main-content">
        <div class="top-bar">
          <h2>My Salary Breakdown</h2>
        </div>
        <div class="panel" style="max-width: 600px; margin: 0 auto;">
          <p style="margin-bottom: 10px;"><strong>Daily Rate:</strong> ₱${parseFloat(worker.daily_rate).toFixed(2)}</p>
          <p style="margin-bottom: 10px;"><strong>Full Days Worked:</strong> ${fullDays}</p>
          <p style="margin-bottom: 10px;"><strong>Half Days Worked:</strong> ${halfDays}</p>
          <p style="margin-bottom: 10px;"><strong>Equivalent Days:</strong> ${equivalentDays}</p>
          <hr style="margin: 15px 0; border: 0; border-top: 1px solid #ddd;">
          <p style="margin-bottom: 10px;"><strong>Total Salary:</strong> ₱${totalSalary.toFixed(2)}</p>
          <p style="margin-bottom: 10px; color: #e74c3c;"><strong>Advance Deduction:</strong> -₱${totalAdvance.toFixed(2)}</p>
          <h3 style="color: #27ae60; margin-top: 15px;">Net Salary: ₱${netSalary.toFixed(2)}</h3>
        </div>
      </div>
    </body>
    </html>
  `);
});

app.get('/worker/announcements', requireAuth('worker'), async (req, res) => {
  const settings = await getCompanySettings();
  const annRes = await pool.query('SELECT * FROM announcements ORDER BY created_at DESC');

  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>Announcements - ${settings.company_name}</title>
      <style>${globalStyles}</style>
    </head>
    <body>
      <div class="sidebar" style="background: #27ae60;">
        <div class="sidebar-header" style="background: #1e8449;">
          ${settings.company_logo ? `<img src="${settings.company_logo}" alt="Logo">` : ''}
          <h2>${settings.company_name}</h2>
        </div>
        <ul class="sidebar-menu">
          <li><a href="/worker/dashboard">🏠 Home</a></li>
          <li><a href="/worker/qr">📱 My QR Code</a></li>
          <li><a href="/worker/attendance">📋 My Attendance</a></li>
          <li><a href="/worker/advance">💰 My Advance</a></li>
          <li><a href="/worker/salary">💵 My Salary</a></li>
          <li><a href="/worker/announcements" class="active">📢 Announcements</a></li>
          <li><a href="/logout">🚪 Logout</a></li>
        </ul>
      </div>
      <div class="main-content">
        <div class="top-bar">
          <h2>Company Announcements</h2>
        </div>
        <div class="panel">
          ${annRes.rows.map(a => `
            <div style="background: #f8f9fa; padding: 15px; border-radius: 6px; margin-bottom: 15px; border-left: 4px solid #27ae60;">
              <h3 style="font-size: 16px; color: #2c3e50; margin-bottom: 5px;">${a.title}</h3>
              <p style="color: #555; font-size: 14px; margin-bottom: 10px;">${a.content}</p>
              <small style="color: #7f8c8d;">Posted: ${a.created_at.toISOString().split('T')[0]}</small>
            </div>
          `).join('')}
          ${annRes.rows.length === '0' ? '<p>No announcements found.</p>' : ''}
        </div>
      </div>
    </body>
    </html>
  `);
});

// ============================================================================
// ATTENDANCE SCANNER PORTAL ROUTES (/scanner)
// ============================================================================
app.get('/scanner/dashboard', requireAuth('scanner'), async (req, res) => {
  const settings = await getCompanySettings();
  const todayStr = new Date().toISOString().split('T')[0];

  const workersRes = await pool.query('SELECT id FROM workers WHERE status = $1', ['Active']);
  let presentToday = 0, fullDayToday = 0, halfDayToday = 0;

  for (let w of workersRes.rows) {
    const calc = await calculateAttendanceStatusForDate(w.id, todayStr);
    if (calc.status !== 'ABSENT') {
      presentToday++;
      if (calc.status === 'FULL DAY') fullDayToday++;
      if (calc.status === 'HALF DAY') halfDayToday++;
    }
  }

  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>Scanner Dashboard - ${settings.company_name}</title>
      <style>${globalStyles}</style>
    </head>
    <body>
      <div class="sidebar" style="background: #e67e22;">
        <div class="sidebar-header" style="background: #d35400;">
          ${settings.company_logo ? `<img src="${settings.company_logo}" alt="Logo">` : ''}
          <h2>${settings.company_name}</h2>
        </div>
        <ul class="sidebar-menu">
          <li><a href="/scanner/dashboard" class="active">📊 Dashboard</a></li>
          <li><a href="/scanner/scan">📷 Scan QR Code</a></li>
          <li><a href="/scanner/attendance">📋 Today's Attendance</a></li>
          <li><a href="/logout">🚪 Logout</a></li>
        </ul>
      </div>
      <div class="main-content">
        <div class="top-bar">
          <h2>Attendance Scanner Dashboard</h2>
          <span>Date: ${todayStr}</span>
        </div>
        <div class="card-grid">
          <div class="stat-card" style="border-left-color: #27ae60;"><h3>Present Today</h3><p>${presentToday}</p></div>
          <div class="stat-card" style="border-left-color: #3498db;"><h3>Full Day</h3><p>${fullDayToday}</p></div>
          <div class="stat-card" style="border-left-color: #f39c12;"><h3>Half Day</h3><p>${halfDayToday}</p></div>
        </div>
        <div class="panel" style="text-align: center; padding: 40px;">
          <h2 style="border: none;">Ready for Attendance Scanning</h2>
          <p style="color: #7f8c8d; margin-bottom: 20px;">Select TIME IN or TIME OUT before scanning worker QR codes.</p>
          <a href="/scanner/scan" class="btn" style="background: #e67e22; padding: 15px 30px; font-size: 18px;">Proceed to QR Scanner →</a>
        </div>
      </div>
    </body>
    </html>
  `);
});

app.get('/scanner/scan', requireAuth('scanner'), async (req, res) => {
  const settings = await getCompanySettings();
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>Scan QR Code - ${settings.company_name}</title>
      <style>
        ${globalStyles}
        .scan-container { max-width: 500px; margin: 0 auto; background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); text-align: center; }
        .type-btns { display: flex; gap: 15px; margin-bottom: 25px; }
        .type-btn { flex: 1; padding: 15px; font-size: 16px; font-weight: bold; border: 2px solid #cbd5e1; border-radius: 6px; cursor: pointer; background: #f8f9fa; color: #555; transition: 0.2s; }
        .type-btn.active.in { background: #27ae60; color: white; border-color: #27ae60; }
        .type-btn.active.out { background: #e74c3c; color: white; border-color: #e74c3c; }
      </style>
    </head>
    <body>
      <div class="sidebar" style="background: #e67e22;">
        <div class="sidebar-header" style="background: #d35400;">
          ${settings.company_logo ? `<img src="${settings.company_logo}" alt="Logo">` : ''}
          <h2>${settings.company_name}</h2>
        </div>
        <ul class="sidebar-menu">
          <li><a href="/scanner/dashboard">📊 Dashboard</a></li>
          <li><a href="/scanner/scan" class="active">📷 Scan QR Code</a></li>
          <li><a href="/scanner/attendance">📋 Today's Attendance</a></li>
          <li><a href="/logout">🚪 Logout</a></li>
        </ul>
      </div>
      <div class="main-content">
        <div class="top-bar">
          <h2>QR Attendance Scanner</h2>
        </div>
        <div class="scan-container">
          <h3 style="margin-bottom: 15px; color: #2c3e50;">Step 1: Select Attendance Type</h3>
          <div class="type-btns">
            <button type="button" class="type-btn" id="btnIn" onclick="setAttendanceType('IN')">[ TIME IN ]</button>
            <button type="button" class="type-btn" id="btnOut" onclick="setAttendanceType('OUT')">[ TIME OUT ]</button>
          </div>
          
          <div id="scanFormArea" style="display: none;">
            <h3 style="margin-bottom: 15px; color: #2c3e50;">Step 2: Enter/Scan Worker QR ID</h3>
            <div id="alertBox"></div>
            <form id="qrScanForm" onsubmit="submitScan(event)">
              <div class="form-group" style="text-align: left;">
                <label>Worker QR / Unique ID</label>
                <input type="text" id="worker_qr" placeholder="Scan or type Worker ID (e.g. W-001)" required autofocus>
              </div>
              <button type="submit" class="btn" style="width: 100%; padding: 12px; background: #e67e22;">Process Attendance</button>
            </form>
          </div>
        </div>
      </div>

      <script>
        let selectedType = '';
        function setAttendanceType(type) {
          selectedType = type;
          document.getElementById('btnIn').classList.remove('active', 'in');
          document.getElementById('btnOut').classList.remove('active', 'out');
          if (type === 'IN') {
            document.getElementById('btnIn').classList.add('active', 'in');
          } else {
            document.getElementById('btnOut').classList.add('active', 'out');
          }
          document.getElementById('scanFormArea').style.display = 'block';
          document.getElementById('worker_qr').focus();
        }

        async function submitScan(event) {
          event.preventDefault();
          const workerQr = document.getElementById('worker_qr').value.trim();
          const alertBox = document.getElementById('alertBox');
          if (!selectedType) {
            alertBox.innerHTML = '<div class="alert alert-danger">Please Select TIME IN or TIME OUT First</div>';
            return;
          }

          try {
            const response = await fetch('/api/scanner/record', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ qr_code: workerQr, attendance_type: selectedType })
            });
            const result = await response.json();
            if (result.success) {
              alertBox.innerHTML = \`<div class="alert alert-success"><strong>ATTENDANCE RECORDED SUCCESSFULLY</strong><br>Name: \${result.worker.full_name}<br>Position: \${result.worker.position}<br>Type: \${result.type}<br>Time: \${result.time}</div>\`;
              document.getElementById('worker_qr').value = '';
              document.getElementById('worker_qr').focus();
            } else {
              alertBox.innerHTML = \`<div class="alert alert-danger">\${result.message}</div>\`;
            }
          } catch (err) {
            alertBox.innerHTML = '<div class="alert alert-danger">Network error recording attendance.</div>';
          }
        }
      </script>
    </body>
    </html>
  `);
});

// Scanner Attendance API Backend Endpoint with Sequence Validation
app.post('/api/scanner/record', requireAuth('scanner'), async (req, res) => {
  const { qr_code, attendance_type } = req.body;
  if (!attendance_type) {
    return res.json({ success: false, message: 'Please Select TIME IN or TIME OUT First' });
  }

  try {
    const workerRes = await pool.query('SELECT * FROM workers WHERE unique_worker_id = $1 OR qr_code = $1', [qr_code]);
    if (workerRes.rows.length === 0) {
      return res.json({ success: false, message: 'Worker Not Found / Invalid QR Code' });
    }
    const worker = workerRes.rows[0];
    if (worker.status !== 'Active') {
      return res.json({ success: false, message: 'Worker Account is Inactive' });
    }

    const todayStr = new Date().toISOString().split('T')[0];
    const nowTime = new Date().toTimeString().split(' ')[0];

    // Get today's logs for sequence validation
    const logsRes = await pool.query(
      "SELECT * FROM attendance_logs WHERE worker_id = $1 AND date = $2 ORDER BY time ASC",
      [worker.id, todayStr]
    );
    const existingLogs = logsRes.rows;

    // Validate Attendance Sequence Rules
    if (existingLogs.length === 0 && attendance_type === 'OUT') {
      return res.json({ success: false, message: 'Cannot Record OUT as First Attendance' });
    }

    if (existingLogs.length > 0) {
      const lastLog = existingLogs[existingLogs.length - 1];
      if (lastLog.attendance_type === 'IN' && attendance_type === 'IN') {
        return res.json({ success: false, message: 'Cannot Record Two Consecutive IN' });
      }
      if (lastLog.attendance_type === 'OUT' && attendance_type === 'OUT') {
        return res.json({ success: false, message: 'Cannot Record Two Consecutive OUT' });
      }
    }

    // Save attendance log
    await pool.query(
      'INSERT INTO attendance_logs (worker_id, date, time, attendance_type) VALUES ($1, $2, $3, $4)',
      [worker.id, todayStr, nowTime, attendance_type]
    );

    res.json({
      success: true,
      worker: { full_name: worker.full_name, position: worker.position },
      type: attendance_type,
      time: nowTime
    });
  } catch (err) {
    res.json({ success: false, message: 'Server error processing scan.' });
  }
});

app.get('/scanner/attendance', requireAuth('scanner'), async (req, res) => {
  const settings = await getCompanySettings();
  const todayStr = new Date().toISOString().split('T')[0];
  const workersRes = await pool.query('SELECT * FROM workers ORDER BY full_name ASC');

  let todaySummary = [];
  for (let w of workersRes.rows) {
    const calc = await calculateAttendanceStatusForDate(w.id, todayStr);
    if (calc.status !== 'ABSENT') {
      todaySummary.push({
        worker: w,
        logs: calc.logs,
        status: calc.status
      });
    }
  }

  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>Today's Attendance - ${settings.company_name}</title>
      <style>${globalStyles}</style>
    </head>
    <body>
      <div class="sidebar" style="background: #e67e22;">
        <div class="sidebar-header" style="background: #d35400;">
          ${settings.company_logo ? `<img src="${settings.company_logo}" alt="Logo">` : ''}
          <h2>${settings.company_name}</h2>
        </div>
        <ul class="sidebar-menu">
          <li><a href="/scanner/dashboard">📊 Dashboard</a></li>
          <li><a href="/scanner/scan">📷 Scan QR Code</a></li>
          <li><a href="/scanner/attendance" class="active">📋 Today's Attendance</a></li>
          <li><a href="/logout">🚪 Logout</a></li>
        </ul>
      </div>
      <div class="main-content">
        <div class="top-bar">
          <h2>Today's Attendance Records</h2>
          <span>Date: ${todayStr}</span>
        </div>
        <div class="panel">
          <table>
            <thead>
              <tr><th>Worker Name</th><th>Position</th><th>Attendance Records</th><th>Status</th></tr>
            </thead>
            <tbody>
              ${todaySummary.map(item => `
                <tr>
                  <td><strong>${item.worker.full_name}</strong><br><small>${item.worker.unique_worker_id}</small></td>
                  <td>${item.worker.position}</td>
                  <td>${item.logs.map(l => `${l.attendance_type}: ${l.time}`).join(' | ')}</td>
                  <td><span class="badge badge-success">${item.status}</span></td>
                </tr>
              `).join('')}
              ${todaySummary.length === 0 ? '<tr><td colspan="4" style="text-align: center;">No attendance recorded for today yet.</td></tr>' : ''}
            </tbody>
          </table>
        </div>
      </div>
    </body>
    </html>
  `);
});

// Start Server
app.listen(PORT, () => {
  console.log(`Construction Worker Management System running on port ${PORT}`);
});
