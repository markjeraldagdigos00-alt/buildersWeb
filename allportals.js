const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const { Pool } = require('pg');
const QRCode = require('qrcode');

const app = express();
const PORT = process.env.PORT || 3000;

// PostgreSQL Connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'construction_secret_key_999',
  resave: false,
  saveUninitialized: false
}));

// Initialize Database Tables
async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        full_name VARCHAR(255) NOT NULL,
        username VARCHAR(100) UNIQUE NOT NULL,
        email VARCHAR(255) UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        role VARCHAR(50) NOT NULL,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS company_settings (
        id SERIAL PRIMARY KEY,
        company_name VARCHAR(255) DEFAULT 'Builder Construction',
        logo_data TEXT DEFAULT '',
        address VARCHAR(255) DEFAULT '123 Construction St.',
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
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
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

    // Insert default settings if empty
    const csCheck = await pool.query('SELECT * FROM company_settings');
    if (csCheck.rows.length === 0) {
      await pool.query('INSERT INTO company_settings (company_name, address, contact_number) VALUES ($1, $2, $3)', 
        ['Apex Builders Inc.', 'Main Site, Metro Manila', '+63 912 345 6789']);
    }

    const wsCheck = await pool.query('SELECT * FROM work_schedules');
    if (wsCheck.rows.length === 0) {
      await pool.query('INSERT INTO work_schedules (morning_start, morning_end, afternoon_start, afternoon_end, full_day_hours, half_day_hours) VALUES ($1, $2, $3, $4, $5, $6)',
        ['07:00', '12:00', '13:00', '17:00', 8, 4]);
    }

    console.log('Database initialized successfully.');
  } catch (err) {
    console.error('Database initialization error:', err);
  }
}
initDB();

// Helper to get company settings
async function getCompanySettings() {
  const res = await pool.query('SELECT * FROM company_settings LIMIT 1');
  return res.rows[0] || { company_name: 'Builder Construction', logo_data: '', address: '', contact_number: '' };
}

// Middleware
function isAuthenticated(req, res, next) {
  if (req.session && req.session.user) return next();
  res.redirect('/admin');
}

function requireRole(role) {
  return (req, res, next) => {
    if (req.session && req.session.user && req.session.user.role === role) {
      return next();
    }
    if (!req.session || !req.session.user) {
      if (role === 'ADMIN') return res.redirect('/admin');
      if (role === 'WORKER') return res.redirect('/worker');
      if (role === 'SCANNER') return res.redirect('/scanner');
    }
    res.status(403).send(`
      <html><head><title>Access Denied</title><link href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css" rel="stylesheet"></head>
      <body class="bg-gray-100 flex items-center justify-center h-screen">
        <div class="bg-white p-8 rounded shadow-md text-center">
          <h1 class="text-2xl font-bold text-red-600 mb-4">Access Denied</h1>
          <p class="text-gray-700 mb-6">You do not have permission to access this portal.</p>
          <a href="/" class="bg-blue-600 text-white px-4 py-2 rounded">Go Home</a>
        </div>
      </body></html>
    `);
  };
}

// Helper: Calculate attendance details
function calculateWorkingHours(logs) {
  // logs should be sorted by time ascending
  if (!logs || logs.length === 0) return { totalHours: 0, status: 'ABSENT', firstIn: '-', firstOut: '-', secondIn: '-', finalOut: '-' };
  
  let totalMinutes = 0;
  let inTime = null;
  let firstIn = '-';
  let firstOut = '-';
  let secondIn = '-';
  let finalOut = '-';
  let pairCount = 0;

  logs.forEach((log, index) => {
    const timeStr = log.time; // HH:MM:SS
    const [h, m] = timeStr.split(':').map(Number);
    const minutes = h * 60 + m;

    if (log.attendance_type === 'IN') {
      if (!inTime) {
        inTime = minutes;
        if (pairCount === 0) firstIn = timeStr.substring(0,5);
        if (pairCount === 1) secondIn = timeStr.substring(0,5);
      }
    } else if (log.attendance_type === 'OUT' && inTime !== null) {
      let diff = minutes - inTime;
      if (diff > 0) totalMinutes += diff;
      if (pairCount === 0) firstOut = timeStr.substring(0,5);
      finalOut = timeStr.substring(0,5);
      inTime = null;
      pairCount++;
    }
  });

  const totalHours = parseFloat((totalMinutes / 60).toFixed(2));
  let status = 'PRESENT';
  if (inTime !== null && pairCount === 0) status = 'INCOMPLETE';
  else if (totalHours >= 7) status = 'FULL DAY';
  else if (totalHours >= 3) status = 'HALF DAY';
  else if (totalHours > 0) status = 'PRESENT';
  else status = 'ABSENT';

  return { totalHours, status, firstIn, firstOut, secondIn, finalOut };
}

// ==================== ROUTES ====================

// 1. MAIN PAGE /
app.get('/', async (req, res) => {
  const adminCheck = await pool.query('SELECT * FROM users WHERE role = $1 LIMIT 1', ['ADMIN']);
  const company = await getCompanySettings();
  const hasAdmin = adminCheck.rows.length > 0;

  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>${company.company_name} - Portal Selection</title>
      <link href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css" rel="stylesheet">
    </head>
    <body class="bg-gray-900 text-white flex flex-col items-center justify-center min-h-screen">
      <div class="text-center max-w-xl p-8 bg-gray-800 rounded-xl shadow-2xl border border-gray-700">
        ${company.logo_data ? `<img src="${company.logo_data}" alt="Logo" class="w-24 h-24 mx-auto mb-4 object-contain rounded-full bg-white p-2">` : '<div class="w-24 h-24 mx-auto mb-4 bg-blue-600 rounded-full flex items-center text-3xl font-bold justify-center">🏗️</div>'}
        <h1 class="text-3xl font-extrabold mb-2">${company.company_name}</h1>
        <p class="text-gray-400 mb-8">Construction Worker Management System</p>
        
        <div class="space-y-4">
          ${!hasAdmin ? `
            <a href="/setup" class="block w-full bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-6 rounded-lg text-lg transition shadow-lg">
              SET UP SYSTEM (FIRST ADMIN)
            </a>
          ` : `
            <a href="/admin" class="block w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-lg text-lg transition shadow-lg">
              ADMIN PORTAL
            </a>
            <a href="/worker" class="block w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 px-6 rounded-lg text-lg transition shadow-lg">
              WORKER PORTAL
            </a>
            <a href="/scanner" class="block w-full bg-yellow-600 hover:bg-yellow-700 text-white font-bold py-3 px-6 rounded-lg text-lg transition shadow-lg">
              ATTENDANCE SCANNER
            </a>
          `}
        </div>
      </div>
    </body>
    </html>
  `);
});

// 2. FIRST TIME SETUP /setup
app.get('/setup', async (req, res) => {
  const adminCheck = await pool.query('SELECT * FROM users WHERE role = $1 LIMIT 1', ['ADMIN']);
  if (adminCheck.rows.length > 0) return res.redirect('/admin');
  
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8"><title>First-Time Admin Setup</title>
      <link href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css" rel="stylesheet">
    </head>
    <body class="bg-gray-100 flex items-center justify-center min-h-screen">
      <div class="bg-white p-8 rounded-lg shadow-md w-full max-w-md">
        <h2 class="text-2xl font-bold mb-6 text-gray-800 text-center">First-Time Admin Setup</h2>
        <form action="/setup" method="POST" class="space-y-4">
          <div>
            <label class="block text-gray-700 text-sm font-bold mb-2">Full Name</label>
            <input type="text" name="full_name" required class="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
          </div>
          <div>
            <label class="block text-gray-700 text-sm font-bold mb-2">Username</label>
            <input type="text" name="username" required class="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
          </div>
          <div>
            <label class="block text-gray-700 text-sm font-bold mb-2">Email Address</label>
            <input type="email" name="email" required class="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
          </div>
          <div>
            <label class="block text-gray-700 text-sm font-bold mb-2">Password</label>
            <input type="password" name="password" required class="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
          </div>
          <div>
            <label class="block text-gray-700 text-sm font-bold mb-2">Confirm Password</label>
            <input type="password" name="confirm_password" required class="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
          </div>
          <button type="submit" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg transition">Create Admin Account</button>
        </form>
      </div>
    </body>
    </html>
  `);
});

