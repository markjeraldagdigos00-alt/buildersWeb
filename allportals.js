/**
 * ============================================================================
 * CONSTRUCTION WORKER MANAGEMENT SYSTEM - ALL-IN-ONE SINGLE FILE APPLICATION
 * ============================================================================
 * Technologies: Node.js, Express.js, PostgreSQL, EJS, Bcryptjs, QRCode, Session
 * 
 * INSTRUCTIONS TO RUN LOCALLY:
 * 1. Initialize a new node project: mkdir app && cd app && npm init -y
 * 2. Install dependencies: npm install express express-session connect-pg-simple pg bcryptjs qrcode ejs
 * 3. Save this code as `server.js`
 * 4. Create a `.env` file or export environment variables:
 *    PORT=3000
 *    DATABASE_URL=postgresql://postgres:password@localhost:5432/construction_db
 *    SESSION_SECRET=super_secret_key
 * 5. Run the app: node server.js
 * ============================================================================
 */

const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// PostgreSQL Pool Connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/construction_db',
  ssl: process.env.NODE_ENV === 'PRODUCTION' ? { rejectUnauthorized: false } : false
});

// Setup embedded views directory and files dynamically so it works as a single file copy-paste
constVIEWS_DIR = path.join(__dirname, 'views_temp');
if (!fs.existsSync(VIEWS_DIR)) {
  fs.mkdirSync(VIEWS_DIR, { recursive: true });
}

// Write embedded views to temporary folder for EJS rendering engine
const writeView = (filename, content) => {
  const filepath = path.join(VIEWS_DIR, filename);
  const dir = path.dirname(filepath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filepath, content);
};

// ==================== EMBEDDED VIEWS & TEMPLATES ====================

writeView('layout.ejs', `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title><%= company.company_name %> - Construction System</title>
    <style>
        :root { --primary: #f39c12; --primary-dark: #d68910; --dark: #2c3e50; --light: #ecf0f1; --success: #27ae60; --danger: #c0392b; --gray: #95a5a6; }
        * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; }
        body { background-color: #f8f9fa; color: #333; }
        .main-header { background: var(--dark); color: white; padding: 15px 30px; display: flex; justify-content: space-between; align-items: center; }
        .company-brand { display: flex; align-items: center; gap: 15px; }
        .brand-logo { width: 50px; height: 50px; border-radius: 8px; background: var(--primary); display: flex; align-items: center; justify-content: center; font-size: 24px; object-fit: cover; }
        .container { max-width: 1200px; margin: 30px auto; padding: 0 20px; }
        .nav-links { display: flex; gap: 15px; background: white; padding: 10px 20px; border-radius: 8px; box-shadow: 0 2px 5px rgba(0,0,0,0.05); margin-bottom: 20px; flex-wrap: wrap; }
        .nav-links a { color: var(--dark); text-decoration: none; font-weight: 600; padding: 5px 10px; border-radius: 4px; }
        .nav-links a:hover, .nav-links a.active { background: var(--primary); color: white; }
        .btn-logout { background: var(--danger); color: white; padding: 6px 12px; border-radius: 4px; text-decoration: none; font-weight: bold; }
        .card { background: white; padding: 25px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.05); margin-bottom: 20px; }
        .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 20px; margin-top: 20px; }
        .stat-card { background: white; padding: 25px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.05); border-left: 5px solid var(--primary); }
        .stat-number { font-size: 32px; font-weight: bold; margin-top: 10px; color: var(--dark); }
        .data-table { width: 100%; border-collapse: collapse; margin-top: 15px; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.05); }
        .data-table th, .data-table td { padding: 12px 15px; text-align: left; border-bottom: 1px solid #eee; }
        .data-table th { background: #f1f2f6; color: var(--dark); }
        .badge { padding: 5px 10px; border-radius: 4px; font-size: 12px; font-weight: bold; }
        .badge-in { background: #d4edda; color: #155724; }
        .badge-out { background: #f8d7da; color: #721c24; }
        .alert { padding: 12px; border-radius: 5px; margin-bottom: 15px; }
        .alert-success { background: #d4edda; color: #155724; }
        .alert-error { background: #f8d7da; color: #721c24; }
        .form-group { margin-bottom: 15px; }
        .form-group label { display: block; margin-bottom: 5px; font-weight: 600; }
        .form-group input, .form-group select, .form-group textarea { width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 5px; font-size: 15px; }
        .btn { padding: 10px 20px; border: none; border-radius: 5px; cursor: pointer; font-size: 15px; font-weight: 600; text-decoration: none; display: inline-block; }
        .btn-primary { background: var(--primary); color: white; }
        .btn-primary:hover { background: var(--primary-dark); }
        .flex { display: flex; gap: 15px; align-items: center; }
    </style>
</head>
<body>
    <header class="main-header">
        <div class="company-brand">
            <% if (company.logo_url) { %>
                <img src="<%= company.logo_url %>" alt="Logo" class="brand-logo">
            <% } else { %>
                <div class="brand-logo">🏗️</div>
            <% } %>
            <div>
                <h2><%= company.company_name %></h2>
                <small><%= company.address %> | Tel: <%= company.contact_number %></small>
            </div>
        </div>
        <% if (user) { %>
            <div class="flex">
                <span>Role: <strong><%= user.role %></strong></span>
                <a href="/logout" class="btn-logout">Logout</a>
            </div>
        <% } %>
    </header>
    <main class="container">
        <%- body %>
    </main>
</body>
</html>
`);

