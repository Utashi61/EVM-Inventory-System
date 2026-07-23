const bcrypt = require('bcryptjs');
const db = require('../config/database');

exports.getLogin = (req, res) => {
  if (req.session.user) {
    const role = req.session.user.role;
    if (role === 'Admin') return res.redirect('/admin/dashboard');
    if (['DzEO','DzERO','EA'].includes(role)) return res.redirect('/dzeo/dashboard');
    if (role === 'RO') return res.redirect('/ro/dashboard');
    if (role === 'Presiding Officer') return res.redirect('/po/dashboard');
  }
  res.render('login', { title: 'Login - EVM Inventory System' });
};

exports.postLogin = async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    req.flash('error', 'Username and password are required.');
    return res.redirect('/login');
  }
  try {
    const [rows] = await db.query(
      `SELECT u.*, d.name AS dzongkhag_name, c.name AS constituency_name, g.name AS gewog_name,
              ps.name AS polling_station_name
       FROM users u
       LEFT JOIN dzongkhags d ON u.dzongkhag_id = d.id
       LEFT JOIN constituencies c ON u.constituency_id = c.id
       LEFT JOIN gewogs g ON u.gewog_id = g.id
       LEFT JOIN polling_stations ps ON u.polling_station_id = ps.id
       WHERE u.username = ? AND u.is_active = 1`,
      [username]
    );
    if (!rows.length) {
      req.flash('error', 'Invalid username or password.');
      return res.redirect('/login');
    }
    const user = rows[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      req.flash('error', 'Invalid username or password.');
      return res.redirect('/login');
    }
    req.session.user = {
      id: user.id,
      full_name: user.full_name,
      username: user.username,
      role: user.role,
      email: user.email,
      dzongkhag_id: user.dzongkhag_id,
      dzongkhag_name: user.dzongkhag_name,
      constituency_id: user.constituency_id,
      constituency_name: user.constituency_name,
      gewog_id: user.gewog_id,
      gewog_name: user.gewog_name,
      polling_station_id: user.polling_station_id,
      polling_station_name: user.polling_station_name
    };
    await db.query(
      'INSERT INTO audit_logs (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
      [user.id, 'LOGIN', `User ${user.username} (${user.role}) logged in`, req.ip]
    );
    // Role-based redirect
    if (user.role === 'Admin') return res.redirect('/admin/dashboard');
    if (['DzEO','DzERO','EA'].includes(user.role)) return res.redirect('/dzeo/dashboard');
    if (user.role === 'RO') return res.redirect('/ro/dashboard');
    // Presiding Officer role is deprecated — redirect to RO dashboard as fallback
    if (user.role === 'Presiding Officer') return res.redirect('/ro/dashboard');
    return res.redirect('/login');
  } catch (err) {
    console.error('Login error:', err);
    req.flash('error', 'Server error. Please try again.');
    return res.redirect('/login');
  }
};

exports.logout = async (req, res) => {
  if (req.session.user) {
    await db.query(
      'INSERT INTO audit_logs (user_id, action, ip_address) VALUES (?, ?, ?)',
      [req.session.user.id, 'LOGOUT', req.ip]
    ).catch(() => {});
  }
  req.session.destroy(() => res.redirect('/login'));
};

// ─── CHANGE PASSWORD (all roles — self-service) ────────────────
exports.getChangePassword = (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  res.render('change-password', { title: 'Change Password' });
};

exports.postChangePassword = async (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  const { current_password, new_password, confirm_password } = req.body;
  const userId = req.session.user.id;
  try {
    if (!current_password || !new_password || !confirm_password) {
      req.flash('error', 'All fields are required.');
      return res.redirect('/change-password');
    }
    if (new_password.length < 6) {
      req.flash('error', 'New password must be at least 6 characters.');
      return res.redirect('/change-password');
    }
    if (new_password !== confirm_password) {
      req.flash('error', 'New password and confirmation do not match.');
      return res.redirect('/change-password');
    }
    const [[user]] = await db.query('SELECT password FROM users WHERE id = ?', [userId]);
    if (!user) return res.redirect('/login');

    const match = await bcrypt.compare(current_password, user.password);
    if (!match) {
      req.flash('error', 'Current password is incorrect.');
      return res.redirect('/change-password');
    }
    const hashed = await bcrypt.hash(new_password, 10);
    await db.query('UPDATE users SET password = ? WHERE id = ?', [hashed, userId]);
    await db.query(
      'INSERT INTO audit_logs (user_id, action, details) VALUES (?, ?, ?)',
      [userId, 'CHANGE_PASSWORD', `User #${userId} changed their own password`]
    );
    req.flash('success', 'Password changed successfully.');
    // Redirect back to their own dashboard
    const role = req.session.user.role;
    if (role === 'Admin') return res.redirect('/admin/dashboard');
    if (['DzEO','DzERO','EA'].includes(role)) return res.redirect('/dzeo/dashboard');
    return res.redirect('/ro/dashboard');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to change password. Please try again.');
    res.redirect('/change-password');
  }
};
