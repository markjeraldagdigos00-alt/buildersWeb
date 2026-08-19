const express = require('express');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 10000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Initialize Database Tables & Default Settings
async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(`
  CREATE TABLE IF NOT EXISTS announcements (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
  ALTER TABLE announcements ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

  CREATE TABLE IF NOT EXISTS workers (
    id SERIAL PRIMARY KEY,
    worker_id VARCHAR(50) UNIQUE NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    position VARCHAR(100) NOT NULL,
    contact_number VARCHAR(50),
    daily_rate NUMERIC(10,2) DEFAULT 0.00,
    assigned_project VARCHAR(255),
    profile_picture TEXT,
    status VARCHAR(20) DEFAULT 'Active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
  ALTER TABLE workers ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

  CREATE TABLE IF NOT EXISTS attendance_logs (
    id SERIAL PRIMARY KEY,
    worker_id VARCHAR(50) NOT NULL,
    attendance_date DATE NOT NULL,
    attendance_time TIME NOT NULL,
    attendance_type VARCHAR(10) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
  ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

  CREATE TABLE IF NOT EXISTS stock_transactions (
    id SERIAL PRIMARY KEY,
    material_id INT,
    transaction_type VARCHAR(10) NOT NULL,
    quantity NUMERIC(10,2) NOT NULL,
    stock_after NUMERIC(10,2) NOT NULL,
    reference_info VARCHAR(255),
    purpose VARCHAR(255),
    notes TEXT,
    recorded_from VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
  ALTER TABLE stock_transactions ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

  CREATE TABLE IF NOT EXISTS advance_money (
    id SERIAL PRIMARY KEY,
    worker_id VARCHAR(50) NOT NULL,
    amount NUMERIC(10,2) NOT NULL,
    advance_date DATE NOT NULL,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
  ALTER TABLE advance_money ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
`);

    // Insert defaults if empty
    const settingsCheck = await client.query('SELECT * FROM company_settings WHERE id = 1');
    if (settingsCheck.rows.length === 0) {
      await client.query('INSERT INTO company_settings (id, company_name) VALUES (1, $1)', ['Apex Construction Co.']);
    }
    const schedCheck = await client.query('SELECT * FROM work_schedules WHERE id = 1');
    if (schedCheck.rows.length === 0) {
      await client.query('INSERT INTO work_schedules (id) VALUES (1)');
    }
  } finally {
    client.release();
  }
}

initDB().catch(console.error);

// Helper for fetching company settings
async function getSettings() {
  const res = await pool.query('SELECT * FROM company_settings WHERE id = 1');
  return res.rows[0] || {};
}

// Helper HTML wrapper with Tailwind & CDN Libraries (QRCode & QR Scanner)
function layout(title, bodyContent, activePortal = '') {
  return `<!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="https://cdn.jsdelivr.net/npm/qrcode@1.5.1/build/qrcode.min.js"></script>
    <script src="https://unpkg.com/html5-qrcode" type="text/javascript"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  </head>
  <body class="bg-gray-100 font-sans min-h-screen flex flex-col justify-between">
    <div>
      ${bodyContent}
    </div>
    <footer class="bg-white border-t border-gray-200 text-center py-4 text-sm text-gray-500 mt-10">
      &copy; ${new Date().getFullYear()} Construction Management System. All rights reserved.
    </footer>
  </body>
  </html>`;
}

// ==========================================
// ROUTES: MAIN PAGE
// ==========================================
app.get('/', async (req, res) => {
  const settings = await getSettings();
  const html = `
    <div class="max-w-4xl mx-auto px-4 py-16 text-center">
      <div class="mb-8 flex flex-col items-center">
        ${settings.company_logo ? `<img src="${settings.company_logo}" class="h-24 w-24 object-cover rounded-full mb-4 shadow-md" />` : '<div class="h-24 w-24 bg-amber-500 rounded-full flex items-center justify-center text-white text-3xl font-bold mb-4"><i class="fa-solid fa-hard-hat"></i></div>'}
        <h1 class="text-4xl font-extrabold text-gray-800">${settings.company_name}</h1>
        <p class="text-gray-600 mt-2">${settings.company_address} | Tel: ${settings.contact_number}</p>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mt-12">
        <a href="/admin" class="bg-blue-600 hover:bg-blue-700 text-white p-8 rounded-xl shadow-lg transition transform hover:-translate-y-1 flex flex-col items-center">
          <i class="fa-solid fa-user-shield text-4xl mb-4"></i>
          <span class="text-2xl font-bold">ADMIN PORTAL</span>
          <span class="text-sm opacity-80 mt-2">Manage workers, stock & payroll</span>
        </a>
        <a href="/worker" class="bg-emerald-600 hover:bg-emerald-700 text-white p-8 rounded-xl shadow-lg transition transform hover:-translate-y-1 flex flex-col items-center">
          <i class="fa-solid fa-hard-hat text-4xl mb-4"></i>
          <span class="text-2xl font-bold">WORKER PORTAL</span>
          <span class="text-sm opacity-80 mt-2">View records & personal QR</span>
        </a>
        <a href="/scanner" class="bg-purple-600 hover:bg-purple-700 text-white p-8 rounded-xl shadow-lg transition transform hover:-translate-y-1 flex flex-col items-center">
          <i class="fa-solid fa-qrcode text-4xl mb-4"></i>
          <span class="text-2xl font-bold">SCANNER PORTAL</span>
          <span class="text-sm opacity-80 mt-2">QR Attendance & Stock IO</span>
        </a>
      </div>
    </div>
  `;
  res.send(layout('Welcome - Construction System', html));
});

