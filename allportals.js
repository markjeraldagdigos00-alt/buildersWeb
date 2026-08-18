
// server.js - Complete Construction Worker Management System
const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const fileUpload = require('express-fileupload');

const app = express();
const PORT = process.env.PORT || 3000;

// PostgreSQL Pool Connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(fileUpload({ limits: { fileSize: 5 * 1024 * 1024 } })); // 5MB limit
app.use(session({
  secret: process.env.SESSION_SECRET || 'construction_management_secret_key',
  resave: false,
  saveUninitialized: false
}));

// Initialize Database Tables
async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS settings (
        id SERIAL PRIMARY KEY,
        company_name VARCHAR(255) DEFAULT 'BuildCorp Management',
        company_logo TEXT DEFAULT ''
      );

      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(100) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(50) NOT NULL, -- admin, worker, scanner
        full_name VARCHAR(255) NOT NULL,
        phone VARCHAR(50),
        daily_rate NUMERIC(10,2) DEFAULT 500.00,
        qr_code TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS attendance (
        id SERIAL PRIMARY KEY,
        worker_id INT REFERENCES users(id) ON DELETE CASCADE,
        type VARCHAR(10) NOT NULL, -- IN or OUT
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        date_stamp DATE DEFAULT CURRENT_DATE
      );

      CREATE TABLE IF NOT EXISTS advances (
        id SERIAL PRIMARY KEY,
        worker_id INT REFERENCES users(id) ON DELETE CASCADE,
        amount NUMERIC(10,2) NOT NULL,
        reason TEXT,
        date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS announcements (
        id SERIAL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        message TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Insert default settings if not exists
    const settingsRes = await client.query('SELECT * FROM settings WHERE id = 1');
    if (settingsRes.rows.length === 0) {
      await client.query("INSERT INTO settings (company_name, company_logo) VALUES ('BuildCorp Management', '')");
    }

    // Insert default admin if not exists
    const adminRes = await client.query("SELECT * FROM users WHERE username = 'admin'");
    if (adminRes.rows.length === 0) {
      const hashedPassword = await bcrypt.hash('admin123', 10);
      await client.query(
        "INSERT INTO users (username, password, role, full_name, daily_rate, qr_code) VALUES ($1, $2, $3, $4, $5, $6)",
        ['admin', hashedPassword, 'admin', 'System Administrator', 0, 'ADMIN-QR']
      );
    }
    console.log('Database initialized successfully.');
  } catch (err) {
    console.error('Database initialization error:', err);
  } finally {
    client.release();
  }
}

initDB();

// Helper: Authentication Middleware
function isAuthenticated(req, res, next) {
  if (req.session && req.session.user) {
    return next();
  }
  res.redirect('/login');
}

function isAdmin(req, res, next) {
  if (req.session && req.session.user && req.session.user.role === 'admin') {
    return next();
  }
  res.status(403).send('Access Denied: Admins Only');
}

function isScanner(req, res, next) {
  if (req.session && req.session.user && (req.session.user.role === 'scanner' || req.session.user.role === 'admin')) {
    return next();
  }
  res.status(403).send('Access Denied: Scanners Only');
}

// ==================== HTML TEMPLATE ENGINE ====================
async function renderLayout(title, content, user, activeTab = '') {
  let settings = { company_name: 'BuildCorp Management', company_logo: '' };
  try {
    const res = await pool.query('SELECT * FROM settings WHERE id = 1');
    if (res.rows.length > 0) settings = res.rows[0];
  } catch (e) {}

  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title} - ${settings.company_name}</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <script src="https://cdn.jsdelivr.net/npm/html5-qrcode/minified/html5-qrcode.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
      body { font-family: 'Inter', sans-serif; }
    </style>
</head>
<body class="bg-gray-100 min-h-screen flex flex-col">
    <!-- Navbar -->
    <nav class="bg-slate-900 text-white shadow-md">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div class="flex justify-between h-16">
                <div class="flex items-center space-x-3">
                    ${settings.company_logo ? `<img src="${settings.company_logo}" class="h-10 w-10 object-contain rounded bg-white p-1">` : `<i class="fa-solid fa-hard-hat text-amber-500 text-2xl"></i>`}
                    <span class="font-bold text-lg tracking-wider">${settings.company_name}</span>
                </div>
                <div class="flex items-center space-x-4">
                    ${user ? `
                        <span class="text-sm text-gray-300 hidden sm:inline">Welcome, <b>${user.full_name}</b> (${user.role.toUpperCase()})</span>
                        <a href="/logout" class="bg-red-600 hover:bg-red-700 px-3 py-1.5 rounded text-sm font-medium transition"><i class="fa-solid fa-right-from-bracket mr-1"></i> Logout</a>
                    ` : `<a href="/login" class="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded text-sm font-medium transition">Login</a>`}
                </div>
            </div>
        </div>
    </nav>

    <!-- Main Container -->
    <div class="flex-grow max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        ${content}
    </div>

    <!-- Footer -->
    <footer class="bg-white border-t border-gray-200 py-4 text-center text-sm text-gray-500">
        &copy; ${new Date().getFullYear()} ${settings.company_name}. All rights reserved. Construction Worker Management System.
    </footer>
