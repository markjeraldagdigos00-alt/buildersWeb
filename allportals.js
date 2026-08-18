/******************************************************************************
 * server.js - Construction Worker Management System
 * Complete Single-File Production-Ready Application for Render & PostgreSQL
 ******************************************************************************/

const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

// PostgreSQL Connection Pool using Render's environment variable
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Middleware Setup
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Session Configuration using PostgreSQL session store
app.use(session({
  store: new pgSession({
    pool: pool,
    tableName: 'session',
    createTableIfMissing: true
  }),
  secret: process.env.SESSION_SECRET || 'construction_system_secret_key_2026',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 } // 30 days
}));

// -----------------------------------------------------------------------------
// DATABASE AUTOMATIC INITIALIZATION
// -----------------------------------------------------------------------------
async function initializeDatabase() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Users table (Admin, Worker, Scanner)
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        full_name VARCHAR(255) NOT NULL,
        username VARCHAR(100) UNIQUE NOT NULL,
        email VARCHAR(255) UNIQUE,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(50) NOT NULL,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Workers profile table linked optionally to user accounts
    await client.query(`
      CREATE TABLE IF NOT EXISTS workers (
        id SERIAL PRIMARY KEY,
        worker_id VARCHAR(50) UNIQUE NOT NULL,
        full_name VARCHAR(255) NOT NULL,
        position VARCHAR(100) NOT NULL,
        contact_number VARCHAR(50),
        daily_rate NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
        assigned_project VARCHAR(255),
        profile_picture TEXT,
        user_id INT REFERENCES users(id) ON DELETE SET NULL,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // QR Codes table
    await client.query(`
      CREATE TABLE IF NOT EXISTS qr_codes (
        id SERIAL PRIMARY KEY,
        worker_id VARCHAR(50) REFERENCES workers(worker_id) ON DELETE CASCADE,
        qr_data TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Attendance logs table (supports multiple IN/OUT per day)
    await client.query(`
      CREATE TABLE IF NOT EXISTS attendance_logs (
        id SERIAL PRIMARY KEY,
        worker_id VARCHAR(50) REFERENCES workers(worker_id) ON DELETE CASCADE,
        date DATE NOT NULL,
        time TIME NOT NULL,
        attendance_type VARCHAR(10) NOT NULL, -- 'IN' or 'OUT'
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Advance Money table
    await client.query(`
      CREATE TABLE IF NOT EXISTS advance_money (
        id SERIAL PRIMARY KEY,
        worker_id VARCHAR(50) REFERENCES workers(worker_id) ON DELETE CASCADE,
        amount NUMERIC(10, 2) NOT NULL,
        date DATE NOT NULL,
        reason TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Company Settings table
    await client.query(`
      CREATE TABLE IF NOT EXISTS company_settings (
        id SERIAL PRIMARY KEY,
        company_name VARCHAR(255) NOT NULL DEFAULT 'BuildCorp Management',
        company_logo TEXT,
        company_address TEXT,
        contact_number VARCHAR(50)
      );
    `);

    // Work Schedules table
    await client.query(`
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

    // Announcements table
    await client.query(`
      CREATE TABLE IF NOT EXISTS announcements (
        id SERIAL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        content TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Insert default company settings if none exist
    const settingsCheck = await client.query('SELECT COUNT(*) FROM company_settings');
    if (parseInt(settingsCheck.rows[0].count) === 0) {
      await client.query(`
        INSERT INTO company_settings (company_name, company_address, contact_number, company_logo)
        VALUES ('PrimeBuild Construction Inc.', '123 Builder St, Metro Manila', '+63 912 345 6789', '')
      `);
    }

    // Insert default work schedule if none exist
    const scheduleCheck = await client.query('SELECT COUNT(*) FROM work_schedules');
    if (parseInt(scheduleCheck.rows[0].count) === 0) {
      await client.query(`
        INSERT INTO work_schedules (morning_start, morning_end, afternoon_start, afternoon_end, full_day_hours, half_day_hours)
        VALUES ('07:00:00', '12:00:00', '13:00:00', '17:00:00', 8.00, 4.00)
      `);
    }

    await client.query('COMMIT');
    console.log('Database tables successfully verified and initialized.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Database initialization error:', err);
  } finally {
    client.release();
  }
}

// Helper to fetch global company settings
async function getCompanySettings() {
  try {
    const res = await pool.query('SELECT * FROM company_settings LIMIT 1');
    return res.rows[0] || { company_name: 'BuildCorp Management', company_logo: '', company_address: '', contact_number: '' };
  } catch (e) {
    return { company_name: 'BuildCorp Management', company_logo: '', company_address: '', contact_number: '' };
  }
}

// Middleware: Authentication & Roles
function requireAuth(role) {
  return async (req, res, next) => {
    if (!req.session || !req.session.user) {
      if (role === 'ADMIN') return res.redirect('/admin');
      if (role === 'WORKER') return res.redirect('/worker');
      if (role === 'SCANNER') return res.redirect('/scanner');
      return res.redirect('/');
    }
    if (role && req.session.user.role !== role) {
      return res.status(403).send(renderLayout('Access Denied', `
        <div style="max-width: 500px; margin: 80px auto; background: white; padding: 30px; border-radius: 8px; text-align: center; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">
          <h2 style="color: #e74c3c;">Access Denied</h2>
          <p>You do not have permission to access this portal.</p>
          <a href="/" class="btn" style="margin-top: 20px; display: inline-block;">Return to Home</a>
        </div>
      `));
    }
    next();
  };
}

// Shared HTML Layout Engine
async function renderLayout(title, content, activeNav = '') {
  const company = await getCompanySettings();
  const logoHtml = company.company_logo 
    ? `<img src="${company.company_logo}" alt="Logo" style="height: 40px; vertical-align: middle; margin-right: 10px; border-radius: 4px;">` 
    : `<span style="font-size: 24px; margin-right: 10px;">🏗️</span>`;

  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${title} - ${company.company_name}</title>
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; }
        body { background-color: #f4f7f6; color: #333; display: flex; flex-direction: column; min-height: 100vh; }
        header { background: #2c3e50; color: white; padding: 15px 30px; display: flex; justify-content: space-between; align-items: center; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .brand { display: flex; align-items: center; font-size: 20px; font-weight: bold; color: white; text-decoration: none; }
        .container { display: flex; flex: 1; }
        sidebar { width: 260px; background: #34495e; color: white; display: flex; flex-direction: column; padding-top: 20px; }
        sidebar a { padding: 12px 25px; color: #ecf0f1; text-decoration: none; display: block; transition: 0.2s; border-left: 4px solid transparent; }
        sidebar a:hover, sidebar a.active { background: #2c3e50; border-left-color: #3498db; color: white; }
        main { flex: 1; padding: 30px; overflow-y: auto; }
        .card { background: white; border-radius: 8px; padding: 25px; box-shadow: 0 2px 8px rgba(0,0,0,0.05); margin-bottom: 20px; }
        .grid-4 { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 20px; margin-bottom: 25px; }
        .stat-card { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 5px rgba(0,0,0,0.05); border-left: 5px solid #3498db; }
        .stat-card h3 { font-size: 14px; color: #7f8c8d; text-transform: uppercase; margin-bottom: 8px; }
        .stat-card .value { font-size: 28px; font-weight: bold; color: #2c3e50; }
        table { width: 100%; border-collapse: collapse; margin-top: 15px; background: white; border-radius: 6px; overflow: hidden; }
        th, td { padding: 12px 15px; text-align: left; border-bottom: 1px solid #ecf0f1; font-size: 14px; }
        th { background: #f8f9fa; color: #2c3e50; font-weight: 600; }
        tr:hover { background: #f9fbfb; }
        .btn { background: #3498db; color: white; padding: 10px 20px; border: none; border-radius: 4px; cursor: pointer; text-decoration: none; font-size: 14px; display: inline-block; font-weight: 600; transition: 0.2s; }
        .btn:hover { background: #2980b9; }
        .btn-success { background: #2ecc71; } .btn-success:hover { background: #27ae60; }
        .btn-danger { background: #e74c3c; } .btn-danger:hover { background: #c0392b; }
        .btn-warning { background: #f39c12; } .btn-warning:hover { background: #d35400; }
        input, select, textarea { width: 100%; padding: 10px 12px; margin-top: 6px; margin-bottom: 15px; border: 1px solid #bdc3c7; border-radius: 4px; font-size: 14px; }
        label { font-weight: 600; font-size: 13px; color: #34495e; display: block; margin-top: 10px; }
        .alert { padding: 12px 15px; border-radius: 4px; margin-bottom: 20px; font-size: 14px; }
        .alert-success { background: #d4edda; color: #155724; border: 1px solid #c3e6cb; }
        .alert-error { background: #f8d7da; color: #721c24; border: 1px solid #f5c6cb; }
        .badge { padding: 4px 10px; border-radius: 12px; font-size: 11px; font-weight: bold; text-transform: uppercase; display: inline-block; }
        .badge-success { background: #e8f8f5; color: #1abc9c; }
        .badge-warning { background: #fef5e7; color: #f39c12; }
        .badge-danger { background: #fdedec; color: #e74c3c; }
      </style>
    </head>
    <body>
      <header>
        <a href="/" class="brand">${logoHtml} ${company.company_name}</a>
        <div>
          ${global.currentUser ? `<span style="margin-right: 15px; font-size: 14px;">👤 ${global.currentUser.full_name} (${global.currentUser.role})</span>` : ''}
        </div>
      </header>
      ${content}
    </body>
    </html>
  `;
}

// -----------------------------------------------------------------------------
// ROUTES: MAIN LANDING & SETUP
// -----------------------------------------------------------------------------
app.get('/', async (req, res) => {
  const company = await getCompanySettings();
  const adminCheck = await pool.query("SELECT COUNT(*) FROM users WHERE role = 'ADMIN'");
  const adminExists = parseInt(adminCheck.rows[0].count) > 0;

  const html = `
    <div style="flex: 1; display: flex; justify-content: center; align-items: center; background: linear-gradient(135deg, #2c3e50, #34495e); padding: 20px;">
      <div style="background: white; padding: 40px; border-radius: 10px; box-shadow: 0 10px 25px rgba(0,0,0,0.2); width: 100%; max-width: 450px; text-align: center;">
        ${company.company_logo ? `<img src="${company.company_logo}" alt="Logo" style="max-height: 80px; margin-bottom: 15px; border-radius: 6px;">` : '<div style="font-size: 50px; margin-bottom: 15px;">🏗️</div>'}
        <h1 style="color: #2c3e50; margin-bottom: 5px; font-size: 24px;">${company.company_name}</h1>
        <p style="color: #7f8c8d; margin-bottom: 30px; font-size: 14px;">Construction Worker Management System</p>
        
        ${!adminExists ? `
          <div class="alert" style="background: #eef2f7; color: #2c3e50; border: 1px solid #cbd5e1; margin-bottom: 25px;">
            System is not initialized. Please set up the first Admin account.
          </div>
          <a href="/setup" class="btn" style="width: 100%; padding: 14px; font-size: 16px;">[ SET UP SYSTEM ]</a>
        ` : `
          <div style="display: flex; flex-direction: column; gap: 15px;">
            <a href="/admin" class="btn" style="padding: 14px; font-size: 16px;">[ ADMIN PORTAL ]</a>
            <a href="/worker" class="btn btn-success" style="padding: 14px; font-size: 16px;">[ WORKER PORTAL ]</a>
            <a href="/scanner" class="btn btn-warning" style="padding: 14px; font-size: 16px; color: white;">[ ATTENDANCE SCANNER ]</a>
          </div>
        `}
      </div>
    </div>
  `;
  res.send(await renderLayout('Welcome', html));
});

// FIRST-TIME ADMIN SETUP
app.get('/setup', async (req, res) => {
  const adminCheck = await pool.query("SELECT COUNT(*) FROM users WHERE role = 'ADMIN'");
  if (parseInt(adminCheck.rows[0].count) > 0) {
    return res.redirect('/admin');
  }

  const html = `
    <div style="flex: 1; display: flex; justify-content: center; align-items: center; background: #f4f7f6; padding: 20px;">
      <div style="background: white; padding: 35px; border-radius: 8px; box-shadow: 0 4px 15px rgba(0,0,0,0.1); width: 100%; max-width: 450px;">
        <h2 style="margin-bottom: 10px; color: #2c3e50;">First-Time Admin Setup</h2>
        <p style="color: #7f8c8d; margin-bottom: 20px; font-size: 13px;">Create your primary administrator account.</p>
        <form action="/setup" method="POST">
          <label>Full Name</label>
          <input type="text" name="full_name" required placeholder="e.g. John Builder">
          
          <label>Username</label>
          <input type="text" name="username" required placeholder="admin">
          
          <label>Email Address</label>
          <input type="email" name="email" required placeholder="admin@builder.com">
          
          <label>Password</label>
          <input type="text" name="password" required placeholder="Enter password">
          
          <button type="submit" class="btn" style="width: 100%; margin-top: 15px; padding: 12px;">Create Admin & Continue</button>
        </form>
      </div>
    </div>
  `;
  res.send(await renderLayout('System Setup', html));
});

app.post('/setup', async (req, res) => {
  const adminCheck = await pool.query("SELECT COUNT(*) FROM users WHERE role = 'ADMIN'");
  if (parseInt(adminCheck.rows[0].count) > 0) {
    return res.redirect('/admin');
  }

  const { full_name, username, email, password } = req.body;
  if (!full_name || !username || !email || !password) {
    return res.send(await renderLayout('Setup Error', `<div class="container"><main><div class="card"><div class="alert alert-error">All fields are required.</div><a href="/setup" class="btn">Back</a></div></main></div>`));
  }

  try {
    const result = await pool.query(
      `INSERT INTO users (full_name, username, email, password, role) VALUES ($1, $2, $3, $4, 'ADMIN') RETURNING *`,
      [full_name, username, email, password]
    );
    req.session.user = result.rows[0];
    res.redirect('/admin/settings?setup=true');
  } catch (err) {
    res.send(await renderLayout('Setup Error', `<div class="container"><main><div class="card"><div class="alert alert-error">Error: Username or Email already exists.</div><a href="/setup" class="btn">Back</a></div></main></div>`));
  }
});

// -----------------------------------------------------------------------------
// LOGIN PORTALS (ADMIN, WORKER, SCANNER)
// -----------------------------------------------------------------------------
async function handleLogin(req, res, roleType, redirectPath, loginUrl) {
  const { username, password } = req.body;
  try {
    const userRes = await pool.query(
      `SELECT * FROM users WHERE username = $1 AND role = $2 AND is_active = TRUE`,
      [username, roleType]
    );
    if (userRes.rows.length === 0 || userRes.rows[0].password !== password) {
      return res.send(await renderLayout(`${roleType} Login`, `
        <div style="flex: 1; display: flex; justify-content: center; align-items: center; padding: 20px;">
          <div class="card" style="width: 100%; max-width: 400px; text-align: center;">
            <h2>${roleType} Portal Login</h2>
            <div class="alert alert-error" style="margin-top: 15px;">Invalid credentials or inactive account.</div>
            <form action="${loginUrl}" method="POST" style="text-align: left; margin-top: 15px;">
              <label>Username</label>
              <input type="text" name="username" required>
              <label>Password</label>
              <input type="password" name="password" required>
              <button type="submit" class="btn" style="width: 100%; margin-top: 10px;">Login</button>
            </form>
            <a href="/" style="display: block; margin-top: 15px; color: #3498db; text-decoration: none; font-size: 13px;">← Back to Home</a>
          </div>
        </div>
      `));
    }
    req.session.user = userRes.rows[0];
    res.redirect(redirectPath);
  } catch (err) {
    res.status(500).send("Server error during login.");
  }
}

// ADMIN LOGIN
app.get('/admin', async (req, res) => {
  if (req.session && req.session.user && req.session.user.role === 'ADMIN') {
    return res.redirect('/admin/dashboard');
  }
  res.send(await renderLayout('Admin Login', `
    <div style="flex: 1; display: flex; justify-content: center; align-items: center; padding: 20px;">
      <div class="card" style="width: 100%; max-width: 400px; text-align: center;">
        <h2>Admin Portal Login</h2>
        <form action="/admin" method="POST" style="text-align: left; margin-top: 20px;">
          <label>Username</label>
          <input type="text" name="username" required>
          <label>Password</label>
          <input type="password" name="password" required>
          <button type="submit" class="btn" style="width: 100%; margin-top: 15px; padding: 12px;">Login to Admin</button>
        </form>
        <a href="/" style="display: block; margin-top: 15px; color: #3498db; text-decoration: none; font-size: 13px;">← Back to Home</a>
      </div>
    </div>
  `));
});
app.post('/admin', (req, res) => handleLogin(req, res, 'ADMIN', '/admin/dashboard', '/admin'));

// WORKER LOGIN
app.get('/worker', async (req, res) => {
  if (req.session && req.session.user && req.session.user.role === 'WORKER') {
    return res.redirect('/worker/dashboard');
  }
  res.send(await renderLayout('Worker Login', `
    <div style="flex: 1; display: flex; justify-content: center; align-items: center; padding: 20px;">
      <div class="card" style="width: 100%; max-width: 400px; text-align: center;">
        <h2>Worker Portal Login</h2>
        <form action="/worker" method="POST" style="text-align: left; margin-top: 20px;">
          <label>Username</label>
          <input type="text" name="username" required>
          <label>Password</label>
          <input type="password" name="password" required>
          <button type="submit" class="btn btn-success" style="width: 100%; margin-top: 15px; padding: 12px;">Login to Worker Portal</button>
        </form>
        <a href="/" style="display: block; margin-top: 15px; color: #3498db; text-decoration: none; font-size: 13px;">← Back to Home</a>
      </div>
    </div>
  `));
});
app.post('/worker', (req, res) => handleLogin(req, res, 'WORKER', '/worker/dashboard', '/worker'));

// SCANNER LOGIN
app.get('/scanner', async (req, res) => {
  if (req.session && req.session.user && req.session.user.role === 'SCANNER') {
    return res.redirect('/scanner/dashboard');
  }
  res.send(await renderLayout('Scanner Login', `
    <div style="flex: 1; display: flex; justify-content: center; align-items: center; padding: 20px;">
      <div class="card" style="width: 100%; max-width: 400px; text-align: center;">
        <h2>Attendance Scanner Login</h2>
        <form action="/scanner" method="POST" style="text-align: left; margin-top: 20px;">
          <label>Username</label>
          <input type="text" name="username" required>
          <label>Password</label>
          <input type="password" name="password" required>
          <button type="submit" class="btn btn-warning" style="width: 100%; margin-top: 15px; padding: 12px; color: white;">Login to Scanner</button>
        </form>
        <a href="/" style="display: block; margin-top: 15px; color: #3498db; text-decoration: none; font-size: 13px;">← Back to Home</a>
      </div>
    </div>
  `));
});
app.post('/scanner', (req, res) => handleLogin(req, res, 'SCANNER', '/scanner/dashboard', '/scanner'));

// LOGOUT ROUTE
app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/');
  });
});

// -----------------------------------------------------------------------------
// ADMIN PORTAL
// -----------------------------------------------------------------------------
function adminSidebar(active) {
  const items = [
    { name: 'Dashboard', href: '/admin/dashboard' },
    { name: 'Workers', href: '/admin/workers' },
    { name: 'Attendance', href: '/admin/attendance' },
    { name: 'Advance Money', href: '/admin/advance' },
    { name: 'Salary', href: '/admin/salary' },
    { name: 'Announcements', href: '/admin/announcements' },
    { name: 'Company Settings', href: '/admin/settings' },
    { name: 'Work Schedule', href: '/admin/schedule' },
    { name: 'Logout', href: '/logout' }
  ];
  return `<sidebar>` + items.map(i => `<a href="${i.href}" class="${active === i.name ? 'active' : ''}">${i.name}</a>`).join('') + `</sidebar>`;
}

// Admin Dashboard
app.get('/admin/dashboard', requireAuth('ADMIN'), async (req, res) => {
  global.currentUser = req.session.user;
  const today = new Date().toISOString().split('T')[0];

  const workersCount = await pool.query('SELECT COUNT(*) FROM workers WHERE is_active = TRUE');
  const totalWorkers = parseInt(workersCount.rows[0].count);

  const todayAtt = await pool.query('SELECT DISTINCT worker_id, attendance_type FROM attendance_logs WHERE date = $1', [today]);
  
  const recentLogs = await pool.query(`
    SELECT a.*, w.full_name, w.position 
    FROM attendance_logs a 
    JOIN workers w ON a.worker_id = w.worker_id 
    WHERE a.date = $1 
    ORDER BY a.time DESC LIMIT 10
  `, [today]);

  const content = `
    <div class="container">
      ${adminSidebar('Dashboard')}
      <main>
        <h2 style="margin-bottom: 20px;">Admin Dashboard</h2>
        <div class="grid-4">
          <div class="stat-card">
            <h3>Total Workers</h3>
            <div class="value">${totalWorkers}</div>
          </div>
          <div class="stat-card" style="border-left-color: #2ecc71;">
            <h3>Attendance Logs Today</h3>
            <div class="value">${todayAtt.rows.length}</div>
          </div>
        </div>

        <div class="card">
          <h3 style="margin-bottom: 15px;">Recent Attendance Today (${today})</h3>
          <table>
            <thead>
              <tr>
                <th>Worker ID</th>
                <th>Full Name</th>
                <th>Position</th>
                <th>Type</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              ${recentLogs.rows.length === 0 ? '<tr><td colspan="5" style="text-align: center; color: #7f8c8d;">No attendance records for today yet.</td></tr>' : 
                recentLogs.rows.map(r => `
                  <tr>
                    <td>${r.worker_id}</td>
                    <td>${r.full_name}</td>
                    <td>${r.position}</td>
                    <td><span class="badge ${r.attendance_type === 'IN' ? 'badge-success' : 'badge-danger'}">${r.attendance_type}</span></td>
                    <td>${r.time}</td>
                  </tr>
                `).join('')
              }
            </tbody>
          </table>
        </div>
      </main>
    </div>
  `;
  res.send(await renderLayout('Admin Dashboard', content));
});

// Worker Management
app.get('/admin/workers', requireAuth('ADMIN'), async (req, res) => {
  global.currentUser = req.session.user;
  const workers = await pool.query('SELECT * FROM workers ORDER BY id DESC');
  
  const content = `
    <div class="container">
      ${adminSidebar('Workers')}
      <main>
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
          <h2>Worker Management</h2>
          <a href="/admin/workers/new" class="btn">+ Register Worker</a>
        </div>
        <div class="card">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Name</th>
                <th>Position</th>
                <th>Project</th>
                <th>Daily Rate</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${workers.rows.map(w => `
                <tr>
                  <td>${w.worker_id}</td>
                  <td>${w.full_name}</td>
                  <td>${w.position}</td>
                  <td>${w.assigned_project || 'N/A'}</td>
                  <td>₱${parseFloat(w.daily_rate).toFixed(2)}</td>
                  <td><span class="badge ${w.is_active ? 'badge-success' : 'badge-danger'}">${w.is_active ? 'Active' : 'Inactive'}</span></td>
                  <td>
                    <a href="/admin/workers/qr/${w.worker_id}" class="btn" style="padding: 5px 10px; font-size: 12px;">QR Code</a>
                    <a href="/admin/workers/edit/${w.id}" class="btn btn-warning" style="padding: 5px 10px; font-size: 12px; color: white;">Edit</a>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  `;
  res.send(await renderLayout('Worker Management', content));
});

app.get('/admin/workers/new', requireAuth('ADMIN'), async (req, res) => {
  global.currentUser = req.session.user;
  const content = `
    <div class="container">
      ${adminSidebar('Workers')}
      <main>
        <div class="card" style="max-width: 600px; margin: 0 auto;">
          <h2>Register New Worker</h2>
          <form action="/admin/workers/new" method="POST">
            <label>Full Name</label>
            <input type="text" name="full_name" required>
            <label>Position</label>
            <input type="text" name="position" required placeholder="e.g. Mason, Electrician">
            <label>Contact Number</label>
            <input type="text" name="contact_number">
            <label>Daily Rate (₱)</label>
            <input type="number" step="0.01" name="daily_rate" required value="700.00">
            <label>Assigned Project</label>
            <input type="text" name="assigned_project">
            <label>Portal Username</label>
            <input type="text" name="username" required>
            <label>Portal Password</label>
            <input type="text" name="password" required>
            <button type="submit" class="btn" style="width: 100%; margin-top: 15px;">Register Worker & Generate QR</button>
          </form>
        </div>
      </main>
    </div>
  `;
  res.send(await renderLayout('Register Worker', content));
});

app.post('/admin/workers/new', requireAuth('ADMIN'), async (req, res) => {
  const { full_name, position, contact_number, daily_rate, assigned_project, username, password } = req.body;
  try {
    const userRes = await pool.query(
      `INSERT INTO users (full_name, username, password, role) VALUES ($1, $2, $3, 'WORKER') RETURNING id`,
      [full_name, username, password]
    );
    const userId = userRes.rows[0].id;

    const countRes = await pool.query('SELECT COUNT(*) FROM workers');
    const workerId = `W-${String(parseInt(countRes.rows[0].count) + 1).padStart(3, '0')}`;

    await pool.query(
      `INSERT INTO workers (worker_id, full_name, position, contact_number, daily_rate, assigned_project, user_id) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [workerId, full_name, position, contact_number, daily_rate, assigned_project, userId]
    );

    await pool.query(
      `INSERT INTO qr_codes (worker_id, qr_data) VALUES ($1, $2)`,
      [workerId, `WORKER_QR_${workerId}_${full_name.replace(/\s+/g, '_')}`]
    );

    res.redirect('/admin/workers');
  } catch (err) {
    res.send(await renderLayout('Error', `<div class="container"><main><div class="card"><div class="alert alert-error">Error registering worker: Username may already exist.</div><a href="/admin/workers/new" class="btn">Back</a></div></main></div>`));
  }
});

app.get('/admin/workers/qr/:id', requireAuth('ADMIN'), async (req, res) => {
  global.currentUser = req.session.user;
  const workerId = req.params.id;
  const qrRes = await pool.query('SELECT * FROM qr_codes WHERE worker_id = $1', [workerId]);
  const workerRes = await pool.query('SELECT * FROM workers WHERE worker_id = $1', [workerId]);

  if (qrRes.rows.length === 0 || workerRes.rows.length === 0) return res.send('Worker/QR not found');
  const worker = workerRes.rows[0];
  const qr = qrRes.rows[0];

  const content = `
    <div class="container">
      ${adminSidebar('Workers')}
      <main>
        <div class="card" style="max-width: 450px; margin: 0 auto; text-align: center;">
          <h2>Worker QR Code</h2>
          <p style="margin: 10px 0; font-size: 16px; font-weight: bold;">${worker.full_name} (${worker.worker_id})</p>
          <p style="color: #7f8c8d; margin-bottom: 20px;">Position: ${worker.position}</p>
          <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; border: 2px dashed #cbd5e1; display: inline-block; margin-bottom: 20px;">
            <div style="font-size: 22px; font-family: monospace; font-weight: bold; color: #2c3e50; word-break: break-all;">${qr.qr_data}</div>
          </div>
          <div>
            <button onclick="window.print();" class="btn">Print / Save QR Code</button>
            <a href="/admin/workers" class="btn btn-warning" style="margin-left: 10px; color: white;">Back to Workers</a>
          </div>
        </div>
      </main>
    </div>
  `;
  res.send(await renderLayout('Worker QR', content));
});

// Admin Attendance Management
app.get('/admin/attendance', requireAuth('ADMIN'), async (req, res) => {
  global.currentUser = req.session.user;
  const logs = await pool.query(`
    SELECT a.*, w.full_name, w.position 
    FROM attendance_logs a 
    JOIN workers w ON a.worker_id = w.worker_id 
    ORDER BY a.date DESC, a.time DESC LIMIT 50
  `);

  const content = `
    <div class="container">
      ${adminSidebar('Attendance')}
      <main>
        <h2>Attendance Records</h2>
        <div class="card">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Worker ID</th>
                <th>Name</th>
                <th>Position</th>
                <th>Type</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              ${logs.rows.length === 0 ? '<tr><td colspan="6" style="text-align: center;">No attendance logs found.</td></tr>' :
                logs.rows.map(l => `
                  <tr>
                    <td>${l.date.toISOString().split('T')[0]}</td>
                    <td>${l.worker_id}</td>
                    <td>${l.full_name}</td>
                    <td>${l.position}</td>
                    <td><span class="badge ${l.attendance_type === 'IN' ? 'badge-success' : 'badge-danger'}">${l.attendance_type}</span></td>
                    <td>${l.time}</td>
                  </tr>
                `).join('')
              }
            </tbody>
          </table>
        </div>
      </main>
    </div>
  `;
  res.send(await renderLayout('Attendance Management', content));
});

// Advance Money Management
app.get('/admin/advance', requireAuth('ADMIN'), async (req, res) => {
  global.currentUser = req.session.user;
  const workers = await pool.query('SELECT worker_id, full_name FROM workers WHERE is_active = TRUE');
  const advances = await pool.query(`
    SELECT am.*, w.full_name 
    FROM advance_money am 
    JOIN workers w ON am.worker_id = w.worker_id 
    ORDER BY am.date DESC
  `);

  const content = `
    <div class="container">
      ${adminSidebar('Advance Money')}
      <main>
        <h2>Advance Money Management</h2>
        <div class="card" style="margin-top: 20px;">
          <h3>Record New Advance Money</h3>
          <form action="/admin/advance" method="POST" style="margin-top: 15px;">
            <label>Select Worker</label>
            <select name="worker_id" required>
              ${workers.rows.map(w => `<option value="${w.worker_id}">${w.full_name} (${w.worker_id})</option>`).join('')}
            </select>
            <label>Amount (₱)</label>
            <input type="number" step="0.01" name="amount" required>
            <label>Date</label>
            <input type="date" name="date" required value="${new Date().toISOString().split('T')[0]}">
            <label>Reason / Notes</label>
            <textarea name="reason" rows="2"></textarea>
            <button type="submit" class="btn" style="margin-top: 10px;">Save Advance Record</button>
          </form>
        </div>

        <div class="card">
          <h3>Advance History</h3>
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Worker</th>
                <th>Amount</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              ${advances.rows.map(a => `
                <tr>
                  <td>${a.date.toISOString().split('T')[0]}</td>
                  <td>${a.full_name}</td>
                  <td>₱${parseFloat(a.amount).toFixed(2)}</td>
                  <td>${a.reason || 'N/A'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  `;
  res.send(await renderLayout('Advance Money', content));
});

app.post('/admin/advance', requireAuth('ADMIN'), async (req, res) => {
  const { worker_id, amount, date, reason } = req.body;
  await pool.query('INSERT INTO advance_money (worker_id, amount, date, reason) VALUES ($1, $2, $3, $4)', [worker_id, amount, date, reason]);
  res.redirect('/admin/advance');
});

// Salary Management
app.get('/admin/salary', requireAuth('ADMIN'), async (req, res) => {
  global.currentUser = req.session.user;
  const workers = await pool.query('SELECT * FROM workers WHERE is_active = TRUE');
  
  const salaryData = [];
  for (let w of workers.rows) {
    const advRes = await pool.query('SELECT SUM(amount) as total FROM advance_money WHERE worker_id = $1', [w.worker_id]);
    const totalAdvance = parseFloat(advRes.rows[0].total || 0);

    const attCount = await pool.query('SELECT COUNT(*) FROM attendance_logs WHERE worker_id = $1 AND attendance_type = $2', [w.worker_id, 'IN']);
    const equivalentDays = parseInt(attCount.rows[0].count) || 0; 
    const totalSalary = equivalentDays * parseFloat(w.daily_rate);
    const netSalary = totalSalary - totalAdvance;

    salaryData.push({
      ...w,
      equivalentDays,
      totalSalary,
      totalAdvance,
      netSalary
    });
  }

  const content = `
    <div class="container">
      ${adminSidebar('Salary')}
      <main>
        <h2>Salary & Payroll Calculation</h2>
        <div class="card">
          <table>
            <thead>
              <tr>
                <th>Worker ID</th>
                <th>Name</th>
                <th>Daily Rate</th>
                <th>Days Worked</th>
                <th>Total Salary</th>
                <th>Advance Deduction</th>
                <th>Net Salary</th>
              </tr>
            </thead>
            <tbody>
              ${salaryData.map(s => `
                <tr>
                  <td>${s.worker_id}</td>
                  <td>${s.full_name}</td>
                  <td>₱${parseFloat(s.daily_rate).toFixed(2)}</td>
                  <td>${s.equivalentDays} Days</td>
                  <td>₱${s.totalSalary.toFixed(2)}</td>
                  <td style="color: #e74c3c;">-₱${s.totalAdvance.toFixed(2)}</td>
                  <td style="font-weight: bold; color: #27ae60;">₱${s.netSalary.toFixed(2)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  `;
  res.send(await renderLayout('Salary Management', content));
});

// Announcements
app.get('/admin/announcements', requireAuth('ADMIN'), async (req, res) => {
  global.currentUser = req.session.user;
  const ann = await pool.query('SELECT * FROM announcements ORDER BY id DESC');

  const content = `
    <div class="container">
      ${adminSidebar('Announcements')}
      <main>
        <h2>Announcements</h2>
        <div class="card">
          <h3>Post New Announcement</h3>
          <form action="/admin/announcements" method="POST" style="margin-top: 15px;">
            <label>Title</label>
            <input type="text" name="title" required>
            <label>Content</label>
            <textarea name="content" rows="3" required></textarea>
            <button type="submit" class="btn" style="margin-top: 10px;">Publish Announcement</button>
          </form>
        </div>
        <div class="card">
          <h3>Active Announcements</h3>
          ${ann.rows.map(a => `
            <div style="border-bottom: 1px solid #ecf0f1; padding: 15px 0;">
              <h4>${a.title}</h4>
              <p style="margin-top: 5px; color: #555;">${a.content}</p>
              <small style="color: #95a5a6;">Posted on: ${a.created_at.toISOString().split('T')[0]}</small>
            </div>
          `).join('')}
        </div>
      </main>
    </div>
  `;
  res.send(await renderLayout('Announcements', content));
});

app.post('/admin/announcements', requireAuth('ADMIN'), async (req, res) => {
  const { title, content } = req.body;
  await pool.query('INSERT INTO announcements (title, content) VALUES ($1, $2)', [title, content]);
  res.redirect('/admin/announcements');
});

// Company Settings
app.get('/admin/settings', requireAuth('ADMIN'), async (req, res) => {
  global.currentUser = req.session.user;
  const company = await getCompanySettings();

  const content = `
    <div class="container">
      ${adminSidebar('Company Settings')}
      <main>
        <h2>Company Customization Settings</h2>
        <div class="card" style="max-width: 600px;">
          <form action="/admin/settings" method="POST">
            <label>Company / Builder Name</label>
            <input type="text" name="company_name" value="${company.company_name}" required>
            
            <label>Company Logo URL (Render-compatible image URL)</label>
            <input type="text" name="company_logo" value="${company.company_logo || ''}" placeholder="https://example.com/logo.png">
            
            <label>Company Address</label>
            <textarea name="company_address" rows="2">${company.company_address || ''}</textarea>
            
            <label>Contact Number</label>
            <input type="text" name="contact_number" value="${company.contact_number || ''}">
            
            <button type="submit" class="btn" style="margin-top: 15px;">Save Company Settings</button>
          </form>
        </div>
      </main>
    </div>
  `;
  res.send(await renderLayout('Company Settings', content));
});

app.post('/admin/settings', requireAuth('ADMIN'), async (req, res) => {
  const { company_name, company_logo, company_address, contact_number } = req.body;
  await pool.query('DELETE FROM company_settings');
  await pool.query(
    'INSERT INTO company_settings (company_name, company_logo, company_address, contact_number) VALUES ($1, $2, $3, $4)',
    [company_name, company_logo, company_address, contact_number]
  );
  res.redirect('/admin/settings');
});

// Work Schedule Settings
app.get('/admin/schedule', requireAuth('ADMIN'), async (req, res) => {
  global.currentUser = req.session.user;
  const schedRes = await pool.query('SELECT * FROM work_schedules LIMIT 1');
  const sched = schedRes.rows[0];

  const content = `
    <div class="container">
      ${adminSidebar('Work Schedule')}
      <main>
        <h2>Work Schedule Settings</h2>
        <div class="card" style="max-width: 500px;">
          <form action="/admin/schedule" method="POST">
            <label>Morning Start Time</label>
            <input type="time" name="morning_start" value="${sched.morning_start}" required>
            <label>Morning End Time</label>
            <input type="time" name="morning_end" value="${sched.morning_end}" required>
            <label>Afternoon Start Time</label>
            <input type="time" name="afternoon_start" value="${sched.afternoon_start}" required>
            <label>Afternoon End Time</label>
            <input type="time" name="afternoon_end" value="${sched.afternoon_end}" required>
            <button type="submit" class="btn" style="margin-top: 15px;">Update Schedule</button>
          </form>
        </div>
      </main>
    </div>
  `;
  res.send(await renderLayout('Work Schedule', content));
});

app.post('/admin/schedule', requireAuth('ADMIN'), async (req, res) => {
  const { morning_start, morning_end, afternoon_start, afternoon_end } = req.body;
  await pool.query('DELETE FROM work_schedules');
  await pool.query(
    'INSERT INTO work_schedules (morning_start, morning_end, afternoon_start, afternoon_end) VALUES ($1, $2, $3, $4)',
    [morning_start, morning_end, afternoon_start, afternoon_end]
  );
  res.redirect('/admin/schedule');
});

// -----------------------------------------------------------------------------
// WORKER PORTAL
// -----------------------------------------------------------------------------
function workerSidebar(active) {
  const items = [
    { name: 'Home', href: '/worker/dashboard' },
    { name: 'My QR Code', href: '/worker/qr' },
    { name: 'My Attendance', href: '/worker/attendance' },
    { name: 'My Advance', href: '/worker/advance' },
    { name: 'My Salary', href: '/worker/salary' },
    { name: 'Announcements', href: '/worker/announcements' },
    { name: 'Logout', href: '/logout' }
  ];
  return `<sidebar>` + items.map(i => `<a href="${i.href}" class="${active === i.name ? 'active' : ''}">${i.name}</a>`).join('') + `</sidebar>`;
}

app.get('/worker/dashboard', requireAuth('WORKER'), async (req, res) => {
  global.currentUser = req.session.user;
  const workerRes = await pool.query('SELECT * FROM workers WHERE user_id = $1', [req.session.user.id]);
  const worker = workerRes.rows[0];

  const content = `
    <div class="container">
      ${workerSidebar('Home')}
      <main>
        <h2>Worker Dashboard</h2>
        <div class="card" style="display: flex; gap: 20px; align-items: center;">
          <div>
            <h3>${worker.full_name}</h3>
            <p style="color: #7f8c8d; margin-top: 5px;">Worker ID: <b>${worker.worker_id}</b></p>
            <p style="color: #7f8c8d;">Position: <b>${worker.position}</b></p>
            <p style="color: #7f8c8d;">Assigned Project: <b>${worker.assigned_project || 'None'}</b></p>
          </div>
        </div>
      </main>
    </div>
  `;
  res.send(await renderLayout('Worker Dashboard', content));
});

app.get('/worker/qr', requireAuth('WORKER'), async (req, res) => {
  global.currentUser = req.session.user;
  const workerRes = await pool.query('SELECT * FROM workers WHERE user_id = $1', [req.session.user.id]);
  const worker = workerRes.rows[0];
  const qrRes = await pool.query('SELECT * FROM qr_codes WHERE worker_id = $1', [worker.worker_id]);
  const qr = qrRes.rows[0];

  const content = `
    <div class="container">
      ${workerSidebar('My QR Code')}
      <main>
        <div class="card" style="max-width: 450px; text-align: center; margin: 0 auto;">
          <h2>My QR Code</h2>
          <p style="margin: 10px 0; font-weight: bold;">${worker.full_name} (${worker.worker_id})</p>
          <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; border: 2px dashed #cbd5e1; display: inline-block; margin: 20px 0;">
            <div style="font-size: 20px; font-family: monospace; font-weight: bold;">${qr.qr_data}</div>
          </div>
          <button onclick="window.print();" class="btn">Print QR Code</button>
        </div>
      </main>
    </div>
  `;
  res.send(await renderLayout('My QR Code', content));
});

app.get('/worker/attendance', requireAuth('WORKER'), async (req, res) => {
  global.currentUser = req.session.user;
  const workerRes = await pool.query('SELECT * FROM workers WHERE user_id = $1', [req.session.user.id]);
  const worker = workerRes.rows[0];
  const logs = await pool.query('SELECT * FROM attendance_logs WHERE worker_id = $1 ORDER BY date DESC, time DESC', [worker.worker_id]);

  const content = `
    <div class="container">
      ${workerSidebar('My Attendance')}
      <main>
        <h2>My Attendance Logs</h2>
        <div class="card">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Time</th>
                <th>Type</th>
              </tr>
            </thead>
            <tbody>
              ${logs.rows.map(l => `
                <tr>
                  <td>${l.date.toISOString().split('T')[0]}</td>
                  <td>${l.time}</td>
                  <td><span class="badge ${l.attendance_type === 'IN' ? 'badge-success' : 'badge-danger'}">${l.attendance_type}</span></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  `;
  res.send(await renderLayout('My Attendance', content));
});

app.get('/worker/advance', requireAuth('WORKER'), async (req, res) => {
  global.currentUser = req.session.user;
  const workerRes = await pool.query('SELECT * FROM workers WHERE user_id = $1', [req.session.user.id]);
  const worker = workerRes.rows[0];
  const advances = await pool.query('SELECT * FROM advance_money WHERE worker_id = $1 ORDER BY date DESC', [worker.worker_id]);

  const content = `
    <div class="container">
      ${workerSidebar('My Advance')}
      <main>
        <h2>My Advance Money History</h2>
        <div class="card">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Amount</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              ${advances.rows.map(a => `
                <tr>
                  <td>${a.date.toISOString().split('T')[0]}</td>
                  <td>₱${parseFloat(a.amount).toFixed(2)}</td>
                  <td>${a.reason || 'N/A'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  `;
  res.send(await renderLayout('My Advance', content));
});

app.get('/worker/salary', requireAuth('WORKER'), async (req, res) => {
  global.currentUser = req.session.user;
  const workerRes = await pool.query('SELECT * FROM workers WHERE user_id = $1', [req.session.user.id]);
  const worker = workerRes.rows[0];
  
  const advRes = await pool.query('SELECT SUM(amount) as total FROM advance_money WHERE worker_id = $1', [worker.worker_id]);
  const totalAdvance = parseFloat(advRes.rows[0].total || 0);
  const attCount = await pool.query('SELECT COUNT(*) FROM attendance_logs WHERE worker_id = $1 AND attendance_type = $2', [worker.worker_id, 'IN']);
  const daysWorked = parseInt(attCount.rows[0].count) || 0;
  const totalSalary = daysWorked * parseFloat(worker.daily_rate);
  const netSalary = totalSalary - totalAdvance;

  const content = `
    <div class="container">
      ${workerSidebar('My Salary')}
      <main>
        <h2>My Salary Summary</h2>
        <div class="card" style="max-width: 500px;">
          <p><b>Daily Rate:</b> ₱${parseFloat(worker.daily_rate).toFixed(2)}</p>
          <p><b>Days Worked (IN counts):</b> ${daysWorked}</p>
          <p><b>Total Salary:</b> ₱${totalSalary.toFixed(2)}</p>
          <p style="color: #e74c3c;"><b>Advance Deductions:</b> -₱${totalAdvance.toFixed(2)}</p>
          <hr style="margin: 15px 0;">
          <h3>Net Salary: ₱${netSalary.toFixed(2)}</h3>
        </div>
      </main>
    </div>
  `;
  res.send(await renderLayout('My Salary', content));
});

app.get('/worker/announcements', requireAuth('WORKER'), async (req, res) => {
  global.currentUser = req.session.user;
  const ann = await pool.query('SELECT * FROM announcements ORDER BY id DESC');

  const content = `
    <div class="container">
      ${workerSidebar('Announcements')}
      <main>
        <h2>Company Announcements</h2>
        <div class="card">
          ${ann.rows.map(a => `
            <div style="border-bottom: 1px solid #ecf0f1; padding: 15px 0;">
              <h4>${a.title}</h4>
              <p style="margin-top: 5px;">${a.content}</p>
              <small style="color: #95a5a6;">${a.created_at.toISOString().split('T')[0]}</small>
            </div>
          `).join('')}
        </div>
      </main>
    </div>
  `;
  res.send(await renderLayout('Announcements', content));
});

// -----------------------------------------------------------------------------
// ATTENDANCE SCANNER PORTAL
// -----------------------------------------------------------------------------
function scannerSidebar(active) {
  const items = [
    { name: 'Dashboard', href: '/scanner/dashboard' },
    { name: 'Scan QR Code', href: '/scanner/scan' },
    { name: "Today's Attendance", href: '/scanner/today' },
    { name: 'Logout', href: '/logout' }
  ];
  return `<sidebar>` + items.map(i => `<a href="${i.href}" class="${active === i.name ? 'active' : ''}">${i.name}</a>`).join('') + `</sidebar>`;
}

app.get('/scanner/dashboard', requireAuth('SCANNER'), async (req, res) => {
  global.currentUser = req.session.user;
  const today = new Date().toISOString().split('T')[0];
  const countRes = await pool.query('SELECT COUNT(DISTINCT worker_id) FROM attendance_logs WHERE date = $1', [today]);

  const content = `
    <div class="container">
      ${scannerSidebar('Dashboard')}
      <main>
        <h2>Attendance Scanner Dashboard</h2>
        <div class="grid-4">
          <div class="stat-card">
            <h3>Workers Present Today</h3>
            <div class="value">${countRes.rows[0].count}</div>
          </div>
        </div>
      </main>
    </div>
  `;
  res.send(await renderLayout('Scanner Dashboard', content));
});

// Scan Portal Interface (with mandatory IN/OUT selection & sequence validation)
app.get('/scanner/scan', requireAuth('SCANNER'), async (req, res) => {
  global.currentUser = req.session.user;
  const scanType = req.query.type || 'IN';

  const content = `
    <div class="container">
      ${scannerSidebar('Scan QR Code')}
      <main>
        <h2>QR Code Attendance Scanner</h2>
        <div class="card" style="max-width: 500px; text-align: center;">
          <h3>Select Attendance Type</h3>
          <div style="display: flex; gap: 15px; justify-content: center; margin: 20px 0;">
            <a href="/scanner/scan?type=IN" class="btn ${scanType === 'IN' ? 'btn-success' : ''}" style="flex: 1; padding: 15px; font-size: 16px;">TIME IN</a>
            <a href="/scanner/scan?type=OUT" class="btn ${scanType === 'OUT' ? 'btn-danger' : ''}" style="flex: 1; padding: 15px; font-size: 16px;">TIME OUT</a>
          </div>

          <p style="margin-bottom: 15px; font-weight: bold; color: #2c3e50;">Current Selected Type: <span style="color: ${scanType === 'IN' ? '#2ecc71' : '#e74c3c'};">${scanType}</span></p>

          <form action="/scanner/record" method="POST">
            <input type="hidden" name="attendance_type" value="${scanType}">
            <label>Scan / Enter Worker QR Data or Worker ID</label>
            <input type="text" name="qr_data" required placeholder="e.g. W-001 or WORKER_QR_W-001..." style="font-size: 16px; text-align: center;">
            <button type="submit" class="btn" style="width: 100%; margin-top: 15px; padding: 14px; font-size: 16px;">Process Attendance Scan</button>
          </form>
        </div>
      </main>
    </div>
  `;
  res.send(await renderLayout('Scan QR', content));
});

app.post('/scanner/record', requireAuth('SCANNER'), async (req, res) => {
  const { qr_data, attendance_type } = req.body;
  const today = new Date().toISOString().split('T')[0];
  const timeNow = new Date().toTimeString().split(' ')[0];

  let workerId = qr_data.trim();
  if (qr_data.startsWith('WORKER_QR_')) {
    const parts = qr_data.split('_');
    workerId = parts[2];
  }

  const workerRes = await pool.query('SELECT * FROM workers WHERE worker_id = $1', [workerId]);
  if (workerRes.rows.length === 0) {
    return res.send(await renderLayout('Scan Error', `<div class="container"><main><div class="card"><div class="alert alert-error">Error: Worker Not Found or Invalid QR Code.</div><a href="/scanner/scan" class="btn">Try Again</a></div></main></div>`));
  }

  const worker = workerRes.rows[0];
  if (!worker.is_active) {
    return res.send(await renderLayout('Scan Error', `<div class="container"><main><div class="card"><div class="alert alert-error">Error: Worker Account is Inactive.</div><a href="/scanner/scan" class="btn">Try Again</a></div></main></div>`));
  }

  const lastLogRes = await pool.query('SELECT * FROM attendance_logs WHERE worker_id = $1 AND date = $2 ORDER BY id DESC LIMIT 1', [workerId, today]);
  const lastLog = lastLogRes.rows[0];

  if (!lastLog && attendance_type === 'OUT') {
    return res.send(await renderLayout('Validation Error', `<div class="container"><main><div class="card"><div class="alert alert-error">Cannot Record OUT as First Attendance for today.</div><a href="/scanner/scan" class="btn">Back</a></div></main></div>`));
  }

  if (lastLog && lastLog.attendance_type === attendance_type) {
    return res.send(await renderLayout('Validation Error', `<div class="container"><main><div class="card"><div class="alert alert-error">Invalid Sequence: Cannot record two consecutive ${attendance_type} records.</div><a href="/scanner/scan" class="btn">Back</a></div></main></div>`));
  }

  await pool.query(
    'INSERT INTO attendance_logs (worker_id, date, time, attendance_type) VALUES ($1, $2, $3, $4)',
    [workerId, today, timeNow, attendance_type]
  );

  const content = `
    <div class="container">
      ${scannerSidebar('Scan QR Code')}
      <main>
        <div class="card" style="max-width: 450px; text-align: center; margin: 0 auto;">
          <h2 style="color: #2ecc71; margin-bottom: 15px;">Attendance Recorded Successfully</h2>
          <p><b>Name:</b> ${worker.full_name}</p>
          <p><b>Position:</b> ${worker.position}</p>
          <p><b>Type:</b> ${attendance_type}</p>
          <p><b>Time:</b> ${timeNow}</p>
          <a href="/scanner/scan" class="btn" style="margin-top: 20px; display: inline-block;">Scan Next Worker</a>
        </div>
      </main>
    </div>
  `;
  res.send(await renderLayout('Success', content));
});

app.get('/scanner/today', requireAuth('SCANNER'), async (req, res) => {
  global.currentUser = req.session.user;
  const today = new Date().toISOString().split('T')[0];
  const logs = await pool.query(`
    SELECT a.*, w.full_name, w.position 
    FROM attendance_logs a 
    JOIN workers w ON a.worker_id = w.worker_id 
    WHERE a.date = $1 
    ORDER BY a.time DESC
  `, [today]);

  const content = `
    <div class="container">
      ${scannerSidebar("Today's Attendance")}
      <main>
        <h2>Today's Attendance (${today})</h2>
        <div class="card">
          <table>
            <thead>
              <tr>
                <th>Worker ID</th>
                <th>Name</th>
                <th>Position</th>
                <th>Type</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              ${logs.rows.length === 0 ? '<tr><td colspan="5" style="text-align: center;">No scans recorded for today yet.</td></tr>' :
                logs.rows.map(l => `
                  <tr>
                    <td>${l.worker_id}</td>
                    <td>${l.full_name}</td>
                    <td>${l.position}</td>
                    <td><span class="badge ${l.attendance_type === 'IN' ? 'badge-success' : 'badge-danger'}">${l.attendance_type}</span></td>
                    <td>${l.time}</td>
                  </tr>
                `).join('')
              }
            </tbody>
          </table>
        </div>
      </main>
    </div>
  `;
  res.send(await renderLayout("Today's Attendance", content));
});

// Start Server and Initialize DB
app.listen(PORT, async () => {
  await initializeDatabase();
  console.log(`Construction Worker Management System running on port ${PORT}`);
});