// ==========================================
// ROUTES: WORKER PORTAL (/worker)
// ==========================================
app.get('/worker', async (req, res) => {
  const settings = await getSettings();
  const workerId = req.query.worker_id || '';
  let worker = null;
  let attendance = [];
  let advances = [];
  let announcements = [];

  if (workerId) {
    const wRes = await pool.query('SELECT * FROM workers WHERE worker_id = $1', [workerId]);
    if (wRes.rows.length > 0) {
      worker = wRes.rows[0];
      const aRes = await pool.query('SELECT * FROM attendance_logs WHERE worker_id = $1 ORDER BY attendance_date DESC, attendance_time DESC', [workerId]);
      attendance = aRes.rows;
      const advRes = await pool.query('SELECT * FROM advance_money WHERE worker_id = $1 ORDER BY advance_date DESC', [workerId]);
      advances = advRes.rows;
    }
  }

  const annRes = await pool.query('SELECT * FROM announcements ORDER BY created_at DESC LIMIT 5');
  announcements = annRes.rows;

  const html = `
    <nav class="bg-emerald-700 text-white shadow-md">
      <div class="max-w-7xl mx-auto px-4 py-4 flex justify-between items-center">
        <div class="flex items-center space-x-3">
          ${settings.company_logo ? `<img src="${settings.company_logo}" class="h-10 w-10 rounded-full object-cover">` : '<i class="fa-solid fa-hard-hat text-2xl"></i>'}
          <span class="font-bold text-lg">${settings.company_name} - Worker Portal</span>
        </div>
        <a href="/" class="bg-emerald-800 px-4 py-2 rounded hover:bg-emerald-900 text-sm"><i class="fa-solid fa-home"></i> Main Page</a>
      </div>
    </nav>
    <div class="max-w-4xl mx-auto px-4 py-8">
      <div class="bg-white p-6 rounded-lg shadow-md mb-8">
        <h2 class="text-xl font-bold text-gray-800 mb-4">Worker Portal Access</h2>
        <form method="GET" action="/worker" class="flex gap-4">
          <input type="text" name="worker_id" placeholder="Enter Worker ID (e.g. W-0001)" value="${workerId}" required class="flex-1 border rounded px-4 py-2 uppercase">
          <button type="submit" class="bg-emerald-600 text-white px-6 py-2 rounded hover:bg-emerald-700 font-semibold">View Profile</button>
        </form>
      </div>

      ${workerId && !worker ? `<div class="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-6">Worker ID not found. Please check and try again.</div>` : ''}

      ${worker ? `
        <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div class="bg-white p-6 rounded-lg shadow-md md:col-span-1 flex flex-col items-center text-center">
            ${worker.profile_picture ? `<img src="${worker.profile_picture}" class="w-32 h-32 rounded-full object-cover mb-4 border-2 border-emerald-500">` : '<div class="w-32 h-32 rounded-full bg-gray-200 flex items-center justify-center text-gray-400 mb-4 text-4xl"><i class="fa-solid fa-user"></i></div>'}
            <h3 class="text-xl font-bold text-gray-800">${worker.full_name}</h3>
            <p class="text-emerald-600 font-semibold">${worker.worker_id}</p>
            <p class="text-gray-500 text-sm mt-1">${worker.position}</p>
            <span class="mt-3 px-3 py-1 bg-green-100 text-green-800 text-xs rounded-full font-semibold">${worker.status}</span>
          </div>
          <div class="bg-white p-6 rounded-lg shadow-md md:col-span-2 flex flex-col justify-between">
            <div>
              <h3 class="text-lg font-bold text-gray-800 mb-4 border-b pb-2">Personal QR Code</h3>
              <div class="flex flex-col items-center justify-center">
                <canvas id="workerQR" class="border p-2 rounded shadow-sm"></canvas>
                <p class="text-xs text-gray-500 mt-2">Show this QR code to the scanner station for attendance.</p>
              </div>
            </div>
          </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div class="bg-white p-6 rounded-lg shadow-md">
            <h3 class="text-lg font-bold text-gray-800 mb-4 border-b pb-2">Recent Attendance Logs</h3>
            <div class="overflow-x-auto max-h-60 overflow-y-auto">
              <table class="w-full text-left text-sm">
                <thead><tr class="bg-gray-50 border-b"><th class="p-2">Date</th><th class="p-2">Time</th><th class="p-2">Type</th></tr></thead>
                <tbody>
                  ${attendance.length === 0 ? '<tr><td colspan="3" class="p-4 text-center text-gray-500">No records found</td></tr>' : attendance.map(a => `
                    <tr class="border-b"><td class="p-2">${a.attendance_date.toISOString().split('T')[0]}</td><td class="p-2">${a.attendance_time}</td><td class="p-2"><span class="px-2 py-0.5 rounded text-xs ${a.attendance_type === 'IN' ? 'bg-blue-100 text-blue-800' : 'bg-orange-100 text-orange-800'}">${a.attendance_type}</span></td></tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>

          <div class="bg-white p-6 rounded-lg shadow-md">
            <h3 class="text-lg font-bold text-gray-800 mb-4 border-b pb-2">Advance Money Records</h3>
            <div class="overflow-x-auto max-h-60 overflow-y-auto">
              <table class="w-full text-left text-sm">
                <thead><tr class="bg-gray-50 border-b"><th class="p-2">Date</th><th class="p-2">Amount</th><th class="p-2">Notes</th></tr></thead>
                <tbody>
                  ${advances.length === 0 ? '<tr><td colspan="3" class="p-4 text-center text-gray-500">No advance records</td></tr>' : advances.map(ad => `
                    <tr class="border-b"><td class="p-2">${ad.advance_date.toISOString().split('T')[0]}</td><td class="p-2 font-bold text-red-600">$${Number(ad.amount).toFixed(2)}</td><td class="p-2">${ad.notes || '-'}</td></tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <script>
          window.addEventListener('DOMContentLoaded', () => {
            QRCode.toCanvas(document.getElementById('workerQR'), "${worker.worker_id}", { width: 180 }, function (error) {
              if (error) console.error(error);
            });
          });
        </script>
      ` : ''}

      <div class="bg-white p-6 rounded-lg shadow-md mt-8">
        <h3 class="text-lg font-bold text-gray-800 mb-4 border-b pb-2"><i class="fa-solid fa-bullhorn text-amber-500"></i> Company Announcements</h3>
        <div class="space-y-4">
          ${announcements.length === 0 ? '<p class="text-gray-500 text-sm">No announcements posted.</p>' : announcements.map(an => `
            <div class="border-l-4 border-amber-500 pl-4 py-1">
              <h4 class="font-bold text-gray-800">${an.title}</h4>
              <p class="text-sm text-gray-600 mt-1">${an.content}</p>
              <span class="text-xs text-gray-400 mt-1 block">${new Date(an.created_at).toLocaleString()}</span>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `;
  res.send(layout('Worker Portal', html));
});

// ==========================================
// ROUTES: SCANNER PORTAL (/scanner)
// ==========================================
app.get('/scanner', async (req, res) => {
  const settings = await getSettings();
  const materials = (await pool.query('SELECT * FROM materials ORDER BY material_name')).rows;
  const stockHistory = (await pool.query('SELECT st.*, m.material_name FROM stock_transactions st LEFT JOIN materials m ON st.material_id = m.id ORDER BY st.created_at DESC LIMIT 20')).rows;

  const html = `
    <nav class="bg-purple-700 text-white shadow-md">
      <div class="max-w-7xl mx-auto px-4 py-4 flex justify-between items-center">
        <div class="flex items-center space-x-3">
          ${settings.company_logo ? `<img src="${settings.company_logo}" class="h-10 w-10 rounded-full object-cover">` : '<i class="fa-solid fa-qrcode text-2xl"></i>'}
          <span class="font-bold text-lg">${settings.company_name} - Scanner Portal</span>
        </div>
        <a href="/" class="bg-purple-800 px-4 py-2 rounded hover:bg-purple-900 text-sm"><i class="fa-solid fa-home"></i> Main Page</a>
      </div>
    </nav>
    <div class="max-w-6xl mx-auto px-4 py-8">
      <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
        
        <!-- ATTENDANCE SCANNER SECTION -->
        <div class="bg-white p-6 rounded-lg shadow-md flex flex-col justify-between">
          <div>
            <h2 class="text-xl font-bold text-purple-800 mb-4 border-b pb-2"><i class="fa-solid fa-camera"></i> QR Worker Attendance Scanner</h2>
            
            <div class="mb-4">
              <label class="block text-sm font-bold text-gray-700 mb-2">Select Attendance Mode:</label>
              <div class="flex gap-4">
                <button type="button" onclick="setMode('IN')" id="btnIn" class="flex-1 py-3 px-4 rounded border-2 font-bold transition border-blue-600 bg-blue-50 text-blue-700">TIME IN</button>
                <button type="button" onclick="setMode('OUT')" id="btnOut" class="flex-1 py-3 px-4 rounded border-2 font-bold transition border-gray-300 bg-white text-gray-700">TIME OUT</button>
              </div>
              <p class="text-xs text-gray-500 mt-2 font-semibold">CURRENT SCAN MODE: <span id="modeDisplay" class="text-blue-600 font-bold text-sm">TIME IN</span></p>
            </div>

            <div id="alertBox" class="hidden p-3 rounded mb-4 text-sm font-semibold"></div>

            <div class="my-4 flex flex-col items-center">
              <button onclick="startScanner()" id="startScanBtn" class="w-full bg-purple-600 text-white font-bold py-3 rounded hover:bg-purple-700 shadow"><i class="fa-solid fa-play"></i> START QR SCANNER</button>
              <div id="reader" class="w-full mt-4 hidden"></div>
            </div>
          </div>
        </div>

        <!-- STOCK IN / OUT SECTION -->
        <div class="bg-white p-6 rounded-lg shadow-md">
          <h2 class="text-xl font-bold text-purple-800 mb-4 border-b pb-2"><i class="fa-solid boxes-stacked"></i> Stock Inventory Operations</h2>
          <div class="flex border-b mb-4">
            <button onclick="switchStockTab('IN')" id="stockInTab" class="flex-1 pb-2 font-bold text-purple-600 border-b-2 border-purple-600">Stock IN</button>
            <button onclick="switchStockTab('OUT')" id="stockOutTab" class="flex-1 pb-2 font-bold text-gray-500">Stock OUT</button>
          </div>

          <form id="stockForm" onsubmit="handleStockSubmit(event)">
            <input type="hidden" id="txType" value="IN">
            <div class="mb-3">
              <label class="block text-sm font-bold text-gray-700 mb-1">Select Material</label>
              <select name="material_id" id="materialSelect" required class="w-full border rounded p-2">
                <option value="">-- Choose Material --</option>
                ${materials.map(m => `<option value="${m.id}">${m.material_name} (Current: ${m.current_quantity} ${m.unit})</option>`).join('')}
              </select>
            </div>
            <div class="mb-3">
              <label class="block text-sm font-bold text-gray-700 mb-1" id="qtyLabel">Quantity Received</label>
              <input type="number" step="any" name="quantity" required class="w-full border rounded p-2" placeholder="0.00">
            </div>
            <div class="mb-3" id="supplierField">
              <label class="block text-sm font-bold text-gray-700 mb-1">Supplier</label>
              <input type="text" name="supplier" class="w-full border rounded p-2" placeholder="Supplier Name">
            </div>
            <div class="mb-3 hidden" id="issuedToField">
              <label class="block text-sm font-bold text-gray-700 mb-1">Issued To / Project / Purpose</label>
              <input type="text" name="issued_to" class="w-full border rounded p-2" placeholder="Recipient / Project Name">
            </div>
            <div class="mb-3">
              <label class="block text-sm font-bold text-gray-700 mb-1">Notes</label>
              <textarea name="notes" class="w-full border rounded p-2" rows="2" placeholder="Optional notes..."></textarea>
            </div>
            <button type="submit" class="w-full bg-purple-600 text-white font-bold py-2 rounded hover:bg-purple-700">Submit Transaction</button>
          </form>
          <div id="stockMsg" class="mt-3 text-sm font-semibold"></div>
        </div>

      </div>

      <!-- Current Stock & History -->
      <div class="mt-8 bg-white p-6 rounded-lg shadow-md">
        <h3 class="text-lg font-bold text-gray-800 mb-4">Stock Inventory Overview & Recent Transactions</h3>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <h4 class="font-bold text-sm text-gray-600 mb-2">Available Materials</h4>
            <div class="overflow-x-auto max-h-48 overflow-y-auto">
              <table class="w-full text-left text-sm">
                <tr class="bg-gray-50 border-b"><th class="p-2">Material</th><th class="p-2">Category</th><th class="p-2">Stock</th><th class="p-2">Status</th></tr>
                ${materials.map(m => `
                  <tr class="border-b">
                    <td class="p-2 font-semibold">${m.material_name}</td>
                    <td class="p-2">${m.category || '-'}</td>
                    <td class="p-2">${m.current_quantity} ${m.unit}</td>
                    <td class="p-2">${Number(m.current_quantity) <= Number(m.minimum_stock_level) ? '<span class="text-xs bg-red-100 text-red-800 px-2 py-0.5 rounded font-bold">LOW STOCK</span>' : '<span class="text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded">OK</span>'}</td>
                  </tr>
                `).join('')}
              </table>
            </div>
          </div>
          <div>
            <h4 class="font-bold text-sm text-gray-600 mb-2">Recent Stock Activity</h4>
            <div class="overflow-x-auto max-h-48 overflow-y-auto">
              <table class="w-full text-left text-sm">
                <tr class="bg-gray-50 border-b"><th class="p-2">Material</th><th class="p-2">Type</th><th class="p-2">Qty</th><th class="p-2">New Stock</th></tr>
                ${stockHistory.map(sh => `
                  <tr class="border-b">
                    <td class="p-2">${sh.material_name}</td>
                    <td class="p-2"><span class="px-2 py-0.5 rounded text-xs ${sh.transaction_type === 'IN' ? 'bg-blue-100 text-blue-800' : 'bg-orange-100 text-orange-800'}">${sh.transaction_type}</span></td>
                    <td class="p-2">${sh.quantity}</td>
                    <td class="p-2 font-semibold">${sh.stock_after}</td>
                  </tr>
                `).join('')}
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>

    <script>
      let currentMode = 'IN';
      let html5QrCode = null;

      function setMode(mode) {
        currentMode = mode;
        document.getElementById('modeDisplay').innerText = mode === 'IN' ? 'TIME IN' : 'TIME OUT';
        if(mode === 'IN') {
          document.getElementById('btnIn').className = 'flex-1 py-3 px-4 rounded border-2 font-bold transition border-blue-600 bg-blue-50 text-blue-700';
          document.getElementById('btnOut').className = 'flex-1 py-3 px-4 rounded border-2 font-bold transition border-gray-300 bg-white text-gray-700';
          document.getElementById('modeDisplay').className = 'text-blue-600 font-bold text-sm';
        } else {
          document.getElementById('btnOut').className = 'flex-1 py-3 px-4 rounded border-2 font-bold transition border-orange-600 bg-orange-50 text-orange-700';
          document.getElementById('btnIn').className = 'flex-1 py-3 px-4 rounded border-2 font-bold transition border-gray-300 bg-white text-gray-700';
          document.getElementById('modeDisplay').className = 'text-orange-600 font-bold text-sm';
        }
      }

      function startScanner() {
        const btn = document.getElementById('startScanBtn');
        btn.classList.add('hidden');
        document.getElementById('reader').classList.remove('hidden');

        html5QrCode = new Html5Qrcode("reader");
        html5QrCode.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 250, height: 250 } },
          async (decodedText) => {
            // Stop scanner temporarily & process
            await html5QrCode.stop();
            document.getElementById('reader').classList.add('hidden');
            btn.classList.remove('hidden');
            processAttendance(decodedText.trim());
          },
          (errorMessage) => { /* scanning error ignore */ }
        ).catch(err => {
          showAlert('Camera access error or unsupported device.', 'error');
          btn.classList.remove('hidden');
          document.getElementById('reader').classList.add('hidden');
        });
      }

      async function processAttendance(workerId) {
        try {
          const res = await fetch('/api/attendance', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ worker_id: workerId, attendance_type: currentMode })
          });
          const data = await res.json();
          if(data.success) {
            showAlert(\`SUCCESS!\\n\${data.worker.full_name}\\nWorker ID: \${data.worker.worker_id}\\n\${data.type} recorded at \${data.time}\`, 'success');
          } else {
            showAlert(\`ERROR: \${data.message}\`, 'error');
          }
        } catch(e) {
          showAlert('Network or server error recording attendance.', 'error');
        }
      }

      function showAlert(msg, type) {
        const box = document.getElementById('alertBox');
        box.classList.remove('hidden', 'bg-green-100', 'text-green-700', 'border-green-400', 'bg-red-100', 'text-red-700', 'border-red-400');
        if(type === 'success') {
          box.classList.add('bg-green-100', 'text-green-700', 'border', 'border-green-400');
        } else {
          box.classList.add('bg-red-100', 'text-red-700', 'border', 'border-red-400');
        }
        box.innerText = msg;
      }

      function switchStockTab(type) {
        document.getElementById('txType').value = type;
        if(type === 'IN') {
          document.getElementById('stockInTab').className = 'flex-1 pb-2 font-bold text-purple-600 border-b-2 border-purple-600';
          document.getElementById('stockOutTab').className = 'flex-1 pb-2 font-bold text-gray-500';
          document.getElementById('qtyLabel').innerText = 'Quantity Received';
          document.getElementById('supplierField').classList.remove('hidden');
          document.getElementById('issuedToField').classList.add('hidden');
        } else {
          document.getElementById('stockOutTab').className = 'flex-1 pb-2 font-bold text-purple-600 border-b-2 border-purple-600';
          document.getElementById('stockInTab').className = 'flex-1 pb-2 font-bold text-gray-500';
          document.getElementById('qtyLabel').innerText = 'Quantity Issued';
          document.getElementById('supplierField').classList.add('hidden');
          document.getElementById('issuedToField').classList.remove('hidden');
        }
      }

      async function handleStockSubmit(e) {
        e.preventDefault();
        const form = e.target;
        const data = {
          material_id: form.material_id.value,
          transaction_type: form.txType.value,
          quantity: form.quantity.value,
          supplier: form.supplier ? form.supplier.value : '',
          issued_to: form.issued_to ? form.issued_to.value : '',
          notes: form.notes.value,
          recorded_from: 'Scanner Portal'
        };

        const res = await fetch('/api/stock', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        });
        const result = await res.json();
        const msgBox = document.getElementById('stockMsg');
        if(result.success) {
          msgBox.className = 'mt-3 text-sm font-semibold text-green-600';
          msgBox.innerText = 'Stock transaction saved successfully! Refreshing...';
          setTimeout(() => location.reload(), 1200);
        } else {
          msgBox.className = 'mt-3 text-sm font-semibold text-red-600';
          msgBox.innerText = result.message;
        }
      }
    </script>
  `;
  res.send(layout('Scanner Portal', html));
});