writeView('login.ejs', `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Login - <%= company.company_name %></title>
    <style>
        body { background: #2c3e50; display: flex; align-items: center; justify-content: center; height: 100vh; font-family: 'Segoe UI', Tahoma, sans-serif; }
        .card { background: white; padding: 40px; border-radius: 10px; width: 100%; max-width: 400px; box-shadow: 0 10px 25px rgba(0,0,0,0.3); }
        .logo { width: 70px; height: 70px; margin: 0 auto 15px auto; border-radius: 50%; background: #f39c12; display: flex; align-items: center; justify-content: center; font-size: 32px; }
        .form-group { margin-bottom: 20px; }
        .form-group label { display: block; margin-bottom: 8px; font-weight: 600; }
        .form-group input { width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 5px; font-size: 16px; }
        .btn { width: 100%; padding: 12px; background: #f39c12; color: white; border: none; border-radius: 5px; font-size: 16px; font-weight: bold; cursor: pointer; }
        .btn:hover { background: #d68910; }
        .alert { padding: 10px; background: #f8d7da; color: #721c24; border-radius: 5px; margin-bottom: 15px; text-align: center; }
    </style>
</head>
<body>
    <div class="card">
        <div style="text-align: center; margin-bottom: 20px;">
            <div class="logo">🏗️</div>
            <h2><%= company.company_name %></h2>
            <p style="color: #666; font-size: 14px;">Construction Worker Management</p>
        </div>
        <% if (error) { %><div class="alert"><%= error %></div><% } %>
        <form action="/login" method="POST">
            <div class="form-group">
                <label>Username</label>
                <input type="text" name="username" required placeholder="Enter username">
            </div>
            <div class="form-group">
                <label>Password</label>
                <input type="password" name="password" required placeholder="Enter password">
            </div>
            <button type="submit" class="btn">Login Portal</button>
        </form>
    </div>
</body>
</html>
`);

writeView('admin/nav.ejs', `
<div class="nav-links">
    <a href="/admin/dashboard">Dashboard</a>
    <a href="/admin/workers">Workers</a>
    <a href="/admin/attendance">Attendance</a>
    <a href="/admin/advance">Advance Money</a>
    <a href="/admin/salary">Salary Calculation</a>
    <a href="/admin/announcements">Announcements</a>
    <a href="/admin/settings">Company Settings</a>
</div>
`);

writeView('admin/dashboard.ejs', `
<%- include('nav') %>
<h2>Admin Dashboard</h2>
<div class="stats-grid">
    <div class="stat-card">
        <h3>Total Workers</h3>
        <p class="stat-number"><%= totalWorkers %></p>
    </div>
    <div class="stat-card">
        <h3>Present Today</h3>
        <p class="stat-number"><%= presentToday %></p>
    </div>
    <div class="stat-card">
        <h3>Current Date</h3>
        <p style="font-size: 20px; font-weight: bold; margin-top: 10px; color: #2c3e50;"><%= today %></p>
    </div>
</div>

<div class="card" style="margin-top: 25px;">
    <h3>Recent Attendance Activity (<%= today %>)</h3>
    <table class="data-table">
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
            <% if (recentAttendance.length === 0) { %>
                <tr><td colspan="5" style="text-align: center;">No attendance logs recorded today.</td></tr>
            <% } else { %>
                <% recentAttendance.forEach(log => { %>
                    <tr>
                        <td><%= log.code_id %></td>
                        <td><%= log.full_name %></td>
                        <td><%= log.position %></td>
                        <td><span class="badge <%= log.attendance_type === 'IN' ? 'badge-in' : 'badge-out' %>"><%= log.attendance_type %></span></td>
                        <td><%= log.time %></td>
                    </tr>
                <% }) %>
            <% } %>
        </tbody>
    </table>
</div>
`);

writeView('admin/workers.ejs', `
<%- include('nav') %>
<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
    <h2>Worker Management</h2>
    <form action="/admin/workers" method="GET" style="display: flex; gap: 10px;">
        <input type="text" name="search" value="<%= search %>" placeholder="Search worker..." style="padding: 8px; border: 1px solid #ddd; border-radius: 4px;">
        <button type="submit" class="btn btn-primary" style="padding: 8px 15px;">Search</button>
    </form>
</div>

<div class="card">
    <h3>Register New Worker</h3>
    <form action="/admin/workers/register" method="POST" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 15px; margin-top: 15px;">
        <div class="form-group"><label>Full Name</label><input type="text" name="full_name" required></div>
        <div class="form-group"><label>Position</label><input type="text" name="position" required placeholder="e.g. Mason, Carpenter"></div>
        <div class="form-group"><label>Contact Number</label><input type="text" name="contact_number" required></div>
        <div class="form-group"><label>Daily Rate (₱)</label><input type="number" step="0.01" name="daily_rate" required></div>
        <div class="form-group"><label>Assigned Project</label><input type="text" name="assigned_project" required></div>
        <div class="form-group"><label>Username</label><input type="text" name="username" required></div>
        <div class="form-group"><label>Password</label><input type="password" name="password" required></div>
        <div style="grid-column: 1 / -1;"><button type="submit" class="btn btn-primary">Register Worker & Generate QR</button></div>
    </form>
</div>

<div class="card">
    <h3>Active Workers Directory</h3>
    <table class="data-table">
        <thead>
            <tr>
                <th>Worker ID</th>
                <th>Name</th>
                <th>Position</th>
                <th>Project</th>
                <th>Daily Rate</th>
                <th>Status</th>
                <th>Actions</th>
            </tr>
        </thead>
        <tbody>
            <% workers.forEach(w => { %>
                <tr>
                    <td><%= w.worker_id %></td>
                    <td><%= w.full_name %></td>
                    <td><%= w.position %></td>
                    <td><%= w.assigned_project %></td>
                    <td>₱<%= w.daily_rate %></td>
                    <td><span class="badge <%= w.status === 'ACTIVE' ? 'badge-in' : 'badge-out' %>"><%= w.status %></span></td>
                    <td>
                        <a href="/admin/workers/profile/<%= w.id %>" class="btn btn-primary" style="padding: 5px 10px; font-size: 13px;">Profile & QR</a>
                        <form action="/admin/workers/toggle-status/<%= w.id %>" method="POST" style="display:inline;">
                            <button type="submit" class="btn" style="padding: 5px 10px; font-size: 13px; background: #e67e22; color: white; margin-left: 5px;">Toggle</button>
                        </form>
                    </td>
                </tr>
            <% }) %>
        </tbody>
    </table>
</div>
`);