</body>
</html>
  `;
}

// ==================== ROUTES ====================

// Login Page
app.get('/login', async (req, res) => {
  if (req.session && req.session.user) {
    if (req.session.user.role === 'admin') return res.redirect('/admin');
    if (req.session.user.role === 'scanner') return res.redirect('/scanner');
    return res.redirect('/worker');
  }

  const html = `
    <div class="flex items-center justify-center flex-grow py-12">
      <div class="bg-white p-8 rounded-xl shadow-lg w-full max-w-md border border-gray-200">
        <div class="text-center mb-6">
          <div class="inline-flex bg-amber-100 text-amber-600 p-3 rounded-full mb-3 text-2xl">
            <i class="fa-solid fa-helmet-safety"></i>
          </div>
          <h2 class="text-2xl font-bold text-gray-800">Worker Management System</h2>
          <p class="text-sm text-gray-500">Sign in to your portal</p>
        </div>
        
        <form action="/login" method="POST" class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Username</label>
            <input type="text" name="username" required class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500">
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Password</label>
            <input type="password" name="password" required class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500">
          </div>
          <button type="submit" class="w-full bg-slate-900 hover:bg-slate-800 text-white font-medium py-2.5 rounded-lg transition">Sign In</button>
        </form>
      </div>
    </div>
  `;
  res.send(await renderLayout('Login', html, null));
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    if (result.rows.length === 0) return res.redirect('/login?error=InvalidCredentials');
    
    const user = result.rows[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.redirect('/login?error=InvalidCredentials');

    req.session.user = { id: user.id, username: user.username, role: user.role, full_name: user.full_name };
    
    if (user.role === 'admin') res.redirect('/admin');
    else if (user.role === 'scanner') res.redirect('/scanner');
    else res.redirect('/worker');
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

// Root redirect
app.get('/', (req, res) => {
  res.redirect('/login');
});

// ==================== ADMIN PORTAL ====================
app.get('/admin', isAuthenticated, isAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    const workersRes = await client.query("SELECT * FROM users WHERE role = 'worker' ORDER BY id DESC");
    const scannersRes = await client.query("SELECT * FROM users WHERE role = 'scanner' ORDER BY id DESC");
    const announcementsRes = await client.query("SELECT * FROM announcements ORDER BY created_at DESC");
    const settingsRes = await client.query("SELECT * FROM settings WHERE id = 1");
    const settings = settingsRes.rows[0];

    const workers = workersRes.rows;
    const announcements = announcementsRes.rows;
    const scanners = scannersRes.rows;

    // Calculate Salaries & Attendance for each worker for current month
    const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
    let workerData = [];

    for (let w of workers) {
      // Get attendance for current month
      const attRes = await client.query(`
        SELECT * FROM attendance 
        WHERE worker_id = $1 AND TO_CHAR(date_stamp, 'YYYY-MM') = $2 
        ORDER BY timestamp ASC
      `, [w.id, currentMonth]);

      const attRecords = attRes.rows;

      // Calculate working hours & days
      let totalMinutes = 0;
      let daysWorkedSet = new Set();
      let dailyMap = {};

      attRecords.forEach(r => {
        const dStr = r.date_stamp.toISOString().slice(0, 10);
        if (!dailyMap[dStr]) dailyMap[dStr] = [];
        dailyMap[dStr].push(r);
      });

      let fullDays = 0;
      let halfDays = 0;

      Object.keys(dailyMap).forEach(date => {
        let recs = dailyMap[date];
        let dayMinutes = 0;
        let lastIn = null;

        recs.forEach(r => {
          if (r.type === 'IN') {
            lastIn = new Date(r.timestamp);
          } else if (r.type === 'OUT' && lastIn) {
            let outTime = new Date(r.timestamp);
            let diff = (outTime - lastIn) / (1000 * 60); // minutes
            if (diff > 0) dayMinutes += diff;
            lastIn = null;
          }
        });

        if (dayMinutes > 0) {
          totalMinutes += dayMinutes;
          daysWorkedSet.add(date);
          if (dayMinutes >= 360) { // 6 hours or more considered Full Day
            fullDays++;
          } else {
            halfDays++;
          }
        }
      });

      // Get Advances for current month
      const advRes = await client.query(`
        SELECT SUM(amount) as total_adv FROM advances 
        WHERE worker_id = $1 AND TO_CHAR(date, 'YYYY-MM') = $2
      `, [w.id, currentMonth]);
      const totalAdvances = parseFloat(advRes.rows[0].total_adv || 0);

      // Salary calculation based on full days and half days (half day = 0.5 rate)
      const earnedSalary = (fullDays * parseFloat(w.daily_rate)) + (halfDays * (parseFloat(w.daily_rate) / 2));
      const netSalary = earnedSalary - totalAdvances;

      workerData.push({
        ...w,
        fullDays,
        halfDays,
        totalHours: (totalMinutes / 60).toFixed(1),
        totalAdvances,
        earnedSalary: earnedSalary.toFixed(2),
        netSalary: netSalary.toFixed(2)
      });
    }

    const content = `
      <div class="space-y-6">
        <!-- Dashboard Header & Tabs -->
        <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-6 rounded-xl shadow-sm border border-gray-200">
          <div>
            <h1 class="text-2xl font-bold text-gray-800">Admin Dashboard</h1>
            <p class="text-sm text-gray-500">Manage workers, attendance, payroll, and company settings.</p>
          </div>
          <div class="flex flex-wrap gap-2">
            <button onclick="switchTab('workers')" id="btn-workers" class="tab-btn px-4 py-2 rounded-lg font-medium text-sm bg-slate-900 text-white transition">Workers & Payroll</button>
            <button onclick="switchTab('scanners')" id="btn-scanners" class="tab-btn px-4 py-2 rounded-lg font-medium text-sm bg-gray-200 text-gray-700 transition">Scanner Accounts</button>
            <button onclick="switchTab('announcements')" id="btn-announcements" class="tab-btn px-4 py-2 rounded-lg font-medium text-sm bg-gray-200 text-gray-700 transition">Announcements</button>
            <button onclick="switchTab('settings')" id="btn-settings" class="tab-btn px-4 py-2 rounded-lg font-medium text-sm bg-gray-200 text-gray-700 transition">Company Settings</button>
          </div>
        </div>

        <!-- TAB 1: WORKERS & PAYROLL -->
        <div id="tab-workers" class="tab-content space-y-6">
          <div class="flex justify-between items-center">
            <h2 class="text-xl font-bold text-gray-800">Worker Directory & Monthly Payroll (${currentMonth})</h2>
            <button onclick="openModal('workerModal')" class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition flex items-center gap-2"><i class="fa-solid fa-user-plus"></i> Add Worker</button>
          </div>

          <div class="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div class="overflow-x-auto">
              <table class="min-w-full divide-y divide-gray-200 text-left text-sm">
                <thead class="bg-gray-50 text-gray-600 font-semibold">
                  <tr>
                    <th class="px-6 py-3">Worker Name</th>
                    <th class="px-6 py-3">Phone</th>
                    <th class="px-6 py-3">Daily Rate</th>
                    <th class="px-6 py-3">Full / Half Days</th>
                    <th class="px-6 py-3">Total Hours</th>
                    <th class="px-6 py-3">Advances</th>
                    <th class="px-6 py-3">Net Salary</th>
                    <th class="px-6 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-gray-200">
                  ${workerData.length === 0 ? `<tr><td colspan="8" class="px-6 py-4 text-center text-gray-500">No workers found.</td></tr>` : ''}
                  ${workerData.map(w => `
                    <tr class="hover:bg-gray-50">
                      <td class="px-6 py-4 font-medium text-gray-900 flex items-center gap-3">
                        <div class="bg-amber-100 text-amber-800 w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs">${w.full_name.charAt(0)}</div>
                        <div>
                          <div>${w.full_name}</div>
                          <div class="text-xs text-gray-500">@${w.username}</div>
                        </div>
                      </td>
                      <td class="px-6 py-4 text-gray-600">${w.phone || 'N/A'}</td>
                      <td class="px-6 py-4 font-semibold text-gray-800">₱${w.daily_rate}</td>
                      <td class="px-6 py-4 text-gray-600"><span class="text-green-600 font-semibold">${w.fullDays} Full</span> / <span class="text-amber-600 font-semibold">${w.halfDays} Half</span></td>
                      <td class="px-6 py-4 text-gray-600">${w.totalHours} hrs</td>
                      <td class="px-6 py-4 text-red-600 font-medium">₱${w.totalAdvances}</td>
                      <td class="px-6 py-4 font-bold text-emerald-600">₱${w.netSalary}</td>
                      <td class="px-6 py-4 text-right space-x-2">
                        <button onclick='showQR(${JSON.stringify(w.qr_code)}, ${JSON.stringify(w.full_name)})' class="text-blue-600 hover:text-blue-800 font-medium" title="View QR"><i class="fa-solid fa-qrcode"></i></button>
                        <button onclick='openAdvanceModal(${w.id}, ${JSON.stringify(w.full_name)})' class="text-amber-600 hover:text-amber-800 font-medium" title="Issue Advance"><i class="fa-solid fa-peso-sign"></i></button>
                        <form action="/admin/worker/delete" method="POST" class="inline" onsubmit="return confirm('Delete worker?')">
                          <input type="hidden" name="id" value="${w.id}">
                          <button type="submit" class="text-red-600 hover:text-red-800 font-medium" title="Delete"><i class="fa-solid fa-trash"></i></button>
                        </form>
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <!-- TAB 2: SCANNERS -->
        <div id="tab-scanners" class="tab-content space-y-6 hidden">
          <div class="flex justify-between items-center">
            <h2 class="text-xl font-bold text-gray-800">Attendance Scanner Accounts</h2>
            <button onclick="openModal('scannerModal')" class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition flex items-center gap-2"><i class="fa-solid fa-user-plus"></i> Add Scanner</button>
          </div>

          <div class="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <table class="min-w-full divide-y divide-gray-200 text-left text-sm">
              <thead class="bg-gray-50 text-gray-600 font-semibold">
                <tr>
                  <th class="px-6 py-3">Name</th>
                  <th class="px-6 py-3">Username</th>
                  <th class="px-6 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-200">
                ${scanners.length === 0 ? `<tr><td colspan="3" class="px-6 py-4 text-center text-gray-500">No scanner accounts found.</td></tr>` : ''}
                ${scanners.map(s => `
                  <tr>
                    <td class="px-6 py-4 font-medium text-gray-900">${s.full_name}</td>
                    <td class="px-6 py-4 text-gray-600">@${s.username}</td>
                    <td class="px-6 py-4 text-right">
                      <form action="/admin/scanner/delete" method="POST" class="inline" onsubmit="return confirm('Delete scanner account?')">
                        <input type="hidden" name="id" value="${s.id}">
                        <button type="submit" class="text-red-600 hover:text-red-800 font-medium"><i class="fa-solid fa-trash"></i> Delete</button>
                      </form>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <!-- TAB 3: ANNOUNCEMENTS -->
        <div id="tab-announcements" class="tab-content space-y-6 hidden">
          <div class="flex justify-between items-center">
            <h2 class="text-xl font-bold text-gray-800">Company Announcements</h2>
            <button onclick="openModal('announcementModal')" class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition flex items-center gap-2"><i class="fa-solid fa-bullhorn"></i> New Announcement</button>
          </div>

          <div class="space-y-4">
            ${announcements.length === 0 ? `<div class="bg-white p-6 rounded-xl border border-gray-200 text-center text-gray-500">No announcements posted yet.</div>` : ''}
            ${announcements.map(a => `
              <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-200 flex justify-between items-start">
                <div>
                  <h3 class="text-lg font-bold text-gray-800">${a.title}</h3>
                  <p class="text-sm text-gray-600 mt-1 whitespace-pre-line">${a.message}</p>
                  <span class="text-xs text-gray-400 mt-3 inline-block"><i class="fa-regular fa-clock"></i> ${new Date(a.created_at).toLocaleString()}</span>
                </div>
                <form action="/admin/announcement/delete" method="POST" onsubmit="return confirm('Delete announcement?')">
                  <input type="hidden" name="id" value="${a.id}">
                  <button type="submit" class="text-red-500 hover:text-red-700"><i class="fa-solid fa-trash"></i></button>
                </form>
              </div>
            `).join('')}
          </div>
        </div>

        <!-- TAB 4: SETTINGS -->
        <div id="tab-settings" class="tab-content space-y-6 hidden">
          <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-200 max-w-xl">
            <h2 class="text-xl font-bold text-gray-800 mb-4">Company Customization</h2>
            <form action="/admin/settings" method="POST" enctype="multipart/form-data" class="space-y-4">
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">Company Name</label>
                <input type="text" name="company_name" value="${settings.company_name}" required class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500">
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">Company Logo</label>
                ${settings.company_logo ? `<div class="mb-2"><img src="${settings.company_logo}" class="h-16 w-16 object-contain border rounded"></div>` : ''}
                <input type="file" name="company_logo" accept="image/*" class="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-50">
              </div>
              <button type="submit" class="bg-slate-900 hover:bg-slate-800 text-white font-medium px-4 py-2 rounded-lg transition">Save Changes</button>
            </form>
          </div>
        </div>
      </div>

      <!-- MODALS -->
      <!-- Add Worker Modal -->
      <div id="workerModal" class="fixed inset-0 bg-black bg-opacity-50 hidden items-center justify-center p-4 z-50">
        <div class="bg-white rounded-xl max-w-md w-full p-6 shadow-xl">
          <div class="flex justify-between items-center mb-4">
            <h3 class="text-lg font-bold text-gray-800">Add New Worker</h3>
            <button onclick="closeModal('workerModal')" class="text-gray-400 hover:text-gray-600"><i class="fa-solid fa-xmark text-xl"></i></button>
          </div>
          <form action="/admin/worker/add" method="POST" class="space-y-4">
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
              <input type="text" name="full_name" required class="w-full px-3 py-2 border border-gray-300 rounded-lg">
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Username</label>
              <input type="text" name="username" required class="w-full px-3 py-2 border border-gray-300 rounded-lg">
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Password</label>
              <input type="password" name="password" required class="w-full px-3 py-2 border border-gray-300 rounded-lg">
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Phone</label>
              <input type="text" name="phone" class="w-full px-3 py-2 border border-gray-300 rounded-lg">
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Daily Rate (₱)</label>
              <input type="number" step="0.01" name="daily_rate" value="500" required class="w-full px-3 py-2 border border-gray-300 rounded-lg">
            </div>
            <button type="submit" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 rounded-lg transition">Create Worker</button>
          </form>
        </div>
      </div>

      <!-- Add Scanner Modal -->
      <div id="scannerModal" class="fixed inset-0 bg-black bg-opacity-50 hidden items-center justify-center p-4 z-50">
        <div class="bg-white rounded-xl max-w-md w-full p-6 shadow-xl">
          <div class="flex justify-between items-center mb-4">
            <h3 class="text-lg font-bold text-gray-800">Add Scanner Account</h3>
            <button onclick="closeModal('scannerModal')" class="text-gray-400 hover:text-gray-600"><i class="fa-solid fa-xmark text-xl"></i></button>
          </div>
          <form action="/admin/scanner/add" method="POST" class="space-y-4">
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Full Name / Gate Name</label>
              <input type="text" name="full_name" required class="w-full px-3 py-2 border border-gray-300 rounded-lg">
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Username</label>
              <input type="text" name="username" required class="w-full px-3 py-2 border border-gray-300 rounded-lg">
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Password</label>
              <input type="password" name="password" required class="w-full px-3 py-2 border border-gray-300 rounded-lg">
            </div>
            <button type="submit" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 rounded-lg transition">Create Scanner</button>
          </form>
        </div>
      </div>

      <!-- Announcement Modal -->
      <div id="announcementModal" class="fixed inset-0 bg-black bg-opacity-50 hidden items-center justify-center p-4 z-50">
        <div class="bg-white rounded-xl max-w-md w-full p-6 shadow-xl">
          <div class="flex justify-between items-center mb-4">
            <h3 class="text-lg font-bold text-gray-800">Post Announcement</h3>
            <button onclick="closeModal('announcementModal')" class="text-gray-400 hover:text-gray-600"><i class="fa-solid fa-xmark text-xl"></i></button>
          </div>
          <form action="/admin/announcement/add" method="POST" class="space-y-4">
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Title</label>
              <input type="text" name="title" required class="w-full px-3 py-2 border border-gray-300 rounded-lg">
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Message</label>
              <textarea name="message" rows="4" required class="w-full px-3 py-2 border border-gray-300 rounded-lg"></textarea>
            </div>
            <button type="submit" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 rounded-lg transition">Post Announcement</button>
          </form>
        </div>
      </div>

      <!-- Advance Modal -->
      <div id="advanceModal" class="fixed inset-0 bg-black bg-opacity-50 hidden items-center justify-center p-4 z-50">
        <div class="bg-white rounded-xl max-w-md w-full p-6 shadow-xl">
          <div class="flex justify-between items-center mb-4">
            <h3 class="text-lg font-bold text-gray-800" id="advanceModalTitle">Issue Advance</h3>
            <button onclick="closeModal('advanceModal')" class="text-gray-400 hover:text-gray-600"><i class="fa-solid fa-xmark text-xl"></i></button>
          </div>
          <form action="/admin/advance/add" method="POST" class="space-y-4">
            <input type="hidden" name="worker_id" id="advanceWorkerId">
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Amount (₱)</label>
              <input type="number" step="0.01" name="amount" required class="w-full px-3 py-2 border border-gray-300 rounded-lg">
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Reason / Note</label>
              <input type="text" name="reason" class="w-full px-3 py-2 border border-gray-300 rounded-lg">
            </div>
            <button type="submit" class="w-full bg-amber-600 hover:bg-amber-700 text-white font-medium py-2 rounded-lg transition">Issue Advance Money</button>
          </form>
        </div>
      </div>

      <!-- QR View Modal -->
      <div id="qrModal" class="fixed inset-0 bg-black bg-opacity-50 hidden items-center justify-center p-4 z-50">
        <div class="bg-white rounded-xl max-w-sm w-full p-6 shadow-xl text-center">
          <div class="flex justify-between items-center mb-4">
            <h3 class="text-lg font-bold text-gray-800" id="qrWorkerName">Worker QR Code</h3>
            <button onclick="closeModal('qrModal')" class="text-gray-400 hover:text-gray-600"><i class="fa-solid fa-xmark text-xl"></i></button>
          </div>
          <div id="qrcode" class="flex justify-center my-4"></div>
          <button onclick="printQR()" class="w-full bg-slate-900 text-white py-2 rounded-lg font-medium">Print QR Code</button>
        </div>
      </div>

      <script>
        function switchTab(tabId) {
          document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
          document.querySelectorAll('.tab-btn').forEach(el => {
            el.classList.remove('bg-slate-900', 'text-white');
            el.classList.add('bg-gray-200', 'text-gray-700');
          });
          document.getElementById('tab-' + tabId).classList.remove('hidden');
          const btn = document.getElementById('btn-' + tabId);
          btn.classList.remove('bg-gray-200', 'text-gray-700');
          btn.classList.add('bg-slate-900', 'text-white');
        }

        function openModal(id) { document.getElementById(id).classList.remove('hidden'); document.getElementById(id).classList.add('flex'); }
        function closeModal(id) { document.getElementById(id).classList.add('hidden'); document.getElementById(id).classList.remove('flex'); }

        function openAdvanceModal(id, name) {
          document.getElementById('advanceWorkerId').value = id;
          document.getElementById('advanceModalTitle').innerText = 'Issue Advance for ' + name;
          openModal('advanceModal');
        }

        function showQR(code, name) {
          document.getElementById('qrWorkerName').innerText = name + ' QR Code';
          document.getElementById('qrcode').innerHTML = '';
          new QRCode(document.getElementById('qrcode'), {
            text: code,
            width: 200,
            height: 200
          });
          openModal('qrModal');
        }

        function printQR() {
          const div = document.getElementById('qrcode').innerHTML;
          const name = document.getElementById('qrWorkerName').innerText;
          const win = window('', '', 'height=500,width=500');
          win.document.write('<html><head><title>Print QR</title></head><body style="text-align:center;margin-top:50px;"><h2>' + name + '</h2>' + div + '</body></html>');
          win.document.close();
          win.focus();
          win.print();
        }
      </script>
    `;

    res.send(await renderLayout('Admin Portal', content, req.session.user));
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  } finally {
    client.release();
  }
});

// Admin Actions
app.post('/admin/worker/add', isAuthenticated, isAdmin, async (req, res) => {
  const { full_name, username, password, phone, daily_rate } = req.body;
  try {
    const hashed = await bcrypt.hash(password, 10);
    const qrCode = 'WORKER-' + Math.random().toString(36).substring(2, 10).toUpperCase();
    await pool.query(
      "INSERT INTO users (username, password, role, full_name, phone, daily_rate, qr_code) VALUES ($1, $2, 'worker', $3, $4, $5, $6)",
      [username, hashed, full_name, phone, daily_rate, qrCode]
    );
    res.redirect('/admin');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error adding worker');
  }
});

app.post('/admin/worker/delete', isAuthenticated, isAdmin, async (req, res) => {
  const { id } = req.body;
  try {
    await pool.query("DELETE FROM users WHERE id = $1 AND role = 'worker'", [id]);
    res.redirect('/admin');
  } catch (err) {
    res.status(500).send('Error deleting worker');
  }
});

app.post('/admin/scanner/add', isAuthenticated, isAdmin, async (req, res) => {
  const { full_name, username, password } = req.body;
  try {
    const hashed = await bcrypt.hash(password, 10);
    await pool.query(
      "INSERT INTO users (username, password, role, full_name, qr_code) VALUES ($1, $2, 'scanner', $3, 'SCANNER')",
      [username, hashed, full_name]
    );
    res.redirect('/admin');
  } catch (err) {
    res.status(500).send('Error adding scanner');
  }
});

app.post('/admin/scanner/delete', isAuthenticated, isAdmin, async (req, res) => {
  const { id } = req.body;
  try {
    await pool.query("DELETE FROM users WHERE id = $1 AND role = 'scanner'", [id]);
    res.redirect('/admin');
  } catch (err) {
    res.status(500).send('Error deleting scanner');
  }
});

app.post('/admin/announcement/add', isAuthenticated, isAdmin, async (req, res) => {
  const { title, message } = req.body;
  try {
    await pool.query("INSERT INTO announcements (title, message) VALUES ($1, $2)", [title, message]);
    res.redirect('/admin');
  } catch (err) {
    res.status(500).send('Error posting announcement');
  }
});

app.post('/admin/announcement/delete', isAuthenticated, isAdmin, async (req, res) => {
  const { id } = req.body;
  try {
    await pool.query("DELETE FROM announcements WHERE id = $1", [id]);
    res.redirect('/admin');
  } catch (err) {
    res.status(500).send('Error deleting announcement');
  }
});

app.post('/admin/advance/add', isAuthenticated, isAdmin, async (req, res) => {
  const { worker_id, amount, reason } = req.body;
  try {
    await pool.query("INSERT INTO advances (worker_id, amount, reason) VALUES ($1, $2, $3)", [worker_id, amount, reason]);
    res.redirect('/admin');
  } catch (err) {
    res.status(500).send('Error issuing advance');
  }
});

app.post('/admin/settings', isAuthenticated, isAdmin, async (req, res) => {
  const { company_name } = req.body;
  let logoUrl = '';
  if (req.files && req.files.company_logo) {
    const file = req.files.company_logo;
    logoUrl = `data:${file.mimetype};base64,${file.data.toString('base64')}`;
  }

  try {
    if (logoUrl) {
      await pool.query("UPDATE settings SET company_name = $1, company_logo = $2 WHERE id = 1", [company_name, logoUrl]);
    } else {
      await pool.query("UPDATE settings SET company_name = $1 WHERE id = 1", [company_name]);
    }
    res.redirect('/admin');
  } catch (err) {
    res.status(500).send('Error saving settings');
  }
});

// ==================== ATTENDANCE SCANNER PORTAL ====================
app.get('/scanner', isAuthenticated, isScanner, async (req, res) => {
  const client = await pool.connect();
  try {
    const todayRes = await client.query(`
      SELECT a.*, u.full_name, u.daily_rate FROM attendance a
      JOIN users u ON a.worker_id = u.id
      WHERE a.date_stamp = CURRENT_DATE
      ORDER BY a.timestamp DESC
    `);
    const logs = todayRes.rows;

    const content = `
      <div class="max-w-4xl mx-auto space-y-6">
        <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-200 flex flex-col sm:flex-row justify-between items-center gap-4">
          <div>
            <h1 class="text-2xl font-bold text-gray-800"><i class="fa-solid fa-qrcode text-amber-500 mr-2"></i> Attendance Scanner</h1>
            <p class="text-sm text-gray-500">Select IN or OUT mode before scanning worker QR codes.</p>
          </div>
          <!-- IN / OUT Selector -->
          <div class="flex bg-gray-100 p-1.5 rounded-xl border border-gray-200">
            <button onclick="setScanType('IN')" id="btn-type-in" class="px-6 py-2 rounded-lg font-bold text-sm bg-green-600 text-white transition shadow-sm">TIME IN</button>
            <button onclick="setScanType('OUT')" id="btn-type-out" class="px-6 py-2 rounded-lg font-bold text-sm text-gray-600 transition">TIME OUT</button>
          </div>
          <input type="hidden" id="scanType" value="IN">
        </div>

        <!-- Scanner View -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-200 flex flex-col items-center">
            <h2 class="text-lg font-bold text-gray-800 mb-3">Scan QR Code</h2>
            <div id="reader" class="w-full rounded-lg overflow-hidden border"></div>
            <div id="scanResult" class="mt-4 text-center font-bold text-lg"></div>
          </div>

          <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
            <h2 class="text-lg font-bold text-gray-800 mb-3">Today's Scans</h2>
            <div class="overflow-y-auto max-h-96 divide-y divide-gray-200" id="logsContainer">
              ${logs.length === 0 ? `<p class="text-gray-500 text-center py-4">No attendance scanned today yet.</p>` : ''}
              ${logs.map(l => `
                <div class="py-3 flex justify-between items-center">
                  <div>
                    <div class="font-bold text-gray-800">${l.full_name}</div>
                    <div class="text-xs text-gray-500">${new Date(l.timestamp).toLocaleTimeString()}</div>
                  </div>
                  <span class="px-2.5 py-1 rounded-full text-xs font-bold ${l.type === 'IN' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}">${l.type}</span>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      </div>

      <script>
        function setScanType(type) {
          document.getElementById('scanType').value = type;
          const btnIn = document.getElementById('btn-type-in');
          const btnOut = document.getElementById('btn-type-out');
          if (type === 'IN') {
            btnIn.className = 'px-6 py-2 rounded-lg font-bold text-sm bg-green-600 text-white transition shadow-sm';
            btnOut.className = 'px-6 py-2 rounded-lg font-bold text-sm text-gray-600 transition';
          } else {
            btnOut.className = 'px-6 py-2 rounded-lg font-bold text-sm bg-red-600 text-white transition shadow-sm';
            btnIn.className = 'px-6 py-2 rounded-lg font-bold text-sm text-gray-600 transition';
          }
        }

        let html5QrCode;
        function onScanSuccess(decodedText, decodedResult) {
          const type = document.getElementById('scanType').value;
          fetch('/scanner/record', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ qr_code: decodedText, type: type })
          })
          .then(res => res.json())
          .then(data => {
            const resDiv = document.getElementById('scanResult');
            if (data.success) {
              resDiv.innerHTML = '<span class="text-green-600"><i class="fa-solid fa-circle-check"></i> ' + data.message + '</span>';
              setTimeout(() => { window.location.reload(); }, 1500);
            } else {
              resDiv.innerHTML = '<span class="text-red-600"><i class="fa-solid fa-circle-xmark"></i> ' + data.message + '</span>';
            }
          })
          .catch(err => console.error(err));
        }

        const html5QrCodeScanner = new Html5QrcodeScanner("reader", { fps: 10, qrbox: 250 });
        html5QrCodeScanner.render(onScanSuccess);
      </script>
    `;

    res.send(await renderLayout('Scanner Portal', content, req.session.user));
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  } finally {
    client.release();
  }
});

app.post('/scanner/record', isAuthenticated, isScanner, async (req, res) => {
  const { qr_code, type } = req.body;
  try {
    const workerRes = await pool.query("SELECT * FROM users WHERE qr_code = $1 AND role = 'worker'", [qr_code]);
    if (workerRes.rows.length === 0) {
      return res.json({ success: false, message: 'Invalid Worker QR Code' });
    }

    const worker = workerRes.rows[0];
    await pool.query("INSERT INTO attendance (worker_id, type) VALUES ($1, $2)", [worker.id, type]);

    res.json({ success: true, message: `${worker.full_name} - Time ${type} Recorded Successfully!` });
  } catch (err) {
    console.error(err);
    res.json({ success: false, message: 'Database Error' });
  }
});

// ==================== WORKER PORTAL ====================
app.get('/worker', isAuthenticated, async (req, res) => {
  if (req.session.user.role !== 'worker') {
    if (req.session.user.role === 'admin') return res.redirect('/admin');
    if (req.session.user.role === 'scanner') return res.redirect('/scanner');
  }

  const client = await pool.connect();
  try {
    const workerId = req.session.user.id;
    const workerRes = await client.query("SELECT * FROM users WHERE id = $1", [workerId]);
    const worker = workerRes.rows[0];

    const currentMonth = new Date().toISOString().slice(0, 7);

    // Attendance records for current month
    const attRes = await client.query(`
      SELECT * FROM attendance 
      WHERE worker_id = $1 AND TO_CHAR(date_stamp, 'YYYY-MM') = $2 
      ORDER BY timestamp DESC
    `, [workerId, currentMonth]);
    const attendance = attRes.rows;

    // Advances for current month
    const advRes = await client.query(`
      SELECT * FROM advances 
      WHERE worker_id = $1 AND TO_CHAR(date, 'YYYY-MM') = $2 
      ORDER BY date DESC
    `, [workerId, currentMonth]);
    const advances = advRes.rows;

    // Announcements
    const annRes = await client.query("SELECT * FROM announcements ORDER BY created_at DESC LIMIT 5");
    const announcements = annRes.rows;

    // Calculate Summary Stats
    let totalMinutes = 0;
    let dailyMap = {};
    attendance.forEach(r => {
      let dStr = r.date_stamp.toISOString().slice(0, 10);
      if (!dailyMap[dStr]) dailyMap[dStr] = [];
      dailyMap[dStr].push(r);
    });

    let fullDays = 0;
    let halfDays = 0;
    Object.keys(dailyMap).forEach(date => {
      let recs = dailyMap[date];
      let dayMinutes = 0;
      let lastIn = null;
      recs.forEach(r => {
        if (r.type === 'IN') lastIn = new Date(r.timestamp);
        else if (r.type === 'OUT' && lastIn) {
          let outTime = new Date(r.timestamp);
          let diff = (outTime - lastIn) / (1000 * 60);
          if (diff > 0) dayMinutes += diff;
          lastIn = null;
        }
      });
      if (dayMinutes >= 360) fullDays++;
      else if (dayMinutes > 0) halfDays++;
    });

    const totalAdvances = advances.reduce((sum, a) => sum + parseFloat(a.amount), 0);
    const earnedSalary = (fullDays * parseFloat(worker.daily_rate)) + (halfDays * (parseFloat(worker.daily_rate) / 2));
    const netSalary = earnedSalary - totalAdvances;

    const content = `
      <div class="space-y-6">
        <!-- Worker Header & QR -->
        <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-200 flex flex-col md:flex-row justify-between items-center gap-6">
          <div class="space-y-2 text-center md:text-left">
            <h1 class="text-2xl font-bold text-gray-800">Hello, ${worker.full_name}</h1>
            <p class="text-sm text-gray-500">Daily Rate: <span class="font-bold text-gray-800">₱${worker.daily_rate}</span></p>
            <p class="text-sm text-gray-500">Phone: ${worker.phone || 'N/A'}</p>
          </div>
          <div class="bg-gray-50 p-4 rounded-xl border border-gray-200 text-center flex flex-col items-center">
            <div id="workerQR" class="mb-2"></div>
            <span class="text-xs text-gray-500 font-medium">Your Attendance QR</span>
          </div>
        </div>

        <!-- Stats Cards -->
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div class="bg-white p-5 rounded-xl shadow-sm border border-gray-200">
            <div class="text-sm text-gray-500 font-medium">Full Days Worked</div>
            <div class="text-2xl font-bold text-green-600 mt-1">${fullDays}</div>
          </div>
          <div class="bg-white p-5 rounded-xl shadow-sm border border-gray-200">
            <div class="text-sm text-gray-500 font-medium">Half Days Worked</div>
            <div class="text-2xl font-bold text-amber-600 mt-1">${halfDays}</div>
          </div>
          <div class="bg-white p-5 rounded-xl shadow-sm border border-gray-200">
            <div class="text-sm text-gray-500 font-medium">Total Advances</div>
            <div class="text-2xl font-bold text-red-600 mt-1">₱${totalAdvances.toFixed(2)}</div>
          </div>
          <div class="bg-white p-5 rounded-xl shadow-sm border border-gray-200">
            <div class="text-sm text-gray-500 font-medium">Estimated Net Salary</div>
            <div class="text-2xl font-bold text-emerald-600 mt-1">₱${netSalary.toFixed(2)}</div>
          </div>
        </div>

        <!-- Announcements & History Grid -->
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <!-- Announcements -->
          <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-200 space-y-4">
            <h2 class="text-lg font-bold text-gray-800"><i class="fa-solid fa-bullhorn text-amber-500 mr-2"></i> Company Announcements</h2>
            <div class="space-y-3">
              ${announcements.length === 0 ? `<p class="text-gray-500 text-sm">No announcements.</p>` : ''}
              ${announcements.map(a => `
                <div class="p-4 bg-gray-50 rounded-lg border border-gray-100">
                  <h3 class="font-bold text-gray-800 text-sm">${a.title}</h3>
                  <p class="text-xs text-gray-600 mt-1">${a.message}</p>
                  <span class="text-[10px] text-gray-400 mt-2 block">${new Date(a.created_at).toLocaleDateString()}</span>
                </div>
              `).join('')}
            </div>
          </div>

          <!-- Attendance Logs -->
          <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-200 space-y-4">
            <h2 class="text-lg font-bold text-gray-800"><i class="fa-solid fa-clock-rotate-left text-blue-500 mr-2"></i> Attendance Logs (${currentMonth})</h2>
            <div class="overflow-y-auto max-h-64 divide-y divide-gray-200 text-sm">
              ${attendance.length === 0 ? `<p class="text-gray-500 text-sm text-center py-4">No attendance records found.</p>` : ''}
              ${attendance.map(l => `
                <div class="py-2.5 flex justify-between items-center">
                  <div>
                    <span class="font-medium text-gray-800">${new Date(l.timestamp).toLocaleDateString()}</span>
                    <span class="text-xs text-gray-500 ml-2">${new Date(l.timestamp).toLocaleTimeString()}</span>
                  </div>
                  <span class="px-2 py-0.5 rounded text-xs font-bold ${l.type === 'IN' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}">${l.type}</span>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      </div>

      <script>
        new QRCode(document.getElementById('workerQR'), {
          text: "${worker.qr_code}",
          width: 140,
          height: 140
        });
      </script>
    `;

    res.send(await renderLayout('Worker Portal', content, req.session.user));
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  } finally {
    client.release();
  }
});

// Start Server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