// ==========================================
// API: ATTENDANCE SCAN LOGIC & VALIDATION
// ==========================================
app.post('/api/attendance', async (req, res) => {
  const { worker_id, attendance_type } = req.body;
  const client = await pool.connect();
  try {
    const wRes = await client.query('SELECT * FROM workers WHERE worker_id = $1', [worker_id]);
    if (wRes.rows.length === 0) {
      return res.json({ success: false, message: 'Worker ID not found in database.' });
    }
    const worker = wRes.rows[0];

    const today = new Date().toISOString().split('T')[0];
    const logsRes = await client.query(
      'SELECT * FROM attendance_logs WHERE worker_id = $1 AND attendance_date = $2 ORDER BY attendance_time ASC',
      [worker_id, today]
    );
    const logs = logsRes.rows;

    // Sequence Validation Rules: IN -> OUT -> IN -> OUT
    if (logs.length === 0) {
      if (attendance_type !== 'IN') {
        return res.json({ success: false, message: 'Cannot record TIME OUT as the first attendance.' });
      }
    } else {
      const lastLog = logs[logs.length - 1];
      if (lastLog.attendance_type === attendance_type) {
        if (attendance_type === 'IN') {
          return res.json({ success: false, message: 'Cannot record two consecutive TIME IN records.' });
        } else {
          return res.json({ success: false, message: 'Cannot record two consecutive TIME OUT records.' });
        }
      }
    }

    const now = new Date();
    const timeStr = now.toTimeString().split(' ')[0];

    await client.query(
      'INSERT INTO attendance_logs (worker_id, attendance_date, attendance_time, attendance_type) VALUES ($1, $2, $3, $4)',
      [worker_id, today, timeStr, attendance_type]
    );

    res.json({
      success: true,
      worker: worker,
      type: attendance_type,
      time: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    });
  } catch (err) {
    res.json({ success: false, message: err.message });
  } finally {
    client.release();
  }
});

