/******************************************************************************
 * server.js - Construction Worker Management System (Single-File App)
 * Technologies: Node.js, Express, PostgreSQL, EJS/Vanilla UI, QRCode, Bcrypt
 ******************************************************************************/

const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const QRCode = require('qrcode');

const app = express();
const PORT = process.env.PORT || 3000;

// PostgreSQL Connection Pool using environment variable for Render
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'construction_secret_key_999',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false } // Set to true if using HTTPS in production with proper proxy config
}));

// Helper: Database Initialization Tables
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

      CREATE TABLE IF NOT EXISTS company_settings (
        id SERIAL PRIMARY KEY,
        company_name VARCHAR(255) DEFAULT 'Apex Builder Construction',
        company_logo TEXT DEFAULT '',
        company_address VARCHAR(255) DEFAULT '123 Construction Ave, Metro Manila',
        contact_number VARCHAR(50) DEFAULT '+63 912 345 6789',
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
        contact_number VARCHAR(50) NOT NULL,
        daily_rate NUMERIC(10,2) NOT NULL DEFAULT 700.00,
        assigned_project VARCHAR(255) NOT NULL,
        profile_picture TEXT DEFAULT '',
        qr_code TEXT DEFAULT '',
        user_id INT REFERENCES users(id) ON DELETE CASCADE,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS attendance_logs (
        id SERIAL PRIMARY KEY,
        worker_id VARCHAR(50) NOT NULL,
        date DATE NOT NULL,
        time TIME NOT NULL,
        attendance_type VARCHAR(10) NOT NULL, -- 'IN' or 'OUT'
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

    // Insert default company settings if empty
    const compCheck = await pool.query('SELECT * FROM company_settings LIMIT 1');
    if (compCheck.rows.length === 0) {
      await pool.query(`INSERT INTO company_settings (company_name, company_address, contact_number) VALUES ('Apex Builder Construction', '123 Construction Ave, Metro Manila', '+63 912 345 6789')`);
    }

    // Insert default work schedule if empty
    const schedCheck = await pool.query('SELECT * FROM work_schedules LIMIT 1');
    if (schedCheck.rows.length === 0) {
      await pool.query(`INSERT INTO work_schedules (morning_start, morning_end, afternoon_start, afternoon_end, full_day_hours, half_day_hours) VALUES ('07:00', '12:00', '13:00', '17:00', 8, 4)`);
    }

    console.log('Database tables verified and initialized successfully.');
  } catch (err) {
    console.error('Database initialization error:', err);
  }
}
initDB();

// Middleware: Global Company Settings & Session User Injection
app.use(async (req, res, next) => {
  try {
    const compRes = await pool.query('SELECT * FROM company_settings LIMIT 1');
    res.locals.company = compRes.rows[0] || {
      company_name: 'Apex Builder Construction',
      company_logo: '',
      company_address: 'Metro Manila',
      contact_number: '09123456789'
    };
    res.locals.user = req.session.user || null;
    next();
  } catch (err) {
    res.locals.company = {};
    res.locals.user = req.session.user || null;
    next();
  }
});

// Authentication and Role Guards
function requireAdmin(req, res, next) {
  if (req.session.user && req.session.user.role === 'ADMIN') {
    return next();
  }
  res.status(403).send(renderErrorPage('Access Denied: You do not have permission to access this portal.', '/admin'));
}

function requireWorker(req, res, next) {
  if (req.session.user && req.session.user.role === 'WORKER') {
    return next();
  }
  res.status(403).send(renderErrorPage('Access Denied: You do not have permission to access this portal.', '/worker'));
}

function requireScanner(req, res, next) {
  if (req.session.user && req.session.user.role === 'SCANNER') {
    return next();
  }
  res.status(403).send(renderErrorPage('Access Denied: You do not have permission to access this portal.', '/scanner'));
}

