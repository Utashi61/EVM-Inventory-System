// Middleware: Ensure user is authenticated
function isAuthenticated(req, res, next) {
  if (req.session && req.session.user) return next();
  req.flash('error', 'Please login to continue.');
  return res.redirect('/login');
}

// Admin only
function isAdmin(req, res, next) {
  if (req.session.user && req.session.user.role === 'Admin') return next();
  req.flash('error', 'Access denied. Admin privileges required.');
  return res.redirect('/login');
}

// DzEO, DzERO, EA — all go to DzEO dashboard
function isDzEO(req, res, next) {
  const r = req.session.user && req.session.user.role;
  if (['DzEO', 'DzERO', 'EA'].includes(r)) return next();
  req.flash('error', 'Access denied.');
  return res.redirect('/login');
}

// RO only
function isRO(req, res, next) {
  const r = req.session.user && req.session.user.role;
  if (r === 'RO') return next();
  req.flash('error', 'Access denied.');
  return res.redirect('/login');
}

// Presiding Officer only
function isPO(req, res, next) {
  const r = req.session.user && req.session.user.role;
  if (r === 'Presiding Officer') return next();
  req.flash('error', 'Access denied.');
  return res.redirect('/login');
}

function isAdminOrDzEO(req, res, next) {
  const r = req.session.user && req.session.user.role;
  if (['Admin', 'DzEO', 'DzERO', 'EA'].includes(r)) return next();
  req.flash('error', 'Access denied.');
  return res.redirect('/login');
}

// Set locals for all views
function setUserLocals(req, res, next) {
  res.locals.currentUser = req.session.user || null;
  res.locals.flashMessages = {
    success: req.flash('success'),
    error: req.flash('error'),
    info: req.flash('info')
  };
  next();
}

module.exports = { isAuthenticated, isAdmin, isDzEO, isRO, isPO, isAdminOrDzEO, setUserLocals };