// ==========================================
// API: STOCK TRANSACTION
// ==========================================
app.post('/api/stock', async (req, res) => {
  const { material_id, transaction_type, quantity, supplier, issued_to, notes, recorded_from } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const matRes = await client.query('SELECT * FROM materials WHERE id = $1', [material_id]);
    if (matRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.json({ success: false, message: 'Material not found.' });
    }
    let material = matRes.rows[0];
    let currentQty = Number(material.current_quantity);
    let qty = Number(quantity);
    let newStock = 0;

    if (transaction_type === 'IN') {
      newStock = currentQty + qty;
    } else {
      if (qty > currentQty) {
        await client.query('ROLLBACK');
        return res.json({ success: false, message: 'Insufficient Stock.' });
      }
      newStock = currentQty - qty;
    }

    await client.query('UPDATE materials SET current_quantity = $1 WHERE id = $2', [newStock, material_id]);
    const refInfo = transaction_type === 'IN' ? (supplier || 'Supplier') : (issued_to || 'Project/Issued');

    await client.query(
      'INSERT INTO stock_transactions (material_id, transaction_type, quantity, stock_after, reference_info, purpose, notes, recorded_from) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
      [material_id, transaction_type, qty, newStock, refInfo, issued_to || '', notes || '', recorded_from || 'Admin']
    );

    await client.query('COMMIT');
    res.json({ success: true, newStock });
  } catch (err) {
    await client.query('ROLLBACK');
    res.json({ success: false, message: err.message });
  } finally {
    client.release();
  }
});