writeView('admin/worker-profile.ejs', `
<%- include('nav') %>
<a href="/admin/workers" class="btn" style="background: #7f8c8d; color: white; margin-bottom: 15px;">&larr; Back to Workers</a>
<div class="card" style="display: grid; grid-template-columns: 1fr 1fr; gap: 30px;">
    <div>
        <h2>Worker Profile: <%= worker.full_name %></h2>
        <p><strong>Worker ID:</strong> <%= worker.worker_id %></p>
        <p><strong>Position:</strong> <%= worker.position %></p>
        <p><strong>Contact:</strong> <%= worker.contact_number %></p>
        <p><strong>Project:</strong> <%= worker.assigned_project %></p>
        <p><strong>Daily Rate:</strong> ₱<%= worker.daily_rate %></p>
        <p><strong>Status:</strong> <%= worker.status %></p>
    </div>
    <div style="text-align: center; background: #f8f9fa; padding: 20px; border-radius: 8px;">
        <h3>Worker QR Code</h3>
        <% if (worker.qr_image) { %>
            <img src="<%= worker.qr_image %>" alt="QR Code" style="width: 180px; height: 180px; margin: 10px 0;"><br>
            <a href="<%= worker.qr_image %>" download="<%= worker.worker_id %>-qr.png" class="btn btn-primary">Download QR Code</a>
        <% } else { %>
            <p>No QR Code generated.</p>
        <% } %>
    </div>
</div>
`);

writeView('admin/attendance.ejs', `
<%- include('nav') %>
<h2>Daily & Historical Attendance</h2>
<form action="/admin/attendance" method="GET" style="display: flex; gap: 15px; margin: 15px 0; align-items: center;">
    <div><label>Date: </label><input type="date" name="date" value="<%= dateQuery %>" style="padding: 8px; border: 1px solid #ddd; border-radius: 4px;"></div>
    <div><label>Search Worker: </label><input type="text" name="search" value="<%= search %>" placeholder="Name or ID" style="padding: 8px; border: 1px solid #ddd; border-radius: 4px;"></div>
    <button type="submit" class="btn btn-primary" style="padding: 9px 15px; margin-top: 18px;">Filter</button>
</form>

<div class="card">
    <table class="data-table">
        <thead>
            <tr>
                <th>ID</th>
                <th>Name</th>
                <th>Position</th>
                <th>1st IN</th>
                <th>1st OUT</th>
                <th>2nd IN</th>
                <th>Final OUT</th>
                <th>Hours</th>
                <th>Status</th>
            </tr>
        </thead>
        <tbody>
            <% attendanceReport.forEach(row => { %>
                <tr>
                    <td><%= row.worker_id %></td>
                    <td><%= row.full_name %></td>
                    <td><%= row.position %></td>
                    <td><%= row.first_in %></td>
                    <td><%= row.first_out %></td>
                    <td><%= row.second_in %></td>
                    <td><%= row.final_out %></td>
                    <td><strong><%= row.total_working_hours %> hrs</strong></td>
                    <td>
                        <span class="badge <%= row.attendance_status === 'FULL DAY' ? 'badge-in' : (row.attendance_status === 'HALF DAY' ? 'badge-in' : 'badge-out') %>">
                            <%= row.attendance_status %>
                        </span>
                    </td>
                </tr>
            <% }) %>
        </tbody>
    </table>
</div>
`);

writeView('admin/advance.ejs', `
<%- include('nav') %>
<h2>Advance Money Management</h2>
<div class="card">
    <h3>Record Advance Money</h3>
    <form action="/admin/advance/add" method="POST" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-top: 15px;">
        <div class="form-group">
            <label>Select Worker</label>
            <select name="worker_id" required>
                <% workers.forEach(w => { %>
                    <option value="<%= w.id %>"><%= w.worker_id %> - <%= w.full_name %></option>
                <% }) %>
            </select>
        </div>
        <div class="form-group"><label>Amount (₱)</label><input type="number" step="0.01" name="amount" required></div>
        <div class="form-group"><label>Date</label><input type="date" name="date" required value="<%= new Date().toISOString().split('T')[0] %>"></div>
        <div class="form-group"><label>Reason / Notes</label><input type="text" name="notes" placeholder="Emergency, etc."></div>
        <div style="grid-column: 1 / -1;"><button type="submit" class="btn btn-primary">Save Advance Record</button></div>
    </form>
</div>

<div class="card">
    <h3>Advance History</h3>
    <table class="data-table">
        <thead>
            <tr><th>Date</th><th>Worker ID</th><th>Name</th><th>Amount</th><th>Notes</th></tr>
        </thead>
        <tbody>
            <% advances.forEach(adv => { %>
                <tr>
                    <td><%= adv.date.toISOString().split('T')[0] %></td>
                    <td><%= adv.code_id %></td>
                    <td><%= adv.full_name %></td>
                    <td>₱<%= adv.amount %></td>
                    <td><%= adv.notes || '-' %></td>
                </tr>
            <% }) %>
        </tbody>
    </table>
</div>
`);

writeView('admin/salary.ejs', `
<%- include('nav') %>
<h2>Salary Calculation (Current Month)</h2>
<div class="card">
    <table class="data-table">
        <thead>
            <tr>
                <th>Worker</th>
                <th>Daily Rate</th>
                <th>Full Days</th>
                <th>Half Days</th>
                <th>Eq. Days</th>
                <th>Total Salary</th>
                <th>Advance Ded.</th>
                <th>Net Salary</th>
            </tr>
        </thead>
        <tbody>
            <% salaryData.forEach(s => { %>
                <tr>
                    <td><strong><%= s.full_name %></strong><br><small><%= s.worker_id %></small></td>
                    <td>₱<%= s.daily_rate %></td>
                    <td><%= s.full_days %></td>
                    <td><%= s.half_days %></td>
                    <td><strong><%= s.equivalent_days %></strong></td>
                    <td>₱<%= s.total_salary %></td>
                    <td style="color: red;">-₱<%= s.total_advance %></td>
                    <td style="color: green; font-weight: bold;">₱<%= s.net_salary %></td>
                </tr>
            <% }) %>
        </tbody>
    </table>
</div>
`);

