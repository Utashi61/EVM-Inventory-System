/**
 * EVM Management System - Setup Script
 * Run: node backend/scripts/setup.js
 *
 * This script:
 * 1. Generates a bcrypt hash for the default admin password
 * 2. Outputs the SQL UPDATE statement to run in MySQL Workbench
 */

const bcrypt = require('bcryptjs');

async function setup() {
  console.log('\n  EVM Management System — Setup Helper\n');
  console.log('=' .repeat(50));

  // Default credentials
  const adminPassword = 'Admin@123';
  const hash = await bcrypt.hash(adminPassword, 10);

  console.log('\n✅ Default Admin Credentials:');
  console.log('   Username : admin');
  console.log('   Password : Admin@123\n');

  console.log('📋 Run this SQL in MySQL Workbench to set the admin password:\n');
  console.log(`UPDATE users SET password = '${hash}' WHERE username = 'admin';\n`);

  console.log('=' .repeat(50));
  console.log('\n📌 Steps to get started:\n');
  console.log('1. Create database:  Run database/schema.sql in MySQL Workbench');
  console.log('2. Set admin pass:   Run the UPDATE SQL above in MySQL Workbench');
  console.log('3. Copy .env.example to .env and update DB credentials');
  console.log('4. Install packages: npm install');
  console.log('5. Start server:     npm start  (or npm run dev)\n');
  console.log('🌐 Open http://localhost:3000 in your browser\n');

  // Also generate sample DzEO and RO passwords
  const officerPassword = 'Officer@123';
  const officerHash = await bcrypt.hash(officerPassword, 10);

  console.log('💡 If you want to create DzEO/RO users via SQL (alternative to web UI):\n');
  console.log(`-- Example DzEO for Chhukha (dzongkhag_id = 2):`);
  console.log(`INSERT INTO users (full_name, username, password, role, dzongkhag_id)`);
  console.log(`VALUES ('Tshering Dorji', 'dzeo_chhukha', '${officerHash}', 'DzEO', 2);\n`);

  console.log(`-- Example RO for Phuntsholing constituency:`);
  console.log(`-- First find constituency_id: SELECT id FROM constituencies WHERE name LIKE '%Phuntsholing%';`);
  console.log(`INSERT INTO users (full_name, username, password, role, dzongkhag_id, constituency_id)`);
  console.log(`VALUES ('Karma Wangchuk', 'ro_phuntsholing', '${officerHash}', 'RO', 2, <constituency_id>);\n`);
  console.log('   (Password for both: Officer@123)\n');
}

setup().catch(console.error);