// ==========================================
// ROUTES: ADMIN PORTAL (/admin)
// ==========================================
app.get('/admin', async (req, res) => {
  const settings = await getSettings();
  const tab = req.query.tab || 'dashboard';

  // Data gathers
  const workers = (await pool.query('SELECT * FROM workers ORDER BY worker_id')).rows;
  const materials = (await pool.query('SELECT * FROM materials ORDER BY material_name')).rows;
  const announcements = (await pool.query('SELECT * FROM announcements ORDER BY created_at DESC')).rows;
  const schedule = (await pool.query('SELECT * FROM work_schedules WHERE id = 1')).rows[0];
  const advances = (await pool.query('SELECT ad.*, w.full_name FROM advance_money ad LEFT JOIN workers w ON ad.worker_id = w.worker_id ORDER BY ad.advance_date DESC')).rows;
  const stockHistory = (await pool.query('SELECT st.*, m.material_name FROM stock_transactions st LEFT JOIN materials m ON st.material_id = m.id ORDER BY st.created_at DESC')).rows;
  
  const today = new Date().toISOString().split('T')[0];
  const todayAtt = (await pool.query('SELECT * FROM attendance_logs WHERE attendance_date = $1', [today])).rows;

  // Dashboard Metrics
  const totalWorkers = workers.length;
  const presentWorkersSet = new Set(todayAtt.map(a => a.worker_id));
  const presentToday = presentWorkersSet.size;
  const absentToday = totalWorkers - presentToday;
  const lowStockMaterials = materials.filter(m => Number(m.current_quantity) <= Number(m.minimum_stock_level));

  const html = `
    <div class="min-h-screen flex flex-col md:flex-row">
      <!-- Admin Sidebar -->
      <div class="w-full md:w-64 bg-slate-800 text-white flex flex-col justify-between">
        <div>
          <div class="p-4 border-b border-slate-700 flex items-center space-x-3">
            ${settings.company_logo ? `<img src="${settings.company_logo}" class="h-10 w-10 rounded-full object-cover">` : '<i class="fa-solid fa-user-shield text-2xl text-amber-500"></i>'}
            <span class="font-bold truncate">${settings.company_name}</span>
          </div>
          <nav class="p-2 space-y-1 text-sm">
            <a href="/admin?tab=dashboard" class="block px-4 py-2.5 rounded ${tab === 'dashboard' ? 'bg-slate-700 font-bold text-amber-400' : 'hover:bg-slate-700'}"><i class="fa-solid fa-chart-line mr-2"></i> Dashboard</a>
            <a href="/admin?tab=workers" class="block px-4 py-2.5 rounded ${tab === 'workers' ? 'bg-slate-700 font-bold text-amber-400' : 'hover:bg-slate-700'}"><i class="fa-solid fa-users mr-2"></i> Workers</a>
            <a href="/admin?tab=attendance" class="block px-4 py-2.5 rounded ${tab === 'attendance' ? 'bg-slate-700 font-bold text-amber-400' : 'hover:bg-slate-700'}"><i class="fa-solid fa-clipboard-user mr-2"></i> Attendance</a>
            <a href="/admin?tab=stock" class="block px-4 py-2.5 rounded ${tab === 'stock' ? 'bg-slate-700 font-bold text-amber-400' : 'hover:bg-slate-700'}"><i class="fa-solid fa-boxes-stacked mr-2"></i> Stock Inventory</a>
            <a href="/admin?tab=advance" class="block px-4 py-2.5 rounded ${tab === 'advance' ? 'bg-slate-700 font-bold text-amber-400' : 'hover:bg-slate-700'}"><i class="fa-solid fa-wallet mr-2"></i> Advance Money</a>
            <a href="/admin?tab=salary" class="block px-4 py-2.5 rounded ${tab === 'salary' ? 'bg-slate-700 font-bold text-amber-400' : 'hover:bg-slate-700'}"><i class="fa-solid fa-money-check-dollar mr-2"></i> Salary</a>
            <a href="/admin?tab=announcements" class="block px-4 py-2.5 rounded ${tab === 'announcements' ? 'bg-slate-700 font-bold text-amber-400' : 'hover:bg-slate-700'}"><i class="fa-solid fa-bullhorn mr-2"></i> Announcements</a>
            <a href="/admin?tab=settings" class="block px-4 py-2.5 rounded ${tab === 'settings' ? 'bg-slate-700 font-bold text-amber-400' : 'hover:bg-slate-700'}"><i class="fa-solid fa-gear mr-2"></i> Company Settings</a>
            <a href="/admin?tab=schedule" class="block px-4 py-2.5 rounded ${tab === 'schedule' ? 'bg-slate-700 font-bold text-amber-400' : 'hover:bg-slate-700'}"><i class="fa-solid fa-clock mr-2"></i> Work Schedule</a>
          </nav>
        </div>
        <div class="p-4 border-t border-slate-700">
          <a href="/" class="block text-center bg-slate-700 hover:bg-slate-600 py-2 rounded text-sm font-semibold"><i class="fa-solid fa-arrow-left"></i> Return to Main Page</a>
        </div>
      </div>

      <!-- Main Content Area -->
      <div class="flex-1 p-6 md:p-8 overflow-y-auto">
        
        <!-- DASHBOARD TAB -->
        ${tab === 'dashboard' ? `
          <h1 class="text-2xl font-bold text-gray-800 mb-6">Admin Dashboard</h1>
          <div class="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
            <div class="bg-white p-6 rounded-lg shadow-md border-l-4 border-blue-500">
              <p class="text-sm text-gray-500 font-semibold">TOTAL WORKERS</p>
              <h3 class="text-3xl font-extrabold text-gray-800 mt-2">${totalWorkers}</h3>
            </div>
            <div class="bg-white p-6 rounded-lg shadow-md border-l-4 border-green-500">
              <p class="text-sm text-gray-500 font-semibold">PRESENT TODAY</p>
              <h3 class="text-3xl font-extrabold text-gray-800 mt-2">${presentToday}</h3>
            </div>
            <div class="bg-white p-6 rounded-lg shadow-md border-l-4 border-amber-500">
              <p class="text-sm text-gray-500 font-semibold">ABSENT TODAY</p>
              <h3 class="text-3xl font-extrabold text-gray-800 mt-2">${absentToday}</h3>
            </div>
            <div class="bg-white p-6 rounded-lg shadow-md border-l-4 border-purple-500">
              <p class="text-sm text-gray-500 font-semibold">TOTAL MATERIALS</p>
              <h3 class="text-3xl font-extrabold text-gray-800 mt-2">${materials.length}</h3>
            </div>
          </div>

          ${lowStockMaterials.length > 0 ? `
            <div class="bg-red-50 border border-red-300 p-4 rounded-lg mb-8">
              <h3 class="text-red-800 font-bold flex items-center"><i class="fa-solid fa-triangle-exclamation mr-2"></i> LOW STOCK ALERT - PLEASE RESTOCK</h3>
              <ul class="mt-2 list-disc list-inside text-sm text-red-700">
                ${lowStockMaterials.map(m => `<li>${m.material_name} (Current Stock: ${m.current_quantity} ${m.unit}, Minimum: ${m.minimum_stock_level})</li>`).join('')}
              </ul>
            </div>
          ` : ''}

          <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div class="bg-white p-6 rounded-lg shadow-md">
              <h3 class="font-bold text-gray-800 mb-4">Recent Attendance Logs (Today)</h3>
              <div class="overflow-x-auto max-h-60 overflow-y-auto">
                <table class="w-full text-left text-sm">
                  <tr class="bg-gray-50 border-b"><th class="p-2">Worker ID</th><th class="p-2">Time</th><th class="p-2">Type</th></tr>
                  ${todayAtt.length === 0 ? '<tr><td colspan="3" class="p-4 text-center text-gray-500">No attendance logs recorded today.</td></tr>' : todayAtt.map(a => `
                    <tr class="border-b"><td class="p-2 font-semibold">${a.worker_id}</td><td class="p-2">${a.attendance_time}</td><td class="p-2"><span class="px-2 py-0.5 rounded text-xs ${a.attendance_type === 'IN' ? 'bg-blue-100 text-blue-800' : 'bg-orange-100 text-orange-800'}">${a.attendance_type}</span></td></tr>
                  `).join('')}
                </table>
              </div>
            </div>
            <div class="bg-white p-6 rounded-lg shadow-md">
              <h3 class="font-bold text-gray-800 mb-4">Recent Stock Transactions</h3>
              <div class="overflow-x-auto max-h-60 overflow-y-auto">
                <table class="w-full text-left text-sm">
                  <tr class="bg-gray-50 border-b"><th class="p-2">Material</th><th class="p-2">Type</th><th class="p-2">Qty</th><th class="p-2">By</th></tr>
                  ${stockHistory.slice(0, 5).map(st => `
                    <tr class="border-b"><td class="p-2">${st.material_name}</td><td class="p-2"><span class="px-2 py-0.5 rounded text-xs ${st.transaction_type === 'IN' ? 'bg-blue-100 text-blue-800' : 'bg-orange-100 text-orange-800'}">${st.transaction_type}</span></td><td class="p-2">${st.quantity}</td><td class="p-2 text-xs">${st.recorded_from}</td></tr>
                  `).join('')}
                </table>
              </div>
            </div>
          </div>
        ` : ''}

        <!-- WORKERS TAB -->
        ${tab === 'workers' ? `
          <div class="flex justify-between items-center mb-6">
            <h1 class="text-2xl font-bold text-gray-800">Worker Management</h1>
            <button onclick="openRegisterModal()" class="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 font-semibold"><i class="fa-solid fa-user-plus"></i> Register Worker</button>
          </div>
          <div class="bg-white rounded-lg shadow-md overflow-hidden">
            <div class="overflow-x-auto">
              <table class="w-full text-left text-sm">
                <tr class="bg-gray-50 border-b">
                  <th class="p-3">ID</th>
                  <th class="p-3">Photo</th>
                  <th class="p-3">Full Name</th>
                  <th class="p-3">Position</th>
                  <th class="p-3">Daily Rate</th>
                  <th class="p-3">Status</th>
                  <th class="p-3">QR Code</th>
                  <th class="p-3">Actions</th>
                </tr>
                ${workers.map(w => `
                  <tr class="border-b">
                    <td class="p-3 font-bold">${w.worker_id}</td>
                    <td class="p-3">${w.profile_picture ? `<img src="${w.profile_picture}" class="w-10 h-10 rounded-full object-cover">` : '<div class="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center"><i class="fa-solid fa-user text-gray-400"></i></div>'}</td>
                    <td class="p-3 font-semibold">${w.full_name}</td>
                    <td class="p-3">${w.position}</td>
                    <td class="p-3">$${Number(w.daily_rate).toFixed(2)}</td>
                    <td class="p-3"><span class="px-2 py-0.5 rounded text-xs ${w.status === 'Active' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}">${w.status}</span></td>
                    <td class="p-3"><button onclick="viewQR('${w.worker_id}', '${w.full_name}')" class="text-purple-600 hover:underline font-semibold"><i class="fa-solid fa-qrcode"></i> View QR</button></td>
                    <td class="p-3 flex space-x-2">
                      <button onclick="toggleStatus('${w.worker_id}', '${w.status}')" class="text-xs bg-gray-200 px-2 py-1 rounded hover:bg-gray-300">${w.status === 'Active' ? 'Deactivate' : 'Activate'}</button>
                      <button onclick="deleteWorker('${w.worker_id}')" class="text-xs bg-red-100 text-red-700 px-2 py-1 rounded hover:bg-red-200">Delete</button>
                    </td>
                  </tr>
                `).join('')}
              </table>
            </div>
          </div>

          <!-- Register Modal -->
          <div id="registerModal" class="fixed inset-0 bg-black bg-opacity-50 hidden flex items-center justify-center p-4">
            <div class="bg-white p-6 rounded-lg max-w-lg w-full">
              <h2 class="text-xl font-bold mb-4">Register New Worker</h2>
              <form method="POST" action="/admin/workers/register">
                <div class="mb-3">
                  <label class="block text-sm font-bold text-gray-700 mb-1">Full Name</label>
                  <input type="text" name="full_name" required class="w-full border rounded p-2">
                </div>
                <div class="mb-3">
                  <label class="block text-sm font-bold text-gray-700 mb-1">Position</label>
                  <input type="text" name="position" required class="w-full border rounded p-2">
                </div>
                <div class="mb-3">
                  <label class="block text-sm font-bold text-gray-700 mb-1">Contact Number</label>
                  <input type="text" name="contact_number" class="w-full border rounded p-2">
                </div>
                <div class="mb-3">
                  <label class="block text-sm font-bold text-gray-700 mb-1">Daily Rate ($)</label>
                  <input type="number" step="any" name="daily_rate" required class="w-full border rounded p-2" value="100.00">
                </div>
                <div class="mb-3">
                  <label class="block text-sm font-bold text-gray-700 mb-1">Assigned Project</label>
                  <input type="text" name="assigned_project" class="w-full border rounded p-2">
                </div>
                <div class="mb-3">
                  <label class="block text-sm font-bold text-gray-700 mb-1">Profile Picture URL</label>
                  <input type="text" name="profile_picture" class="w-full border rounded p-2" placeholder="https://...">
                </div>
                <div class="flex justify-end space-x-2 mt-4">
                  <button type="button" onclick="closeRegisterModal()" class="bg-gray-300 px-4 py-2 rounded">Cancel</button>
                  <button type="submit" class="bg-blue-600 text-white px-4 py-2 rounded">Save Worker</button>
                </div>
              </form>
            </div>
          </div>

          <!-- QR Modal -->
          <div id="qrModal" class="fixed inset-0 bg-black bg-opacity-50 hidden flex items-center justify-center p-4">
            <div class="bg-white p-6 rounded-lg max-w-sm w-full text-center">
              <h3 id="qrWorkerName" class="text-xl font-bold mb-1"></h3>
              <p id="qrWorkerIdText" class="text-sm text-gray-500 mb-4"></p>
              <div class="flex justify-center mb-4"><canvas id="adminQRCanvas"></canvas></div>
              <div class="flex justify-center space-x-2">
                <button onclick="printQR()" class="bg-purple-600 text-white px-4 py-2 rounded text-sm"><i class="fa-solid fa-print"></i> Print</button>
                <button onclick="closeQRModal()" class="bg-gray-300 px-4 py-2 rounded text-sm">Close</button>
              </div>
            </div>
          </div>

          <script>
            function openRegisterModal() { document.getElementById('registerModal').classList.remove('hidden'); }
            function closeRegisterModal() { document.getElementById('registerModal').classList.add('hidden'); }
            function viewQR(id, name) {
              document.getElementById('qrWorkerName').innerText = name;
              document.getElementById('qrWorkerIdText').innerText = id;
              document.getElementById('qrModal').classList.remove('hidden');
              QRCode.toCanvas(document.getElementById('adminQRCanvas'), id, { width: 200 });
            }
            function closeQRModal() { document.getElementById('qrModal').classList.add('hidden'); }
            function printQR() { window.print(); }
            async function toggleStatus(id, current) {
              await fetch('/api/workers/status', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ worker_id: id, status: current === 'Active' ? 'Inactive' : 'Active' }) });
              location.reload();
            }
            async function deleteWorker(id) {
              if(confirm('Are you sure you want to delete this worker?')) {
                await fetch('/api/workers/delete', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ worker_id: id }) });
                location.reload();
              }
            }
          </script>
        ` : ''}

        <!-- ATTENDANCE TAB -->
        ${tab === 'attendance' ? `
          <h1 class="text-2xl font-bold text-gray-800 mb-6">Attendance History & Daily Logs</h1>
          <div class="bg-white rounded-lg shadow-md p-6">
            <div class="overflow-x-auto">
              <table class="w-full text-left text-sm">
                <tr class="bg-gray-50 border-b"><th class="p-3">Worker ID</th><th class="p-3">Date</th><th class="p-3">Time</th><th class="p-3">Type</th></tr>
                ${(await pool.query('SELECT * FROM attendance_logs ORDER BY attendance_date DESC, attendance_time DESC LIMIT 100')).rows.map(a => `
                  <tr class="border-b"><td class="p-3 font-semibold">${a.worker_id}</td><td class="p-3">${a.attendance_date.toISOString().split('T')[0]}</td><td class="p-3">${a.attendance_time}</td><td class="p-3"><span class="px-2 py-0.5 rounded text-xs ${a.attendance_type === 'IN' ? 'bg-blue-100 text-blue-800' : 'bg-orange-100 text-orange-800'}">${a.attendance_type}</span></td></tr>
                `).join('')}
              </table>
            </div>
          </div>
        ` : ''}

        <!-- STOCK INVENTORY TAB -->
        ${tab === 'stock' ? `
          <div class="flex justify-between items-center mb-6">
            <h1 class="text-2xl font-bold text-gray-800">Stock Inventory Management</h1>
            <button onclick="openMaterialModal()" class="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 font-semibold"><i class="fa-solid fa-plus"></i> Add Material</button>
          </div>
          <div class="bg-white rounded-lg shadow-md p-6 mb-8">
            <h3 class="font-bold text-gray-800 mb-4">Material Inventory List</h3>
            <div class="overflow-x-auto">
              <table class="w-full text-left text-sm">
                <tr class="bg-gray-50 border-b"><th class="p-3">Material Name</th><th class="p-3">Category</th><th class="p-3">Unit</th><th class="p-3">Current Qty</th><th class="p-3">Min Level</th><th class="p-3">Status</th></tr>
                ${materials.map(m => `
                  <tr class="border-b">
                    <td class="p-3 font-semibold">${m.material_name}</td>
                    <td class="p-3">${m.category || '-'}</td>
                    <td class="p-3">${m.unit}</td>
                    <td class="p-3 font-bold">${m.current_quantity}</td>
                    <td class="p-3">${m.minimum_stock_level}</td>
                    <td class="p-3">${Number(m.current_quantity) <= Number(m.minimum_stock_level) ? '<span class="bg-red-100 text-red-800 text-xs px-2 py-0.5 rounded font-bold">LOW STOCK</span>' : '<span class="bg-green-100 text-green-800 text-xs px-2 py-0.5 rounded">OK</span>'}</td>
                  </tr>
                `).join('')}
              </table>
            </div>
          </div>

          <!-- Add Material Modal -->
          <div id="materialModal" class="fixed inset-0 bg-black bg-opacity-50 hidden flex items-center justify-center p-4">
            <div class="bg-white p-6 rounded-lg max-w-md w-full">
              <h2 class="text-xl font-bold mb-4">Add New Material</h2>
              <form method="POST" action="/admin/materials/add">
                <div class="mb-3"><label class="block text-sm font-bold mb-1">Material Name</label><input type="text" name="material_name" required class="w-full border rounded p-2"></div>
                <div class="mb-3"><label class="block text-sm font-bold mb-1">Category</label><input type="text" name="category" class="w-full border rounded p-2"></div>
                <div class="mb-3"><label class="block text-sm font-bold mb-1">Unit (e.g. bags, pcs)</label><input type="text" name="unit" required class="w-full border rounded p-2"></div>
                <div class="mb-3"><label class="block text-sm font-bold mb-1">Initial Quantity</label><input type="number" step="any" name="current_quantity" required value="0" class="w-full border rounded p-2"></div>
                <div class="mb-3"><label class="block text-sm font-bold mb-1">Minimum Stock Level</label><input type="number" step="any" name="minimum_stock_level" required value="5" class="w-full border rounded p-2"></div>
                <div class="flex justify-end space-x-2 mt-4">
                  <button type="button" onclick="closeMaterialModal()" class="bg-gray-300 px-4 py-2 rounded">Cancel</button>
                  <button type="submit" class="bg-blue-600 text-white px-4 py-2 rounded">Save Material</button>
                </div>
              </form>
            </div>
          </div>
          <script>
            function openMaterialModal() { document.getElementById('materialModal').classList.remove('hidden'); }
            function closeMaterialModal() { document.getElementById('materialModal').classList.add('hidden'); }
          </script>
        ` : ''}

        <!-- ADVANCE MONEY TAB -->
        ${tab === 'advance' ? `
          <div class="flex justify-between items-center mb-6">
            <h1 class="text-2xl font-bold text-gray-800">Advance Money Management</h1>
            <button onclick="openAdvanceModal()" class="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 font-semibold"><i class="fa-solid fa-plus"></i> Add Advance</button>
          </div>
          <div class="bg-white rounded-lg shadow-md p-6">
            <div class="overflow-x-auto">
              <table class="w-full text-left text-sm">
                <tr class="bg-gray-50 border-b"><th class="p-3">Worker</th><th class="p-3">Date</th><th class="p-3">Amount</th><th class="p-3">Notes</th></tr>
                ${advances.map(ad => `
                  <tr class="border-b"><td class="p-3 font-semibold">${ad.full_name} (${ad.worker_id})</td><td class="p-3">${ad.advance_date.toISOString().split('T')[0]}</td><td class="p-3 font-bold text-red-600">$${Number(ad.amount).toFixed(2)}</td><td class="p-3">${ad.notes || '-'}</td></tr>
                `).join('')}
              </table>
            </div>
          </div>

          <div id="advanceModal" class="fixed inset-0 bg-black bg-opacity-50 hidden flex items-center justify-center p-4">
            <div class="bg-white p-6 rounded-lg max-w-md w-full">
              <h2 class="text-xl font-bold mb-4">Add Advance Money</h2>
              <form method="POST" action="/admin/advance/add">
                <div class="mb-3">
                  <label class="block text-sm font-bold mb-1">Select Worker</label>
                  <select name="worker_id" required class="w-full border rounded p-2">
                    ${workers.map(w => `<option value="${w.worker_id}">${w.full_name} (${w.worker_id})</option>`).join('')}
                  </select>
                </div>
                <div class="mb-3"><label class="block text-sm font-bold mb-1">Amount ($)</label><input type="number" step="any" name="amount" required class="w-full border rounded p-2"></div>
                <div class="mb-3"><label class="block text-sm font-bold mb-1">Date</label><input type="date" name="advance_date" required value="${today}" class="w-full border rounded p-2"></div>
                <div class="mb-3"><label class="block text-sm font-bold mb-1">Notes</label><textarea name="notes" class="w-full border rounded p-2"></textarea></div>
                <div class="flex justify-end space-x-2 mt-4">
                  <button type="button" onclick="closeAdvanceModal()" class="bg-gray-300 px-4 py-2 rounded">Cancel</button>
                  <button type="submit" class="bg-blue-600 text-white px-4 py-2 rounded">Save Advance</button>
                </div>
              </form>
            </div>
          </div>
          <script>
            function openAdvanceModal() { document.getElementById('advanceModal').classList.remove('hidden'); }
            function closeAdvanceModal() { document.getElementById('advanceModal').classList.add('hidden'); }
          </script>
        ` : ''}

        <!-- SALARY TAB -->
        ${tab === 'salary' ? `
          <h1 class="text-2xl font-bold text-gray-800 mb-6">Salary & Payroll Calculation</h1>
          <div class="bg-white rounded-lg shadow-md p-6">
            <p class="text-sm text-gray-500 mb-4">Salary is automatically computed based on daily rates, completed attendance days, and advance money deductions.</p>
            <div class="overflow-x-auto">
              <table class="w-full text-left text-sm">
                <tr class="bg-gray-50 border-b">
                  <th class="p-3">Worker</th>
                  <th class="p-3">Daily Rate</th>
                  <th class="p-3">Total Logs</th>
                  <th class="p-3">Total Advance</th>
                  <th class="p-3">Estimated Salary</th>
                </tr>
                ${workers.map(w => {
                  const wAtt = (todayAtt || []).filter(a => a.worker_id === w.worker_id);
                  const wAdv = advances.filter(ad => ad.worker_id === w.worker_id).reduce((sum, ad) => sum + Number(ad.amount), 0);
                  const estDays = wAtt.length >= 2 ? 1 : (wAtt.length === 1 ? 0.5 : 0);
                  const totalSal = estDays * Number(w.daily_rate);
                  const netSal = totalSal - wAdv;
                  return `
                    <tr class="border-b">
                      <td class="p-3 font-semibold">${w.full_name} (${w.worker_id})</td>
                      <td class="p-3">$${Number(w.daily_rate).toFixed(2)}</td>
                      <td class="p-3">${wAtt.length} records today</td>
                      <td class="p-3 text-red-600 font-bold">$${wAdv.toFixed(2)}</td>
                      <td class="p-3 font-extrabold text-green-600">$${netSal.toFixed(2)}</td>
                    </tr>
                  `;
                }).join('')}
              </table>
            </div>
          </div>
        ` : ''}

        <!-- ANNOUNCEMENTS TAB -->
        ${tab === 'announcements' ? `
          <div class="flex justify-between items-center mb-6">
            <h1 class="text-2xl font-bold text-gray-800">Company Announcements</h1>
            <button onclick="openAnnModal()" class="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 font-semibold"><i class="fa-solid fa-bullhorn"></i> New Announcement</button>
          </div>
          <div class="space-y-4">
            ${announcements.map(an => `
              <div class="bg-white p-6 rounded-lg shadow-md flex justify-between items-start">
                <div>
                  <h3 class="font-bold text-lg text-gray-800">${an.title}</h3>
                  <p class="text-gray-600 mt-1">${an.content}</p>
                  <span class="text-xs text-gray-400 mt-2 block">${new Date(an.created_at).toLocaleString()}</span>
                </div>
                <button onclick="deleteAnn(${an.id})" class="text-red-500 hover:text-red-700"><i class="fa-solid fa-trash"></i></button>
              </div>
            `).join('')}
          </div>

          <div id="annModal" class="fixed inset-0 bg-black bg-opacity-50 hidden flex items-center justify-center p-4">
            <div class="bg-white p-6 rounded-lg max-w-md w-full">
              <h2 class="text-xl font-bold mb-4">Create Announcement</h2>
              <form method="POST" action="/admin/announcements/add">
                <div class="mb-3"><label class="block text-sm font-bold mb-1">Title</label><input type="text" name="title" required class="w-full border rounded p-2"></div>
                <div class="mb-3"><label class="block text-sm font-bold mb-1">Content</label><textarea name="content" required rows="4" class="w-full border rounded p-2"></textarea></div>
                <div class="flex justify-end space-x-2 mt-4">
                  <button type="button" onclick="closeAnnModal()" class="bg-gray-300 px-4 py-2 rounded">Cancel</button>
                  <button type="submit" class="bg-blue-600 text-white px-4 py-2 rounded">Post Announcement</button>
                </div>
              </form>
            </div>
          </div>
          <script>
            function openAnnModal() { document.getElementById('annModal').classList.remove('hidden'); }
            function closeAnnModal() { document.getElementById('annModal').classList.add('hidden'); }
            async function deleteAnn(id) {
              if(confirm('Delete announcement?')) {
                await fetch('/api/announcements/delete', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ id }) });
                location.reload();
              }
            }
          </script>
        ` : ''}

        <!-- COMPANY SETTINGS TAB -->
        ${tab === 'settings' ? `
          <h1 class="text-2xl font-bold text-gray-800 mb-6">Company Settings</h1>
          <div class="bg-white rounded-lg shadow-md p-6 max-w-xl">
            <form method="POST" action="/admin/settings/update">
              <div class="mb-4"><label class="block text-sm font-bold mb-1">Company Name</label><input type="text" name="company_name" value="${settings.company_name || ''}" required class="w-full border rounded p-2"></div>
              <div class="mb-4"><label class="block text-sm font-bold mb-1">Company Logo URL</label><input type="text" name="company_logo" value="${settings.company_logo || ''}" class="w-full border rounded p-2"></div>
              <div class="mb-4"><label class="block text-sm font-bold mb-1">Company Address</label><input type="text" name="company_address" value="${settings.company_address || ''}" class="w-full border rounded p-2"></div>
              <div class="mb-4"><label class="block text-sm font-bold mb-1">Contact Number</label><input type="text" name="contact_number" value="${settings.contact_number || ''}" class="w-full border rounded p-2"></div>
              <button type="submit" class="bg-blue-600 text-white px-6 py-2 rounded hover:bg-blue-700 font-semibold">Save Settings</button>
            </form>
          </div>
        ` : ''}

        <!-- WORK SCHEDULE TAB -->
        ${tab === 'schedule' ? `
          <h1 class="text-2xl font-bold text-gray-800 mb-6">Work Schedule Configuration</h1>
          <div class="bg-white rounded-lg shadow-md p-6 max-w-xl">
            <form method="POST" action="/admin/schedule/update">
              <div class="grid grid-cols-2 gap-4 mb-4">
                <div><label class="block text-sm font-bold mb-1">Morning Start</label><input type="text" name="morning_start" value="${schedule.morning_start}" class="w-full border rounded p-2"></div>
                <div><label class="block text-sm font-bold mb-1">Morning End</label><input type="text" name="morning_end" value="${schedule.morning_end}" class="w-full border rounded p-2"></div>
              </div>
              <div class="grid grid-cols-2 gap-4 mb-4">
                <div><label class="block text-sm font-bold mb-1">Afternoon Start</label><input type="text" name="afternoon_start" value="${schedule.afternoon_start}" class="w-full border rounded p-2"></div>
                <div><label class="block text-sm font-bold mb-1">Afternoon End</label><input type="text" name="afternoon_end" value="${schedule.afternoon_end}" class="w-full border rounded p-2"></div>
              </div>
              <button type="submit" class="bg-blue-600 text-white px-6 py-2 rounded hover:bg-blue-700 font-semibold">Update Schedule</button>
            </form>
          </div>
        ` : ''}

      </div>
    </div>
  `;
  res.send(layout('Admin Portal', html));
});

