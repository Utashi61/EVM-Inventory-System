const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const express = require('express');
const session = require('express-session');
const flash = require('connect-flash');
const methodOverride = require('method-override');
const { setUserLocals } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── VIEW ENGINE ─────────────────────────────────────────────
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../frontend/views'));

// ─── MIDDLEWARE ──────────────────────────────────────────────
app.use(express.static(path.join(__dirname, '../frontend/public')));
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Ensure upload directories exist on startup
const uploadDirs = ['../uploads', '../uploads/forms'];
uploadDirs.forEach(dir => {
  const fullPath = path.join(__dirname, dir);
  if (!require('fs').existsSync(fullPath)) {
    require('fs').mkdirSync(fullPath, { recursive: true });
    console.log('[startup] Created directory:', fullPath);
  }
});
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(methodOverride('_method'));

app.use(session({
  secret: process.env.SESSION_SECRET || 'evm-secret-2024',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: parseInt(process.env.SESSION_MAX_AGE) || 3600000,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production'
  }
}));

app.use(flash());
app.use(setUserLocals);

// ─── ROUTES ──────────────────────────────────────────────────
const routes = require('./routes/index');
app.use('/', routes);

// ─── 404 / ERROR ─────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).render('error', { title: '404 Not Found', message: 'Page not found.', code: 404 });
});
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).render('error', { title: 'Server Error', message: 'Something went wrong.', code: 500 });
});

app.listen(PORT, () => {
  console.log(`\n  EVM Inventory System`);
  console.log(`🚀 Server running at: http://localhost:${PORT}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}\n`);
});

module.exports = app;