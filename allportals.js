const express = require('express');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 10000;

// Middleware para sa pagbasa ng form data at JSON
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// PostgreSQL Connection Pool gamit ang Render environment variable o local database
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// Helper function para sa Company Settings (Naayos na ang ReferenceError)
async function getCompanySettings() {
  try {
    const result = await pool.query('SELECT * FROM company_settings LIMIT 1');
    if (result.rows.length > 0) {
      return result.rows[0];
    }
    // Default values kung wala pang laman ang table
    return { company_name: 'Apex Builder Construction' };
  } catch (err) {
    console.error('Error fetching company settings:', err);
    return { company_name: 'Apex Builder Construction' };
  }
}

// Database Initialization (Naayos ang syntax error sa dulo ng columns)
async function initDB() {
  const client = await pool.connect();
  try {
    // Optional: I-drop muna ang attendance_logs para masigurong malinis ang structure
    // await client.query(`DROP TABLE IF EXISTS attendance_logs CASCADE;`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS company_settings (
        id SERIAL PRIMARY KEY,
        company_name VARCHAR(255) DEFAULT 'Apex Builder Construction',
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS workers (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        role VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS attendance_logs (
        id SERIAL PRIMARY KEY,
        worker_id INT,
        attendance_date DATE,
        attendance_type VARCHAR(50)
      );
    `);
    console.log('Database initialized successfully.');
  } catch (err) {
    console.error('Error initializing database:', err);
  } finally {
    client.release();
  }
}

// Sample route na gumagamit ng getCompanySettings (Line 223 fix)
app.get('/', async (req, res) => {
  try {
    const settings = await getCompanySettings();
    res.send(`<h1>Welcome to ${settings.company_name} Portal</h1><p>System is running smoothly!</p>`);
  } catch (err) {
    res.status(500).send('Server Error: ' + err.message);
  }
});

// Simulan ang Server at Database
app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  await initDB();
});