// Admin Post Handlers
app.post('/admin/workers/register', async (req, res) => {
  const { full_name, position, contact_number, daily_rate, assigned_project, profile_picture } = req.body;
  const client = await pool.connect();
  try {
    const countRes = await client.query('SELECT COUNT(*) FROM workers');
    const nextIdNum = parseInt(countRes.rows[0].count) + 1;
    const worker_id = `W-${String(nextIdNum).padStart(4, '0')}`;

    await client.query(
      'INSERT INTO workers (worker_id, full_name, position, contact_number, daily_rate, assigned_project, profile_picture) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [worker_id, full_name, position, contact_number, daily_rate, assigned_project, profile_picture]
    );
    res.redirect('/admin?tab=workers');
  } finally {
    client.release();
  }
});

app.post('/api/workers/status', async (req, res) => {
  const { worker_id, status } = req.body;
  await pool.query('UPDATE workers SET status = $1 WHERE worker_id = $2', [status, worker_id]);
  res.json({ success: true });
});

app.post('/api/workers/delete', async (req, res) => {
  const { worker_id } = req.body;
  await pool.query('DELETE FROM workers WHERE worker_id = $1', [worker_id]);
  res.json({ success: true });
});

app.post('/admin/materials/add', async (req, res) => {
  const { material_name, category, unit, current_quantity, minimum_stock_level } = req.body;
  await pool.query(
    'INSERT INTO materials (material_name, category, unit, current_quantity, minimum_stock_level) VALUES ($1, $2, $3, $4, $5)',
    [material_name, category, unit, current_quantity, minimum_stock_level]
  );
  res.redirect('/admin?tab=stock');
});