writeView('admin/announcements.ejs', `
<%- include('nav') %>
<h2>Announcements Board</h2>
<div class="card">
    <h3>Create Announcement</h3>
    <form action="/admin/announcements/add" method="POST" style="margin-top: 15px;">
        <div class="form-group"><label>Title</label><input type="text" name="title" required></div>
        <div class="form-group"><label>Content</label><textarea name="content" rows="4" required></textarea></div>
        <button type="submit" class="btn btn-primary">Post Announcement</button>
    </form>
</div>

<div class="card">
    <h3>All Announcements</h3>
    <% announcements.forEach(a => { %>
        <div style="border-bottom: 1px solid #eee; padding: 15px 0;">
            <h4><%= a.title %> <small style="color: #888; font-weight: normal;">(<%= a.created_at.toISOString().split('T')[0] %>)</small></h4>
            <p style="margin-top: 8px;"><%= a.content %></p>
            <form action="/admin/announcements/delete/<%= a.id %>" method="POST" style="margin-top: 8px;">
                <button type="submit" class="btn" style="background: #e74c3c; color: white; padding: 4px 8px; font-size: 12px;">Delete</button>
            </form>
        </div>
    <% }) %>
</div>
`);

writeView('admin/settings.ejs', `
<%- include('nav') %>
<h2>Company & System Settings</h2>
<div class="card">
    <form action="/admin/settings/update" method="POST">
        <div class="form-group"><label>Company / Builder Name</label><input type="text" name="company_name" value="<%= settings.company_name %>" required></div>
        <div class="form-group"><label>Company Logo URL</label><input type="text" name="logo_url" value="<%= settings.logo_url %>" placeholder="https://example.com/logo.png"></div>
        <div class="form-group"><label>Company Address</label><input type="text" name="address" value="<%= settings.address %>"></div>
        <div class="form-group"><label>Contact Number</label><input type="text" name="contact_number" value="<%= settings.contact_number %>"></div>
        <div class="form-group"><label>Half Day Equivalent Value (e.g. 0.50)</label><input type="number" step="0.05" name="half_day_value" value="<%= schedule.half_day_value %>" required></div>
        <button type="submit" class="btn btn-primary">Save Settings</button>
    </form>
</div>
`);

writeView('worker/dashboard.ejs', `
<h2>Worker Portal - Welcome, <%= worker.full_name %></h2>
<div class="stats-grid">
    <div class="stat-card">
        <h3>Worker ID</h3>
        <p class="stat-number" style="font-size: 24px;"><%= worker.worker_id %></p>
    </div>
    <div class="stat-card">
        <h3>Position & Project</h3>
        <p style="font-size: 18px; font-weight: bold; margin-top: 10px;"><%= worker.position %></p>
        <small><%= worker.assigned_project %></small>
    </div>
    <div class="stat-card">
        <h3>Today's Status</h3>
        <p style="font-size: 22px; font-weight: bold; margin-top: 10px; color: <%= todayStatus === 'FULL DAY' ? 'green' : (todayStatus === 'HALF DAY' ? 'orange' : 'red') %>;">
            <%= todayStatus %>
        </p>
    </div>
</div>

<div class="card" style="margin-top: 25px; display: grid; grid-template-columns: 1fr 1fr; gap: 30px;">
    <div style="text-align: center;">
        <h3>My Personal QR Code</h3>
        <% if (worker.qr_image) { %>
            <img src="<%= worker.qr_image %>" alt="QR Code" style="width: 200px; height: 200px; margin: 15px 0;"><br>
            <p>Show this QR code to the Attendance Scanner.</p>
        <% } %>
    </div>
    <div>
        <h3>Announcements</h3>
        <% announcements.forEach(a => { %>
            <div style="background: #f8f9fa; padding: 12px; border-radius: 5px; margin-bottom: 10px;">
                <strong><%= a.title %></strong>
                <p style="font-size: 14px;"><%= a.content %></p>
            </div>
        <% }) %>
    </div>
</div>

<div class="card">
    <h3>My Attendance History</h3>
    <table class="data-table">
        <thead>
            <tr><th>Date</th><th>Time</th><th>Type</th></tr>
        </thead>
        <tbody>
            <% attendanceHistory.forEach(log => { %>
                <tr>
                    <td><%= log.date.toISOString().split('T')[0] %></td>
                    <td><%= log.time %></td>
                    <td><span class="badge <%= log.attendance_type === 'IN' ? 'badge-in' : 'badge-out' %>"><%= log.attendance_type %></span></td>
                </tr>
            <% }) %>
        </tbody>
    </table>
</div>
`);