// UI Template Shell wrapper
function layout(title, bodyHtml, activeNav = '') {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>\${title}</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
</head>
<body class="bg-slate-50 text-slate-800 font-sans antialiased min-h-screen flex flex-col">
  <div class="flex-grow">\${bodyHtml}</div>
  <footer class="bg-white border-t py-4 text-center text-xs text-slate-500">
    &copy; \${new Date().getFullYear()} Construction Worker Management System. All rights reserved.
  </footer>
</body>
</html>`;
}

function renderErrorPage(message, backUrl) {
  return layout('Access Denied', `
    <div class="min-h-screen flex items-center justify-center p-4">
      <div class="bg-white p-8 rounded-xl shadow-md max-w-md w-full text-center border border-red-100">
        <div class="text-red-500 text-5xl mb-4"><i class="fa-solid fa-triangle-exclamation"></i></div>
        <h2 class="text-xl font-bold text-slate-800 mb-2">Access Denied</h2>
        <p class="text-slate-600 mb-6">\${message}</p>
        <a href="\${backUrl}" class="inline-block bg-blue-600 hover:bg-blue-700 text-white font-medium px-6 py-2.5 rounded-lg transition">Back to Portal</a>
      </div>
    </div>
  `);
}

// ==========================================
// ROUTES: MAIN PAGE & SETUP
// ==========================================

app.get('/', async (req, res) => {
  try {
    const adminCheck = await pool.query("SELECT * FROM users WHERE role = 'ADMIN' LIMIT 1");
    const hasAdmin = adminCheck.rows.length > 0;
    const comp = res.locals.company;

    let buttonsHtml = '';
    if (!hasAdmin) {
      buttonsHtml = `
        <a href="/setup" class="w-full bg-amber-600 hover:bg-amber-700 text-white font-semibold py-4 px-6 rounded-xl shadow-lg transition flex items-center justify-center space-x-3 text-lg">
          <i class="fa-solid fa-screwdriver-wrench"></i><span>SET UP SYSTEM (FIRST ADMIN)</span>
        </a>
      `;
    } else {
      buttonsHtml = `
        <div class="space-y-4 w-full">
          <a href="/admin" class="w-full bg-slate-900 hover:bg-slate-800 text-white font-semibold py-4 px-6 rounded-xl shadow-lg transition flex items-center justify-center space-x-3 text-lg">
            <i class="fa-solid fa-user-shield"></i><span>ADMIN PORTAL</span>
          </a>
          <a href="/worker" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-4 px-6 rounded-xl shadow-lg transition flex items-center justify-center space-x-3 text-lg">
            <i class="fa-solid fa-hard-hat"></i><span>WORKER PORTAL</span>
          </a>
          <a href="/scanner" class="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-semibold py-4 px-6 rounded-xl shadow-lg transition flex items-center justify-center space-x-3 text-lg">
            <i class="fa-solid fa-qrcode"></i><span>ATTENDANCE SCANNER</span>
          </a>
        </div>
      `;
    }

    const logoDisplay = comp.company_logo ? `<img src="\${comp.company_logo}" alt="Logo" class="h-20 w-20 object-contain mx-auto mb-4 rounded-full shadow border bg-white p-1">` : `<div class="h-20 w-20 bg-blue-600 text-white rounded-full flex items-center justify-center mx-auto mb-4 text-3xl font-bold shadow"><i class="fa-solid fa-building"></i></div>`;

    res.send(layout('Welcome - Construction System', `
      <div class="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-slate-100 to-slate-200">
        <div class="bg-white p-8 rounded-2xl shadow-xl max-w-md w-full text-center border border-slate-100">
          \${logoDisplay}
          <h1 class="text-2xl font-bold text-slate-900 mb-1">\${comp.company_name}</h1>
          <p class="text-slate-500 text-sm mb-8">Construction Worker Management System</p>
          \${buttonsHtml}
        </div>
      </div>
    `));
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
});

app.get('/setup', async (req, res) => {
  const adminCheck = await pool.query("SELECT * FROM users WHERE role = 'ADMIN' LIMIT 1");
  if (adminCheck.rows.length > 0) {
    return res.redirect('/admin');
  }

  res.send(layout('First-Time Admin Setup', `
    <div class="min-h-screen flex items-center justify-center p-4 bg-slate-100">
      <div class="bg-white p-8 rounded-xl shadow-md max-w-lg w-full">
        <h2 class="text-2xl font-bold text-slate-900 mb-2">First-Time System Setup</h2>
        <p class="text-slate-600 text-sm mb-6">Create the master Administrator account to manage the system.</p>
        <form action="/setup" method="POST" class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1">Full Name</label>
            <input type="text" name="full_name" required class="w-full border rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500">
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1">Username</label>
            <input type="text" name="username" required class="w-full border rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500">
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1">Email Address</label>
            <input type="email" name="email" required class="w-full border rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500">
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1">Password</label>
            <input type="password" name="password" required class="w-full border rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500">
          </div>
          <button type="submit" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 rounded-lg transition shadow">Create Admin & Continue</button>
        </form>
      </div>
    </div>
  `));
});

app.post('/setup', async (req, res) => {
  try {
    const adminCheck = await pool.query("SELECT * FROM users WHERE role = 'ADMIN' LIMIT 1");
    if (adminCheck.rows.length > 0) return res.redirect('/admin');

    const { full_name, username, email, password } = req.body;
    const password_hash = await bcrypt.hash(password, 10);

    const newAdmin = await pool.query(
      `INSERT INTO users (full_name, username, email, password_hash, role) VALUES ($1, $2, $3, $4, 'ADMIN') RETURNING *`,
      [full_name, username, email, password_hash]
    );

    req.session.user = newAdmin.rows[0];
    res.redirect('/admin/settings?setup=true');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error creating admin account: ' + err.message);
  }
});

// ==========================================
// LOGIN SYSTEM ROUTES
// ==========================================

app.get('/admin', async (req, res) => {
  if (req.session.user && req.session.user.role === 'ADMIN') return res.redirect('/admin/dashboard');
  
  // Check if admin exists
  const adminCheck = await pool.query("SELECT * FROM users WHERE role = 'ADMIN' LIMIT 1");
  if (adminCheck.rows.length === 0) return res.redirect('/setup');

  res.send(layout('Admin Login', `
    <div class="min-h-screen flex items-center justify-center p-4 bg-slate-100">
      <div class="bg-white p-8 rounded-xl shadow-md max-w-md w-full">
        <h2 class="text-2xl font-bold text-slate-900 mb-1 text-center">Admin Portal</h2>
        <p class="text-slate-500 text-xs text-center mb-6">\${res.locals.company.company_name || ''}</p>
        <form action="/admin/login" method="POST" class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1">Username or Email</label>
            <input type="text" name="username" required class="w-full border rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500">
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1">Password</label>
            <input type="password" name="password" required class="w-full border rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500">
          </div>
          <button type="submit" class="w-full bg-slate-900 hover:bg-slate-800 text-white font-medium py-2.5 rounded-lg transition">Login to Admin</button>
        </form>
        <div class="mt-4 text-center"><a href="/" class="text-xs text-blue-600 hover:underline">&larr; Back to Home</a></div>
      </div>
    </div>
  `));
});

app.post('/admin/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const result = await pool.query("SELECT * FROM users WHERE (username = $1 OR email = $1) AND role = 'ADMIN'", [username]);
    if (result.rows.length > 0) {
      const user = result.rows[0];
      if (await bcrypt.compare(password, user.password_hash)) {
        req.session.user = user;
        return res.redirect('/admin/dashboard');
      }
    }
    res.send(renderErrorPage('Invalid username or password.', '/admin'));
  } catch (err) {
    res.status(500).send('Login error');
  }
});

app.get('/worker', async (req, res) => {
  if (req.session.user && req.session.user.role === 'WORKER') return res.redirect('/worker/dashboard');

  res.send(layout('Worker Login', `
    <div class="min-h-screen flex items-center justify-center p-4 bg-slate-100">
      <div class="bg-white p-8 rounded-xl shadow-md max-w-md w-full">
        <h2 class="text-2xl font-bold text-slate-900 mb-1 text-center">Worker Portal</h2>
        <p class="text-slate-500 text-xs text-center mb-6">\${res.locals.company.company_name || ''}</p>
        <form action="/worker/login" method="POST" class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1">Username</label>
            <input type="text" name="username" required class="w-full border rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500">
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1">Password</label>
            <input type="password" name="password" required class="w-full border rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500">
          </div>
          <button type="submit" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 rounded-lg transition">Worker Login</button>
        </form>
        <div class="mt-4 text-center"><a href="/" class="text-xs text-blue-600 hover:underline">&larr; Back to Home</a></div>
      </div>
    </div>
  `));
});

app.post('/worker/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const result = await pool.query("SELECT * FROM users WHERE username = $1 AND role = 'WORKER'", [username]);
    if (result.rows.length > 0) {
      const user = result.rows[0];
      if (await bcrypt.compare(password, user.password_hash)) {
        req.session.user = user;
        return res.redirect('/worker/dashboard');
      }
    }
    res.send(renderErrorPage('Invalid worker credentials.', '/worker'));
  } catch (err) {
    res.status(500).send('Login error');
  }
});

app.get('/scanner', async (req, res) => {
  if (req.session.user && req.session.user.role === 'SCANNER') return res.redirect('/scanner/dashboard');

  res.send(layout('Scanner Login', `
    <div class="min-h-screen flex items-center justify-center p-4 bg-slate-100">
      <div class="bg-white p-8 rounded-xl shadow-md max-w-md w-full">
        <h2 class="text-2xl font-bold text-slate-900 mb-1 text-center">Attendance Scanner Portal</h2>
        <p class="text-slate-500 text-xs text-center mb-6">\${res.locals.company.company_name || ''}</p>
        <form action="/scanner/login" method="POST" class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1">Username</label>
            <input type="text" name="username" required class="w-full border rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-emerald-500">
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-700 mb-1">Password</label>
            <input type="password" name="password" required class="w-full border rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-emerald-500">
          </div>
          <button type="submit" class="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-medium py-2.5 rounded-lg transition">Scanner Login</button>
        </form>
        <div class="mt-4 text-center"><a href="/" class="text-xs text-blue-600 hover:underline">&larr; Back to Home</a></div>
      </div>
    </div>
  `));
});

app.post('/scanner/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const result = await pool.query("SELECT * FROM users WHERE username = $1 AND role = 'SCANNER'", [username]);
    if (result.rows.length > 0) {
      const user = result.rows[0];
      if (await bcrypt.compare(password, user.password_hash)) {
        req.session.user = user;
        return res.redirect('/scanner/dashboard');
      }
    }
    res.send(renderErrorPage('Invalid scanner credentials.', '/scanner'));
  } catch (err) {
    res.status(500).send('Login error');
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/');
  });
});

// ==========================================
// ADMIN PORTAL & MODULES
// ==========================================

function adminNav(active) {
  const items = [
    { name: 'Dashboard', href: '/admin/dashboard', icon: 'fa-chart-pie' },
    { name: 'Workers', href: '/admin/workers', icon: 'fa-users' },
    { name: 'Attendance', href: '/admin/attendance', icon: 'fa-clipboard-user' },
    { name: 'Advance Money', href: '/admin/advance', icon: 'fa-wallet' },
    { name: 'Salary', href: '/admin/salary', icon: 'fa-peso-sign' },
    { name: 'Announcements', href: '/admin/announcements', icon: 'fa-bullhorn' },
    { name: 'Company Settings', href: '/admin/settings', icon: 'fa-building' },
    { name: 'Work Schedule', href: '/admin/schedule', icon: 'fa-clock' },
    { name: 'Scanner Users', href: '/admin/scanners', icon: 'fa-qrcode' },
    { name: 'Logout', href: '/logout', icon: 'fa-right-from-bracket' }
  ];

  let links = '';
  items.forEach(i => {
    const isActive = active === i.name ? 'bg-slate-800 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white';
    links += `<a href="\${i.href}" class="flex items-center space-x-3 px-4 py-2.5 rounded-lg text-sm font-medium transition \${isActive}"><i class="fa-solid \${i.icon} w-5"></i><span>\${i.name}</span></a>`;
  });

  return `
    <aside class="w-64 bg-slate-900 text-slate-100 flex flex-col hidden md:flex shrink-0">
      <div class="p-6 border-b border-slate-800">
        <h2 class="font-bold text-lg truncate">\${res.locals.company.company_name || 'Admin Portal'}</h2>
        <p class="text-xs text-slate-400">Management Panel</p>
      </div>
      <nav class="flex-1 p-4 space-y-1 overflow-y-auto">\${links}</nav>
    </aside>
  `;
}

function adminHeader(title) {
  return `
    <header class="bg-white border-b px-6 py-4 flex items-center justify-between shadow-sm">
      <h1 class="text-xl font-bold text-slate-800">\${title}</h1>
      <div class="flex items-center space-x-3">
        <span class="text-sm font-medium text-slate-600"><i class="fa-solid fa-user-shield mr-1"></i> \${res.locals.user ? res.locals.user.full_name : 'Admin'}</span>
      </div>
    </header>
  `;
}

// Admin Dashboard
app.get('/admin/dashboard', requireAdmin, async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const workersCount = await pool.query('SELECT COUNT(*) FROM workers WHERE is_active = true');
    const presentToday = await pool.query('SELECT COUNT(DISTINCT worker_id) FROM attendance_logs WHERE date = $1', [today]);
    
    // Calculate full day / half day count today
    const workersList = await pool.query('SELECT * FROM workers WHERE is_active = true');
    const scheduleRes = await pool.query('SELECT * FROM work_schedules LIMIT 1');
    const sched = scheduleRes.rows[0];

    let fullDayCount = 0;
    let halfDayCount = 0;
    let absentCount = 0;

    for (let w of workersList.rows) {
      const logs = await pool.query('SELECT * FROM attendance_logs WHERE worker_id = $1 AND date = $2 ORDER BY time ASC', [w.worker_id, today]);
      const status = calculateAttendanceStatus(logs.rows, sched);
      if (status === 'FULL DAY') fullDayCount++;
      else if (status === 'HALF DAY') halfDayCount++;
      else absentCount++;
    }

    const recentLogs = await pool.query('SELECT l.*, w.full_name, w.position FROM attendance_logs l JOIN workers w ON l.worker_id = w.worker_id ORDER BY l.date DESC, l.time DESC LIMIT 10');

    res.send(layout('Admin Dashboard', `
      <div class="flex min-h-screen">
        \${adminNav('Dashboard')}
        <div class="flex-1 flex flex-col">
          \${adminHeader('Dashboard Overview')}
          <main class="p-6 space-y-6">
            <div class="grid grid-cols-1 md:grid-cols-5 gap-4">
              <div class="bg-white p-5 rounded-xl shadow border border-slate-100">
                <p class="text-xs font-semibold text-slate-400 uppercase">Total Workers</p>
                <h3 class="text-2xl font-bold text-slate-800 mt-1">\${workersCount.rows[0].count}</h3>
              </div>
              <div class="bg-white p-5 rounded-xl shadow border border-slate-100">
                <p class="text-xs font-semibold text-slate-400 uppercase">Present Today</p>
                <h3 class="text-2xl font-bold text-blue-600 mt-1">\${presentToday.rows[0].count}</h3>
              </div>
              <div class="bg-white p-5 rounded-xl shadow border border-slate-100">
                <p class="text-xs font-semibold text-slate-400 uppercase">Full Day Today</p>
                <h3 class="text-2xl font-bold text-emerald-600 mt-1">\${fullDayCount}</h3>
              </div>
              <div class="bg-white p-5 rounded-xl shadow border border-slate-100">
                <p class="text-xs font-semibold text-slate-400 uppercase">Half Day Today</p>
                <h3 class="text-2xl font-bold text-amber-600 mt-1">\${halfDayCount}</h3>
              </div>
              <div class="bg-white p-5 rounded-xl shadow border border-slate-100">
                <p class="text-xs font-semibold text-slate-400 uppercase">Absent Today</p>
                <h3 class="text-2xl font-bold text-rose-600 mt-1">\${absentCount}</h3>
              </div>
            </div>

            <div class="bg-white rounded-xl shadow border border-slate-100 p-6">
              <h3 class="text-lg font-bold text-slate-800 mb-4">Recent Attendance Logs</h3>
              <div class="overflow-x-auto">
                <table class="w-full text-left text-sm">
                  <thead>
                    <tr class="border-b text-slate-400 font-semibold text-xs uppercase">
                      <th class="pb-3">Worker ID</th>
                      <th class="pb-3">Name</th>
                      <th class="pb-3">Position</th>
                      <th class="pb-3">Type</th>
                      <th class="pb-3">Date</th>
                      <th class="pb-3">Time</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y">
                    \${recentLogs.rows.map(r => `
                      <tr class="hover:bg-slate-50">
                        <td class="py-3 font-medium">\${r.worker_id}</td>
                        <td class="py-3">\${r.full_name}</td>
                        <td class="py-3">\${r.position}</td>
                        <td class="py-3"><span class="px-2 py-1 rounded text-xs font-bold \${r.attendance_type === 'IN' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}">\${r.attendance_type}</span></td>
                        <td class="py-3">\${r.date.toISOString().split('T')[0]}</td>
                        <td class="py-3">\${r.time}</td>
                      </tr>
                    `).join('') || '<tr><td colspan="6" class="py-4 text-center text-slate-400">No attendance recorded yet.</td></tr>'}
                  </tbody>
                </table>
              </div>
            </div>
          </main>
        </div>
      </div>
    `));
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
});

// Workers Management
app.get('/admin/workers', requireAdmin, async (req, res) => {
  const search = req.query.search || '';
  try {
    const workers = await pool.query(
      `SELECT * FROM workers WHERE full_name ILIKE $1 OR worker_id ILIKE $1 OR position ILIKE $1 ORDER BY id DESC`,
      [`%\${search}%`]
    );

    res.send(layout('Worker Management', `
      <div class="flex min-h-screen">
        \${adminNav('Workers')}
        <div class="flex-1 flex flex-col">
          \${adminHeader('Worker Management')}
          <main class="p-6 space-y-6">
            <div class="flex flex-col md:flex-row justify-between items-center gap-4">
              <form method="GET" class="flex w-full md:w-96 gap-2">
                <input type="text" name="search" value="\${search}" placeholder="Search worker..." class="w-full border rounded-lg px-3 py-2 text-sm">
                <button type="submit" class="bg-slate-900 text-white px-4 py-2 rounded-lg text-sm">Search</button>
              </form>
              <a href="/admin/workers/new" class="bg-blue-600 hover:bg-blue-700 text-white font-medium px-4 py-2 rounded-lg text-sm transition flex items-center space-x-2"><i class="fa-solid fa-user-plus"></i><span>Register Worker</span></a>
            </div>

            <div class="bg-white rounded-xl shadow border border-slate-100 overflow-hidden">
              <table class="w-full text-left text-sm">
                <thead class="bg-slate-50 border-b text-slate-500 font-semibold text-xs uppercase">
                  <tr>
                    <th class="p-4">Worker ID</th>
                    <th class="p-4">Name</th>
                    <th class="p-4">Position</th>
                    <th class="p-4">Project</th>
                    <th class="p-4">Daily Rate</th>
                    <th class="p-4">Status</th>
                    <th class="p-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody class="divide-y">
                  \${workers.rows.map(w => `
                    <tr class="hover:bg-slate-50">
                      <td class="p-4 font-medium">\${w.worker_id}</td>
                      <td class="p-4">\${w.full_name}</td>
                      <td class="p-4">\${w.position}</td>
                      <td class="p-4">\${w.assigned_project}</td>
                      <td class="p-4">₱\${Number(w.daily_rate).toFixed(2)}</td>
                      <td class="p-4"><span class="px-2 py-1 rounded text-xs font-bold \${w.is_active ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}">\${w.is_active ? 'ACTIVE' : 'INACTIVE'}</span></td>
                      <td class="p-4 text-right space-x-2">
                        <a href="/admin/workers/\${w.id}" class="text-blue-600 hover:underline"><i class="fa-solid fa-eye"></i> View</a>
                        <a href="/admin/workers/edit/\${w.id}" class="text-amber-600 hover:underline"><i class="fa-solid fa-pen"></i> Edit</a>
                        <a href="/admin/workers/toggle/\${w.id}" class="text-slate-600 hover:underline">\${w.is_active ? 'Deactivate' : 'Activate'}</a>
                      </td>
                    </tr>
                  `).join('') || '<tr><td colspan="7" class="p-6 text-center text-slate-400">No workers found.</td></tr>'}
                </tbody>
              </table>
            </div>
          </main>
        </div>
      </div>
    `));
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
});

app.get('/admin/workers/new', requireAdmin, (req, res) => {
  res.send(layout('Register Worker', `
    <div class="flex min-h-screen">
      \${adminNav('Workers')}
      <div class="flex-1 flex flex-col">
        \${adminHeader('Register New Worker')}
        <main class="p-6 max-w-2xl">
          <form action="/admin/workers/new" method="POST" class="bg-white p-6 rounded-xl shadow border space-y-4">
            <div>
              <label class="block text-sm font-medium text-slate-700 mb-1">Full Name</label>
              <input type="text" name="full_name" required class="w-full border rounded-lg p-2.5 text-sm">
            </div>
            <div>
              <label class="block text-sm font-medium text-slate-700 mb-1">Position (e.g. Mason, Carpenter)</label>
              <input type="text" name="position" required class="w-full border rounded-lg p-2.5 text-sm">
            </div>
            <div>
              <label class="block text-sm font-medium text-slate-700 mb-1">Contact Number</label>
              <input type="text" name="contact_number" required class="w-full border rounded-lg p-2.5 text-sm">
            </div>
            <div>
              <label class="block text-sm font-medium text-slate-700 mb-1">Daily Rate (₱)</label>
              <input type="number" step="0.01" name="daily_rate" required value="700.00" class="w-full border rounded-lg p-2.5 text-sm">
            </div>
            <div>
              <label class="block text-sm font-medium text-slate-700 mb-1">Assigned Project</label>
              <input type="text" name="assigned_project" required class="w-full border rounded-lg p-2.5 text-sm">
            </div>
            <div>
              <label class="block text-sm font-medium text-slate-700 mb-1">Username (for Worker Portal)</label>
              <input type="text" name="username" required class="w-full border rounded-lg p-2.5 text-sm">
            </div>
            <div>
              <label class="block text-sm font-medium text-slate-700 mb-1">Password (for Worker Portal)</label>
              <input type="password" name="password" required class="w-full border rounded-lg p-2.5 text-sm">
            </div>
            <button type="submit" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 rounded-lg transition shadow">Register & Generate QR Code</button>
          </form>
        </main>
      </div>
    </div>
  `));
});

app.post('/admin/workers/new', requireAdmin, async (req, res) => {
  const { full_name, position, contact_number, daily_rate, assigned_project, username, password } = req.body;
  try {
    // Generate unique Worker ID
    const countRes = await pool.query('SELECT COUNT(*) FROM workers');
    const worker_id = 'W-' + String(Number(countRes.rows[0].count) + 1).padStart(3, '0');

    // Create User login account
    const password_hash = await bcrypt.hash(password, 10);
    const userRes = await pool.query(
      `INSERT INTO users (full_name, username, email, password_hash, role) VALUES ($1, $2, $3, $4, 'WORKER') RETURNING id`,
      [full_name, username, `${username}@worker.system`, password_hash]
    );
    const userId = userRes.rows[0].id;

    // Generate QR Code data URL
    const qrDataUrl = await QRCode.toDataURL(worker_id);

    await pool.query(
      `INSERT INTO workers (worker_id, full_name, position, contact_number, daily_rate, assigned_project, qr_code, user_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [worker_id, full_name, position, contact_number, daily_rate, assigned_project, qrDataUrl, userId]
    );

    res.redirect('/admin/workers');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error registering worker: ' + err.message);
  }
});