app.post('/admin/advance/add', async (req, res) => {
  const { worker_id, amount, advance_date, notes } = req.body;
  await pool.query('INSERT INTO advance_money (worker_id, amount, advance_date, notes) VALUES ($1, $2, $3, $4)', [worker_id, amount, advance_date, notes]);
  res.redirect('/admin?tab=advance');
});

app.post('/admin/announcements/add', async (req, res) => {
  const { title, content } = req.body;
  await pool.query('INSERT INTO announcements (title, content) VALUES ($1, $2)', [title, content]);
  res.redirect('/admin?tab=announcements');
});

app.post('/api/announcements/delete', async (req, res) => {
  const { id } = req.body;
  await pool.query('DELETE FROM announcements WHERE id = $1', [id]);
  res.json({ success: true });
});

app.post('/admin/settings/update', async (req, res) => {
  const { company_name, company_logo, company_address, contact_number } = req.body;
  await pool.query(
    'UPDATE company_settings SET company_name = $1, company_logo = $2, company_address = $3, contact_number = $4 WHERE id = 1',
    [company_name, company_logo, company_address, contact_number]
  );
  res.redirect('/admin?tab=settings');
});

app.post('/admin/schedule/update', async (req, res) => {
  const { morning_start, morning_end, afternoon_start, afternoon_end } = req.body;
  await pool.query(
    'UPDATE work_schedules SET morning_start = $1, morning_end = $2, afternoon_start = $3, afternoon_end = $4 WHERE id = 1',
    [morning_start, morning_end, afternoon_start, afternoon_end]
  );
  res.redirect('/admin?tab=schedule');
});

app.listen(PORT, () => {
  console.log(`Construction Worker & Inventory System running on port ${PORT}`);
});