writeView('scanner/dashboard.ejs', `
<h2>Attendance Scanner Portal</h2>
<div class="card" style="text-align: center; background: #2c3e50; color: white;">
    <h3>Select Attendance Type BEFORE Scanning</h3>
    <div style="display: flex; justify-content: center; gap: 20px; margin: 20px 0;">
        <button id="btn-in" class="btn" style="padding: 20px 40px; font-size: 20px; background: #95a5a6; color: white;">[ TIME IN ]</button>
        <button id="btn-out" class="btn" style="padding: 20px 40px; font-size: 20px; background: #95a5a6; color: white;">[ TIME OUT ]</button>
    </div>
    <p id="scanner-status-notice" style="font-size: 18px; font-weight: bold; color: #f39c12;">Mode: Please Select IN or OUT First</p>
</div>

<div class="card">
    <h3>Scan QR Code Simulator / Scanner Input</h3>
    <div class="form-group">
        <label>Scan or Paste Worker QR Code Data JSON string:</label>
        <input type="text" id="qr-input-data" placeholder='{"worker_id":"W-001","name":"Juan Dela Cruz"}' style="padding: 12px;">
    </div>
    <button onclick="simulateScan()" class="btn btn-primary" style="padding: 12px 25px;">Process Scan</button>
    <div id="scan-result" style="margin-top: 20px;"></div>
</div>

<div class="card">
    <h3>Today's Attendance Logs (<%= today %>)</h3>
    <table class="data-table">
        <thead>
            <tr><th>Worker Name</th><th>Position</th><th>Type</th><th>Time</th></tr>
        </thead>
        <tbody>
            <% logs.forEach(l => { %>
                <tr>
                    <td><%= l.full_name %></td>
                    <td><%= l.position %></td>
                    <td><span class="badge <%= l.attendance_type === 'IN' ? 'badge-in' : 'badge-out' %>"><%= l.attendance_type %></span></td>
                    <td><%= l.time %></td>
                </tr>
            <% }) %>
        </tbody>
    </table>
</div>

<script>
    let selectedType = null;
    const btnIn = document.getElementById('btn-in');
    const btnOut = document.getElementById('btn-out');
    const notice = document.getElementById('scanner-status-notice');

    btnIn.addEventListener('click', () => {
        selectedType = 'IN';
        btnIn.style.background = '#27ae60';
        btnOut.style.background = '#95a5a6';
        notice.textContent = 'Selected Mode: TIME IN';
    });

    btnOut.addEventListener('click', () => {
        selectedType = 'OUT';
        btnOut.style.background = '#c0392b';
        btnIn.style.background = '#95a5a6';
        notice.textContent = 'Selected Mode: TIME OUT';
    });

    async function simulateScan() {
        const qrData = document.getElementById('qr-input-data').value;
        const resultBox = document.getElementById('scan-result');
        if (!selectedType) {
            alert('Please select TIME IN or TIME OUT first!');
            return;
        }

        const res = await fetch('/api/scan', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ qr_data: qrData, attendance_type: selectedType })
        });
        const data = await res.json();
        if (data.success) {
            resultBox.innerHTML = \`<div class="alert alert-success"><strong>SUCCESS</strong><br>Name: \${data.worker.name}<br>Position: \${data.worker.position}<br>Type: \${data.worker.type} at \${data.worker.time}</div>\`;
            setTimeout(() => location.reload(), 1500);
        } else {
            resultBox.innerHTML = \`<div class="alert alert-error"><strong>Error:</strong> \${data.message}</div>\`;
        }
    }
</script>
`);

// ==================== EXPRESS SETUP & MIDDLEWARE ====================

app.set('view engine', 'ejs');
app.set('views', VIEWS_DIR);
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(session({
  store: new pgSession({
    pool: pool,
    tableName: 'session',
    createTableIfMissing: true
  }),
  secret: process.env.SESSION_SECRET || 'construction_secret_key',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 }
}));

// Global Company & User Middleware
app.use(async (req, res, next) => {
  try {
    const comp = await pool.query('SELECT * FROM company_settings LIMIT 1');
    res.locals.company = comp.rows[0] || { company_name: 'Apex Builders', logo_url: '', address: '123 Construction Ave', contact_number: '+1 555-0199' };
    res.locals.user = req.session.user || null;
    next();
  } catch (err) {
    res.locals.company = { company_name: 'Apex Builders', logo_url: '', address: '123 Construction Ave', contact_number: '+1 555-0199' };
    res.locals.user = req.session.user || null;
    next();
  }
});

const isAuthenticated = (req, res, next) => {
  if (req.session.user) return next();
  res.redirect('/login');
};

const authorizeRole = (role) => (req, res, next) => {
  if (req.session.user && req.session.user.role === role) return next();
  res.status(403).send('Access Denied: Unauthorized portal role.');
};

// Custom render wrapper with layout
const renderView = (res, viewName, data = {}) => {
  res.render(viewName, data, (err, html) => {
    if (err) { console.error(err); return res.status(500).send('View Render Error: ' + err.message); }
    res.render('layout', { ...data, body: html });
  });
};

