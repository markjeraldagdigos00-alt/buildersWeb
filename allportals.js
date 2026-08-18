const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

// PostgreSQL Connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

app.use(express.urlencoded({ extended: true }));
app.use(express.json({ limit: '10mb' }));

app.use(session({
  secret: process.env.SESSION_SECRET || 'construction_system_secret_key',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false }
}));

// Initialize Database Tables & Default Settings
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

      CREATE TABLE IF NOT EXISTS workers (
        id SERIAL PRIMARY KEY,
        worker_id VARCHAR(50) UNIQUE NOT NULL,
        full_name VARCHAR(255) NOT NULL,
        position VARCHAR(100) NOT NULL,
        contact_number VARCHAR(50),
        daily_rate NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
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
        amount NUMERIC(10, 2) NOT NULL,
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

      CREATE TABLE IF NOT EXISTS company_settings (
        id SERIAL PRIMARY KEY,
        company_name VARCHAR(255) DEFAULT 'BuildCorp Construction',
        company_logo TEXT DEFAULT '',
        company_address VARCHAR(255) DEFAULT '123 Construction Ave, Builders City',
        contact_number VARCHAR(50) DEFAULT '+1 234 567 8900'
      );

      CREATE TABLE IF NOT EXISTS work_schedules (
        id SERIAL PRIMARY KEY,
        morning_start TIME DEFAULT '07:00:00',
        morning_end TIME DEFAULT '12:00:00',
        afternoon_start TIME DEFAULT '13:00:00',
        afternoon_end TIME DEFAULT '17:00:00',
        full_day_hours NUMERIC(4, 2) DEFAULT 8.00,
        half_day_hours NUMERIC(4, 2) DEFAULT 4.00
      );
    `);

    const companyCheck = await pool.query('SELECT * FROM company_settings LIMIT 1');
    if (companyCheck.rows.length === 0) {
      await pool.query(`INSERT INTO company_settings (company_name, company_logo, company_address, contact_number) VALUES ('BuildCorp Construction', '', '123 Construction Ave', '+1 234 567 8900')`);
    }

    const scheduleCheck = await pool.query('SELECT * FROM work_schedules LIMIT 1');
    if (scheduleCheck.rows.length === 0) {
      await pool.query(`INSERT INTO work_schedules (morning_start, morning_end, afternoon_start, afternoon_end, full_day_hours, half_day_hours) VALUES ('07:00', '12:00', '13:00', '17:00', 8.00, 4.00)`);
    }

    console.log('Database initialized successfully.');
  } catch (err) {
    console.error('Database initialization error:', err);
  }
}
initDB();

async function getCompanySettings() {
  const res = await pool.query('SELECT * FROM company_settings LIMIT 1');
  return res.rows[0] || { company_name: 'BuildCorp', company_logo: '', company_address: '', contact_number: '' };
}

function requireRole(role) {
  return (req, res, next) => {
    if (!req.session.user || req.session.user.role !== role) {
      if (req.xhr || req.headers.accept.indexOf('json') > -1) {
        return res.status(403).json({ error: 'Access Denied: You do not have permission to access this portal.' });
      }
      return res.status(403).send(renderErrorPage('Access Denied: You do not have permission to access this portal.'));
    }
    next();
  };
}

function renderErrorPage(message) {
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>Access Denied</title>
      <style>
        body { font-family: Arial, sans-serif; background: #f4f7f6; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
        .card { background: white; padding: 40px; border-radius: 8px; box-shadow: 0 4px 15px rgba(0,0,0,0.1); text-align: center; max-width: 400px; }
        h1 { color: #e74c3c; margin-bottom: 20px; }
        p { color: #555; margin-bottom: 30px; }
        a { background: #34495e; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px; }
        a:hover { background: #2c3e50; }
      </style>
    </head>
    <body>
      <div class="card">
        <h1>Access Denied</h1>
        <p>${message}</p>
        <a href="/">Go Back Home</a>
      </div>
    </body>
    </html>
  `;
}

// ---------------------------------------------------------
// ROUTES: MAIN & SETUP
// ---------------------------------------------------------