app.post('/setup', async (req, res) => {
  const adminCheck = await pool.query('SELECT * FROM users WHERE role = $1 LIMIT 1', ['ADMIN']);
  if (adminCheck.rows.length > 0) return res.redirect('/admin');

  const { full_name, username, email, password, confirm_password } = req.body;
  if (!full_name || !username || !email || !password || password !== confirm_password) {
    return res.send('<script>alert("Invalid input or passwords do not match."); window.history.back();</script>');
  }

  try {
    const hash = await bcrypt.hash(password, 10);
    const newAdmin = await pool.query(
      'INSERT INTO users (full_name, username, email, password_hash, role) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [full_name, username, email, hash, 'ADMIN']
    );
    req.session.user = newAdmin.rows[0];
    res.redirect('/admin/company-setup');
  } catch (err) {
    res.send(`<script>alert("Error: ${err.message}"); window.history.back();</script>`);
  }
});

app.get('/admin/company-setup', isAuthenticated, requireRole('ADMIN'), async (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8"><title>Company Information Setup</title>
      <link href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css" rel="stylesheet">
    </head>
    <body class="bg-gray-100 flex items-center justify-center min-h-screen">
      <div class="bg-white p-8 rounded-lg shadow-md w-full max-w-md">
        <h2 class="text-2xl font-bold mb-6 text-gray-800 text-center">Company Information Setup</h2>
        <form action="/admin/company-setup" method="POST" class="space-y-4">
          <div>
            <label class="block text-gray-700 text-sm font-bold mb-2">Company Name</label>
            <input type="text" name="company_name" required value="Apex Builders Inc." class="w-full px-3 py-2 border rounded-lg">
          </div>
          <div>
            <label class="block text-gray-700 text-sm font-bold mb-2">Company Logo URL / Data URI</label>
            <input type="text" name="logo_data" placeholder="https://example.com/logo.png" class="w-full px-3 py-2 border rounded-lg">
          </div>
          <div>
            <label class="block text-gray-700 text-sm font-bold mb-2">Company Address</label>
            <input type="text" name="address" required value="Metro Manila, Philippines" class="w-full px-3 py-2 border rounded-lg">
          </div>
          <div>
            <label class="block text-gray-700 text-sm font-bold mb-2">Contact Number</label>
            <input type="text" name="contact_number" required value="+63 900 000 0000" class="w-full px-3 py-2 border rounded-lg">
          </div>
          <button type="submit" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg">Save & Continue</button>
        </form>
      </div>
    </body>
    </html>
  `);
});

app.post('/admin/company-setup', isAuthenticated, requireRole('ADMIN'), async (req, res) => {
  const { company_name, logo_data, address, contact_number } = req.body;
  await pool.query('UPDATE company_settings SET company_name=$1, logo_data=$2, address=$3, contact_number=$4', [company_name, logo_data, address, contact_number]);
  res.redirect('/admin/dashboard');
});

// ==================== AUTHENTICATION LOGIN / LOGOUT ====================

app.get('/admin', async (req, res) => {
  const adminCheck = await pool.query('SELECT * FROM users WHERE role = $1 LIMIT 1', ['ADMIN']);
  if (adminCheck.rows.length === 0) return res.redirect('/setup');
  if (req.session.user && req.session.user.role === 'ADMIN') return res.redirect('/admin/dashboard');

  const company = await getCompanySettings();
  res.send(loginPageTemplate('Admin Portal', '/admin', company));
});

app.post('/admin', async (req, res) => {
  const { username, password } = req.body;
  const userRes = await pool.query('SELECT * FROM users WHERE (username = $1 OR email = $1) AND role = $2', [username, 'ADMIN']);
  if (userRes.rows.length > 0) {
    const user = userRes.rows[0];
    if (await bcrypt.compare(password, user.password_hash)) {
      if (!user.is_active) return res.send('<script>alert("Account is inactive."); window.history.back();</script>');
      req.session.user = user;
      return res.redirect('/admin/dashboard');
    }
  }
  res.send('<script>alert("Invalid credentials."); window.history.back();</script>');
});

app.get('/worker', async (req, res) => {
  if (req.session.user && req.session.user.role === 'WORKER') return res.redirect('/worker/dashboard');
  const company = await getCompanySettings();
  res.send(loginPageTemplate('Worker Portal', '/worker', company));
});

app.post('/worker', async (req, res) => {
  const { username, password } = req.body;
  const userRes = await pool.query('SELECT * FROM users WHERE (username = $1 OR email = $1) AND role = $2', [username, 'WORKER']);
  if (userRes.rows.length > 0) {
    const user = userRes.rows[0];
    if (await bcrypt.compare(password, user.password_hash)) {
      if (!user.is_active) return res.send('<script>alert("Account is inactive."); window.history.back();</script>');
      req.session.user = user;
      return res.redirect('/worker/dashboard');
    }
  }
  res.send('<script>alert("Invalid credentials."); window.history.back();</script>');
});

app.get('/scanner', async (req, res) => {
  if (req.session.user && req.session.user.role === 'SCANNER') return res.redirect('/scanner/dashboard');
  const company = await getCompanySettings();
  res.send(loginPageTemplate('Scanner Portal', '/scanner', company));
});

app.post('/scanner', async (req, res) => {
  const { username, password } = req.body;
  const userRes = await pool.query('SELECT * FROM users WHERE (username = $1 OR email = $1) AND role = $2', [username, 'SCANNER']);
  if (userRes.rows.length > 0) {
    const user = userRes.rows[0];
    if (await bcrypt.compare(password, user.password_hash)) {
      if (!user.is_active) return res.send('<script>alert("Account is inactive."); window.history.back();</script>');
      req.session.user = user;
      return res.redirect('/scanner/dashboard');
    }
  }
  res.send('<script>alert("Invalid credentials."); window.history.back();</script>');
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/');
  });
});

function loginPageTemplate(title, actionUrl, company) {
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8"><title>${title} - ${company.company_name}</title>
      <link href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css" rel="stylesheet">
    </head>
    <body class="bg-gray-100 flex items-center justify-center min-h-screen">
      <div class="bg-white p-8 rounded-lg shadow-md w-full max-w-md text-center">
        ${company.logo_data ? `<img src="${company.logo_data}" class="w-16 h-16 mx-auto mb-4 object-contain">` : ''}
        <h2 class="text-2xl font-bold mb-1 text-gray-800">${title}</h2>
        <p class="text-sm text-gray-500 mb-6">${company.company_name}</p>
        <form action="${actionUrl}" method="POST" class="space-y-4 text-left">
          <div>
            <label class="block text-gray-700 text-sm font-bold mb-2">Username or Email</label>
            <input type="text" name="username" required class="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
          </div>
          <div>
            <label class="block text-gray-700 text-sm font-bold mb-2">Password</label>
            <input type="password" name="password" required class="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
          </div>
          <button type="submit" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg transition">Login</button>
        </form>
        <div class="mt-4"><a href="/" class="text-sm text-blue-600 hover:underline">&larr; Back to Main Page</a></div>
      </div>
    </body>
    </html>
  `;
}

// ==================== ADMIN PORTAL ====================

app.get('/admin/dashboard', isAuthenticated, requireRole('ADMIN'), async (req, res) => {
  const company = await getCompanySettings();
  const today = new Date().toISOString().split('T')[0];

  const workersCount = await pool.query('SELECT COUNT(*) FROM workers');
  const totalWorkers = parseInt(workersCount.rows[0].count);

  const todayLogsRes = await pool.query('SELECT * FROM attendance_logs WHERE date = $1 ORDER BY time ASC', [today]);
  const logsByWorker = {};
  todayLogsRes.rows.forEach(l => {
    if (!logsByWorker[l.worker_id]) logsByWorker[l.worker_id] = [];
    logsByWorker[l.worker_id].push(l);
  });

  let presentToday = 0;
  let fullDayToday = 0;
  let halfDayToday = 0;
  let absentToday = totalWorkers;

  Object.keys(logsByWorker).forEach(wid => {
    const calc = calculateWorkingHours(logsByWorker[wid]);
    if (calc.status !== 'ABSENT') {
      presentToday++;
      absentToday--;
    }
    if (calc.status === 'FULL DAY') fullDayToday++;
    if (calc.status === 'HALF DAY') halfDayToday++;
  });

  const recentLogs = await pool.query(`
    SELECT l.*, w.full_name, w.position FROM attendance_logs l
    JOIN workers w ON l.worker_id = w.worker_id
    ORDER BY l.date DESC, l.time DESC LIMIT 10
  `);

  res.send(adminLayout('Dashboard', company, req.session.user, `
    <div class="grid grid-cols-1 md:grid-cols-5 gap-4 mb-6">
      <div class="bg-white p-4 rounded-lg shadow border-l-4 border-blue-500">
        <p class="text-gray-500 text-sm font-bold">Total Workers</p>
        <h3 class="text-3xl font-extrabold text-gray-800">${totalWorkers}</h3>
      </div>
      <div class="bg-white p-4 rounded-lg shadow border-l-4 border-green-500">
        <p class="text-gray-500 text-sm font-bold">Present Today</p>
        <h3 class="text-3xl font-extrabold text-gray-800">${presentToday}</h3>
      </div>
      <div class="bg-white p-4 rounded-lg shadow border-l-4 border-indigo-500">
        <p class="text-gray-500 text-sm font-bold">Full Day Today</p>
        <h3 class="text-3xl font-extrabold text-gray-800">${fullDayToday}</h3>
      </div>
      <div class="bg-white p-4 rounded-lg shadow border-l-4 border-yellow-500">
        <p class="text-gray-500 text-sm font-bold">Half Day Today</p>
        <h3 class="text-3xl font-extrabold text-gray-800">${halfDayToday}</h3>
      </div>
      <div class="bg-white p-4 rounded-lg shadow border-l-4 border-red-500">
        <p class="text-gray-500 text-sm font-bold">Absent Today</p>
        <h3 class="text-3xl font-extrabold text-gray-800">${absentToday}</h3>
      </div>
    </div>

    <div class="bg-white rounded-lg shadow p-6">
      <h3 class="text-xl font-bold mb-4 text-gray-800">Recent Attendance Logs</h3>
      <table class="w-full text-left border-collapse">
        <thead>
          <tr class="bg-gray-100 text-gray-700 text-sm">
            <th class="p-3">Worker ID</th>
            <th class="p-3">Full Name</th>
            <th class="p-3">Position</th>
            <th class="p-3">Type</th>
            <th class="p-3">Date</th>
            <th class="p-3">Time</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-200 text-sm">
          ${recentLogs.rows.map(r => `
            <tr>
              <td class="p-3 font-semibold">${r.worker_id}</td>
              <td class="p-3">${r.full_name}</td>
              <td class="p-3">${r.position}</td>
              <td class="p-3"><span class="px-2 py-1 rounded text-xs font-bold ${r.attendance_type === 'IN' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}">${r.attendance_type}</span></td>
              <td class="p-3">${r.date.toISOString().split('T')[0]}</td>
              <td class="p-3">${r.time}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `));
});

// Workers Management
app.get('/admin/workers', isAuthenticated, requireRole('ADMIN'), async (req, res) => {
  const company = await getCompanySettings();
  const search = req.query.search || '';
  const workers = await pool.query('SELECT * FROM workers WHERE full_name ILIKE $1 OR worker_id ILIKE $1 ORDER BY created_at DESC', [`%${search}%`]);

  res.send(adminLayout('Workers', company, req.session.user, `
    <div class="flex justify-between items-center mb-6">
      <form method="GET" class="flex gap-2">
        <input type="text" name="search" value="${search}" placeholder="Search worker..." class="px-3 py-2 border rounded-lg">
        <button type="submit" class="bg-gray-700 text-white px-4 py-2 rounded-lg">Search</button>
      </form>
      <a href="/admin/workers/register" class="bg-blue-600 hover:bg-blue-700 text-white font-bold px-4 py-2 rounded-lg">+ Register Worker</a>
    </div>

    <div class="bg-white rounded-lg shadow overflow-hidden">
      <table class="w-full text-left border-collapse">
        <thead>
          <tr class="bg-gray-100 text-gray-700 text-sm">
            <th class="p-3">Worker ID</th>
            <th class="p-3">Name</th>
            <th class="p-3">Position</th>
            <th class="p-3">Project</th>
            <th class="p-3">Daily Rate</th>
            <th class="p-3">Status</th>
            <th class="p-3">Actions</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-200 text-sm">
          ${workers.rows.map(w => `
            <tr>
              <td class="p-3 font-bold">${w.worker_id}</td>
              <td class="p-3">${w.full_name}</td>
              <td class="p-3">${w.position}</td>
              <td class="p-3">${w.assigned_project || '-'}</td>
              <td class="p-3">₱${parseFloat(w.daily_rate).toFixed(2)}</td>
              <td class="p-3"><span class="px-2 py-1 rounded text-xs font-bold ${w.is_active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}">${w.is_active ? 'Active' : 'Inactive'}</span></td>
              <td class="p-3 space-x-2">
                <a href="/admin/workers/profile/${w.id}" class="text-blue-600 hover:underline">View</a>
                <a href="/admin/workers/edit/${w.id}" class="text-indigo-600 hover:underline">Edit</a>
                <a href="/admin/workers/toggle/${w.id}" class="text-yellow-600 hover:underline">${w.is_active ? 'Deactivate' : 'Activate'}</a>
                <a href="/admin/workers/delete/${w.id}" onclick="return confirm('Delete worker?')" class="text-red-600 hover:underline">Delete</a>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `));
});

app.get('/admin/workers/register', isAuthenticated, requireRole('ADMIN'), async (req, res) => {
  const company = await getCompanySettings();
  res.send(adminLayout('Register Worker', company, req.session.user, `
    <div class="bg-white p-6 rounded-lg shadow max-w-xl mx-auto">
      <h3 class="text-xl font-bold mb-4">Register New Worker</h3>
      <form action="/admin/workers/register" method="POST" class="space-y-4">
        <div>
          <label class="block text-gray-700 text-sm font-bold mb-1">Full Name</label>
          <input type="text" name="full_name" required class="w-full px-3 py-2 border rounded-lg">
        </div>
        <div>
          <label class="block text-gray-700 text-sm font-bold mb-1">Position</label>
          <input type="text" name="position" required class="w-full px-3 py-2 border rounded-lg" placeholder="e.g. Mason, Carpenter">
        </div>
        <div>
          <label class="block text-gray-700 text-sm font-bold mb-1">Contact Number</label>
          <input type="text" name="contact_number" class="w-full px-3 py-2 border rounded-lg">
        </div>
        <div>
          <label class="block text-gray-700 text-sm font-bold mb-1">Daily Rate (₱)</label>
          <input type="number" step="0.01" name="daily_rate" required class="w-full px-3 py-2 border rounded-lg">
        </div>
        <div>
          <label class="block text-gray-700 text-sm font-bold mb-1">Assigned Project</label>
          <input type="text" name="assigned_project" class="w-full px-3 py-2 border rounded-lg">
        </div>
        <div>
          <label class="block text-gray-700 text-sm font-bold mb-1">Username (For Worker Portal)</label>
          <input type="text" name="username" required class="w-full px-3 py-2 border rounded-lg">
        </div>
        <div>
          <label class="block text-gray-700 text-sm font-bold mb-1">Password</label>
          <input type="password" name="password" required class="w-full px-3 py-2 border rounded-lg">
        </div>
        <button type="submit" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg">Register & Generate QR</button>
      </form>
    </div>
  `));
});

app.post('/admin/workers/register', isAuthenticated, requireRole('ADMIN'), async (req, res) => {
  const { full_name, position, contact_number, daily_rate, assigned_project, username, password } = req.body;
  try {
    const hash = await bcrypt.hash(password, 10);
    const userRes = await pool.query(
      'INSERT INTO users (full_name, username, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id',
      [full_name, username, hash, 'WORKER']
    );
    const userId = userRes.rows[0].id;

    // Generate Unique Worker ID
    const countRes = await pool.query('SELECT COUNT(*) FROM workers');
    const workerId = `W-${String(parseInt(countRes.rows[0].count) + 1).padStart(3, '0')}`;

    // Generate QR Code data URL
    const qrDataUrl = await QRCode.toDataURL(workerId);

    await pool.query(
      'INSERT INTO workers (worker_id, full_name, position, contact_number, daily_rate, assigned_project, qr_code, user_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
      [workerId, full_name, position, contact_number, daily_rate, assigned_project, qrDataUrl, userId]
    );

    res.redirect('/admin/workers');
  } catch (err) {
    res.send(`<script>alert("Error: ${err.message}"); window.history.back();</script>`);
  }
});

app.get('/admin/workers/profile/:id', isAuthenticated, requireRole('ADMIN'), async (req, res) => {
  const company = await getCompanySettings();
  const workerRes = await pool.query('SELECT * FROM workers WHERE id = $1', [req.params.id]);
  if (workerRes.rows.length === 0) return res.redirect('/admin/workers');
  const w = workerRes.rows[0];

  res.send(adminLayout('Worker Profile', company, req.session.user, `
    <div class="bg-white p-6 rounded-lg shadow max-w-xl mx-auto text-center">
      <h3 class="text-2xl font-bold mb-2">${w.full_name}</h3>
      <p class="text-gray-600 mb-4">${w.position} | ID: <span class="font-bold text-blue-600">${w.worker_id}</span></p>
      
      <div class="my-6">
        <img src="${w.qr_code}" alt="Worker QR Code" class="w-48 h-48 mx-auto border p-2 rounded shadow">
        <p class="text-xs text-gray-500 mt-2">Unique QR Code for Attendance Scanning</p>
        <a href="${w.qr_code}" download="${w.worker_id}_qr.png" class="mt-3 inline-block bg-green-600 text-white px-4 py-2 rounded text-sm font-bold">Download QR Code</a>
      </div>

      <div class="text-left bg-gray-50 p-4 rounded-lg space-y-2">
        <p><strong>Contact Number:</strong> ${w.contact_number || '-'}</p>
        <p><strong>Daily Rate:</strong> ₱${parseFloat(w.daily_rate).toFixed(2)}</p>
        <p><strong>Assigned Project:</strong> ${w.assigned_project || '-'}</p>
        <p><strong>Status:</strong> ${w.is_active ? 'Active' : 'Inactive'}</p>
      </div>

      <div class="mt-6">
        <a href="/admin/workers" class="bg-gray-600 text-white px-4 py-2 rounded">Back to Workers</a>
      </div>
    </div>
  `));
});

app.get('/admin/workers/toggle/:id', isAuthenticated, requireRole('ADMIN'), async (req, res) => {
  const w = await pool.query('SELECT * FROM workers WHERE id = $1', [req.params.id]);
  if (w.rows.length > 0) {
    const newStatus = !w.rows[0].is_active;
    await pool.query('UPDATE workers SET is_active = $1 WHERE id = $2', [newStatus, req.params.id]);
    await pool.query('UPDATE users SET is_active = $1 WHERE id = $2', [newStatus, w.rows[0].user_id]);
  }
  res.redirect('/admin/workers');
});

app.get('/admin/workers/delete/:id', isAuthenticated, requireRole('ADMIN'), async (req, res) => {
  const w = await pool.query('SELECT * FROM workers WHERE id = $1', [req.params.id]);
  if (w.rows.length > 0) {
    await pool.query('DELETE FROM users WHERE id = $1', [w.rows[0].user_id]);
    await pool.query('DELETE FROM workers WHERE id = $1', [req.params.id]);
  }
  res.redirect('/admin/workers');
});

// Attendance Management
app.get('/admin/attendance', isAuthenticated, requireRole('ADMIN'), async (req, res) => {
  const company = await getCompanySettings();
  const dateQuery = req.query.date || new Date().toISOString().split('T')[0];
  const search = req.query.search || '';

  const workers = await pool.query('SELECT * FROM workers WHERE full_name ILIKE $1 OR worker_id ILIKE $1', [`%${search}%`]);
  const logsRes = await pool.query('SELECT * FROM attendance_logs WHERE date = $1 ORDER BY time ASC', [dateQuery]);

  const logsByWorker = {};
  logsRes.rows.forEach(l => {
    if (!logsByWorker[l.worker_id]) logsByWorker[l.worker_id] = [];
    logsByWorker[l.worker_id].push(l);
  });

  res.send(adminLayout('Attendance', company, req.session.user, `
    <div class="flex justify-between items-center mb-6">
      <form method="GET" class="flex gap-2">
        <input type="date" name="date" value="${dateQuery}" class="px-3 py-2 border rounded-lg">
        <input type="text" name="search" value="${search}" placeholder="Search worker..." class="px-3 py-2 border rounded-lg">
        <button type="submit" class="bg-gray-700 text-white px-4 py-2 rounded-lg">Filter</button>
      </form>
    </div>

    <div class="bg-white rounded-lg shadow overflow-hidden">
      <table class="w-full text-left border-collapse">
        <thead>
          <tr class="bg-gray-100 text-gray-700 text-sm">
            <th class="p-3">Worker ID & Name</th>
            <th class="p-3">Position</th>
            <th class="p-3">First IN</th>
            <th class="p-3">First OUT</th>
            <th class="p-3">Second IN</th>
            <th class="p-3">Final OUT</th>
            <th class="p-3">Total Hours</th>
            <th class="p-3">Status</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-200 text-sm">
          ${workers.rows.map(w => {
            const wLogs = logsByWorker[w.worker_id] || [];
            const calc = calculateWorkingHours(wLogs);
            return `
              <tr>
                <td class="p-3 font-bold">${w.worker_id}<br><span class="text-xs font-normal text-gray-600">${w.full_name}</span></td>
                <td class="p-3">${w.position}</td>
                <td class="p-3">${calc.firstIn}</td>
                <td class="p-3">${calc.firstOut}</td>
                <td class="p-3">${calc.secondIn}</td>
                <td class="p-3">${calc.finalOut}</td>
                <td class="p-3 font-semibold">${calc.totalHours} hrs</td>
                <td class="p-3"><span class="px-2 py-1 rounded text-xs font-bold ${calc.status === 'FULL DAY' ? 'bg-green-100 text-green-800' : calc.status === 'HALF DAY' ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800'}">${calc.status}</span></td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `));
});

// Advance Money Management
app.get('/admin/advance', isAuthenticated, requireRole('ADMIN'), async (req, res) => {
  const company = await getCompanySettings();
  const workers = await pool.query('SELECT * FROM workers');
  const advances = await pool.query(`
    SELECT a.*, w.full_name FROM advance_money a
    JOIN workers w ON a.worker_id = w.worker_id
    ORDER BY a.date DESC
  `);

  res.send(adminLayout('Advance Money', company, req.session.user, `
    <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
      <div class="bg-white p-6 rounded-lg shadow h-fit">
        <h3 class="text-lg font-bold mb-4">Record Advance Money</h3>
        <form action="/admin/advance" method="POST" class="space-y-4">
          <div>
            <label class="block text-gray-700 text-sm font-bold mb-1">Select Worker</label>
            <select name="worker_id" required class="w-full px-3 py-2 border rounded-lg">
              ${workers.rows.map(w => `<option value="${w.worker_id}">${w.worker_id} - ${w.full_name}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="block text-gray-700 text-sm font-bold mb-1">Amount (₱)</label>
            <input type="number" step="0.01" name="amount" required class="w-full px-3 py-2 border rounded-lg">
          </div>
          <div>
            <label class="block text-gray-700 text-sm font-bold mb-1">Date</label>
            <input type="date" name="date" required value="${new Date().toISOString().split('T')[0]}" class="w-full px-3 py-2 border rounded-lg">
          </div>
          <div>
            <label class="block text-gray-700 text-sm font-bold mb-1">Reason / Notes</label>
            <textarea name="reason" class="w-full px-3 py-2 border rounded-lg"></textarea>
          </div>
          <button type="submit" class="w-full bg-blue-600 text-white font-bold py-2 rounded-lg">Save Advance</button>
        </form>
      </div>

      <div class="md:col-span-2 bg-white p-6 rounded-lg shadow">
        <h3 class="text-lg font-bold mb-4">Advance History</h3>
        <table class="w-full text-left border-collapse">
          <thead>
            <tr class="bg-gray-100 text-gray-700 text-sm">
              <th class="p-3">Date</th>
              <th class="p-3">Worker</th>
              <th class="p-3">Amount</th>
              <th class="p-3">Reason</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-200 text-sm">
            ${advances.rows.map(a => `
              <tr>
                <td class="p-3">${a.date.toISOString().split('T')[0]}</td>
                <td class="p-3">${a.full_name}</td>
                <td class="p-3 font-bold text-red-600">₱${parseFloat(a.amount).toFixed(2)}</td>
                <td class="p-3">${a.reason || '-'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `));
});

app.post('/admin/advance', isAuthenticated, requireRole('ADMIN'), async (req, res) => {
  const { worker_id, amount, date, reason } = req.body;
  await pool.query('INSERT INTO advance_money (worker_id, amount, date, reason) VALUES ($1, $2, $3, $4)', [worker_id, amount, date, reason]);
  res.redirect('/admin/advance');
});

// Salary Management
app.get('/admin/salary', isAuthenticated, requireRole('ADMIN'), async (req, res) => {
  const company = await getCompanySettings();
  const workers = await pool.query('SELECT * FROM workers');
  const logsRes = await pool.query('SELECT * FROM attendance_logs');
  const advancesRes = await pool.query('SELECT * FROM advance_money');

  const logsByWorker = {};
  logsRes.rows.forEach(l => {
    if (!logsByWorker[l.worker_id]) logsByWorker[l.worker_id] = [];
    logsByWorker[l.worker_id].push(l);
  });

  const advancesByWorker = {};
  advancesRes.rows.forEach(a => {
    if (!advancesByWorker[a.worker_id]) advancesByWorker[a.worker_id] = 0;
    advancesByWorker[a.worker_id] += parseFloat(a.amount);
  });

  const salaryData = workers.rows.map(w => {
    const wLogs = logsByWorker[w.worker_id] || [];
    // Group logs by date
    const byDate = {};
    wLogs.forEach(l => {
      const d = l.date.toISOString().split('T')[0];
      if (!byDate[d]) byDate[d] = [];
      byDate[d].push(l);
    });

    let fullDays = 0;
    let halfDays = 0;
    Object.keys(byDate).forEach(d => {
      const calc = calculateWorkingHours(byDate[d]);
      if (calc.status === 'FULL DAY') fullDays++;
      else if (calc.status === 'HALF DAY') halfDays++;
    });

    const equivalentDays = fullDays + (halfDays * 0.5);
    const totalSalary = equivalentDays * parseFloat(w.daily_rate);
    const advanceDeduction = advancesByWorker[w.worker_id] || 0;
    const netSalary = totalSalary - advanceDeduction;

    return { ...w, fullDays, halfDays, equivalentDays, totalSalary, advanceDeduction, netSalary };
  });

  res.send(adminLayout('Salary Management', company, req.session.user, `
    <div class="bg-white p-6 rounded-lg shadow overflow-x-auto">
      <h3 class="text-xl font-bold mb-4">Payroll & Salary Calculation</h3>
      <table class="w-full text-left border-collapse">
        <thead>
          <tr class="bg-gray-100 text-gray-700 text-sm">
            <th class="p-3">Worker</th>
            <th class="p-3">Daily Rate</th>
            <th class="p-3">Full Days</th>
            <th class="p-3">Half Days</th>
            <th class="p-3">Equivalent Days</th>
            <th class="p-3">Total Salary</th>
            <th class="p-3">Advance Deduction</th>
            <th class="p-3">Net Salary</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-200 text-sm">
          ${salaryData.map(s => `
            <tr>
              <td class="p-3 font-bold">${s.worker_id}<br><span class="text-xs font-normal text-gray-600">${s.full_name}</span></td>
              <td class="p-3">₱${parseFloat(s.daily_rate).toFixed(2)}</td>
              <td class="p-3">${s.fullDays}</td>
              <td class="p-3">${s.halfDays}</td>
              <td class="p-3 font-semibold">${s.equivalentDays}</td>
              <td class="p-3">₱${s.totalSalary.toFixed(2)}</td>
              <td class="p-3 text-red-600">₱${s.advanceDeduction.toFixed(2)}</td>
              <td class="p-3 font-bold text-green-600">₱${s.netSalary.toFixed(2)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `));
});

// Announcements
app.get('/admin/announcements', isAuthenticated, requireRole('ADMIN'), async (req, res) => {
  const company = await getCompanySettings();
  const announcements = await pool.query('SELECT * FROM announcements ORDER BY created_at DESC');

  res.send(adminLayout('Announcements', company, req.session.user, `
    <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
      <div class="bg-white p-6 rounded-lg shadow h-fit">
        <h3 class="text-lg font-bold mb-4">Create Announcement</h3>
        <form action="/admin/announcements" method="POST" class="space-y-4">
          <div>
            <label class="block text-gray-700 text-sm font-bold mb-1">Title</label>
            <input type="text" name="title" required class="w-full px-3 py-2 border rounded-lg">
          </div>
          <div>
            <label class="block text-gray-700 text-sm font-bold mb-1">Content</label>
            <textarea name="content" required rows="4" class="w-full px-3 py-2 border rounded-lg"></textarea>
          </div>
          <button type="submit" class="w-full bg-blue-600 text-white font-bold py-2 rounded-lg">Post Announcement</button>
        </form>
      </div>

      <div class="md:col-span-2 space-y-4">
        ${announcements.rows.map(a => `
          <div class="bg-white p-6 rounded-lg shadow">
            <div class="flex justify-between items-start">
              <h4 class="text-lg font-bold text-gray-800">${a.title}</h4>
              <a href="/admin/announcements/delete/${a.id}" class="text-red-600 text-sm hover:underline">Delete</a>
            </div>
            <p class="text-xs text-gray-500 mb-2">${a.created_at.toISOString().split('T')[0]}</p>
            <p class="text-gray-700 whitespace-pre-line">${a.content}</p>
          </div>
        `).join('')}
      </div>
    </div>
  `));
});

app.post('/admin/announcements', isAuthenticated, requireRole('ADMIN'), async (req, res) => {
  const { title, content } = req.body;
  await pool.query('INSERT INTO announcements (title, content) VALUES ($1, $2)', [title, content]);
  res.redirect('/admin/announcements');
});

app.get('/admin/announcements/delete/:id', isAuthenticated, requireRole('ADMIN'), async (req, res) => {
  await pool.query('DELETE FROM announcements WHERE id = $1', [req.params.id]);
  res.redirect('/admin/announcements');
});

// Company Settings
app.get('/admin/settings', isAuthenticated, requireRole('ADMIN'), async (req, res) => {
  const company = await getCompanySettings();
  res.send(adminLayout('Company Settings', company, req.session.user, `
    <div class="bg-white p-6 rounded-lg shadow max-w-xl mx-auto">
      <h3 class="text-xl font-bold mb-4">Company Settings</h3>
      <form action="/admin/settings" method="POST" class="space-y-4">
        <div>
          <label class="block text-gray-700 text-sm font-bold mb-1">Company Name</label>
          <input type="text" name="company_name" required value="${company.company_name}" class="w-full px-3 py-2 border rounded-lg">
        </div>
        <div>
          <label class="block text-gray-700 text-sm font-bold mb-1">Company Logo (URL or Data URI)</label>
          <input type="text" name="logo_data" value="${company.logo_data || ''}" class="w-full px-3 py-2 border rounded-lg">
        </div>
        <div>
          <label class="block text-gray-700 text-sm font-bold mb-1">Company Address</label>
          <input type="text" name="address" required value="${company.address || ''}" class="w-full px-3 py-2 border rounded-lg">
        </div>
        <div>
          <label class="block text-gray-700 text-sm font-bold mb-1">Contact Number</label>
          <input type="text" name="contact_number" required value="${company.contact_number || ''}" class="w-full px-3 py-2 border rounded-lg">
        </div>
        <button type="submit" class="w-full bg-blue-600 text-white font-bold py-2 rounded-lg">Update Settings</button>
      </form>
    </div>
  `));
});

app.post('/admin/settings', isAuthenticated, requireRole('ADMIN'), async (req, res) => {
  const { company_name, logo_data, address, contact_number } = req.body;
  await pool.query('UPDATE company_settings SET company_name=$1, logo_data=$2, address=$3, contact_number=$4', [company_name, logo_data, address, contact_number]);
  res.redirect('/admin/settings');
});

// Work Schedule Settings
app.get('/admin/schedule', isAuthenticated, requireRole('ADMIN'), async (req, res) => {
  const company = await getCompanySettings();
  const scheduleRes = await pool.query('SELECT * FROM work_schedules LIMIT 1');
  const sched = scheduleRes.rows[0];

  res.send(adminLayout('Work Schedule Settings', company, req.session.user, `
    <div class="bg-white p-6 rounded-lg shadow max-w-xl mx-auto">
      <h3 class="text-xl font-bold mb-4">Work Schedule Settings</h3>
      <form action="/admin/schedule" method="POST" class="space-y-4">
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="block text-gray-700 text-sm font-bold mb-1">Morning Start</label>
            <input type="text" name="morning_start" required value="${sched.morning_start}" class="w-full px-3 py-2 border rounded-lg">
          </div>
          <div>
            <label class="block text-gray-700 text-sm font-bold mb-1">Morning End</label>
            <input type="text" name="morning_end" required value="${sched.morning_end}" class="w-full px-3 py-2 border rounded-lg">
          </div>
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="block text-gray-700 text-sm font-bold mb-1">Afternoon Start</label>
            <input type="text" name="afternoon_start" required value="${sched.afternoon_start}" class="w-full px-3 py-2 border rounded-lg">
          </div>
          <div>
            <label class="block text-gray-700 text-sm font-bold mb-1">Afternoon End</label>
            <input type="text" name="afternoon_end" required value="${sched.afternoon_end}" class="w-full px-3 py-2 border rounded-lg">
          </div>
        </div>
        <button type="submit" class="w-full bg-blue-600 text-white font-bold py-2 rounded-lg">Update Schedule</button>
      </form>
    </div>
  `));
});

app.post('/admin/schedule', isAuthenticated, requireRole('ADMIN'), async (req, res) => {
  const { morning_start, morning_end, afternoon_start, afternoon_end } = req.body;
  await pool.query('UPDATE work_schedules SET morning_start=$1, morning_end=$2, afternoon_start=$3, afternoon_end=$4', [morning_start, morning_end, afternoon_start, afternoon_end]);
  res.redirect('/admin/schedule');
});

function adminLayout(title, company, user, content) {
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8"><title>${title} - Admin Portal</title>
      <link href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css" rel="stylesheet">
    </head>
    <body class="bg-gray-100 flex min-h-screen">
      <aside class="w-64 bg-gray-900 text-white flex flex-col">
        <div class="p-6 border-b border-gray-800 flex items-center space-x-3">
          ${company.logo_data ? `<img src="${company.logo_data}" class="w-10 h-10 object-contain bg-white rounded p-1">` : ''}
          <div>
            <h2 class="font-bold text-lg">${company.company_name}</h2>
            <p class="text-xs text-gray-400">Admin Portal</p>
          </div>
        </div>
        <nav class="flex-1 p-4 space-y-1 text-sm font-medium">
          <a href="/admin/dashboard" class="block px-4 py-2 rounded hover:bg-gray-800">Dashboard</a>
          <a href="/admin/workers" class="block px-4 py-2 rounded hover:bg-gray-800">Workers</a>
          <a href="/admin/attendance" class="block px-4 py-2 rounded hover:bg-gray-800">Attendance</a>
          <a href="/admin/advance" class="block px-4 py-2 rounded hover:bg-gray-800">Advance Money</a>
          <a href="/admin/salary" class="block px-4 py-2 rounded hover:bg-gray-800">Salary</a>
          <a href="/admin/announcements" class="block px-4 py-2 rounded hover:bg-gray-800">Announcements</a>
          <a href="/admin/settings" class="block px-4 py-2 rounded hover:bg-gray-800">Company Settings</a>
          <a href="/admin/schedule" class="block px-4 py-2 rounded hover:bg-gray-800">Work Schedule</a>
        </nav>
        <div class="p-4 border-t border-gray-800">
          <a href="/logout" class="block w-full text-center bg-red-600 hover:bg-red-700 py-2 rounded text-sm font-bold">Logout</a>
        </div>
      </aside>
      <main class="flex-1 flex flex-col">
        <header class="bg-white shadow px-8 py-4 flex justify-between items-center">
          <h1 class="text-2xl font-bold text-gray-800">${title}</h1>
          <span class="text-gray-600 text-sm">Welcome, ${user.full_name}</span>
        </header>
        <div class="p-8 flex-1 overflow-y-auto">${content}</div>
      </main>
    </body>
    </html>
  `;
}

// ==================== WORKER PORTAL ====================

app.get('/worker/dashboard', isAuthenticated, requireRole('WORKER'), async (req, res) => {
  const company = await getCompanySettings();
  const workerRes = await pool.query('SELECT * FROM workers WHERE user_id = $1', [req.session.user.id]);
  const w = workerRes.rows[0];
  const today = new Date().toISOString().split('T')[0];
  const logsRes = await pool.query('SELECT * FROM attendance_logs WHERE worker_id = $1 AND date = $2 ORDER BY time ASC', [w.worker_id, today]);
  const calc = calculateWorkingHours(logsRes.rows);

  res.send(workerLayout('Dashboard', company, w, `
    <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
      <div class="bg-white p-6 rounded-lg shadow">
        <h3 class="text-xl font-bold mb-4 text-gray-800">My Profile</h3>
        <p><strong>Worker ID:</strong> ${w.worker_id}</p>
        <p><strong>Position:</strong> ${w.position}</p>
        <p><strong>Assigned Project:</strong> ${w.assigned_project || '-'}</p>
        <p><strong>Daily Rate:</strong> ₱${parseFloat(w.daily_rate).toFixed(2)}</p>
      </div>
      <div class="bg-white p-6 rounded-lg shadow">
        <h3 class="text-xl font-bold mb-4 text-gray-800">Today's Attendance Status</h3>
        <p class="text-2xl font-extrabold text-blue-600 mb-2">${calc.status}</p>
        <p><strong>Total Hours:</strong> ${calc.totalHours} hrs</p>
        <p><strong>First IN:</strong> ${calc.firstIn} | <strong>Final OUT:</strong> ${calc.finalOut}</p>
      </div>
    </div>
  `));
});

app.get('/worker/qrcode', isAuthenticated, requireRole('WORKER'), async (req, res) => {
  const company = await getCompanySettings();
  const workerRes = await pool.query('SELECT * FROM workers WHERE user_id = $1', [req.session.user.id]);
  const w = workerRes.rows[0];

  res.send(workerLayout('My QR Code', company, w, `
    <div class="bg-white p-6 rounded-lg shadow max-w-md mx-auto text-center">
      <h3 class="text-xl font-bold mb-2">My QR Code</h3>
      <p class="text-gray-600 mb-4">${w.worker_id}</p>
      <img src="${w.qr_code}" alt="QR Code" class="w-64 h-64 mx-auto border p-2 rounded shadow mb-4">
      <a href="${w.qr_code}" download="${w.worker_id}_qr.png" class="bg-green-600 text-white px-4 py-2 rounded font-bold inline-block">Download QR Code</a>
    </div>
  `));
});

app.get('/worker/attendance', isAuthenticated, requireRole('WORKER'), async (req, res) => {
  const company = await getCompanySettings();
  const workerRes = await pool.query('SELECT * FROM workers WHERE user_id = $1', [req.session.user.id]);
  const w = workerRes.rows[0];
  const logsRes = await pool.query('SELECT * FROM attendance_logs WHERE worker_id = $1 ORDER BY date DESC, time ASC', [w.worker_id]);

  const byDate = {};
  logsRes.rows.forEach(l => {
    const d = l.date.toISOString().split('T')[0];
    if (!byDate[d]) byDate[d] = [];
    byDate[d].push(l);
  });

  res.send(workerLayout('My Attendance', company, w, `
    <div class="bg-white rounded-lg shadow overflow-hidden">
      <table class="w-full text-left border-collapse">
        <thead>
          <tr class="bg-gray-100 text-gray-700 text-sm">
            <th class="p-3">Date</th>
            <th class="p-3">First IN</th>
            <th class="p-3">First OUT</th>
            <th class="p-3">Second IN</th>
            <th class="p-3">Final OUT</th>
            <th class="p-3">Total Hours</th>
            <th class="p-3">Status</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-200 text-sm">
          ${Object.keys(byDate).map(d => {
            const calc = calculateWorkingHours(byDate[d]);
            return `
              <tr>
                <td class="p-3 font-bold">${d}</td>
                <td class="p-3">${calc.firstIn}</td>
                <td class="p-3">${calc.firstOut}</td>
                <td class="p-3">${calc.secondIn}</td>
                <td class="p-3">${calc.finalOut}</td>
                <td class="p-3">${calc.totalHours} hrs</td>
                <td class="p-3 font-semibold">${calc.status}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `));
});

app.get('/worker/advance', isAuthenticated, requireRole('WORKER'), async (req, res) => {
  const company = await getCompanySettings();
  const workerRes = await pool.query('SELECT * FROM workers WHERE user_id = $1', [req.session.user.id]);
  const w = workerRes.rows[0];
  const advances = await pool.query('SELECT * FROM advance_money WHERE worker_id = $1 ORDER BY date DESC', [w.worker_id]);

  res.send(workerLayout('My Advance', company, w, `
    <div class="bg-white p-6 rounded-lg shadow">
      <h3 class="text-xl font-bold mb-4">Advance History</h3>
      <table class="w-full text-left border-collapse">
        <thead>
          <tr class="bg-gray-100 text-gray-700 text-sm">
            <th class="p-3">Date</th>
            <th class="p-3">Amount</th>
            <th class="p-3">Reason</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-200 text-sm">
          ${advances.rows.map(a => `
            <tr>
              <td class="p-3">${a.date.toISOString().split('T')[0]}</td>
              <td class="p-3 font-bold text-red-600">₱${parseFloat(a.amount).toFixed(2)}</td>
              <td class="p-3">${a.reason || '-'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `));
});

app.get('/worker/salary', isAuthenticated, requireRole('WORKER'), async (req, res) => {
  const company = await getCompanySettings();
  const workerRes = await pool.query('SELECT * FROM workers WHERE user_id = $1', [req.session.user.id]);
  const w = workerRes.rows[0];

  const logsRes = await pool.query('SELECT * FROM attendance_logs WHERE worker_id = $1', [w.worker_id]);
  const advancesRes = await pool.query('SELECT * FROM advance_money WHERE worker_id = $1', [w.worker_id]);

  const byDate = {};
  logsRes.rows.forEach(l => {
    const d = l.date.toISOString().split('T')[0];
    if (!byDate[d]) byDate[d] = [];
    byDate[d].push(l);
  });

  let fullDays = 0;
  let halfDays = 0;
  Object.keys(byDate).forEach(d => {
    const calc = calculateWorkingHours(byDate[d]);
    if (calc.status === 'FULL DAY') fullDays++;
    else if (calc.status === 'HALF DAY') halfDays++;
  });

  const equivalentDays = fullDays + (halfDays * 0.5);
  const totalSalary = equivalentDays * parseFloat(w.daily_rate);
  const advanceDeduction = advancesRes.rows.reduce((sum, a) => sum + parseFloat(a.amount), 0);
  const netSalary = totalSalary - advanceDeduction;

  res.send(workerLayout('My Salary', company, w, `
    <div class="bg-white p-6 rounded-lg shadow max-w-xl mx-auto space-y-4">
      <h3 class="text-xl font-bold mb-4">Salary Computation</h3>
      <p><strong>Daily Rate:</strong> ₱${parseFloat(w.daily_rate).toFixed(2)}</p>
      <p><strong>Full Days Worked:</strong> ${fullDays}</p>
      <p><strong>Half Days Worked:</strong> ${halfDays}</p>
      <p><strong>Equivalent Days:</strong> ${equivalentDays}</p>
      <p><strong>Total Salary:</strong> ₱${totalSalary.toFixed(2)}</p>
      <p><strong>Advance Deduction:</strong> ₱${advanceDeduction.toFixed(2)}</p>
      <hr>
      <p class="text-xl font-bold text-green-600">Net Salary: ₱${netSalary.toFixed(2)}</p>
    </div>
  `));
});

app.get('/worker/announcements', isAuthenticated, requireRole('WORKER'), async (req, res) => {
  const company = await getCompanySettings();
  const workerRes = await pool.query('SELECT * FROM workers WHERE user_id = $1', [req.session.user.id]);
  const w = workerRes.rows[0];
  const announcements = await pool.query('SELECT * FROM announcements ORDER BY created_at DESC');

  res.send(workerLayout('Announcements', company, w, `
    <div class="space-y-4">
      ${announcements.rows.map(a => `
        <div class="bg-white p-6 rounded-lg shadow">
          <h4 class="text-lg font-bold text-gray-800">${a.title}</h4>
          <p class="text-xs text-gray-500 mb-2">${a.created_at.toISOString().split('T')[0]}</p>
          <p class="text-gray-700 whitespace-pre-line">${a.content}</p>
        </div>
      `).join('')}
    </div>
  `));
});

function workerLayout(title, company, worker, content) {
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8"><title>${title} - Worker Portal</title>
      <link href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css" rel="stylesheet">
    </head>
    <body class="bg-gray-100 flex min-h-screen">
      <aside class="w-64 bg-indigo-900 text-white flex flex-col">
        <div class="p-6 border-b border-indigo-800 flex items-center space-x-3">
          ${company.logo_data ? `<img src="${company.logo_data}" class="w-10 h-10 object-contain bg-white rounded p-1">` : ''}
          <div>
            <h2 class="font-bold text-lg">${company.company_name}</h2>
            <p class="text-xs text-indigo-300">Worker Portal</p>
          </div>
        </div>
        <nav class="flex-1 p-4 space-y-1 text-sm font-medium">
          <a href="/worker/dashboard" class="block px-4 py-2 rounded hover:bg-indigo-800">Home</a>
          <a href="/worker/qrcode" class="block px-4 py-2 rounded hover:bg-indigo-800">My QR Code</a>
          <a href="/worker/attendance" class="block px-4 py-2 rounded hover:bg-indigo-800">My Attendance</a>
          <a href="/worker/advance" class="block px-4 py-2 rounded hover:bg-indigo-800">My Advance</a>
          <a href="/worker/salary" class="block px-4 py-2 rounded hover:bg-indigo-800">My Salary</a>
          <a href="/worker/announcements" class="block px-4 py-2 rounded hover:bg-indigo-800">Announcements</a>
        </nav>
        <div class="p-4 border-t border-indigo-800">
          <a href="/logout" class="block w-full text-center bg-red-600 hover:bg-red-700 py-2 rounded text-sm font-bold">Logout</a>
        </div>
      </aside>
      <main class="flex-1 flex flex-col">
        <header class="bg-white shadow px-8 py-4 flex justify-between items-center">
          <h1 class="text-2xl font-bold text-gray-800">${title}</h1>
          <span class="text-gray-600 text-sm">${worker.full_name} (${worker.worker_id})</span>
        </header>
        <div class="p-8 flex-1 overflow-y-auto">${content}</div>
      </main>
    </body>
    </html>
  `;
}

// ==================== ATTENDANCE SCANNER PORTAL ====================

app.get('/scanner/dashboard', isAuthenticated, requireRole('SCANNER'), async (req, res) => {
  const company = await getCompanySettings();
  const today = new Date().toISOString().split('T')[0];

  const workersCount = await pool.query('SELECT COUNT(*) FROM workers');
  const totalWorkers = parseInt(workersCount.rows[0].count);

  const todayLogsRes = await pool.query('SELECT * FROM attendance_logs WHERE date = $1', [today]);
  const logsByWorker = {};
  todayLogsRes.rows.forEach(l => {
    if (!logsByWorker[l.worker_id]) logsByWorker[l.worker_id] = [];
    logsByWorker[l.worker_id].push(l);
  });

  let presentToday = 0;
  let fullDayToday = 0;
  let halfDayToday = 0;

  Object.keys(logsByWorker).forEach(wid => {
    const calc = calculateWorkingHours(logsByWorker[wid]);
    if (calc.status !== 'ABSENT') presentToday++;
    if (calc.status === 'FULL DAY') fullDayToday++;
    if (calc.status === 'HALF DAY') halfDayToday++;
  });

  res.send(scannerLayout('Dashboard', company, req.session.user, `
    <div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
      <div class="bg-white p-4 rounded shadow border-l-4 border-blue-500">
        <p class="text-gray-500 text-sm font-bold">Current Date</p>
        <h3 class="text-xl font-bold text-gray-800">${today}</h3>
      </div>
      <div class="bg-white p-4 rounded shadow border-l-4 border-green-500">
        <p class="text-gray-500 text-sm font-bold">Workers Present Today</p>
        <h3 class="text-3xl font-extrabold text-gray-800">${presentToday}</h3>
      </div>
      <div class="bg-white p-4 rounded shadow border-l-4 border-indigo-500">
        <p class="text-gray-500 text-sm font-bold">Full Day</p>
        <h3 class="text-3xl font-extrabold text-gray-800">${fullDayToday}</h3>
      </div>
      <div class="bg-white p-4 rounded shadow border-l-4 border-yellow-500">
        <p class="text-gray-500 text-sm font-bold">Half Day</p>
        <h3 class="text-3xl font-extrabold text-gray-800">${halfDayToday}</h3>
      </div>
    </div>
    <div class="bg-white p-6 rounded shadow text-center">
      <a href="/scanner/scan" class="inline-block bg-yellow-600 hover:bg-yellow-700 text-white font-bold text-xl px-8 py-4 rounded-xl shadow-lg">GO TO QR SCANNER</a>
    </div>
  `));
});

app.get('/scanner/scan', isAuthenticated, requireRole('SCANNER'), async (req, res) => {
  const company = await getCompanySettings();
  res.send(scannerLayout('Scan QR Code', company, req.session.user, `
    <div class="bg-white p-6 rounded-lg shadow max-w-lg mx-auto text-center">
      <h3 class="text-xl font-bold mb-4">Select Attendance Type First</h3>
      
      <div id="selection-box" class="space-y-4 mb-6">
        <div class="grid grid-cols-2 gap-4">
          <button onclick="setType('IN')" id="btn-in" class="py-4 border-4 border-gray-300 bg-gray-50 text-gray-700 font-bold text-xl rounded-xl transition">TIME IN</button>
          <button onclick="setType('OUT')" id="btn-out" class="py-4 border-4 border-gray-300 bg-gray-50 text-gray-700 font-bold text-xl rounded-xl transition">TIME OUT</button>
        </div>
      </div>

      <div id="scanner-box" class="hidden space-y-4">
        <p id="selected-type-indicator" class="font-bold text-lg text-green-600"></p>
        <form id="scan-form" action="/scanner/record" method="POST" class="space-y-4">
          <input type="hidden" name="attendance_type" id="attendance_type">
          <div>
            <label class="block text-gray-700 text-sm font-bold mb-2">Scan or Enter Worker ID</label>
            <input type="text" name="worker_id" id="worker_id_input" required autofocus placeholder="e.g. W-001" class="w-full px-4 py-3 border-2 border-blue-500 rounded-lg text-center text-xl font-bold">
          </div>
          <button type="submit" class="w-full bg-blue-600 text-white font-bold py-3 rounded-lg text-lg">Record Attendance</button>
        </form>
        <button onclick="resetType()" class="text-sm text-gray-500 underline">Change Type</button>
      </div>
    </div>

    <script>
      let currentType = '';
      function setType(type) {
        currentType = type;
        document.getElementById('attendance_type').value = type;
        document.getElementById('selection-box').classList.add('hidden');
        document.getElementById('scanner-box').classList.remove('hidden');
        document.getElementById('selected-type-indicator').innerText = 'Selected Type: ' + (type === 'IN' ? 'TIME IN' : 'TIME OUT');
        document.getElementById('worker_id_input').focus();
      }
      function resetType() {
        currentType = '';
        document.getElementById('selection-box').classList.remove('hidden');
        document.getElementById('scanner-box').classList.add('hidden');
        document.getElementById('worker_id_input').value = '';
      }
    </script>
  `));
});

app.post('/scanner/record', isAuthenticated, requireRole('SCANNER'), async (req, res) => {
  const { worker_id, attendance_type } = req.body;
  if (!attendance_type) return res.send('<script>alert("Please Select TIME IN or TIME OUT First"); window.location.href="/scanner/scan";</script>');

  const workerRes = await pool.query('SELECT * FROM workers WHERE worker_id = $1', [worker_id]);
  if (workerRes.rows.length === 0) return res.send('<script>alert("Worker Not Found"); window.location.href="/scanner/scan";</script>');
  const worker = workerRes.rows[0];

  if (!worker.is_active) return res.send('<script>alert("Worker Account is Inactive"); window.location.href="/scanner/scan";</script>');

  const today = new Date().toISOString().split('T')[0];
  const logsRes = await pool.query('SELECT * FROM attendance_logs WHERE worker_id = $1 AND date = $2 ORDER BY time ASC', [worker_id, today]);
  const logs = logsRes.rows;

  // Validation rules
  if (logs.length === 0 && attendance_type === 'OUT') {
    return res.send('<script>alert("Cannot Record OUT as First Attendance"); window.location.href="/scanner/scan";</script>');
  }

  if (logs.length > 0) {
    const lastType = logs[logs.length - 1].attendance_type;
    if (lastType === 'IN' && attendance_type === 'IN') {
      return res.send('<script>alert("Cannot Record Two Consecutive IN"); window.location.href="/scanner/scan";</script>');
    }
    if (lastType === 'OUT' && attendance_type === 'OUT') {
      return res.send('<script>alert("Cannot Record Two Consecutive OUT"); window.location.href="/scanner/scan";</script>');
    }
  }

  const now = new Date();
  const timeStr = now.toTimeString().split(' ')[0];

  await pool.query('INSERT INTO attendance_logs (worker_id, date, time, attendance_type) VALUES ($1, $2, $3, $4)', [worker_id, today, timeStr, attendance_type]);

  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head><meta charset="UTF-8"><title>Success</title><link href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css" rel="stylesheet"></head>
    <body class="bg-gray-100 flex items-center justify-center min-h-screen">
      <div class="bg-white p-8 rounded-lg shadow-md text-center max-w-md w-full">
        <h2 class="text-2xl font-bold text-green-600 mb-4">ATTENDANCE RECORDED SUCCESSFULLY</h2>
        <div class="text-left bg-gray-50 p-4 rounded mb-6 space-y-2">
          <p><strong>Name:</strong> ${worker.full_name}</p>
          <p><strong>Position:</strong> ${worker.position}</p>
          <p><strong>Type:</strong> ${attendance_type}</p>
          <p><strong>Time:</strong> ${timeStr}</p>
        </div>
        <a href="/scanner/scan" class="block w-full bg-blue-600 text-white font-bold py-3 rounded-lg">Next Scan</a>
      </div>
    </body>
    </html>
  `);
});

app.get('/scanner/attendance', isAuthenticated, requireRole('SCANNER'), async (req, res) => {
  const company = await getCompanySettings();
  const today = new Date().toISOString().split('T')[0];
  const logsRes = await pool.query('SELECT l.*, w.full_name, w.position FROM attendance_logs l JOIN workers w ON l.worker_id = w.worker_id WHERE l.date = $1 ORDER BY l.time DESC', [today]);

  res.send(scannerLayout("Today's Attendance", company, req.session.user, `
    <div class="bg-white rounded-lg shadow overflow-hidden">
      <table class="w-full text-left border-collapse">
        <thead>
          <tr class="bg-gray-100 text-gray-700 text-sm">
            <th class="p-3">Worker ID & Name</th>
            <th class="p-3">Position</th>
            <th class="p-3">Type</th>
            <th class="p-3">Time</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-200 text-sm">
          ${logsRes.rows.map(l => `
            <tr>
              <td class="p-3 font-bold">${l.worker_id}<br><span class="text-xs font-normal text-gray-600">${l.full_name}</span></td>
              <td class="p-3">${l.position}</td>
              <td class="p-3"><span class="px-2 py-1 rounded text-xs font-bold ${l.attendance_type === 'IN' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}">${l.attendance_type}</span></td>
              <td class="p-3">${l.time}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `));
});

function scannerLayout(title, company, user, content) {
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8"><title>${title} - Scanner Portal</title>
      <link href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css" rel="stylesheet">
    </head>
    <body class="bg-gray-100 flex min-h-screen">
      <aside class="w-64 bg-yellow-900 text-white flex flex-col">
        <div class="p-6 border-b border-yellow-800 flex items-center space-x-3">
          ${company.logo_data ? `<img src="${company.logo_data}" class="w-10 h-10 object-contain bg-white rounded p-1">` : ''}
          <div>
            <h2 class="font-bold text-lg">${company.company_name}</h2>
            <p class="text-xs text-yellow-300">Scanner Portal</p>
          </div>
        </div>
        <nav class="flex-1 p-4 space-y-1 text-sm font-medium">
          <a href="/scanner/dashboard" class="block px-4 py-2 rounded hover:bg-yellow-800">Dashboard</a>
          <a href="/scanner/scan" class="block px-4 py-2 rounded hover:bg-yellow-800">Scan QR Code</a>
          <a href="/scanner/attendance" class="block px-4 py-2 rounded hover:bg-yellow-800">Today's Attendance</a>
        </nav>
        <div class="p-4 border-t border-yellow-800">
          <a href="/logout" class="block w-full text-center bg-red-600 hover:bg-red-700 py-2 rounded text-sm font-bold">Logout</a>
        </div>
      </aside>
      <main class="flex-1 flex flex-col">
        <header class="bg-white shadow px-8 py-4 flex justify-between items-center">
          <h1 class="text-2xl font-bold text-gray-800">${title}</h1>
          <span class="text-gray-600 text-sm">Scanner User</span>
        </header>
        <div class="p-8 flex-1 overflow-y-auto">${content}</div>
      </main>
    </body>
    </html>
  `;
}

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
