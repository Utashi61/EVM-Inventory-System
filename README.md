# 🗳️ EVM Management System — Bhutan

A comprehensive **Electronic Voting Machine (EVM) Management System** for the Election Commission of Bhutan. Built with **Node.js**, **Express**, **EJS**, and **MySQL**.

---

## 📋 Features

| Role | Capabilities |
|------|-------------|
| **Admin** | Full system access: manage all 21 Dzongkhags, equipment CRUD, user management (DzEO/RO), transfers, all reports |
| **DzEO** | Dzongkhag-scoped: add/edit equipment, transfer to RO, view transfers, generate reports |
| **RO** | Constituency-scoped: view assigned equipment, return equipment to DzEO, generate reports |

### Core Features
- 🔐 Role-based access control (Admin / DzEO / RO)
- 📦 Equipment tracking (Ballot Unit, Control Unit, Battery)
- 🔄 Transfer management with full audit trail
- 📊 Dynamic dashboards with live statistics
- 🏔️ All 20 Dzongkhags + Thimphu HQ supported
- 🔍 Search, filter, sort, and pagination on all lists
- 📄 PDF and Excel report export
- 🔒 Session-based authentication with timeout
- 📝 Audit logging for all user actions

---

## 🚀 Quick Setup

### Prerequisites
- Node.js v16+ 
- MySQL 8.0+ (via MySQL Workbench or CLI)

### Step 1 — Database Setup

Open **MySQL Workbench**, connect to your server, and run the schema file:

```
File → Open SQL Script → select: database/schema.sql → Execute (⚡)
```

This creates the `evm_management` database with all tables, views, and seed data.

### Step 2 — Environment Configuration

```bash
cp .env.example .env
```

Edit `.env` with your MySQL credentials:

```env
PORT=3000
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_password_here
DB_NAME=evm_management
SESSION_SECRET=change_this_to_a_long_random_string
```

### Step 3 — Install Dependencies

```bash
npm install
```

### Step 4 — Set Admin Password

```bash
node backend/scripts/setup.js
```

This outputs an SQL `UPDATE` statement. **Run that statement in MySQL Workbench** to set the admin password.

### Step 5 — Start the Server

```bash
# Production
npm start

# Development (auto-restart on changes)
npm run dev
```

### Step 6 — Open in Browser

```
http://localhost:3000
```

**Default Admin Login:**
- Username: `admin`
- Password: `Admin@123`

---

## 📁 Project Structure

```
evm-system/
├── backend/
│   ├── app.js                     # Express entry point
│   ├── config/
│   │   └── database.js            # MySQL connection pool
│   ├── controllers/
│   │   ├── authController.js      # Login / Logout
│   │   ├── adminController.js     # Admin all actions
│   │   ├── dzeoController.js      # DzEO actions
│   │   ├── roController.js        # RO actions
│   │   └── reportController.js    # PDF & Excel exports
│   ├── middleware/
│   │   └── auth.js                # isAuthenticated, isAdmin, isDzEO, isRO
│   ├── routes/
│   │   └── index.js               # All routes
│   └── scripts/
│       └── setup.js               # Password hash helper
├── database/
│   └── schema.sql                 # Full MySQL schema + seed data
├── frontend/
│   ├── public/
│   │   ├── css/style.css          # Main stylesheet
│   │   └── js/main.js             # Client-side JS
│   └── views/
│       ├── login.ejs
│       ├── error.ejs
│       ├── partials/
│       │   ├── head.ejs
│       │   ├── flash.ejs
│       │   ├── admin-sidebar.ejs
│       │   ├── dzeo-sidebar.ejs
│       │   └── ro-sidebar.ejs
│       ├── admin/
│       │   ├── dashboard.ejs
│       │   ├── equipment.ejs
│       │   ├── equipment-form.ejs
│       │   ├── dzongkhag-detail.ejs
│       │   ├── transfers.ejs
│       │   ├── users.ejs
│       │   └── reports.ejs
│       ├── dzeo/
│       │   ├── dashboard.ejs
│       │   ├── equipment.ejs
│       │   ├── equipment-form.ejs
│       │   ├── transfers.ejs
│       │   └── reports.ejs
│       └── ro/
│           ├── dashboard.ejs
│           ├── equipment.ejs
│           ├── return.ejs
│           └── reports.ejs
├── .env.example
├── package.json
└── README.md
```

---

## 🔑 API Endpoints (Dynamic Dropdowns)

| Endpoint | Description |
|----------|-------------|
| `GET /api/constituencies/:dzongkhag_id` | Get constituencies for a Dzongkhag |
| `GET /api/gewogs/:dzongkhag_id` | Get gewogs for a Dzongkhag |
| `GET /api/ro/:constituency_id` | Get RO assigned to a constituency |

---

## 🏔️ Dzongkhags Supported

Bumthang, Chhukha, Dagana, Gasa, Haa, Lhuentse, Mongar, Paro, Pemagatshel, Punakha, Samdrup Jongkhar, Samtse, Sarpang, Thimphu, Trashigang, Trashiyangtse, Trongsa, Tsirang, Wangdue Phodrang, Zhemgang, **Thimphu HQ**

---

## 📊 Reports Available

| Report | Admin | DzEO | RO |
|--------|-------|------|----|
| Equipment Inventory | ✅ All | ✅ Own Dzongkhag | ✅ Own Constituency |
| Functional Equipment | ✅ | ✅ | ❌ |
| Non-Functional Equipment | ✅ | ✅ | ❌ |
| Transfer Report | ✅ | ✅ | ❌ |
| Return History | ❌ | ❌ | ✅ |

All reports export to **PDF** and **Excel (.xlsx)**.

---

## 🔒 Security Features

- Passwords hashed with **bcrypt** (10 salt rounds)
- Session-based authentication (1-hour timeout)
- Role-based route protection middleware
- Dzongkhag/Constituency access enforcement
- All actions logged to `audit_logs` table
- SQL injection protection via parameterized queries

---

## ⚠️ Troubleshooting

| Issue | Solution |
|-------|----------|
| Cannot connect to MySQL | Check `.env` DB credentials; ensure MySQL service is running |
| `ER_ACCESS_DENIED_ERROR` | Verify `DB_USER` and `DB_PASSWORD` in `.env` |
| Login fails with correct password | Re-run `node backend/scripts/setup.js` and apply the SQL |
| Port 3000 in use | Change `PORT` in `.env` to 3001 or another free port |
| PDF not generating | Ensure `pdfkit` installed: `npm install pdfkit` |
| Excel not generating | Ensure `exceljs` installed: `npm install exceljs` |

---

## 📞 Support

For issues, contact the Election Commission of Bhutan IT Department.