app.get('/', async (req, res) => {
  try {
    const company = await getCompanySettings();
    const adminCheck = await pool.query("SELECT * FROM users WHERE role = 'ADMIN' LIMIT 1");
    const hasAdmin = adminCheck.rows.length > 0;

    res.send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${company.company_name} - Portal</title>
        <style>
          * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; }
          body { background: #f0f3f6; display: flex; justify-content: center; align-items: center; min-height: 100vh; color: #333; }
          .container { background: white; padding: 50px 40px; border-radius: 12px; box-shadow: 0 10px 25px rgba(0,0,0,0.08); text-align: center; width: 100%; max-width: 480px; }
          .logo { max-height: 90px; max-width: 100%; object-fit: contain; margin-bottom: 15px; }
          h1 { font-size: 24px; color: #2c3e50; margin-bottom: 30px; font-weight: 600; }
          .btn-group { display: flex; flex-direction: column; gap: 15px; }
          .btn { display: block; width: 100%; padding: 15px; font-size: 16px; font-weight: 600; text-decoration: none; color: white; background: #2c3e50; border-radius: 8px; transition: background 0.2s, transform 0.1s; box-shadow: 0 4px 6px rgba(0,0,0,0.05); }
          .btn:hover { background: #34495e; transform: translateY(-2px); }
          .btn-setup { background: #e67e22; }
          .btn-setup:hover { background: #d35400; }
          .footer { margin-top: 30px; font-size: 13px; color: #888; }
        </style>
      </head>
      <body>
        <div class="container">
          ${company.company_logo ? `<img src="${company.company_logo}" alt="Logo" class="logo">` : ''}
          <h1>${company.company_name}</h1>
          
          <div class="btn-group">
            ${!hasAdmin ? `
              <a href="/setup" class="btn btn-setup">SET UP SYSTEM (FIRST ADMIN)</a>
            ` : `
              <a href="/admin" class="btn">ADMIN PORTAL</a>
              <a href="/worker" class="btn">WORKER PORTAL</a>
              <a href="/scanner" class="btn">ATTENDANCE SCANNER</a>
            `}
          </div>
          <div class="footer">&copy; ${new Date().getFullYear()} ${company.company_name}. All Rights Reserved.</div>
        </div>
      </body>
      </html>
    `);
  } catch (err) {
    res.status(500).send('Server Error');
  }
});

app.get('/setup', async (req, res) => {
  const adminCheck = await pool.query("SELECT * FROM users WHERE role = 'ADMIN' LIMIT 1");
  if (adminCheck.rows.length > 0) {
    return res.redirect('/admin');
  }
  const company = await getCompanySettings();
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>First-Time Admin Setup</title>
      <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #f0f3f6; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; }
        .card { background: white; padding: 40px; border-radius: 12px; box-shadow: 0 10px 25px rgba(0,0,0,0.08); width: 100%; max-width: 450px; }
        h2 { color: #2c3e50; margin-bottom: 25px; text-align: center; }
        .form-group { margin-bottom: 15px; }
        label { display: block; margin-bottom: 5px; font-weight: 600; font-size: 14px; color: #555; }
        input { width: 100%; padding: 12px; border: 1px solid #ddd; border-radius: 6px; font-size: 14px; box-sizing: border-box; }
        button { width: 100%; padding: 12px; background: #e67e22; color: white; border: none; border-radius: 6px; font-size: 16px; font-weight: bold; cursor: pointer; margin-top: 10px; }
        button:hover { background: #d35400; }
        .error { color: #e74c3c; margin-bottom: 15px; text-align: center; font-size: 14px; }
      </style>
    </head>
    <body>
      <div class="card">
        <h2>First-Time Admin Setup</h2>
        ${req.query.error ? `<div class="error">${req.query.error}</div>` : ''}
        <form action="/setup" method="POST">
          <div class="form-group">
            <label>Full Name</label>
            <input type="text" name="full_name" required>
          </div>
          <div class="form-group">
            <label>Username</label>
            <input type="text" name="username" required>
          </div>
          <div class="form-group">
            <label>Email Address</label>
            <input type="email" name="email" required>
          </div>
          <div class="form-group">
            <label>Password</label>
            <input type="password" name="password" required>
          </div>
          <div class="form-group">
            <label>Confirm Password</label>
            <input type="password" name="confirm_password" required>
          </div>
          <button type="submit">Create Admin Account & Proceed</button>
        </form>
      </div>
    </body>
    </html>
  `);
});

app.post('/setup', async (req, res) => {
  const adminCheck = await pool.query("SELECT * FROM users WHERE role = 'ADMIN' LIMIT 1");
  if (adminCheck.rows.length > 0) return res.redirect('/admin');

  const { full_name, username, email, password, confirm_password } = req.body;
  if (!full_name || !username || !email || !password || !confirm_password) {
    return res.redirect('/setup?error=All fields are required');
  }
  if (password !== confirm_password) {
    return res.redirect('/setup?error=Passwords do not match');
  }

  try {
    const hash = await bcrypt.hash(password, 10);
    const newAdmin = await pool.query(
      'INSERT INTO users (full_name, username, email, password_hash, role) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [full_name, username, email, hash, 'ADMIN']
    );

    req.session.user = {
      id: newAdmin.rows[0].id,
      username: newAdmin.rows[0].username,
      full_name: newAdmin.rows[0].full_name,
      role: 'ADMIN'
    };

    res.redirect('/admin/settings?setup=true');
  } catch (err) {
    res.redirect(`/setup?error=${encodeURIComponent('Username or Email already exists')}`);
  }
});

// ---------------------------------------------------------
// AUTHENTICATION LOGINS & LOGOUTS
// ---------------------------------------------------------

app.get('/admin', async (req, res) => {
  const adminCheck = await pool.query("SELECT * FROM users WHERE role = 'ADMIN' LIMIT 1");
  if (adminCheck.rows.length === 0) return res.redirect('/setup');
  
  if (req.session.user && req.session.user.role === 'ADMIN') {
    return res.redirect('/admin/dashboard');
  }
  const company = await getCompanySettings();
  sendLoginPage(res, company, 'Admin Portal Login', '/admin');
});

app.post('/admin', async (req, res) => {
  handleLogin(req, res, 'ADMIN', '/admin/dashboard', '/admin');
});

app.get('/worker', async (req, res) => {
  if (req.session.user && req.session.user.role === 'WORKER') {
    return res.redirect('/worker/dashboard');
  }
  const company = await getCompanySettings();
  sendLoginPage(res, company, 'Worker Portal Login', '/worker');
});

app.post('/worker', async (req, res) => {
  handleLogin(req, res, 'WORKER', '/worker/dashboard', '/worker');
});

app.get('/scanner', async (req, res) => {
  if (req.session.user && req.session.user.role === 'SCANNER') {
    return res.redirect('/scanner/dashboard');
  }
  const company = await getCompanySettings();
  sendLoginPage(res, company, 'Attendance Scanner Login', '/scanner');
});

app.post('/scanner', async (req, res) => {
  handleLogin(req, res, 'SCANNER', '/scanner/dashboard', '/scanner');
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/');
  });
});

function sendLoginPage(res, company, title, portalUrl) {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>${title}</title>
      <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #f0f3f6; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; }
        .card { background: white; padding: 40px; border-radius: 12px; box-shadow: 0 10px 25px rgba(0,0,0,0.08); width: 100%; max-width: 400px; text-align: center; }
        .logo { max-height: 70px; max-width: 100%; object-fit: contain; margin-bottom: 15px; }
        h2 { color: #2c3e50; margin-bottom: 20px; font-size: 22px; }
        .form-group { margin-bottom: 15px; text-align: left; }
        label { display: block; margin-bottom: 5px; font-weight: 600; font-size: 14px; color: #555; }
        input { width: 100%; padding: 12px; border: 1px solid #ddd; border-radius: 6px; font-size: 14px; box-sizing: border-box; }
        button { width: 100%; padding: 12px; background: #2c3e50; color: white; border: none; border-radius: 6px; font-size: 16px; font-weight: bold; cursor: pointer; margin-top: 10px; }
        button:hover { background: #34495e; }
        .error { color: #e74c3c; margin-bottom: 15px; font-size: 14px; }
        .back { display: block; margin-top: 20px; color: #7f8c8d; text-decoration: none; font-size: 13px; }
        .back:hover { text-decoration: underline; }
      </style>
    </head>
    <body>
      <div class="card">
        ${company.company_logo ? `<img src="${company.company_logo}" alt="Logo" class="logo">` : ''}
        <h2>${title}</h2>
        <form action="${portalUrl}" method="POST">
          <div class="form-group">
            <label>Username or Email</label>
            <input type="text" name="username" required>
          </div>
          <div class="form-group">
            <label>Password</label>
            <input type="password" name="password" required>
          </div>
          <button type="submit">Login</button>
        </form>
        <a href="/" class="back">&larr; Back to Main Page</a>
      </div>
    </body>
    </html>
  `);
}

async function handleLogin(req, res, expectedRole, successRedirect, failUrl) {
  const { username, password } = req.body;
  try {
    const userResult = await pool.query('SELECT * FROM users WHERE username = $1 OR email = $1', [username]);
    if (userResult.rows.length === 0) {
      return res.send(renderErrorPage('Invalid username or password. <a href="' + failUrl + '">Try Again</a>'));
    }
    const user = userResult.rows[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.send(renderErrorPage('Invalid username or password. <a href="' + failUrl + '">Try Again</a>'));
    }
    if (!user.is_active) {
      return res.send(renderErrorPage('Account is deactivated. <a href="' + failUrl + '">Try Again</a>'));
    }
    if (user.role !== expectedRole) {
      return res.send(renderErrorPage('Access Denied: You do not have permission to access this portal.'));
    }

    req.session.user = {
      id: user.id,
      username: user.username,
      full_name: user.full_name,
      role: user.role
    };

    res.redirect(successRedirect);
  } catch (err) {
    res.status(500).send('Server Error');
  }
}

// ---------------------------------------------------------
// ADMIN PORTAL
// ---------------------------------------------------------

app.get('/admin/*', requireRole('ADMIN'), (req, res, next) => next());

app.get('/admin/dashboard', async (req, res) => {
  const company = await getCompanySettings();
  const todayStr = new Date().toISOString().split('T')[0];

  const totalWorkers = await pool.query('SELECT COUNT(*) FROM workers WHERE is_active = TRUE');
  const presentToday = await pool.query('SELECT COUNT(DISTINCT worker_id) FROM attendance_logs WHERE date = $1', [todayStr]);
  const recentLogs = await pool.query('SELECT al.*, w.full_name, w.position FROM attendance_logs al JOIN workers w ON al.worker_id = w.worker_id ORDER BY al.created_at DESC LIMIT 10');

  const workersList = await pool.query('SELECT worker_id FROM workers WHERE is_active = TRUE');
  const scheduleRes = await pool.query('SELECT * FROM work_schedules LIMIT 1');
  const schedule = scheduleRes.rows[0];

  let fullDayCount = 0;
  let halfDayCount = 0;

  for (let w of workersList.rows) {
    const logs = await pool.query('SELECT * FROM attendance_logs WHERE worker_id = $1 AND date = $2 ORDER BY time ASC', [w.worker_id, todayStr]);
    const status = calculateAttendanceStatus(logs.rows, schedule);
    if (status === 'FULL DAY') fullDayCount++;
    if (status === 'HALF DAY') halfDayCount++;
  }
  const absentCount = parseInt(totalWorkers.rows[0].count) - parseInt(presentToday.rows[0].count);

  res.send(renderAdminLayout('Dashboard', company, req.session.user, `
    <h2>Admin Dashboard</h2>
    <div class="stats-grid">
      <div class="stat-card"><h3>Total Workers</h3><p>${totalWorkers.rows[0].count}</p></div>
      <div class="stat-card"><h3>Present Today</h3><p>${presentToday.rows[0].count}</p></div>
      <div class="stat-card"><h3>Full Day Today</h3><p>${fullDayCount}</p></div>
      <div class="stat-card"><h3>Half Day Today</h3><p>${halfDayCount}</p></div>
      <div class="stat-card"><h3>Absent Today</h3><p>${absentCount < 0 ? 0 : absentCount}</p></div>
    </div>
    
    <div class="card-box" style="margin-top: 30px;">
      <h3>Recent Attendance Logs</h3>
      <table>
        <thead>
          <tr><th>Worker ID</th><th>Name</th><th>Position</th><th>Type</th><th>Time</th><th>Date</th></tr>
        </thead>
        <tbody>
          ${recentLogs.rows.map(l => `
            <tr>
              <td>${l.worker_id}</td>
              <td>${l.full_name}</td>
              <td>${l.position}</td>
              <td><span class="badge ${l.attendance_type === 'IN' ? 'badge-in' : 'badge-out'}">${l.attendance_type}</span></td>
              <td>${l.time}</td>
              <td>${l.date}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `));
});

// Workers Management
app.get('/admin/workers', async (req, res) => {
  const company = await getCompanySettings();
  const search = req.query.search || '';
  const workers = await pool.query(`SELECT * FROM workers WHERE full_name ILIKE $1 OR worker_id ILIKE $1 OR position ILIKE $1 ORDER BY created_at DESC`, [`%${search}%`]);

  res.send(renderAdminLayout('Workers', company, req.session.user, `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
      <h2>Worker Management</h2>
      <a href="/admin/workers/register" class="btn-primary">+ Register New Worker</a>
    </div>

    <form method="GET" action="/admin/workers" style="margin-bottom: 20px; display: flex; gap: 10px;">
      <input type="text" name="search" value="${search}" placeholder="Search by name, ID or position..." style="padding: 10px; width: 300px; border: 1px solid #ddd; border-radius: 6px;">
      <button type="submit" class="btn-primary" style="padding: 10px 20px;">Search</button>
    </form>

    <div class="card-box">
      <table>
        <thead>
          <tr><th>ID</th><th>Photo</th><th>Name</th><th>Position</th><th>Daily Rate</th><th>Project</th><th>Status</th><th>Actions</th></tr>
        </thead>
        <tbody>
          ${workers.rows.map(w => `
            <tr>
              <td>${w.worker_id}</td>
              <td>${w.profile_picture ? `<img src="${w.profile_picture}" style="width:40px; height:40px; border-radius:50%; object-fit:cover;">` : 'N/A'}</td>
              <td><strong>${w.full_name}</strong></td>
              <td>${w.position}</td>
              <td>₱${parseFloat(w.daily_rate).toFixed(2)}</td>
              <td>${w.assigned_project || 'N/A'}</td>
              <td><span class="badge ${w.is_active ? 'badge-in' : 'badge-out'}">${w.is_active ? 'Active' : 'Inactive'}</span></td>
              <td>
                <a href="/admin/workers/view/${w.id}" class="action-btn">View QR</a>
                <a href="/admin/workers/edit/${w.id}" class="action-btn">Edit</a>
                <a href="/admin/workers/toggle/${w.id}" class="action-btn" style="background:${w.is_active ? '#e74c3c' : '#27ae60'}">${w.is_active ? 'Deactivate' : 'Activate'}</a>
                <a href="/admin/workers/delete/${w.id}" class="action-btn" style="background:#c0392b;" onclick="return confirm('Delete worker?')">Delete</a>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `));
});

app.get('/admin/workers/register', async (req, res) => {
  const company = await getCompanySettings();
  res.send(renderAdminLayout('Register Worker', company, req.session.user, `
    <h2>Register New Worker</h2>
    <form action="/admin/workers/register" method="POST" class="form-grid">
      <div class="form-group">
        <label>Full Name</label>
        <input type="text" name="full_name" required>
      </div>
      <div class="form-group">
        <label>Position</label>
        <input type="text" name="position" required>
      </div>
      <div class="form-group">
        <label>Contact Number</label>
        <input type="text" name="contact_number">
      </div>
      <div class="form-group">
        <label>Daily Rate (₱)</label>
        <input type="number" step="0.01" name="daily_rate" required>
      </div>
      <div class="form-group">
        <label>Assigned Project</label>
        <input type="text" name="assigned_project">
      </div>
      <div class="form-group">
        <label>Profile Picture URL / Base64</label>
        <input type="text" name="profile_picture" placeholder="https://...">
      </div>
      <div class="form-group">
        <label>Portal Username</label>
        <input type="text" name="username" required>
      </div>
      <div class="form-group">
        <label>Portal Password</label>
        <input type="password" name="password" required>
      </div>
      <div style="grid-column: span 2;">
        <button type="submit" class="btn-primary" style="width: 100%; padding: 12px;">Register Worker & Generate QR</button>
      </div>
    </form>
  `));
});

app.post('/admin/workers/register', async (req, res) => {
  const { full_name, position, contact_number, daily_rate, assigned_project, profile_picture, username, password } = req.body;
  try {
    const hash = await bcrypt.hash(password, 10);
    const userRes = await pool.query(
      'INSERT INTO users (full_name, username, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id',
      [full_name, username, hash, 'WORKER']
    );
    const userId = userRes.rows[0].id;

    const countRes = await pool.query('SELECT COUNT(*) FROM workers');
    const workerId = `W-${String(parseInt(countRes.rows[0].count) + 1).padStart(3, '0')}`;

    const qrData = JSON.stringify({ worker_id: workerId, name: full_name });
    const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(qrData)}`;

    await pool.query(
      'INSERT INTO workers (worker_id, full_name, position, contact_number, daily_rate, assigned_project, profile_picture, qr_code, user_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
      [workerId, full_name, position, contact_number, daily_rate, assigned_project, profile_picture, qrCodeUrl, userId]
    );

    res.redirect('/admin/workers');
  } catch (err) {
    res.status(500).send('Error registering worker: ' + err.message);
  }
});

app.get('/admin/workers/view/:id', async (req, res) => {
  const company = await getCompanySettings();
  const workerRes = await pool.query('SELECT * FROM workers WHERE id = $1', [req.params.id]);
  if (workerRes.rows.length === 0) return res.redirect('/admin/workers');
  const w = workerRes.rows[0];

  res.send(renderAdminLayout('Worker Profile & QR', company, req.session.user, `
    <h2>Worker Profile & QR Code</h2>
    <div class="card-box" style="display: flex; gap: 30px; align-items: center;">
      <div>
        ${w.profile_picture ? `<img src="${w.profile_picture}" style="width:120px; height:120px; border-radius:50%; object-fit:cover; margin-bottom:15px;">` : ''}
        <h3>${w.full_name}</h3>
        <p><strong>ID:</strong> ${w.worker_id}</p>
        <p><strong>Position:</strong> ${w.position}</p>
        <p><strong>Project:</strong> ${w.assigned_project || 'N/A'}</p>
        <p><strong>Daily Rate:</strong> ₱${parseFloat(w.daily_rate).toFixed(2)}</p>
      </div>
      <div style="text-align: center; border-left: 2px solid #eee; padding-left: 30px;">
        <img src="${w.qr_code}" alt="QR Code" style="width: 200px; height: 200px;"><br>
        <a href="${w.qr_code}" download="QR_${w.worker_id}.png" target="_blank" class="btn-primary" style="margin-top: 10px; display:inline-block; text-decoration:none;">Download QR Code</a>
      </div>
    </div>
    <a href="/admin/workers" class="action-btn" style="margin-top:20px; display:inline-block;">&larr; Back to Workers</a>
  `));
});

app.get('/admin/workers/toggle/:id', async (req, res) => {
  await pool.query('UPDATE workers SET is_active = NOT is_active WHERE id = $1', [req.params.id]);
  res.redirect('/admin/workers');
});

app.get('/admin/workers/delete/:id', async (req, res) => {
  const wRes = await pool.query('SELECT user_id FROM workers WHERE id = $1', [req.params.id]);
  if (wRes.rows.length > 0) {
    const userId = wRes.rows[0].user_id;
    await pool.query('DELETE FROM workers WHERE id = $1', [req.params.id]);
    if (userId) await pool.query('DELETE FROM users WHERE id = $1', [userId]);
  }
  res.redirect('/admin/workers');
});

// Attendance Management
app.get('/admin/attendance', async (req, res) => {
  const company = await getCompanySettings();
  const date = req.query.date || new Date().toISOString().split('T')[0];
  const search = req.query.search || '';

  const workers = await pool.query(`SELECT * FROM workers WHERE (full_name ILIKE $1 OR worker_id ILIKE $1) AND is_active = TRUE`, [`%${search}%`]);
  const scheduleRes = await pool.query('SELECT * FROM work_schedules LIMIT 1');
  const schedule = scheduleRes.rows[0];

  let attendanceData = [];
  for (let w of workers.rows) {
    const logsRes = await pool.query('SELECT * FROM attendance_logs WHERE worker_id = $1 AND date = $2 ORDER BY time ASC', [w.worker_id, date]);
    const logs = logsRes.rows;
    const status = calculateAttendanceStatus(logs, schedule);
    const totalHours = calculateWorkingHours(logs);

    attendanceData.push({
      worker: w,
      logs: logs,
      first_in: logs.find(l => l.attendance_type === 'IN')?.time || 'N/A',
      first_out: logs.filter(l => l.attendance_type === 'OUT')[0]?.time || 'N/A',
      second_in: logs.filter(l => l.attendance_type === 'IN')[1]?.time || 'N/A',
      final_out: logs.filter(l => l.attendance_type === 'OUT').reverse()[0]?.time || 'N/A',
      total_hours: totalHours,
      status: status
    });
  }

  res.send(renderAdminLayout('Attendance Management', company, req.session.user, `
    <h2>Attendance Management</h2>
    <form method="GET" action="/admin/attendance" style="margin-bottom: 20px; display: flex; gap: 10px;">
      <input type="date" name="date" value="${date}" style="padding: 10px; border: 1px solid #ddd; border-radius: 6px;">
      <input type="text" name="search" value="${search}" placeholder="Search worker name or ID..." style="padding: 10px; width: 250px; border: 1px solid #ddd; border-radius: 6px;">
      <button type="submit" class="btn-primary" style="padding: 10px 20px;">Filter</button>
    </form>

    <div class="card-box">
      <table>
        <thead>
          <tr><th>Worker ID</th><th>Name</th><th>Position</th><th>First IN</th><th>First OUT</th><th>Second IN</th><th>Final OUT</th><th>Total Hours</th><th>Status</th></tr>
        </thead>
        <tbody>
          ${attendanceData.map(d => `
            <tr>
              <td>${d.worker.worker_id}</td>
              <td><strong>${d.worker.full_name}</strong></td>
              <td>${d.worker.position}</td>
              <td>${d.first_in}</td>
              <td>${d.first_out}</td>
              <td>${d.second_in}</td>
              <td>${d.final_out}</td>
              <td>${d.total_hours} Hours</td>
              <td><span class="badge ${d.status === 'FULL DAY' ? 'badge-in' : d.status === 'HALF DAY' ? 'badge-out' : ''}">${d.status}</span></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `));
});

// Advance Money Management
app.get('/admin/advance', async (req, res) => {
  const company = await getCompanySettings();
  const workers = await pool.query('SELECT * FROM workers WHERE is_active = TRUE');
  const advances = await pool.query('SELECT am.*, w.full_name FROM advance_money am JOIN workers w ON am.worker_id = w.worker_id ORDER BY am.date DESC');

  res.send(renderAdminLayout('Advance Money', company, req.session.user, `
    <h2>Advance Money Management</h2>
    <div style="display: grid; grid-template-columns: 1fr 2fr; gap: 20px;">
      <div class="card-box">
        <h3>Record Advance</h3>
        <form action="/admin/advance" method="POST" style="display: flex; flex-direction: column; gap: 15px; margin-top: 15px;">
          <div>
            <label>Select Worker</label>
            <select name="worker_id" required style="width:100%; padding:10px; border:1px solid #ddd; border-radius:6px;">
              ${workers.rows.map(w => `<option value="${w.worker_id}">${w.full_name} (${w.worker_id})</option>`).join('')}
            </select>
          </div>
          <div>
            <label>Amount (₱)</label>
            <input type="number" step="0.01" name="amount" required style="width:100%; padding:10px; border:1px solid #ddd; border-radius:6px; box-sizing:border-box;">
          </div>
          <div>
            <label>Date</label>
            <input type="date" name="date" value="${new Date().toISOString().split('T')[0]}" required style="width:100%; padding:10px; border:1px solid #ddd; border-radius:6px; box-sizing:border-box;">
          </div>
          <div>
            <label>Reason / Notes</label>
            <textarea name="reason" style="width:100%; padding:10px; border:1px solid #ddd; border-radius:6px; box-sizing:border-box;"></textarea>
          </div>
          <button type="submit" class="btn-primary" style="padding: 12px;">Save Advance</button>
        </form>
      </div>

      <div class="card-box">
        <h3>Advance History</h3>
        <table>
          <thead>
            <tr><th>Date</th><th>Worker</th><th>Amount</th><th>Reason</th></tr>
          </thead>
          <tbody>
            ${advances.rows.map(a => `
              <tr>
                <td>${a.date}</td>
                <td>${a.full_name}</td>
                <td>₱${parseFloat(a.amount).toFixed(2)}</td>
                <td>${a.reason || 'N/A'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `));
});

app.post('/admin/advance', async (req, res) => {
  const { worker_id, amount, date, reason } = req.body;
  await pool.query('INSERT INTO advance_money (worker_id, amount, date, reason) VALUES ($1, $2, $3, $4)', [worker_id, amount, date, reason]);
  res.redirect('/admin/advance');
});

// Salary Management
app.get('/admin/salary', async (req, res) => {
  const company = await getCompanySettings();
  const workers = await pool.query('SELECT * FROM workers WHERE is_active = TRUE');
  const scheduleRes = await pool.query('SELECT * FROM work_schedules LIMIT 1');
  const schedule = scheduleRes.rows[0];

  let salaryData = [];
  for (let w of workers.rows) {
    const logsRes = await pool.query('SELECT * FROM attendance_logs WHERE worker_id = $1 ORDER BY date ASC, time ASC', [w.worker_id]);
    const logs = logsRes.rows;

    const grouped = {};
    logs.forEach(l => {
      const d = l.date.toISOString().split('T')[0];
      if (!grouped[d]) grouped[d] = [];
      grouped[d].push(l);
    });

    let fullDays = 0;
    let halfDays = 0;
    for (let d in grouped) {
      const status = calculateAttendanceStatus(grouped[d], schedule);
      if (status === 'FULL DAY') fullDays++;
      if (status === 'HALF DAY') halfDays++;
    }

    const equivalentDays = fullDays + (halfDays * 0.5);
    const totalSalary = equivalentDays * parseFloat(w.daily_rate);

    const advRes = await pool.query('SELECT SUM(amount) as total FROM advance_money WHERE worker_id = $1', [w.worker_id]);
    const totalAdvance = parseFloat(advRes.rows[0].total || 0);
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

  res.send(renderAdminLayout('Salary Management', company, req.session.user, `
    <h2>Salary Management</h2>
    <div class="card-box">
      <table>
        <thead>
          <tr><th>Worker ID</th><th>Name</th><th>Daily Rate</th><th>Full Days</th><th>Half Days</th><th>Equivalent Days</th><th>Total Salary</th><th>Advance Ded.</th><th>Net Salary</th></tr>
        </thead>
        <tbody>
          ${salaryData.map(s => `
            <tr>
              <td>${s.worker.worker_id}</td>
              <td><strong>${s.worker.full_name}</strong></td>
              <td>₱${parseFloat(s.worker.daily_rate).toFixed(2)}</td>
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
  `));
});

// Announcements
app.get('/admin/announcements', async (req, res) => {
  const company = await getCompanySettings();
  const anns = await pool.query('SELECT * FROM announcements ORDER BY created_at DESC');

  res.send(renderAdminLayout('Announcements', company, req.session.user, `
    <h2>Announcements</h2>
    <div style="display: grid; grid-template-columns: 1fr 2fr; gap: 20px;">
      <div class="card-box">
        <h3>Post Announcement</h3>
        <form action="/admin/announcements" method="POST" style="display: flex; flex-direction: column; gap: 15px; margin-top: 15px;">
          <div>
            <label>Title</label>
            <input type="text" name="title" required style="width:100%; padding:10px; border:1px solid #ddd; border-radius:6px; box-sizing:border-box;">
          </div>
          <div>
            <label>Content</label>
            <textarea name="content" required rows="4" style="width:100%; padding:10px; border:1px solid #ddd; border-radius:6px; box-sizing:border-box;"></textarea>
          </div>
          <button type="submit" class="btn-primary" style="padding: 12px;">Publish Announcement</button>
        </form>
      </div>

      <div class="card-box">
        <h3>All Announcements</h3>
        ${anns.rows.map(a => `
          <div style="border-bottom: 1px solid #eee; padding: 15px 0;">
            <h4>${a.title}</h4>
            <p style="color: #666; font-size: 14px; margin: 5px 0;">${a.content}</p>
            <small style="color: #999;">${new Date(a.created_at).toLocaleString()}</small>
            <br><a href="/admin/announcements/delete/${a.id}" style="color: #e74c3c; font-size: 12px; text-decoration: none;">Delete</a>
          </div>
        `).join('')}
      </div>
    </div>
  `));
});

app.post('/admin/announcements', async (req, res) => {
  const { title, content } = req.body;
  await pool.query('INSERT INTO announcements (title, content) VALUES ($1, $2)', [title, content]);
  res.redirect('/admin/announcements');
});

app.get('/admin/announcements/delete/:id', async (req, res) => {
  await pool.query('DELETE FROM announcements WHERE id = $1', [req.params.id]);
  res.redirect('/admin/announcements');
});

// Company Settings
app.get('/admin/settings', async (req, res) => {
  const company = await getCompanySettings();
  const setupMsg = req.query.setup ? '<div style="background: #27ae60; color: white; padding: 10px; border-radius: 6px; margin-bottom: 20px;">Admin Account Created Successfully! Now please set your Company Information.</div>' : '';

  res.send(renderAdminLayout('Company Settings', company, req.session.user, `
    <h2>Company Settings</h2>
    ${setupMsg}
    <div class="card-box" style="max-width: 600px;">
      <form action="/admin/settings" method="POST" style="display: flex; flex-direction: column; gap: 15px;">
        <div>
          <label>Company / Builder Name</label>
          <input type="text" name="company_name" value="${company.company_name}" required style="width:100%; padding:10px; border:1px solid #ddd; border-radius:6px; box-sizing:border-box;">
        </div>
        <div>
          <label>Company Logo URL / Base64</label>
          <input type="text" name="company_logo" value="${company.company_logo}" style="width:100%; padding:10px; border:1px solid #ddd; border-radius:6px; box-sizing:border-box;">
        </div>
        <div>
          <label>Company Address</label>
          <input type="text" name="company_address" value="${company.company_address}" style="width:100%; padding:10px; border:1px solid #ddd; border-radius:6px; box-sizing:border-box;">
        </div>
        <div>
          <label>Contact Number</label>
          <input type="text" name="contact_number" value="${company.contact_number}" style="width:100%; padding:10px; border:1px solid #ddd; border-radius:6px; box-sizing:border-box;">
        </div>
        <button type="submit" class="btn-primary" style="padding: 12px;">Save Settings</button>
      </form>
    </div>
  `));
});

app.post('/admin/settings', async (req, res) => {
  const { company_name, company_logo, company_address, contact_number } = req.body;
  await pool.query('UPDATE company_settings SET company_name = $1, company_logo = $2, company_address = $3, contact_number = $4', [company_name, company_logo, company_address, contact_number]);
  res.redirect('/admin/settings');
});

// Work Schedule Settings
app.get('/admin/schedule', async (req, res) => {
  const company = await getCompanySettings();
  const scheduleRes = await pool.query('SELECT * FROM work_schedules LIMIT 1');
  const s = scheduleRes.rows[0];

  res.send(renderAdminLayout('Work Schedule Settings', company, req.session.user, `
    <h2>Work Schedule Settings</h2>
    <div class="card-box" style="max-width: 600px;">
      <form action="/admin/schedule" method="POST" class="form-grid">
        <div class="form-group">
          <label>Morning Start Time</label>
          <input type="time" name="morning_start" value="${s.morning_start}" required>
        </div>
        <div class="form-group">
          <label>Morning End Time</label>
          <input type="time" name="morning_end" value="${s.morning_end}" required>
        </div>
        <div class="form-group">
          <label>Afternoon Start Time</label>
          <input type="time" name="afternoon_start" value="${s.afternoon_start}" required>
        </div>
        <div class="form-group">
          <label>Afternoon End Time</label>
          <input type="time" name="afternoon_end" value="${s.afternoon_end}" required>
        </div>
        <div class="form-group">
          <label>Full Day Hours</label>
          <input type="number" step="0.5" name="full_day_hours" value="${s.full_day_hours}" required>
        </div>
        <div class="form-group">
          <label>Half Day Hours</label>
          <input type="number" step="0.5" name="half_day_hours" value="${s.half_day_hours}" required>
        </div>
        <div style="grid-column: span 2;">
          <button type="submit" class="btn-primary" style="width:100%; padding:12px;">Update Schedule</button>
        </div>
      </form>
    </div>
  `));
});

app.post('/admin/schedule', async (req, res) => {
  const { morning_start, morning_end, afternoon_start, afternoon_end, full_day_hours, half_day_hours } = req.body;
  await pool.query('UPDATE work_schedules SET morning_start = $1, morning_end = $2, afternoon_start = $3, afternoon_end = $4, full_day_hours = $5, half_day_hours = $6', [morning_start, morning_end, afternoon_start, afternoon_end, full_day_hours, half_day_hours]);
  res.redirect('/admin/schedule');
});

function renderAdminLayout(title, company, user, content) {
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>${title} - Admin Portal</title>
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; }
        body { background: #f4f7f6; display: flex; height: 100vh; overflow: hidden; }
        .sidebar { width: 260px; background: #2c3e50; color: white; display: flex; flex-direction: column; justify-content: space-between; }
        .sidebar-header { padding: 20px; text-align: center; border-bottom: 1px solid #34495e; }
        .sidebar-header img { max-height: 50px; max-width: 100%; object-fit: contain; margin-bottom: 10px; }
        .sidebar-menu { list-style: none; padding: 20px 0; overflow-y: auto; flex-grow: 1; }
        .sidebar-menu li a { display: block; padding: 12px 20px; color: #bdc3c7; text-decoration: none; font-size: 14px; transition: 0.2s; }
        .sidebar-menu li a:hover, .sidebar-menu li a.active { background: #34495e; color: white; border-left: 4px solid #3498db; }
        .main-content { flex-grow: 1; display: flex; flex-direction: column; overflow-y: auto; }
        .topbar { background: white; padding: 15px 30px; border-bottom: 1px solid #e1e8ed; display: flex; justify-content: space-between; align-items: center; }
        .content-body { padding: 30px; }
        .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 20px; margin-bottom: 25px; }
        .stat-card { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.04); border-left: 4px solid #3498db; }
        .stat-card h3 { font-size: 13px; color: #7f8c8d; margin-bottom: 5px; text-transform: uppercase; }
        .stat-card p { font-size: 24px; font-weight: bold; color: #2c3e50; }
        .card-box { background: white; padding: 25px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.04); }
        table { width: 100%; border-collapse: collapse; margin-top: 10px; }
        th, td { padding: 12px; text-align: left; border-bottom: 1px solid #eee; font-size: 14px; }
        th { background: #f8f9fa; color: #333; font-weight: 600; }
        .badge { padding: 5px 10px; border-radius: 12px; font-size: 11px; font-weight: bold; text-transform: uppercase; }
        .badge-in { background: #e8f8f5; color: #27ae60; }
        .badge-out { background: #fef5e7; color: #d35400; }
        .btn-primary { background: #3498db; color: white; padding: 10px 20px; border: none; border-radius: 6px; font-weight: 600; cursor: pointer; text-decoration: none; display: inline-block; }
        .btn-primary:hover { background: #2980b9; }
        .action-btn { background: #7f8c8d; color: white; padding: 5px 10px; border-radius: 4px; font-size: 12px; text-decoration: none; margin-right: 5px; }
        .action-btn:hover { background: #636e72; }
        .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
        .form-group { display: flex; flex-direction: column; gap: 8px; }
        .form-group label { font-weight: 600; font-size: 14px; color: #555; }
        .form-group input, .form-group textarea { padding: 12px; border: 1px solid #ddd; border-radius: 6px; font-size: 14px; box-sizing: border-box; }
      </style>
    </head>
    <body>
      <div class="sidebar">
        <div>
          <div class="sidebar-header">
            ${company.company_logo ? `<img src="${company.company_logo}" alt="Logo">` : ''}
            <h3 style="font-size: 16px;">${company.company_name}</h3>
          </div>
          <ul class="sidebar-menu">
            <li><a href="/admin/dashboard">Dashboard</a></li>
            <li><a href="/admin/workers">Workers</a></li>
            <li><a href="/admin/attendance">Attendance</a></li>
            <li><a href="/admin/advance">Advance Money</a></li>
            <li><a href="/admin/salary">Salary</a></li>
            <li><a href="/admin/announcements">Announcements</a></li>
            <li><a href="/admin/settings">Company Settings</a></li>
            <li><a href="/admin/schedule">Work Schedule</a></li>
          </ul>
        </div>
        <div style="padding: 20px; border-top: 1px solid #34495e; font-size: 13px;">
          <p>Logged in as: <strong>${user.full_name}</strong></p>
          <a href="/logout" style="color: #e74c3c; text-decoration: none; display: block; margin-top: 8px;">Logout</a>
        </div>
      </div>
      <div class="main-content">
        <div class="topbar">
          <h3>Admin Portal</h3>
          <span>${new Date().toLocaleDateString()}</span>
        </div>
        <div class="content-body">
          ${content}
        </div>
      </div>
    </body>
    </html>
  `;
}

// ---------------------------------------------------------
// WORKER PORTAL
// ---------------------------------------------------------

app.get('/worker/*', requireRole('WORKER'), (req, res, next) => next());

app.get('/worker/dashboard', async (req, res) => {
  const company = await getCompanySettings();
  const workerRes = await pool.query('SELECT * FROM workers WHERE user_id = $1', [req.session.user.id]);
  const w = workerRes.rows[0];
  const todayStr = new Date().toISOString().split('T')[0];

  const logsRes = await pool.query('SELECT * FROM attendance_logs WHERE worker_id = $1 AND date = $2 ORDER BY time ASC', [w.worker_id, todayStr]);
  const scheduleRes = await pool.query('SELECT * FROM work_schedules LIMIT 1');
  const status = calculateAttendanceStatus(logsRes.rows, scheduleRes.rows[0]);

  res.send(renderWorkerLayout('Dashboard', company, req.session.user, `
    <h2>Worker Dashboard</h2>
    <div class="card-box" style="display: flex; gap: 30px; align-items: center; margin-bottom: 25px;">
      ${w.profile_picture ? `<img src="${w.profile_picture}" style="width:100px; height:100px; border-radius:50%; object-fit:cover;">` : ''}
      <div>
        <h3>${w.full_name}</h3>
        <p><strong>Worker ID:</strong> ${w.worker_id}</p>
        <p><strong>Position:</strong> ${w.position}</p>
        <p><strong>Assigned Project:</strong> ${w.assigned_project || 'N/A'}</p>
      </div>
    </div>
    <div class="stats-grid">
      <div class="stat-card"><h3>Today's Status</h3><p>${status}</p></div>
    </div>
  `));
});

app.get('/worker/qr', async (req, res) => {
  const company = await getCompanySettings();
  const workerRes = await pool.query('SELECT * FROM workers WHERE user_id = $1', [req.session.user.id]);
  const w = workerRes.rows[0];

  res.send(renderWorkerLayout('My QR Code', company, req.session.user, `
    <h2>My QR Code</h2>
    <div class="card-box" style="text-align: center; max-width: 400px; margin: 0 auto;">
      <img src="${w.qr_code}" alt="QR Code" style="width: 250px; height: 250px; margin-bottom: 15px;"><br>
      <h3>${w.full_name}</h3>
      <p style="color: #666; margin-top: 5px;">Worker ID: ${w.worker_id}</p>
    </div>
  `));
});

app.get('/worker/attendance', async (req, res) => {
  const company = await getCompanySettings();
  const workerRes = await pool.query('SELECT * FROM workers WHERE user_id = $1', [req.session.user.id]);
  const w = workerRes.rows[0];
  const logsRes = await pool.query('SELECT * FROM attendance_logs WHERE worker_id = $1 ORDER BY date DESC, time DESC', [w.worker_id]);
  const scheduleRes = await pool.query('SELECT * FROM work_schedules LIMIT 1');
  const schedule = scheduleRes.rows[0];

  const grouped = {};
  logsRes.rows.forEach(l => {
    const d = l.date.toISOString().split('T')[0];
    if (!grouped[d]) grouped[d] = [];
    grouped[d].push(l);
  });

  res.send(renderWorkerLayout('My Attendance', company, req.session.user, `
    <h2>My Attendance History</h2>
    <div class="card-box">
      <table>
        <thead>
          <tr><th>Date</th><th>Records</th><th>Total Working Hours</th><th>Status</th></tr>
        </thead>
        <tbody>
          ${Object.keys(grouped).map(date => {
            const dayLogs = grouped[date].sort((a,b) => a.time.localeCompare(b.time));
            const status = calculateAttendanceStatus(dayLogs, schedule);
            const hours = calculateWorkingHours(dayLogs);
            return `
              <tr>
                <td>${date}</td>
                <td>${dayLogs.map(l => `${l.attendance_type}: ${l.time}`).join(' | ')}</td>
                <td>${hours} Hours</td>
                <td><span class="badge ${status === 'FULL DAY' ? 'badge-in' : 'badge-out'}">${status}</span></td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `));
});

app.get('/worker/advance', async (req, res) => {
  const company = await getCompanySettings();
  const workerRes = await pool.query('SELECT * FROM workers WHERE user_id = $1', [req.session.user.id]);
  const w = workerRes.rows[0];
  const advances = await pool.query('SELECT * FROM advance_money WHERE worker_id = $1 ORDER BY date DESC', [w.worker_id]);
  const totalAdv = advances.rows.reduce((sum, a) => sum + parseFloat(a.amount), 0);

  res.send(renderWorkerLayout('My Advance Money', company, req.session.user, `
    <h2>My Advance Money</h2>
    <div class="stats-grid">
      <div class="stat-card"><h3>Total Advance Balance</h3><p>₱${totalAdv.toFixed(2)}</p></div>
    </div>
    <div class="card-box">
      <table>
        <thead>
          <tr><th>Date</th><th>Amount</th><th>Reason</th></tr>
        </thead>
        <tbody>
          ${advances.rows.map(a => `
            <tr>
              <td>${a.date}</td>
              <td>₱${parseFloat(a.amount).toFixed(2)}</td>
              <td>${a.reason || 'N/A'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `));
});

app.get('/worker/salary', async (req, res) => {
  const company = await getCompanySettings();
  const workerRes = await pool.query('SELECT * FROM workers WHERE user_id = $1', [req.session.user.id]);
  const w = workerRes.rows[0];
  const scheduleRes = await pool.query('SELECT * FROM work_schedules LIMIT 1');
  const schedule = scheduleRes.rows[0];

  const logsRes = await pool.query('SELECT * FROM attendance_logs WHERE worker_id = $1 ORDER BY date ASC, time ASC', [w.worker_id]);
  const grouped = {};
  logsRes.rows.forEach(l => {
    const d = l.date.toISOString().split('T')[0];
    if (!grouped[d]) grouped[d] = [];
    grouped[d].push(l);
  });

  let fullDays = 0;
  let halfDays = 0;
  for (let d in grouped) {
    const status = calculateAttendanceStatus(grouped[d], schedule);
    if (status === 'FULL DAY') fullDays++;
    if (status === 'HALF DAY') halfDays++;
  }

  const equivalentDays = fullDays + (halfDays * 0.5);
  const totalSalary = equivalentDays * parseFloat(w.daily_rate);
  const advRes = await pool.query('SELECT SUM(amount) as total FROM advance_money WHERE worker_id = $1', [w.worker_id]);
  const totalAdvance = parseFloat(advRes.rows[0].total || 0);
  const netSalary = totalSalary - totalAdvance;

  res.send(renderWorkerLayout('My Salary', company, req.session.user, `
    <h2>My Salary Summary</h2>
    <div class="card-box" style="max-width: 600px;">
      <p style="margin-bottom:10px;"><strong>Daily Rate:</strong> ₱${parseFloat(w.daily_rate).toFixed(2)}</p>
      <p style="margin-bottom:10px;"><strong>Full Days Worked:</strong> ${fullDays}</p>
      <p style="margin-bottom:10px;"><strong>Half Days Worked:</strong> ${halfDays}</p>
      <p style="margin-bottom:10px;"><strong>Equivalent Days:</strong> ${equivalentDays}</p>
      <p style="margin-bottom:10px;"><strong>Total Salary:</strong> ₱${totalSalary.toFixed(2)}</p>
      <p style="margin-bottom:10px;"><strong>Advance Deduction:</strong> ₱${totalAdvance.toFixed(2)}</p>
      <hr style="margin: 15px 0; border:0; border-top:1px solid #eee;">
      <h3>Net Salary: ₱${netSalary.toFixed(2)}</h3>
    </div>
  `));
});

app.get('/worker/announcements', async (req, res) => {
  const company = await getCompanySettings();
  const anns = await pool.query('SELECT * FROM announcements ORDER BY created_at DESC');

  res.send(renderWorkerLayout('Announcements', company, req.session.user, `
    <h2>Announcements</h2>
    <div class="card-box">
      ${anns.rows.map(a => `
        <div style="border-bottom: 1px solid #eee; padding: 15px 0;">
          <h4>${a.title}</h4>
          <p style="color: #666; font-size: 14px; margin: 5px 0;">${a.content}</p>
          <small style="color: #999;">${new Date(a.created_at).toLocaleString()}</small>
        </div>
      `).join('')}
    </div>
  `));
});

function renderWorkerLayout(title, company, user, content) {
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>${title} - Worker Portal</title>
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; }
        body { background: #f4f7f6; display: flex; height: 100vh; overflow: hidden; }
        .sidebar { width: 260px; background: #2c3e50; color: white; display: flex; flex-direction: column; justify-content: space-between; }
        .sidebar-header { padding: 20px; text-align: center; border-bottom: 1px solid #34495e; }
        .sidebar-header img { max-height: 50px; max-width: 100%; object-fit: contain; margin-bottom: 10px; }
        .sidebar-menu { list-style: none; padding: 20px 0; overflow-y: auto; flex-grow: 1; }
        .sidebar-menu li a { display: block; padding: 12px 20px; color: #bdc3c7; text-decoration: none; font-size: 14px; transition: 0.2s; }
        .sidebar-menu li a:hover { background: #34495e; color: white; border-left: 4px solid #3498db; }
        .main-content { flex-grow: 1; display: flex; flex-direction: column; overflow-y: auto; }
        .topbar { background: white; padding: 15px 30px; border-bottom: 1px solid #e1e8ed; display: flex; justify-content: space-between; align-items: center; }
        .content-body { padding: 30px; }
        .card-box { background: white; padding: 25px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.04); }
        .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 20px; margin-bottom: 25px; }
        .stat-card { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.04); border-left: 4px solid #27ae60; }
        .stat-card h3 { font-size: 13px; color: #7f8c8d; margin-bottom: 5px; text-transform: uppercase; }
        .stat-card p { font-size: 20px; font-weight: bold; color: #2c3e50; }
        table { width: 100%; border-collapse: collapse; margin-top: 10px; }
        th, td { padding: 12px; text-align: left; border-bottom: 1px solid #eee; font-size: 14px; }
        th { background: #f8f9fa; color: #333; font-weight: 600; }
        .badge { padding: 5px 10px; border-radius: 12px; font-size: 11px; font-weight: bold; text-transform: uppercase; }
        .badge-in { background: #e8f8f5; color: #27ae60; }
        .badge-out { background: #fef5e7; color: #d35400; }
      </style>
    </head>
    <body>
      <div class="sidebar">
        <div>
          <div class="sidebar-header">
            ${company.company_logo ? `<img src="${company.company_logo}" alt="Logo">` : ''}
            <h3 style="font-size: 16px;">${company.company_name}</h3>
          </div>
          <ul class="sidebar-menu">
            <li><a href="/worker/dashboard">Home</a></li>
            <li><a href="/worker/qr">My QR Code</a></li>
            <li><a href="/worker/attendance">My Attendance</a></li>
            <li><a href="/worker/advance">My Advance</a></li>
            <li><a href="/worker/salary">My Salary</a></li>
            <li><a href="/worker/announcements">Announcements</a></li>
          </ul>
        </div>
        <div style="padding: 20px; border-top: 1px solid #34495e; font-size: 13px;">
          <p>Logged in as: <strong>${user.full_name}</strong></p>
          <a href="/logout" style="color: #e74c3c; text-decoration: none; display: block; margin-top: 8px;">Logout</a>
        </div>
      </div>
      <div class="main-content">
        <div class="topbar">
          <h3>Worker Portal</h3>
          <span>${new Date().toLocaleDateString()}</span>
        </div>
        <div class="content-body">
          ${content}
        </div>
      </div>
    </body>
    </html>
  `;
}

// ---------------------------------------------------------
// ATTENDANCE SCANNER PORTAL
// ---------------------------------------------------------

app.get('/scanner/*', requireRole('SCANNER'), (req, res, next) => next());

app.get('/scanner/dashboard', async (req, res) => {
  const company = await getCompanySettings();
  const todayStr = new Date().toISOString().split('T')[0];

  const presentToday = await pool.query('SELECT COUNT(DISTINCT worker_id) FROM attendance_logs WHERE date = $1', [todayStr]);
  const workersList = await pool.query('SELECT worker_id FROM workers WHERE is_active = TRUE');
  const scheduleRes = await pool.query('SELECT * FROM work_schedules LIMIT 1');
  const schedule = scheduleRes.rows[0];

  let fullDay = 0;
  let halfDay = 0;
  for (let w of workersList.rows) {
    const logs = await pool.query('SELECT * FROM attendance_logs WHERE worker_id = $1 AND date = $2 ORDER BY time ASC', [w.worker_id, todayStr]);
    const status = calculateAttendanceStatus(logs.rows, schedule);
    if (status === 'FULL DAY') fullDay++;
    if (status === 'HALF DAY') halfDay++;
  }

  res.send(renderScannerLayout('Dashboard', company, req.session.user, `
    <h2>Scanner Dashboard</h2>
    <div class="stats-grid">
      <div class="stat-card"><h3>Present Today</h3><p>${presentToday.rows[0].count}</p></div>
      <div class="stat-card"><h3>Full Day</h3><p>${fullDay}</p></div>
      <div class="stat-card"><h3>Half Day</h3><p>${halfDay}</p></div>
    </div>
  `));
});

app.get('/scanner/scan', async (req, res) => {
  const company = await getCompanySettings();
  res.send(renderScannerLayout('Scan QR Code', company, req.session.user, `
    <h2>Scan Worker QR Code</h2>
    <div class="card-box" style="max-width: 600px; text-align: center;">
      <div id="selection-container" style="margin-bottom: 20px;">
        <h3>Select Attendance Type First</h3>
        <div style="display: flex; justify-content: center; gap: 20px; margin-top: 15px;">
          <button type="button" onclick="selectType('IN')" id="btn-in" style="padding: 15px 40px; font-size: 18px; font-weight: bold; background: #27ae60; color: white; border: none; border-radius: 8px; cursor: pointer;">[ TIME IN ]</button>
          <button type="button" onclick="selectType('OUT')" id="btn-out" style="padding: 15px 40px; font-size: 18px; font-weight: bold; background: #e74c3c; color: white; border: none; border-radius: 8px; cursor: pointer;">[ TIME OUT ]</button>
        </div>
      </div>

      <div id="scanner-container" style="display: none; margin-top: 20px;">
        <h3 id="selected-type-label" style="color: #2980b9; margin-bottom: 15px;"></h3>
        <p style="margin-bottom: 10px;">Simulate QR Code Scan by entering Worker ID or pasting QR JSON data:</p>
        <input type="text" id="qr-input" placeholder="Enter Worker ID (e.g. W-001)" style="padding: 12px; width: 80%; border: 1px solid #ddd; border-radius: 6px; font-size: 16px; margin-bottom: 10px;"><br>
        <button type="button" onclick="submitScan()" class="btn-primary" style="padding: 12px 30px; font-size: 16px;">Process Scan</button>
      </div>

      <div id="result-container" style="margin-top: 20px; font-size: 16px; font-weight: bold;"></div>
    </div>

    <script>
      let selectedType = '';
      function selectType(type) {
        selectedType = type;
        document.getElementById('selection-container').style.display = 'none';
        document.getElementById('scanner-container').style.display = 'block';
        document.getElementById('selected-type-label').innerText = 'SELECTED TYPE: ' + (type === 'IN' ? 'TIME IN' : 'TIME OUT');
        document.getElementById('qr-input').focus();
      }

      async function submitScan() {
        const rawInput = document.getElementById('qr-input').value.trim();
        if (!selectedType) {
          alert('Please Select TIME IN or TIME OUT First');
          return;
        }
        let workerId = rawInput;
        try {
          const parsed = JSON.parse(rawInput);
          if (parsed.worker_id) workerId = parsed.worker_id;
        } catch(e) {}

        const res = await fetch('/scanner/api/record', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ worker_id: workerId, attendance_type: selectedType })
        });
        const data = await res.json();
        const resultBox = document.getElementById('result-container');
        if (data.success) {
          resultBox.innerHTML = \`<div style="background: #e8f8f5; color: #27ae60; padding: 15px; border-radius: 6px;">
            ATTENDANCE RECORDED SUCCESSFULLY<br>
            Name: \${data.name}<br>
            Position: \${data.position}<br>
            Type: \${data.type}<br>
            Time: \${data.time}
          </div>\`;
          document.getElementById('qr-input').value = '';
          setTimeout(() => {
            window.location.reload();
          }, 2000);
        } else {
          resultBox.innerHTML = \`<div style="background: #fdebd0; color: #c0392b; padding: 15px; border-radius: 6px;">Error: \${data.error}</div>\`;
        }
      }
    </script>
  `));
});

app.post('/scanner/api/record', async (req, res) => {
  const { worker_id, attendance_type } = req.body;
  if (!attendance_type) {
    return res.json({ success: false, error: 'Please Select TIME IN or TIME OUT First' });
  }

  const workerRes = await pool.query('SELECT * FROM workers WHERE worker_id = $1', [worker_id]);
  if (workerRes.rows.length === 0) {
    return res.json({ success: false, error: 'Worker Not Found or Invalid QR Code' });
  }
  const worker = workerRes.rows[0];
  if (!worker.is_active) {
    return res.json({ success: false, error: 'Worker Account is Inactive' });
  }

  const todayStr = new Date().toISOString().split('T')[0];
  const logsRes = await pool.query('SELECT * FROM attendance_logs WHERE worker_id = $1 AND date = $2 ORDER BY time ASC', [worker_id, todayStr]);
  const logs = logsRes.rows;

  if (logs.length === 0 && attendance_type === 'OUT') {
    return res.json({ success: false, error: 'Cannot Record OUT as First Attendance' });
  }
  if (logs.length > 0) {
    const lastType = logs[logs.length - 1].attendance_type;
    if (lastType === attendance_type) {
      return res.json({ success: false, error: attendance_type === 'IN' ? 'Cannot Record Two Consecutive IN' : 'Cannot Record Two Consecutive OUT' });
    }
  }

  const now = new Date();
  const timeStr = now.toTimeString().split(' ')[0];

  await pool.query('INSERT INTO attendance_logs (worker_id, date, time, attendance_type) VALUES ($1, $2, $3, $4)', [worker_id, todayStr, timeStr, attendance_type]);

  res.json({
    success: true,
    name: worker.full_name,
    position: worker.position,
    type: attendance_type === 'IN' ? 'TIME IN' : 'TIME OUT',
    time: timeStr
  });
});

app.get('/scanner/attendance', async (req, res) => {
  const company = await getCompanySettings();
  const todayStr = new Date().toISOString().split('T')[0];
  const logs = await pool.query('SELECT al.*, w.full_name, w.position FROM attendance_logs al JOIN workers w ON al.worker_id = w.worker_id WHERE al.date = $1 ORDER BY al.time DESC', [todayStr]);

  res.send(renderScannerLayout("Today's Attendance", company, req.session.user, `
    <h2>Today's Attendance Logs</h2>
    <div class="card-box">
      <table>
        <thead>
          <tr><th>Worker ID</th><th>Name</th><th>Position</th><th>Type</th><th>Time</th></tr>
        </thead>
        <tbody>
          ${logs.rows.map(l => `
            <tr>
              <td>${l.worker_id}</td>
              <td><strong>${l.full_name}</strong></td>
              <td>${l.position}</td>
              <td><span class="badge ${l.attendance_type === 'IN' ? 'badge-in' : 'badge-out'}">${l.attendance_type}</span></td>
              <td>${l.time}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `));
});

function renderScannerLayout(title, company, user, content) {
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>${title} - Scanner Portal</title>
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; }
        body { background: #f4f7f6; display: flex; height: 100vh; overflow: hidden; }
        .sidebar { width: 260px; background: #2c3e50; color: white; display: flex; flex-direction: column; justify-content: space-between; }
        .sidebar-header { padding: 20px; text-align: center; border-bottom: 1px solid #34495e; }
        .sidebar-header img { max-height: 50px; max-width: 100%; object-fit: contain; margin-bottom: 10px; }
        .sidebar-menu { list-style: none; padding: 20px 0; overflow-y: auto; flex-grow: 1; }
        .sidebar-menu li a { display: block; padding: 12px 20px; color: #bdc3c7; text-decoration: none; font-size: 14px; transition: 0.2s; }
        .sidebar-menu li a:hover { background: #34495e; color: white; border-left: 4px solid #3498db; }
        .main-content { flex-grow: 1; display: flex; flex-direction: column; overflow-y: auto; }
        .topbar { background: white; padding: 15px 30px; border-bottom: 1px solid #e1e8ed; display: flex; justify-content: space-between; align-items: center; }
        .content-body { padding: 30px; }
        .card-box { background: white; padding: 25px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.04); }
        .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 20px; margin-bottom: 25px; }
        .stat-card { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.04); border-left: 4px solid #e67e22; }
        .stat-card h3 { font-size: 13px; color: #7f8c8d; margin-bottom: 5px; text-transform: uppercase; }
        .stat-card p { font-size: 20px; font-weight: bold; color: #2c3e50; }
        table { width: 100%; border-collapse: collapse; margin-top: 10px; }
        th, td { padding: 12px; text-align: left; border-bottom: 1px solid #eee; font-size: 14px; }
        th { background: #f8f9fa; color: #333; font-weight: 600; }
        .badge { padding: 5px 10px; border-radius: 12px; font-size: 11px; font-weight: bold; text-transform: uppercase; }
        .badge-in { background: #e8f8f5; color: #27ae60; }
        .badge-out { background: #fef5e7; color: #d35400; }
        .btn-primary { background: #e67e22; color: white; border: none; border-radius: 6px; font-weight: 600; cursor: pointer; }
        .btn-primary:hover { background: #d35400; }
      </style>
    </head>
    <body>
      <div class="sidebar">
        <div>
          <div class="sidebar-header">
            ${company.company_logo ? `<img src="${company.company_logo}" alt="Logo">` : ''}
            <h3 style="font-size: 16px;">${company.company_name}</h3>
          </div>
          <ul class="sidebar-menu">
            <li><a href="/scanner/dashboard">Dashboard</a></li>
            <li><a href="/scanner/scan">Scan QR Code</a></li>
            <li><a href="/scanner/attendance">Today's Attendance</a></li>
          </ul>
        </div>
        <div style="padding: 20px; border-top: 1px solid #34495e; font-size: 13px;">
          <p>Logged in as: <strong>${user.full_name}</strong></p>
          <a href="/logout" style="color: #e74c3c; text-decoration: none; display: block; margin-top: 8px;">Logout</a>
        </div>
      </div>
      <div class="main-content">
        <div class="topbar">
          <h3>Attendance Scanner Portal</h3>
          <span>${new Date().toLocaleDateString()}</span>
        </div>
        <div class="content-body">
          ${content}
        </div>
      </div>
    </body>
    </html>
  `;
}

// ---------------------------------------------------------
// CALCULATION HELPERS
// ---------------------------------------------------------

function calculateWorkingHours(logs) {
  let totalMinutes = 0;
  let lastInTime = null;

  for (let l of logs) {
    const [h, m, s] = l.time.split(':').map(Number);
    const timeInMins = h * 60 + m;

    if (l.attendance_type === 'IN') {
      lastInTime = timeInMins;
    } else if (l.attendance_type === 'OUT' && lastInTime !== null) {
      totalMinutes += (timeInMins - lastInTime);
      lastInTime = null;
    }
  }
  return (totalMinutes / 60).toFixed(1);
}

function calculateAttendanceStatus(logs, schedule) {
  if (!logs || logs.length === 0) return 'ABSENT';
  
  let workingHours = parseFloat(calculateWorkingHours(logs));
  const hasOut = logs.some(l => l.attendance_type === 'OUT');
  if (!hasOut && logs.length > 0) return 'INCOMPLETE';

  if (workingHours >= parseFloat(schedule.full_day_hours || 8)) {
    return 'FULL DAY';
  } else if (workingHours >= parseFloat(schedule.half_day_hours || 4)) {
    return 'HALF DAY';
  } else if (logs.length > 0) {
    return 'PRESENT';
  }
  return 'ABSENT';
}

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