app.get('/admin/workers/:id', requireAdmin, async (req, res) => {
  try {
    const worker = await pool.query('SELECT * FROM workers WHERE id = $1', [req.params.id]);
    if (worker.rows.length === 0) return res.status(404).send('Worker not found');
    const w = worker.rows[0];

    res.send(layout('Worker Profile', `
      <div class="flex min-h-screen">
        \${adminNav('Workers')}
        <div class="flex-1 flex flex-col">
          \${adminHeader('Worker Profile & QR Code')}
          <main class="p-6 max-w-2xl space-y-6">
            <div class="bg-white p-6 rounded-xl shadow border flex flex-col md:flex-row items-center gap-6">
              <div class="text-center">
                <img src="\${w.qr_code}" alt="QR Code" class="w-48 h-48 object-contain border p-2 rounded-lg bg-white shadow">
                <a href="\${w.qr_code}" download="\${w.worker_id}-qr.png" class="mt-3 inline-block bg-slate-900 text-white text-xs font-semibold px-4 py-2 rounded-lg">Download QR Code</a>
              </div>
              <div class="space-y-2 flex-1">
                <h2 class="text-2xl font-bold text-slate-800">\${w.full_name}</h2>
                <p class="text-sm font-semibold text-blue-600">ID: \${w.worker_id}</p>
                <p class="text-sm text-slate-600"><strong class="text-slate-700">Position:</strong> \${w.position}</p>
                <p class="text-sm text-slate-600"><strong class="text-slate-700">Contact:</strong> \${w.contact_number}</p>
                <p class="text-sm text-slate-600"><strong class="text-slate-700">Project:</strong> \${w.assigned_project}</p>
                <p class="text-sm text-slate-600"><strong class="text-slate-700">Daily Rate:</strong> ₱\${Number(w.daily_rate).toFixed(2)}</p>
                <p class="text-sm text-slate-600"><strong class="text-slate-700">Status:</strong> <span class="\${w.is_active ? 'text-emerald-600' : 'text-rose-600'} font-bold">\${w.is_active ? 'ACTIVE' : 'INACTIVE'}</span></p>
              </div>
            </div>
            <div><a href="/admin/workers" class="text-sm text-blue-600 hover:underline">&larr; Back to Workers List</a></div>
          </main>
        </div>
      </div>
    `));
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
});

app.get('/admin/workers/toggle/:id', requireAdmin, async (req, res) => {
  try {
    const worker = await pool.query('SELECT is_active FROM workers WHERE id = $1', [req.params.id]);
    if (worker.rows.length > 0) {
      const nextStatus = !worker.rows[0].is_active;
      await pool.query('UPDATE workers SET is_active = $1 WHERE id = $2', [nextStatus, req.params.id]);
    }
    res.redirect('/admin/workers');
  } catch (err) {
    res.status(500).send('Error');
  }
});

// Attendance Management Helper and View
function calculateAttendanceStatus(logs, schedule) {
  if (!logs || logs.length === 0) return 'ABSENT';
  // logs sorted by time asc
  let hasIn = logs.some(l => l.attendance_type === 'IN');
  let hasOut = logs.some(l => l.attendance_type === 'OUT');
  
  if (logs.length >= 4) return 'FULL DAY';
  if (logs.length === 2 && logs[0].attendance_type === 'IN' && logs[1].attendance_type === 'OUT') return 'HALF DAY';
  if (logs.length % 2 !== 0) return 'INCOMPLETE';
  return 'INCOMPLETE';
}

function calculateWorkingHours(logs) {
  let totalHours = 0;
  for (let i = 0; i < logs.length; i += 2) {
    if (logs[i] && logs[i+1] && logs[i].attendance_type === 'IN' && logs[i+1].attendance_type === 'OUT') {
      let inTime = new Date(`1970-01-01T\${logs[i].time}`);
      let outTime = new Date(`1970-01-01T\${logs[i+1].time}`);
      let diff = (outTime - inTime) / (1000 * 60 * 60);
      if (diff > 0) totalHours += diff;
    }
  }
  return totalHours.toFixed(1);
}

app.get('/admin/attendance', requireAdmin, async (req, res) => {
  const searchDate = req.query.date || new Date().toISOString().split('T')[0];
  const searchName = req.query.search || '';
  try {
    const workers = await pool.query(`SELECT * FROM workers WHERE full_name ILIKE $1 OR worker_id ILIKE $1 ORDER BY full_name ASC`, [`%\${searchName}%`]);
    const scheduleRes = await pool.query('SELECT * FROM work_schedules LIMIT 1');
    const sched = scheduleRes.rows[0];

    let reportData = [];
    for (let w of workers.rows) {
      const logsRes = await pool.query('SELECT * FROM attendance_logs WHERE worker_id = $1 AND date = $2 ORDER BY time ASC', [w.worker_id, searchDate]);
      const logs = logsRes.rows;
      const status = calculateAttendanceStatus(logs, sched);
      const hours = calculateWorkingHours(logs);

      reportData.push({
        worker: w,
        logs: logs,
        status: status,
        hours: hours
      });
    }

    res.send(layout('Attendance Management', `
      <div class="flex min-h-screen">
        \${adminNav('Attendance')}
        <div class="flex-1 flex flex-col">
          \${adminHeader('Attendance Records')}
          <main class="p-6 space-y-6">
            <form method="GET" class="bg-white p-4 rounded-xl shadow border flex flex-col md:flex-row gap-4 items-center">
              <div>
                <label class="block text-xs font-semibold text-slate-500 mb-1">Select Date</label>
                <input type="date" name="date" value="\${searchDate}" class="border rounded-lg p-2 text-sm">
              </div>
              <div class="flex-1">
                <label class="block text-xs font-semibold text-slate-500 mb-1">Search Worker</label>
                <input type="text" name="search" value="\${searchName}" placeholder="Worker name or ID..." class="w-full border rounded-lg p-2 text-sm">
              </div>
              <div class="flex items-end">
                <button type="submit" class="bg-slate-900 text-white px-5 py-2 rounded-lg text-sm font-medium">Filter</button>
              </div>
            </form>

            <div class="bg-white rounded-xl shadow border overflow-hidden">
              <table class="w-full text-left text-sm">
                <thead class="bg-slate-50 border-b text-slate-500 font-semibold text-xs uppercase">
                  <tr>
                    <th class="p-4">Worker</th>
                    <th class="p-4">Position</th>
                    <th class="p-4">Records (IN / OUT)</th>
                    <th class="p-4">Total Hours</th>
                    <th class="p-4">Status</th>
                  </tr>
                </thead>
                <tbody class="divide-y">
                  \${reportData.map(r => `
                    <tr class="hover:bg-slate-50">
                      <td class="p-4 font-medium">\${r.worker.full_name}<br><span class="text-xs text-slate-400">\${r.worker.worker_id}</span></td>
                      <td class="p-4">\${r.worker.position}</td>
                      <td class="p-4 text-xs font-mono">
                        \${r.logs.map(l => `[\${l.attendance_type} \${l.time}]`).join(' &rarr; ') || 'No records'}
                      </td>
                      <td class="p-4 font-semibold">\${r.hours} hrs</td>
                      <td class="p-4">
                        <span class="px-2.5 py-1 rounded text-xs font-bold 
                          \${r.status === 'FULL DAY' ? 'bg-emerald-100 text-emerald-800' : ''}
                          \${r.status === 'HALF DAY' ? 'bg-amber-100 text-amber-800' : ''}
                          \${r.status === 'INCOMPLETE' ? 'bg-blue-100 text-blue-800' : ''}
                          \${r.status === 'ABSENT' ? 'bg-rose-100 text-rose-800' : ''}">
                          \${r.status}
                        </span>
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </main>
        </div>
      </div>
    `));
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
});

// Advance Money Management
app.get('/admin/advance', requireAdmin, async (req, res) => {
  try {
    const workers = await pool.query('SELECT * FROM workers WHERE is_active = true ORDER BY full_name ASC');
    const advances = await pool.query('SELECT a.*, w.full_name, w.worker_id FROM advance_money a JOIN workers w ON a.worker_id = w.worker_id ORDER BY a.date DESC');

    res.send(layout('Advance Money', `
      <div class="flex min-h-screen">
        \${adminNav('Advance Money')}
        <div class="flex-1 flex flex-col">
          \${adminHeader('Advance Money Management')}
          <main class="p-6 space-y-6">
            <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
              <form action="/admin/advance" method="POST" class="bg-white p-6 rounded-xl shadow border space-y-4 md:col-span-1">
                <h3 class="font-bold text-slate-800">Record Cash Advance</h3>
                <div>
                  <label class="block text-sm font-medium text-slate-700 mb-1">Select Worker</label>
                  <select name="worker_id" required class="w-full border rounded-lg p-2.5 text-sm">
                    \${workers.rows.map(w => `<option value="\${w.worker_id}">\${w.full_name} (\${w.worker_id})</option>`).join('')}
                  </select>
                </div>
                <div>
                  <label class="block text-sm font-medium text-slate-700 mb-1">Amount (₱)</label>
                  <input type="number" step="0.01" name="amount" required class="w-full border rounded-lg p-2.5 text-sm">
                </div>
                <div>
                  <label class="block text-sm font-medium text-slate-700 mb-1">Date</label>
                  <input type="date" name="date" required value="\${new Date().toISOString().split('T')[0]}" class="w-full border rounded-lg p-2.5 text-sm">
                </div>
                <div>
                  <label class="block text-sm font-medium text-slate-700 mb-1">Reason / Notes</label>
                  <textarea name="reason" class="w-full border rounded-lg p-2.5 text-sm" rows="2"></textarea>
                </div>
                <button type="submit" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 rounded-lg transition">Save Advance Record</button>
              </form>

              <div class="bg-white rounded-xl shadow border overflow-hidden md:col-span-2">
                <div class="p-4 border-b font-bold text-slate-800">Advance History</div>
                <table class="w-full text-left text-sm">
                  <thead class="bg-slate-50 border-b text-slate-500 font-semibold text-xs uppercase">
                    <tr>
                      <th class="p-4">Date</th>
                      <th class="p-4">Worker</th>
                      <th class="p-4">Amount</th>
                      <th class="p-4">Reason</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y">
                    \${advances.rows.map(a => `
                      <tr class="hover:bg-slate-50">
                        <td class="p-4">\${a.date.toISOString().split('T')[0]}</td>
                        <td class="p-4 font-medium">\${a.full_name}</td>
                        <td class="p-4 text-rose-600 font-bold">₱\${Number(a.amount).toFixed(2)}</td>
                        <td class="p-4 text-slate-500">\${a.reason || '-'}</td>
                      </tr>
                    `).join('') || '<tr><td colspan="4" class="p-4 text-center text-slate-400">No advance records found.</td></tr>'}
                  </tbody>
                </table>
              </div>
            </div>
          </main>
        </div>
      </div>
    `));
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
});

app.post('/admin/advance', requireAdmin, async (req, res) => {
  const { worker_id, amount, date, reason } = req.body;
  try {
    await pool.query('INSERT INTO advance_money (worker_id, amount, date, reason) VALUES ($1, $2, $3, $4)', [worker_id, amount, date, reason]);
    res.redirect('/admin/advance');
  } catch (err) {
    res.status(500).send('Error');
  }
});

// Salary Calculation Management
app.get('/admin/salary', requireAdmin, async (req, res) => {
  try {
    const workers = await pool.query('SELECT * FROM workers WHERE is_active = true ORDER BY full_name ASC');
    const scheduleRes = await pool.query('SELECT * FROM work_schedules LIMIT 1');
    const sched = scheduleRes.rows[0];

    let salaryData = [];
    for (let w of workers.rows) {
      // Calculate total full days and half days across all logs
      const logsRes = await pool.query('SELECT date, json_agg(attendance_type) as types FROM attendance_logs WHERE worker_id = $1 GROUP BY date', [w.worker_id]);
      
      let fullDays = 0;
      let halfDays = 0;
      for (let row of logsRes.rows) {
        // simplified day check or group check
        const dayLogsRes = await pool.query('SELECT * FROM attendance_logs WHERE worker_id = $1 AND date = $2 ORDER BY time ASC', [w.worker_id, row.date]);
        const st = calculateAttendanceStatus(dayLogsRes.rows, sched);
        if (st === 'FULL DAY') fullDays++;
        if (st === 'HALF DAY') halfDays++;
      }

      const equivDays = fullDays + (halfDays * 0.5);
      const totalSalary = equivDays * Number(w.daily_rate);

      // Get total advance money
      const advRes = await pool.query('SELECT SUM(amount) as total FROM advance_money WHERE worker_id = $1', [w.worker_id]);
      const advanceTotal = Number(advRes.rows[0].total || 0);
      const netSalary = totalSalary - advanceTotal;

      salaryData.push({
        worker: w,
        fullDays,
        halfDays,
        equivDays,
        totalSalary,
        advanceTotal,
        netSalary
      });
    }

    res.send(layout('Salary Management', `
      <div class="flex min-h-screen">
        \${adminNav('Salary')}
        <div class="flex-1 flex flex-col">
          \${adminHeader('Salary Calculation & Payouts')}
          <main class="p-6 space-y-6">
            <div class="bg-white rounded-xl shadow border overflow-hidden">
              <table class="w-full text-left text-sm">
                <thead class="bg-slate-50 border-b text-slate-500 font-semibold text-xs uppercase">
                  <tr>
                    <th class="p-4">Worker</th>
                    <th class="p-4">Daily Rate</th>
                    <th class="p-4">Full Days</th>
                    <th class="p-4">Half Days</th>
                    <th class="p-4">Equiv. Days</th>
                    <th class="p-4">Total Salary</th>
                    <th class="p-4">Advance Ded.</th>
                    <th class="p-4 font-bold text-slate-900">Net Salary</th>
                  </tr>
                </thead>
                <tbody class="divide-y">
                  \${salaryData.map(s => `
                    <tr class="hover:bg-slate-50">
                      <td class="p-4 font-medium">\${s.worker.full_name}<br><span class="text-xs text-slate-400">\${s.worker.worker_id}</span></td>
                      <td class="p-4">₱\${Number(s.worker.daily_rate).toFixed(2)}</td>
                      <td class="p-4">\${s.fullDays}</td>
                      <td class="p-4">\${s.halfDays}</td>
                      <td class="p-4 font-semibold">\${s.equivDays}</td>
                      <td class="p-4">₱\${s.totalSalary.toFixed(2)}</td>
                      <td class="p-4 text-rose-600">-₱\${s.advanceTotal.toFixed(2)}</td>
                      <td class="p-4 font-bold text-emerald-600 text-base">₱\${s.netSalary.toFixed(2)}</td>
                    </tr>
                  `).join('') || '<tr><td colspan="8" class="p-6 text-center text-slate-400">No salary records.</td></tr>'}
                </tbody>
              </table>
            </div>
          </main>
        </div>
      </div>
    `));
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
});

// Announcements Management
app.get('/admin/announcements', requireAdmin, async (req, res) => {
  try {
    const ann = await pool.query('SELECT * FROM announcements ORDER BY created_at DESC');
    res.send(layout('Announcements', `
      <div class="flex min-h-screen">
        \${adminNav('Announcements')}
        <div class="flex-1 flex flex-col">
          \${adminHeader('Company Announcements')}
          <main class="p-6 space-y-6">
            <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
              <form action="/admin/announcements" method="POST" class="bg-white p-6 rounded-xl shadow border space-y-4 md:col-span-1">
                <h3 class="font-bold text-slate-800">Post Announcement</h3>
                <div>
                  <label class="block text-sm font-medium text-slate-700 mb-1">Title</label>
                  <input type="text" name="title" required class="w-full border rounded-lg p-2.5 text-sm">
                </div>
                <div>
                  <label class="block text-sm font-medium text-slate-700 mb-1">Content</label>
                  <textarea name="content" required rows="4" class="w-full border rounded-lg p-2.5 text-sm"></textarea>
                </div>
                <button type="submit" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 rounded-lg transition">Publish</button>
              </form>

              <div class="space-y-4 md:col-span-2">
                \${ann.rows.map(a => `
                  <div class="bg-white p-5 rounded-xl shadow border space-y-2">
                    <div class="flex justify-between items-start">
                      <h4 class="font-bold text-slate-800 text-lg">\${a.title}</h4>
                      <span class="text-xs text-slate-400">\${a.created_at.toISOString().split('T')[0]}</span>
                    </div>
                    <p class="text-slate-600 text-sm whitespace-pre-line">\${a.content}</p>
                    <div class="text-right"><a href="/admin/announcements/delete/\${a.id}" class="text-xs text-rose-600 hover:underline">Delete</a></div>
                  </div>
                `).join('') || '<div class="bg-white p-6 rounded-xl shadow border text-slate-400 text-center">No announcements posted yet.</div>'}
              </div>
            </div>
          </main>
        </div>
      </div>
    `));
  } catch (err) {
    res.status(500).send('Server Error');
  }
});

app.post('/admin/announcements', requireAdmin, async (req, res) => {
  const { title, content } = req.body;
  try {
    await pool.query('INSERT INTO announcements (title, content) VALUES ($1, $2)', [title, content]);
    res.redirect('/admin/announcements');
  } catch (err) {
    res.status(500).send('Error');
  }
});

app.get('/admin/announcements/delete/:id', requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM announcements WHERE id = $1', [req.params.id]);
    res.redirect('/admin/announcements');
  } catch (err) {
    res.status(500).send('Error');
  }
});

// Company Settings
app.get('/admin/settings', requireAdmin, async (req, res) => {
  try {
    const comp = res.locals.company;
    res.send(layout('Company Settings', `
      <div class="flex min-h-screen">
        \${adminNav('Company Settings')}
        <div class="flex-1 flex flex-col">
          \${adminHeader('Company Settings & Customization')}
          <main class="p-6 max-w-xl">
            <form action="/admin/settings" method="POST" class="bg-white p-6 rounded-xl shadow border space-y-4">
              <div>
                <label class="block text-sm font-medium text-slate-700 mb-1">Company / Builder Name</label>
                <input type="text" name="company_name" required value="\${comp.company_name || ''}" class="w-full border rounded-lg p-2.5 text-sm">
              </div>
              <div>
                <label class="block text-sm font-medium text-slate-700 mb-1">Company Logo URL (Render-compatible image URL)</label>
                <input type="text" name="company_logo" value="\${comp.company_logo || ''}" placeholder="https://example.com/logo.png" class="w-full border rounded-lg p-2.5 text-sm">
              </div>
              <div>
                <label class="block text-sm font-medium text-slate-700 mb-1">Company Address</label>
                <input type="text" name="company_address" required value="\${comp.company_address || ''}" class="w-full border rounded-lg p-2.5 text-sm">
              </div>
              <div>
                <label class="block text-sm font-medium text-slate-700 mb-1">Contact Number</label>
                <input type="text" name="contact_number" required value="\${comp.contact_number || ''}" class="w-full border rounded-lg p-2.5 text-sm">
              </div>
              <button type="submit" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 rounded-lg transition shadow">Save Settings</button>
            </form>
          </main>
        </div>
      </div>
    `));
  } catch (err) {
    res.status(500).send('Server Error');
  }
});

app.post('/admin/settings', requireAdmin, async (req, res) => {
  const { company_name, company_logo, company_address, contact_number } = req.body;
  try {
    await pool.query('UPDATE company_settings SET company_name = $1, company_logo = $2, company_address = $3, contact_number = $4', [company_name, company_logo, company_address, contact_number]);
    res.redirect('/admin/settings');
  } catch (err) {
    res.status(500).send('Error saving settings');
  }
});

// Work Schedule Settings
app.get('/admin/schedule', requireAdmin, async (req, res) => {
  try {
    const schedRes = await pool.query('SELECT * FROM work_schedules LIMIT 1');
    const sched = schedRes.rows[0];
    res.send(layout('Work Schedule Settings', `
      <div class="flex min-h-screen">
        \${adminNav('Work Schedule')}
        <div class="flex-1 flex flex-col">
          \${adminHeader('Work Schedule Configuration')}
          <main class="p-6 max-w-xl">
            <form action="/admin/schedule" method="POST" class="bg-white p-6 rounded-xl shadow border space-y-4">
              <div class="grid grid-cols-2 gap-4">
                <div>
                  <label class="block text-sm font-medium text-slate-700 mb-1">Morning Start</label>
                  <input type="text" name="morning_start" required value="\${sched.morning_start}" class="w-full border rounded-lg p-2.5 text-sm">
                </div>
                <div>
                  <label class="block text-sm font-medium text-slate-700 mb-1">Morning End</label>
                  <input type="text" name="morning_end" required value="\${sched.morning_end}" class="w-full border rounded-lg p-2.5 text-sm">
                </div>
              </div>
              <div class="grid grid-cols-2 gap-4">
                <div>
                  <label class="block text-sm font-medium text-slate-700 mb-1">Afternoon Start</label>
                  <input type="text" name="afternoon_start" required value="\${sched.afternoon_start}" class="w-full border rounded-lg p-2.5 text-sm">
                </div>
                <div>
                  <label class="block text-sm font-medium text-slate-700 mb-1">Afternoon End</label>
                  <input type="text" name="afternoon_end" required value="\${sched.afternoon_end}" class="w-full border rounded-lg p-2.5 text-sm">
                </div>
              </div>
              <button type="submit" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 rounded-lg transition shadow">Save Schedule</button>
            </form>
          </main>
        </div>
      </div>
    `));
  } catch (err) {
    res.status(500).send('Server Error');
  }
});

app.post('/admin/schedule', requireAdmin, async (req, res) => {
  const { morning_start, morning_end, afternoon_start, afternoon_end } = req.body;
  try {
    await pool.query('UPDATE work_schedules SET morning_start = $1, morning_end = $2, afternoon_start = $3, afternoon_end = $4', [morning_start, morning_end, afternoon_start, afternoon_end]);
    res.redirect('/admin/schedule');
  } catch (err) {
    res.status(500).send('Error');
  }
});

// Scanner Users Management by Admin
app.get('/admin/scanners', requireAdmin, async (req, res) => {
  try {
    const scanners = await pool.query("SELECT * FROM users WHERE role = 'SCANNER' ORDER BY id DESC");
    res.send(layout('Scanner Users', `
      <div class="flex min-h-screen">
        \${adminNav('Scanner Users')}
        <div class="flex-1 flex flex-col">
          \${adminHeader('Attendance Scanner Staff Accounts')}
          <main class="p-6 space-y-6">
            <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
              <form action="/admin/scanners" method="POST" class="bg-white p-6 rounded-xl shadow border space-y-4 md:col-span-1">
                <h3 class="font-bold text-slate-800">Add Scanner User</h3>
                <div>
                  <label class="block text-sm font-medium text-slate-700 mb-1">Full Name</label>
                  <input type="text" name="full_name" required class="w-full border rounded-lg p-2.5 text-sm">
                </div>
                <div>
                  <label class="block text-sm font-medium text-slate-700 mb-1">Username</label>
                  <input type="text" name="username" required class="w-full border rounded-lg p-2.5 text-sm">
                </div>
                <div>
                  <label class="block text-sm font-medium text-slate-700 mb-1">Email</label>
                  <input type="email" name="email" required class="w-full border rounded-lg p-2.5 text-sm">
                </div>
                <div>
                  <label class="block text-sm font-medium text-slate-700 mb-1">Password</label>
                  <input type="password" name="password" required class="w-full border rounded-lg p-2.5 text-sm">
                </div>
                <button type="submit" class="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-medium py-2.5 rounded-lg transition">Create Scanner Account</button>
              </form>

              <div class="bg-white rounded-xl shadow border overflow-hidden md:col-span-2">
                <table class="w-full text-left text-sm">
                  <thead class="bg-slate-50 border-b text-slate-500 font-semibold text-xs uppercase">
                    <tr>
                      <th class="p-4">Name</th>
                      <th class="p-4">Username</th>
                      <th class="p-4">Email</th>
                      <th class="p-4 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y">
                    \${scanners.rows.map(s => `
                      <tr class="hover:bg-slate-50">
                        <td class="p-4 font-medium">\${s.full_name}</td>
                        <td class="p-4">\${s.username}</td>
                        <td class="p-4">\${s.email}</td>
                        <td class="p-4 text-right"><a href="/admin/scanners/delete/\${s.id}" class="text-rose-600 hover:underline">Delete</a></td>
                      </tr>
                    `).join('') || '<tr><td colspan="4" class="p-4 text-center text-slate-400">No scanner staff accounts found.</td></tr>'}
                  </tbody>
                </table>
              </div>
            </div>
          </main>
        </div>
      </div>
    `));
  } catch (err) {
    res.status(500).send('Server Error');
  }
});

app.post('/admin/scanners', requireAdmin, async (req, res) => {
  const { full_name, username, email, password } = req.body;
  try {
    const password_hash = await bcrypt.hash(password, 10);
    await pool.query("INSERT INTO users (full_name, username, email, password_hash, role) VALUES ($1, $2, $3, $4, 'SCANNER')", [full_name, username, email, password_hash]);
    res.redirect('/admin/scanners');
  } catch (err) {
    res.status(500).send('Error creating scanner user');
  }
});

app.get('/admin/scanners/delete/:id', requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM users WHERE id = $1 AND role = \'SCANNER\'', [req.params.id]);
    res.redirect('/admin/scanners');
  } catch (err) {
    res.status(500).send('Error');
  }
});

// ==========================================
// WORKER PORTAL
// ==========================================

function workerNav(active) {
  const items = [
    { name: 'Home', href: '/worker/dashboard', icon: 'fa-house' },
    { name: 'My QR Code', href: '/worker/qrcode', icon: 'fa-qrcode' },
    { name: 'My Attendance', href: '/worker/attendance', icon: 'fa-calendar-days' },
    { name: 'My Advance', href: '/worker/advance', icon: 'fa-wallet' },
    { name: 'My Salary', href: '/worker/salary', icon: 'fa-peso-sign' },
    { name: 'Announcements', href: '/worker/announcements', icon: 'fa-bullhorn' },
    { name: 'Logout', href: '/logout', icon: 'fa-right-from-bracket' }
  ];

  let links = '';
  items.forEach(i => {
    const isActive = active === i.name ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100';
    links += `<a href="\${i.href}" class="flex items-center space-x-3 px-4 py-2.5 rounded-lg text-sm font-medium transition \${isActive}"><i class="fa-solid \${i.icon} w-5"></i><span>\${i.name}</span></a>`;
  });

  return `
    <aside class="w-64 bg-white border-r flex flex-col hidden md:flex shrink-0">
      <div class="p-6 border-b">
        <h2 class="font-bold text-slate-900 truncate">\${res.locals.company.company_name}</h2>
        <p class="text-xs text-slate-500">Worker Portal</p>
      </div>
      <nav class="flex-1 p-4 space-y-1">\${links}</nav>
    </aside>
  `;
}

app.get('/worker/dashboard', requireWorker, async (req, res) => {
  try {
    const workerRes = await pool.query('SELECT * FROM workers WHERE user_id = $1', [req.session.user.id]);
    if (workerRes.rows.length === 0) return res.send('Worker profile not found.');
    const w = workerRes.rows[0];
    const today = new Date().toISOString().split('T')[0];
    const logsRes = await pool.query('SELECT * FROM attendance_logs WHERE worker_id = $1 AND date = $2 ORDER BY time ASC', [w.worker_id, today]);
    const scheduleRes = await pool.query('SELECT * FROM work_schedules LIMIT 1');
    const status = calculateAttendanceStatus(logsRes.rows, scheduleRes.rows[0]);

    res.send(layout('Worker Dashboard', `
      <div class="flex min-h-screen">
        \${workerNav('Home')}
        <div class="flex-1 flex flex-col">
          <header class="bg-white border-b px-6 py-4 flex justify-between items-center">
            <h1 class="text-xl font-bold text-slate-800">Worker Dashboard</h1>
            <span class="text-sm font-medium text-slate-600">\${w.full_name} (\${w.worker_id})</span>
          </header>
          <main class="p-6 space-y-6">
            <div class="bg-white p-6 rounded-xl shadow border flex flex-col md:flex-row items-center gap-6">
              <div class="h-24 w-24 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-4xl font-bold"><i class="fa-solid fa-hard-hat"></i></div>
              <div class="space-y-1 flex-1">
                <h2 class="text-2xl font-bold text-slate-800">\${w.full_name}</h2>
                <p class="text-sm text-slate-600"><strong class="text-slate-700">Position:</strong> \${w.position}</p>
                <p class="text-sm text-slate-600"><strong class="text-slate-700">Project:</strong> \${w.assigned_project}</p>
                <p class="text-sm text-slate-600"><strong class="text-slate-700">Today's Status:</strong> <span class="px-2 py-0.5 rounded text-xs font-bold \${status === 'FULL DAY' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}">\${status}</span></p>
              </div>
            </div>
          </main>
        </div>
      </div>
    `));
  } catch (err) {
    res.status(500).send('Server Error');
  }
});

app.get('/worker/qrcode', requireWorker, async (req, res) => {
  try {
    const workerRes = await pool.query('SELECT * FROM workers WHERE user_id = $1', [req.session.user.id]);
    const w = workerRes.rows[0];
    res.send(layout('My QR Code', `
      <div class="flex min-h-screen">
        \${workerNav('My QR Code')}
        <div class="flex-1 flex flex-col">
          <header class="bg-white border-b px-6 py-4"><h1 class="text-xl font-bold text-slate-800">My Personal QR Code</h1></header>
          <main class="p-6">
            <div class="bg-white p-6 rounded-xl shadow border max-w-sm text-center space-y-4">
              <img src="\${w.qr_code}" alt="QR Code" class="w-64 h-64 mx-auto border p-2 rounded-lg bg-white">
              <h3 class="font-bold text-lg text-slate-800">\${w.full_name}</h3>
              <p class="text-sm font-semibold text-blue-600">ID: \${w.worker_id}</p>
              <a href="\${w.qr_code}" download="my-qr.png" class="inline-block w-full bg-blue-600 text-white font-medium py-2.5 rounded-lg text-sm">Download QR Code</a>
            </div>
          </main>
        </div>
      </div>
    `));
  } catch (err) {
    res.status(500).send('Server Error');
  }
});

app.get('/worker/attendance', requireWorker, async (req, res) => {
  try {
    const workerRes = await pool.query('SELECT * FROM workers WHERE user_id = $1', [req.session.user.id]);
    const w = workerRes.rows[0];
    const logsRes = await pool.query('SELECT date, json_agg(json_build_object(\'time\', time, \'type\', attendance_type) ORDER BY time ASC) as records FROM attendance_logs WHERE worker_id = $1 GROUP BY date ORDER BY date DESC', [w.worker_id]);
    const scheduleRes = await pool.query('SELECT * FROM work_schedules LIMIT 1');
    const sched = scheduleRes.rows[0];

    res.send(layout('My Attendance', `
      <div class="flex min-h-screen">
        \${workerNav('My Attendance')}
        <div class="flex-1 flex flex-col">
          <header class="bg-white border-b px-6 py-4"><h1 class="text-xl font-bold text-slate-800">My Attendance History</h1></header>
          <main class="p-6">
            <div class="bg-white rounded-xl shadow border overflow-hidden">
              <table class="w-full text-left text-sm">
                <thead class="bg-slate-50 border-b text-slate-500 font-semibold text-xs uppercase">
                  <tr>
                    <th class="p-4">Date</th>
                    <th class="p-4">Records</th>
                    <th class="p-4">Total Hours</th>
                    <th class="p-4">Status</th>
                  </tr>
                </thead>
                <tbody class="divide-y">
                  \${logsRes.rows.map(row => {
                    const dayLogs = row.records;
                    const hours = calculateWorkingHours(dayLogs.map(d => ({ attendance_type: d.type, time: d.time })));
                    const status = calculateAttendanceStatus(dayLogs.map(d => ({ attendance_type: d.type, time: d.time })), sched);
                    return `
                      <tr class="hover:bg-slate-50">
                        <td class="p-4 font-medium">\${row.date.toISOString().split('T')[0]}</td>
                        <td class="p-4 font-mono text-xs">\${dayLogs.map(d => `[\${d.type} \${d.time}]`).join(' &rarr; ')}</td>
                        <td class="p-4">\${hours} hrs</td>
                        <td class="p-4"><span class="px-2.5 py-1 rounded text-xs font-bold \${status === 'FULL DAY' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}">\${status}</span></td>
                      </tr>
                    `;
                  }).join('') || '<tr><td colspan="4" class="p-4 text-center text-slate-400">No attendance logs found.</td></tr>'}
                </tbody>
              </table>
            </div>
          </main>
        </div>
      </div>
    `));
  } catch (err) {
    res.status(500).send('Server Error');
  }
});

app.get('/worker/advance', requireWorker, async (req, res) => {
  try {
    const workerRes = await pool.query('SELECT * FROM workers WHERE user_id = $1', [req.session.user.id]);
    const w = workerRes.rows[0];
    const advRes = await pool.query('SELECT * FROM advance_money WHERE worker_id = $1 ORDER BY date DESC', [w.worker_id]);
    const totalAdv = advRes.rows.reduce((acc, curr) => acc + Number(curr.amount), 0);

    res.send(layout('My Advance Money', `
      <div class="flex min-h-screen">
        \${workerNav('My Advance')}
        <div class="flex-1 flex flex-col">
          <header class="bg-white border-b px-6 py-4"><h1 class="text-xl font-bold text-slate-800">My Cash Advance History</h1></header>
          <main class="p-6 space-y-6">
            <div class="bg-white p-5 rounded-xl shadow border max-w-sm">
              <p class="text-xs font-semibold text-slate-400 uppercase">Total Remaining Advance Balance</p>
              <h3 class="text-2xl font-bold text-rose-600 mt-1">₱\${totalAdv.toFixed(2)}</h3>
            </div>
            <div class="bg-white rounded-xl shadow border overflow-hidden">
              <table class="w-full text-left text-sm">
                <thead class="bg-slate-50 border-b text-slate-500 font-semibold text-xs uppercase">
                  <tr><th class="p-4">Date</th><th class="p-4">Amount</th><th class="p-4">Reason</th></tr>
                </thead>
                <tbody class="divide-y">
                  \${advRes.rows.map(a => `
                    <tr class="hover:bg-slate-50">
                      <td class="p-4">\${a.date.toISOString().split('T')[0]}</td>
                      <td class="p-4 font-bold text-rose-600">₱\${Number(a.amount).toFixed(2)}</td>
                      <td class="p-4 text-slate-500">\${a.reason || '-'}</td>
                    </tr>
                  `).join('') || '<tr><td colspan="3" class="p-4 text-center text-slate-400">No advance records.</td></tr>'}
                </tbody>
              </table>
            </div>
          </main>
        </div>
      </div>
    `));
  } catch (err) {
    res.status(500).send('Server Error');
  }
});

app.get('/worker/salary', requireWorker, async (req, res) => {
  try {
    const workerRes = await pool.query('SELECT * FROM workers WHERE user_id = $1', [req.session.user.id]);
    const w = workerRes.rows[0];
    const scheduleRes = await pool.query('SELECT * FROM work_schedules LIMIT 1');
    const sched = scheduleRes.rows[0];

    const logsRes = await pool.query('SELECT DISTINCT date FROM attendance_logs WHERE worker_id = $1', [w.worker_id]);
    let fullDays = 0;
    let halfDays = 0;
    for (let row of logsRes.rows) {
      const dayLogs = await pool.query('SELECT * FROM attendance_logs WHERE worker_id = $1 AND date = $2 ORDER BY time ASC', [w.worker_id, row.date]);
      const st = calculateAttendanceStatus(dayLogs.rows, sched);
      if (st === 'FULL DAY') fullDays++;
      if (st === 'HALF DAY') halfDays++;
    }

    const equivDays = fullDays + (halfDays * 0.5);
    const totalSalary = equivDays * Number(w.daily_rate);
    const advRes = await pool.query('SELECT SUM(amount) as total FROM advance_money WHERE worker_id = $1', [w.worker_id]);
    const advanceTotal = Number(advRes.rows[0].total || 0);
    const netSalary = totalSalary - advanceTotal;

    res.send(layout('My Salary', `
      <div class="flex min-h-screen">
        \${workerNav('My Salary')}
        <div class="flex-1 flex flex-col">
          <header class="bg-white border-b px-6 py-4"><h1 class="text-xl font-bold text-slate-800">My Salary & Earnings</h1></header>
          <main class="p-6 max-w-xl">
            <div class="bg-white p-6 rounded-xl shadow border space-y-4">
              <div class="flex justify-between border-b pb-3"><span class="text-slate-600">Daily Rate:</span><span class="font-bold">₱\${Number(w.daily_rate).toFixed(2)}</span></div>
              <div class="flex justify-between border-b pb-3"><span class="text-slate-600">Full Days Worked:</span><span class="font-bold">\${fullDays}</span></div>
              <div class="flex justify-between border-b pb-3"><span class="text-slate-600">Half Days Worked:</span><span class="font-bold">\${halfDays}</span></div>
              <div class="flex justify-between border-b pb-3"><span class="text-slate-600">Equivalent Days:</span><span class="font-bold">\${equivDays}</span></div>
              <div class="flex justify-between border-b pb-3"><span class="text-slate-600">Total Salary:</span><span class="font-bold">₱\${totalSalary.toFixed(2)}</span></div>
              <div class="flex justify-between border-b pb-3"><span class="text-slate-600">Advance Deduction:</span><span class="font-bold text-rose-600">-₱\${advanceTotal.toFixed(2)}</span></div>
              <div class="flex justify-between pt-2 text-lg"><span class="font-bold text-slate-900">Net Salary:</span><span class="font-bold text-emerald-600">₱\${netSalary.toFixed(2)}</span></div>
            </div>
          </main>
        </div>
      </div>
    `));
  } catch (err) {
    res.status(500).send('Server Error');
  }
});

app.get('/worker/announcements', requireWorker, async (req, res) => {
  try {
    const ann = await pool.query('SELECT * FROM announcements ORDER BY created_at DESC');
    res.send(layout('Announcements', `
      <div class="flex min-h-screen">
        \${workerNav('Announcements')}
        <div class="flex-1 flex flex-col">
          <header class="bg-white border-b px-6 py-4"><h1 class="text-xl font-bold text-slate-800">Company Announcements</h1></header>
          <main class="p-6 space-y-4 max-w-2xl">
            \${ann.rows.map(a => `
              <div class="bg-white p-5 rounded-xl shadow border space-y-2">
                <div class="flex justify-between"><h4 class="font-bold text-slate-800">\${a.title}</h4><span class="text-xs text-slate-400">\${a.created_at.toISOString().split('T')[0]}</span></div>
                <p class="text-slate-600 text-sm whitespace-pre-line">\${a.content}</p>
              </div>
            `).join('') || '<div class="bg-white p-6 rounded-xl shadow border text-slate-400 text-center">No announcements.</div>'}
          </main>
        </div>
      </div>
    `));
  } catch (err) {
    res.status(500).send('Server Error');
  }
});

// ==========================================
// ATTENDANCE SCANNER PORTAL
// ==========================================

function scannerNav(active) {
  const items = [
    { name: 'Dashboard', href: '/scanner/dashboard', icon: 'fa-chart-pie' },
    { name: 'Scan QR Code', href: '/scanner/scan', icon: 'fa-qrcode' },
    { name: 'Today Attendance', href: '/scanner/today', icon: 'fa-clipboard-user' },
    { name: 'Logout', href: '/logout', icon: 'fa-right-from-bracket' }
  ];

  let links = '';
  items.forEach(i => {
    const isActive = active === i.name ? 'bg-emerald-600 text-white' : 'text-slate-600 hover:bg-slate-100';
    links += `<a href="\${i.href}" class="flex items-center space-x-3 px-4 py-2.5 rounded-lg text-sm font-medium transition \${isActive}"><i class="fa-solid \${i.icon} w-5"></i><span>\${i.name}</span></a>`;
  });

  return `
    <aside class="w-64 bg-white border-r flex flex-col hidden md:flex shrink-0">
      <div class="p-6 border-b">
        <h2 class="font-bold text-slate-900 truncate">\${res.locals.company.company_name}</h2>
        <p class="text-xs text-slate-500">Scanner Portal</p>
      </div>
      <nav class="flex-1 p-4 space-y-1">\${links}</nav>
    </aside>
  `;
}

app.get('/scanner/dashboard', requireScanner, async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const presentCount = await pool.query('SELECT COUNT(DISTINCT worker_id) FROM attendance_logs WHERE date = $1', [today]);
    res.send(layout('Scanner Dashboard', `
      <div class="flex min-h-screen">
        \${scannerNav('Dashboard')}
        <div class="flex-1 flex flex-col">
          <header class="bg-white border-b px-6 py-4 flex justify-between items-center"><h1 class="text-xl font-bold text-slate-800">Scanner Dashboard</h1><span class="text-sm font-medium text-slate-600">\${today}</span></header>
          <main class="p-6">
            <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div class="bg-white p-6 rounded-xl shadow border">
                <p class="text-xs font-semibold text-slate-400 uppercase">Workers Present Today</p>
                <h3 class="text-3xl font-bold text-emerald-600 mt-2">\${presentCount.rows[0].count}</h3>
              </div>
            </div>
            <div class="mt-8">
              <a href="/scanner/scan" class="inline-block bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-8 py-4 rounded-xl shadow-lg text-lg"><i class="fa-solid fa-qrcode mr-2"></i> Open QR Scanner Tool</a>
            </div>
          </main>
        </div>
      </div>
    `));
  } catch (err) {
    res.status(500).send('Server Error');
  }
});

// Scan QR Code page with mandatory IN / OUT selection & sequence validation
app.get('/scanner/scan', requireScanner, (req, res) => {
  res.send(layout('Scan QR Code', `
    <div class="flex min-h-screen">
      \${scannerNav('Scan QR Code')}
      <div class="flex-1 flex flex-col">
        <header class="bg-white border-b px-6 py-4"><h1 class="text-xl font-bold text-slate-800">Attendance QR Scanner</h1></header>
        <main class="p-6 max-w-xl">
          <div class="bg-white p-6 rounded-xl shadow border space-y-6">
            <div id="selection-step" class="space-y-4">
              <h3 class="font-bold text-slate-800 text-center text-lg">Step 1: Select Attendance Type First</h3>
              <div class="grid grid-cols-2 gap-4">
                <button onclick="selectType('IN')" id="btn-in" class="py-6 border-2 border-slate-200 rounded-xl font-bold text-lg hover:border-emerald-600 hover:text-emerald-600 transition flex flex-col items-center justify-center space-y-2">
                  <i class="fa-solid fa-right-to-bracket text-3xl"></i>
                  <span>TIME IN</span>
                </button>
                <button onclick="selectType('OUT')" id="btn-out" class="py-6 border-2 border-slate-200 rounded-xl font-bold text-lg hover:border-rose-600 hover:text-rose-600 transition flex flex-col items-center justify-center space-y-2">
                  <i class="fa-solid fa-right-from-bracket text-3xl"></i>
                  <span>TIME OUT</span>
                </button>
              </div>
            </div>

            <div id="scan-step" class="hidden space-y-4 text-center">
              <div class="p-3 bg-blue-50 text-blue-800 rounded-lg text-sm font-medium flex justify-between items-center">
                <span>Selected Type: <strong id="selected-type-label" class="uppercase"></strong></span>
                <button onclick="resetSelection()" class="text-xs underline text-blue-600">Change</button>
              </div>
              <div class="space-y-2">
                <label class="block text-sm font-medium text-slate-700">Scan or Enter Worker ID</label>
                <input type="text" id="worker_id_input" placeholder="e.g. W-001" class="w-full border rounded-lg p-3 text-center text-lg font-mono">
                <button onclick="submitScan()" class="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 rounded-lg shadow transition">Process QR Scan</button>
              </div>
            </div>

            <div id="result-box" class="hidden p-4 rounded-xl text-center"></div>
          </div>
        </main>
      </div>
    </div>
    <script>
      let selectedAttendanceType = '';
      function selectType(type) {
        selectedAttendanceType = type;
        document.getElementById('selected-type-label').innerText = type;
        document.getElementById('selection-step').classList.add('hidden');
        document.getElementById('scan-step').classList.remove('hidden');
        document.getElementById('worker_id_input').focus();
      }
      function resetSelection() {
        selectedAttendanceType = '';
        document.getElementById('scan-step').classList.add('hidden');
        document.getElementById('selection-step').classList.remove('hidden');
        document.getElementById('result-box').classList.add('hidden');
        document.getElementById('worker_id_input').value = '';
      }
      async function submitScan() {
        const worker_id = document.getElementById('worker_id_input').value.trim();
        if (!worker_id) { alert('Please enter or scan Worker ID'); return; }
        
        const res = await fetch('/api/scanner/record', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ worker_id, attendance_type: selectedAttendanceType })
        });
        const data = await res.json();
        const box = document.getElementById('result-box');
        box.classList.remove('hidden');
        if (data.success) {
          box.className = 'p-4 rounded-xl text-center bg-emerald-50 text-emerald-800 border border-emerald-200';
          box.innerHTML = \`<h4 class="font-bold text-lg mb-1">ATTENDANCE RECORDED SUCCESSFULLY</h4><p class="text-sm">Name: \${data.worker.full_name}</p><p class="text-sm">Position: \${data.worker.position}</p><p class="text-sm font-bold mt-2">Type: \${data.attendance_type} at \${data.time}</p>\`;
          document.getElementById('worker_id_input').value = '';
          setTimeout(() => { box.classList.add('hidden'); }, 4000);
        } else {
          box.className = 'p-4 rounded-xl text-center bg-rose-50 text-rose-800 border border-rose-200';
          box.innerHTML = \`<h4 class="font-bold text-lg mb-1">Error</h4><p class="text-sm">\${data.message}</p>\`;
        }
      }
    </script>
  `));
});

// API endpoint for scanning validation & insertion with sequence verification (IN -> OUT -> IN -> OUT)
app.post('/api/scanner/record', requireScanner, async (req, res) => {
  const { worker_id, attendance_type } = req.body;
  try {
    const workerRes = await pool.query('SELECT * FROM workers WHERE worker_id = $1', [worker_id]);
    if (workerRes.rows.length === 0) return res.json({ success: false, message: 'Worker Not Found or Invalid QR Code' });
    const worker = workerRes.rows[0];
    if (!worker.is_active) return res.json({ success: false, message: 'Worker Account is Inactive' });

    const today = new Date().toISOString().split('T')[0];
    const logsRes = await pool.query('SELECT * FROM attendance_logs WHERE worker_id = $1 AND date = $2 ORDER BY time ASC', [worker_id, today]);
    const existingLogs = logsRes.rows;

    // Sequence validations
    if (existingLogs.length === 0 && attendance_type === 'OUT') {
      return res.json({ success: false, message: 'Cannot Record OUT as First Attendance' });
    }
    if (existingLogs.length > 0) {
      const lastType = existingLogs[existingLogs.length - 1].attendance_type;
      if (lastType === 'IN' && attendance_type === 'IN') {
        return res.json({ success: false, message: 'Cannot Record Two Consecutive IN' });
      }
      if (lastType === 'OUT' && attendance_type === 'OUT') {
        return res.json({ success: false, message: 'Cannot Record Two Consecutive OUT' });
      }
    }

    const timeNow = new Date().toTimeString().split(' ')[0];
    await pool.query('INSERT INTO attendance_logs (worker_id, date, time, attendance_type) VALUES ($1, $2, $3, $4)', [worker_id, today, timeNow, attendance_type]);

    res.json({ success: true, worker, attendance_type, time: timeNow });
  } catch (err) {
    console.error(err);
    res.json({ success: false, message: 'Database error recording attendance' });
  }
});

app.get('/scanner/today', requireScanner, async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const logs = await pool.query('SELECT l.*, w.full_name, w.position FROM attendance_logs l JOIN workers w ON l.worker_id = w.worker_id WHERE l.date = $1 ORDER BY l.time DESC', [today]);

    res.send(layout('Today Attendance', `
      <div class="flex min-h-screen">
        \${scannerNav('Today Attendance')}
        <div class="flex-1 flex flex-col">
          <header class="bg-white border-b px-6 py-4"><h1 class="text-xl font-bold text-slate-800">Today's Attendance Logs</h1></header>
          <main class="p-6">
            <div class="bg-white rounded-xl shadow border overflow-hidden">
              <table class="w-full text-left text-sm">
                <thead class="bg-slate-50 border-b text-slate-500 font-semibold text-xs uppercase">
                  <tr><th class="p-4">Worker</th><th class="p-4">Position</th><th class="p-4">Type</th><th class="p-4">Time</th></tr>
                </thead>
                <tbody class="divide-y">
                  \${logs.rows.map(l => `
                    <tr class="hover:bg-slate-50">
                      <td class="p-4 font-medium">\${l.full_name} <span class="text-xs text-slate-400">(\${l.worker_id})</span></td>
                      <td class="p-4">\${l.position}</td>
                      <td class="p-4"><span class="px-2 py-1 rounded text-xs font-bold \${l.attendance_type === 'IN' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}">\${l.attendance_type}</span></td>
                      <td class="p-4">\${l.time}</td>
                    </tr>
                  `).join('') || '<tr><td colspan="4" class="p-4 text-center text-slate-400">No attendance scanned today yet.</td></tr>'}
                </tbody>
              </table>
            </div>
          </main>
        </div>
      </div>
    `));
  } catch (err) {
    res.status(500).send('Server Error');
  }
});

// Start Server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