// ==================== DATABASE INITIALIZATION SCHEMA ====================
const initDatabase = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(100) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(50) CHECK (role IN ('ADMIN', 'WORKER', 'ATTENDANCE_SCANNER')) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS company_settings (
        id SERIAL PRIMARY KEY,
        company_name VARCHAR(255) NOT NULL DEFAULT 'Apex Builders & Construction',
        logo_url VARCHAR(500) DEFAULT '',
        address VARCHAR(500) DEFAULT '123 Construction Avenue',
        contact_number VARCHAR(50) DEFAULT '+1 (555) 019-2834',
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS work_schedules (
        id SERIAL PRIMARY KEY,
        half_day_value NUMERIC(3,2) DEFAULT 0.50
    );
    CREATE TABLE IF NOT EXISTS workers (
        id SERIAL PRIMARY KEY,
        user_id INT REFERENCES users(id) ON DELETE CASCADE,
        worker_id VARCHAR(50) UNIQUE NOT NULL,
        full_name VARCHAR(255) NOT NULL,
        position VARCHAR(100) NOT NULL,
        contact_number VARCHAR(50) NOT NULL,
        daily_rate NUMERIC(10,2) NOT NULL DEFAULT 0.00,
        assigned_project VARCHAR(255) NOT NULL,
        profile_picture VARCHAR(500) DEFAULT '',
        status VARCHAR(20) DEFAULT 'ACTIVE',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS qr_codes (
        id SERIAL PRIMARY KEY,
        worker_id INT REFERENCES workers(id) ON DELETE CASCADE,
        qr_code_data TEXT NOT NULL,
        qr_image TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS attendance_logs (
        id SERIAL PRIMARY KEY,
        worker_id INT REFERENCES workers(id) ON DELETE CASCADE,
        date DATE NOT NULL DEFAULT CURRENT_DATE,
        time TIME NOT NULL DEFAULT CURRENT_TIME,
        attendance_type VARCHAR(10) CHECK (attendance_type IN ('IN', 'OUT')) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS advance_money (
        id SERIAL PRIMARY KEY,
        worker_id INT REFERENCES workers(id) ON DELETE CASCADE,
        amount NUMERIC(10,2) NOT NULL,
        date DATE NOT NULL DEFAULT CURRENT_DATE,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS announcements (
        id SERIAL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        content TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Insert Default Data if empty
  const compCheck = await pool.query('SELECT COUNT(*) FROM company_settings');
  if (parseInt(compCheck.rows[0].count) === 0) {
    await pool.query("INSERT INTO company_settings (company_name) VALUES ('Apex Builders & Construction')");
    await pool.query("INSERT INTO work_schedules (half_day_value) VALUES (0.50)");
    const adminPass = await bcrypt.hash('admin123', 10);
    const scannerPass = await bcrypt.hash('scanner123', 10);
    await pool.query("INSERT INTO users (username, password, role) VALUES ('admin', $1, 'ADMIN'), ('scanner', $2, 'ATTENDANCE_SCANNER')", [adminPass, scannerPass]);
    console.log('Default Admin (admin / admin123) and Scanner (scanner / scanner123) created.');
  }
};

// ==================== ROUTES ====================

app.get('/login', (req, res) => {
  if (req.session.user) {
    if (req.session.user.role === 'ADMIN') return res.redirect('/admin/dashboard');
    if (req.session.user.role === 'WORKER') return res.redirect('/worker/dashboard');
    if (req.session.user.role === 'ATTENDANCE_SCANNER') return res.redirect('/scanner/dashboard');
  }
  res.render('login', { error: null });
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const userRes = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    if (userRes.rows.length === 0) return res.render('login', { error: 'Invalid credentials' });
    const user = userRes.rows[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.render('login', { error: 'Invalid credentials' });

    req.session.user = { id: user.id, username: user.username, role: user.role };
    if (user.role === 'ADMIN') res.redirect('/admin/dashboard');
    else if (user.role === 'WORKER') res.redirect('/worker/dashboard');
    else if (user.role === 'ATTENDANCE_SCANNER') res.redirect('/scanner/dashboard');
  } catch (err) {
    res.render('login', { error: 'Database or server error' });
  }
});

app.get('/logout', (req, res) => req.session.destroy(() => res.redirect('/login')));
app.get('/', (req, res) => res.redirect('/login'));

// ADMIN PORTAL
app.get('/admin/dashboard', isAuthenticated, authorizeRole('ADMIN'), async (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const workersCount = await pool.query('SELECT COUNT(*) FROM workers WHERE status = $1', ['ACTIVE']);
  const presentToday = await pool.query('SELECT DISTINCT worker_id FROM attendance_logs WHERE date = $1', [today]);
  const recentLogs = await pool.query(`
    SELECT a.*, w.full_name, w.worker_id as code_id, w.position 
    FROM attendance_logs a JOIN workers w ON a.worker_id = w.id 
    WHERE a.date = $1 ORDER BY a.created_at DESC LIMIT 10
  `, [today]);

  renderView(res, 'admin/dashboard', {
    totalWorkers: workersCount.rows[0].count,
    presentToday: presentToday.rows.length,
    recentAttendance: recentLogs.rows,
    today
  });
});

app.get('/admin/workers', isAuthenticated, authorizeRole('ADMIN'), async (req, res) => {
  const search = req.query.search || '';
  const query = search 
    ? `SELECT * FROM workers WHERE full_name ILIKE $1 OR worker_id ILIKE $1 OR position ILIKE $1 ORDER BY created_at DESC`
    : `SELECT * FROM workers ORDER BY created_at DESC`;
  const workers = await pool.query(query, search ? [`%${search}%`] : []);
  renderView(res, 'admin/workers', { workers: workers.rows, search });
});

app.post('/admin/workers/register', isAuthenticated, authorizeRole('ADMIN'), async (req, res) => {
  const { full_name, position, contact_number, daily_rate, assigned_project, username, password } = req.body;
  try {
    const countRes = await pool.query('SELECT COUNT(*) FROM workers');
    const workerIdCode = `W-${String(parseInt(countRes.rows[0].count) + 1).padStart(3, '0')}`;
    const hashedPassword = await bcrypt.hash(password, 10);

    const userRes = await pool.query('INSERT INTO users (username, password, role) VALUES ($1, $2, $3) RETURNING id', [username, hashedPassword, 'WORKER']);
    const userId = userRes.rows[0].id;

    const workerRes = await pool.query(
      `INSERT INTO workers (user_id, worker_id, full_name, position, contact_number, daily_rate, assigned_project) 
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [userId, workerIdCode, full_name, position, contact_number, daily_rate, assigned_project]
    );
    const dbWorkerId = workerRes.rows[0].id;

    const qrData = JSON.stringify({ worker_id: workerIdCode, name: full_name });
    const qrImage = await QRCode.toDataURL(qrData);
    await pool.query('INSERT INTO qr_codes (worker_id, qr_code_data, qr_image) VALUES ($1, $2, $3)', [dbWorkerId, qrData, qrImage]);

    res.redirect('/admin/workers');
  } catch (err) {
    res.status(500).send('Error registering worker: ' + err.message);
  }
});

app.post('/admin/workers/toggle-status/:id', isAuthenticated, authorizeRole('ADMIN'), async (req, res) => {
  const w = await pool.query('SELECT status FROM workers WHERE id = $1', [req.params.id]);
  if (w.rows.length > 0) {
    const newStatus = w.rows[0].status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    await pool.query('UPDATE workers SET status = $1 WHERE id = $2', [newStatus, req.params.id]);
  }
  res.redirect('/admin/workers');
});

app.get('/admin/workers/profile/:id', isAuthenticated, authorizeRole('ADMIN'), async (req, res) => {
  const worker = await pool.query('SELECT w.*, q.qr_image FROM workers w LEFT JOIN qr_codes q ON w.id = q.worker_id WHERE w.id = $1', [req.params.id]);
  if (worker.rows.length === 0) return res.status(404).send('Not found');
  renderView(res, 'admin/worker-profile', { worker: worker.rows[0] });
});

app.get('/admin/attendance', isAuthenticated, authorizeRole('ADMIN'), async (req, res) => {
  const dateQuery = req.query.date || new Date().toISOString().split('T')[0];
  const search = req.query.search || '';
  const workers = await pool.query('SELECT * FROM workers WHERE status = $1', ['ACTIVE']);

  let attendanceReport = [];
  for (let worker of workers.rows) {
    if (search && !worker.full_name.toLowerCase().includes(search.toLowerCase()) && !worker.worker_id.toLowerCase().includes(search.toLowerCase())) continue;
    const logs = await pool.query('SELECT * FROM attendance_logs WHERE worker_id = $1 AND date = $2 ORDER BY time ASC', [worker.id, dateQuery]);
    let lgs = logs.rows;
    let first_in = lgs.find(l => l.attendance_type === 'IN')?.time || '-';
    let first_out = lgs.filter(l => l.attendance_type === 'OUT')[0]?.time || '-';
    let second_in = lgs.filter(l => l.attendance_type === 'IN')[1]?.time || '-';
    let final_out = lgs.filter(l => l.attendance_type === 'OUT').pop()?.time || '-';

    let totalHours = 0, status = 'ABSENT';
    if (lgs.length > 0) {
      status = 'INCOMPLETE';
      let currIn = null;
      lgs.forEach(l => {
        if (l.attendance_type === 'IN') currIn = l.time;
        else if (l.attendance_type === 'OUT' && currIn) {
          const [inH, inM] = currIn.split(':').map(Number);
          const [outH, outM] = l.time.split(':').map(Number);
          totalHours += (outH + outM/60) - (inH + inM/60);
          currIn = null;
        }
      });
      if (totalHours >= 7.5) status = 'FULL DAY';
      else if (totalHours >= 3.5) status = 'HALF DAY';
    }
    attendanceReport.push({ ...worker, first_in, first_out, second_in, final_out, total_working_hours: totalHours.toFixed(1), attendance_status: status });
  }
  renderView(res, 'admin/attendance', { attendanceReport, dateQuery, search });
});

app.get('/admin/advance', isAuthenticated, authorizeRole('ADMIN'), async (req, res) => {
  const workers = await pool.query('SELECT id, worker_id, full_name FROM workers WHERE status = $1', ['ACTIVE']);
  const advances = await pool.query('SELECT a.*, w.full_name, w.worker_id as code_id FROM advance_money a JOIN workers w ON a.worker_id = w.id ORDER BY a.date DESC');
  renderView(res, 'admin/advance', { workers: workers.rows, advances: advances.rows });
});

app.post('/admin/advance/add', isAuthenticated, authorizeRole('ADMIN'), async (req, res) => {
  const { worker_id, amount, date, notes } = req.body;
  await pool.query('INSERT INTO advance_money (worker_id, amount, date, notes) VALUES ($1, $2, $3, $4)', [worker_id, amount, date, notes]);
  res.redirect('/admin/advance');
});

app.get('/admin/salary', isAuthenticated, authorizeRole('ADMIN'), async (req, res) => {
  const workers = await pool.query('SELECT * FROM workers WHERE status = $1', ['ACTIVE']);
  const schedule = await pool.query('SELECT * FROM work_schedules LIMIT 1');
  const halfVal = parseFloat(schedule.rows[0]?.half_day_value || 0.5);
  const currentMonth = new Date().toISOString().slice(0, 7);

  let salaryData = [];
  for (let w of workers.rows) {
    const logs = await pool.query('SELECT date, attendance_type, time FROM attendance_logs WHERE worker_id = $1 AND TO_CHAR(date, \'YYYY-MM\') = $2 ORDER BY date ASC, time ASC', [w.id, currentMonth]);
    const daysMap = {};
    logs.rows.forEach(l => { if (!daysMap[l.date]) daysMap[l.date] = []; daysMap[l.date].push(l); });

    let fullDays = 0, halfDays = 0;
    for (let dt in daysMap) {
      let lgs = daysMap[dt], totalH = 0, currIn = null;
      lgs.forEach(l => {
        if (l.attendance_type === 'IN') currIn = l.time;
        else if (l.attendance_type === 'OUT' && currIn) {
          const [ih, im] = currIn.split(':').map(Number);
          const [oh, om] = l.time.split(':').map(Number);
          totalH += (oh + om/60) - (ih + im/60);
          currIn = null;
        }
      });
      if (totalH >= 7.5) fullDays++;
      else if (totalH >= 3.5) halfDays++;
    }
    const eqDays = fullDays + (halfDays * halfVal);
    const totalSal = eqDays * parseFloat(w.daily_rate);
    const adv = await pool.query('SELECT SUM(amount) as tot FROM advance_money WHERE worker_id = $1 AND TO_CHAR(date, \'YYYY-MM\') = $2', [w.id, currentMonth]);
    const totalAdv = parseFloat(adv.rows[0]?.tot || 0);

    salaryData.push({ ...w, full_days: fullDays, half_days: halfDays, equivalent_days: eqDays, total_salary: totalSal.toFixed(2), total_advance: totalAdv.toFixed(2), net_salary: (totalSal - totalAdv).toFixed(2) });
  }
  renderView(res, 'admin/salary', { salaryData });
});

app.get('/admin/announcements', isAuthenticated, authorizeRole('ADMIN'), async (req, res) => {
  const ann = await pool.query('SELECT * FROM announcements ORDER BY created_at DESC');
  renderView(res, 'admin/announcements', { announcements: ann.rows });
});

app.post('/admin/announcements/add', isAuthenticated, authorizeRole('ADMIN'), async (req, res) => {
  await pool.query('INSERT INTO announcements (title, content) VALUES ($1, $2)', [req.body.title, req.body.content]);
  res.redirect('/admin/announcements');
});

app.post('/admin/announcements/delete/:id', isAuthenticated, authorizeRole('ADMIN'), async (req, res) => {
  await pool.query('DELETE FROM announcements WHERE id = $1', [req.params.id]);
  res.redirect('/admin/announcements');
});

app.get('/admin/settings', isAuthenticated, authorizeRole('ADMIN'), async (req, res) => {
  const settings = await pool.query('SELECT * FROM company_settings LIMIT 1');
  const schedule = await pool.query('SELECT * FROM work_schedules LIMIT 1');
  renderView(res, 'admin/settings', { settings: settings.rows[0], schedule: schedule.rows[0] });
});

app.post('/admin/settings/update', isAuthenticated, authorizeRole('ADMIN'), async (req, res) => {
  const { company_name, logo_url, address, contact_number, half_day_value } = req.body;
  await pool.query('UPDATE company_settings SET company_name=$1, logo_url=$2, address=$3, contact_number=$4', [company_name, logo_url, address, contact_number]);
  await pool.query('UPDATE work_schedules SET half_day_value=$1', [half_day_value]);
  res.redirect('/admin/settings');
});

// WORKER PORTAL
app.get('/worker/dashboard', isAuthenticated, authorizeRole('WORKER'), async (req, res) => {
  const workerRes = await pool.query('SELECT w.*, q.qr_image FROM workers w LEFT JOIN qr_codes q ON w.id = q.worker_id WHERE w.user_id = $1', [req.session.user.id]);
  if (workerRes.rows.length === 0) return res.status(404).send('Worker profile not found');
  const worker = workerRes.rows[0];
  const today = new Date().toISOString().split('T')[0];
  const todayLogs = await pool.query('SELECT * FROM attendance_logs WHERE worker_id = $1 AND date = $2 ORDER BY time ASC', [worker.id, today]);

  let todayStatus = 'ABSENT', totalH = 0, currIn = null;
  todayLogs.rows.forEach(l => {
    if (l.attendance_type === 'IN') currIn = l.time;
    else if (l.attendance_type === 'OUT' && currIn) {
      const [ih, im] = currIn.split(':').map(Number);
      const [oh, om] = l.time.split(':').map(Number);
      totalH += (oh + om/60) - (ih + im/60);
      currIn = null;
    }
  });
  if (totalH >= 7.5) todayStatus = 'FULL DAY';
  else if (totalH >= 3.5) todayStatus = 'HALF DAY';
  else if (todayLogs.rows.length > 0) todayStatus = 'INCOMPLETE';

  const history = await pool.query('SELECT * FROM attendance_logs WHERE worker_id = $1 ORDER BY date DESC, time DESC LIMIT 30', [worker.id]);
  const announcements = await pool.query('SELECT * FROM announcements ORDER BY created_at DESC LIMIT 5');

  renderView(res, 'worker/dashboard', { worker, todayStatus, attendanceHistory: history.rows, announcements: announcements.rows });
});

// ATTENDANCE SCANNER PORTAL
app.get('/scanner/dashboard', isAuthenticated, authorizeRole('ATTENDANCE_SCANNER'), async (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const logs = await pool.query('SELECT a.*, w.full_name, w.position FROM attendance_logs a JOIN workers w ON w.id = a.worker_id WHERE a.date = $1 ORDER BY a.created_at DESC', [today]);
  renderView(res, 'scanner/dashboard', { logs: logs.rows, today });
});

app.post('/api/scan', isAuthenticated, authorizeRole('ATTENDANCE_SCANNER'), async (req, res) => {
  const { qr_data, attendance_type } = req.body;
  if (!attendance_type) return res.status(400).json({ success: false, message: 'Please select TIME IN or TIME OUT first.' });
  
  try {
    const parsed = JSON.parse(qr_data);
    const workerRes = await pool.query('SELECT * FROM workers WHERE worker_id = $1', [parsed.worker_id]);
    if (workerRes.rows.length === 0) return res.status(404).json({ success: false, message: 'Worker Not Found.' });
    const worker = workerRes.rows[0];
    if (worker.status !== 'ACTIVE') return res.status(400).json({ success: false, message: 'Worker is Inactive.' });

    const today = new Date().toISOString().split('T')[0];
    const lastLog = await pool.query('SELECT attendance_type FROM attendance_logs WHERE worker_id = $1 AND date = $2 ORDER BY time DESC LIMIT 1', [worker.id, today]);
    const lastType = lastLog.rows.length > 0 ? lastLog.rows[0].attendance_type : null;

    if (!lastType && attendance_type === 'OUT') return res.status(400).json({ success: false, message: 'Cannot record OUT as first attendance.' });
    if (lastType === 'IN' && attendance_type === 'IN') return res.status(400).json({ success: false, message: 'Cannot record two consecutive IN.' });
    if (lastType === 'OUT' && attendance_type === 'OUT') return res.status(400).json({ success: false, message: 'Cannot record two consecutive OUT.' });

    const currentTime = new Date().toTimeString().split(' ')[0];
    await pool.query('INSERT INTO attendance_logs (worker_id, date, time, attendance_type) VALUES ($1, $2, $3, $4)', [worker.id, today, currentTime, attendance_type]);

    res.json({ success: true, worker: { name: worker.full_name, position: worker.position, type: attendance_type, time: currentTime } });
  } catch (err) {
    res.status(400).json({ success: false, message: 'Invalid QR Code format.' });
  }
});

// Start application and initialize DB
initDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`Construction Worker Management System running on port ${PORT}`);
  });
}).catch(err => {
  console.error('Failed to initialize database:', err);
});
