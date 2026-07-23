const db = require('../config/database');
const bcrypt = require('bcryptjs');
const { sendCredentialsEmail } = require('../utils/mailer');

// ─── DASHBOARD ──────────────────────────────────────────────
exports.getDashboard = async (req, res) => {
  try {
    const currentUser = req.session.user || req.user;

    // Items already gone to ECIL — exclude from every live count
    const ECIL_EXCL = `AND e.id NOT IN (
        SELECT equipment_id FROM transfers WHERE transfer_type='ECIL' AND status='Returned')`;

    // --- ECIL count ---
    const [[{ ecil_count }]] = await db.query(
      `SELECT COUNT(DISTINCT equipment_id) AS ecil_count
       FROM transfers WHERE transfer_type='ECIL' AND status='Returned'`);

    // --- ECB live inventory (HQ + Dzongkhags + ROs, excl. ECIL) ---
    const [[{ ecb_total }]] = await db.query(
      `SELECT COUNT(*) AS ecb_total FROM equipment e WHERE 1=1 ${ECIL_EXCL}`);

    // --- HQ stats (Admin holder, excl. ECIL) ---
    const [[hqSummary]] = await db.query(`
      SELECT COUNT(*) AS total_equipment,
             SUM(e.status='Functional')     AS functional,
             SUM(e.status='Non-Functional') AS non_functional
      FROM equipment e
      WHERE e.current_holder_id IN (SELECT id FROM users WHERE role='Admin')
        ${ECIL_EXCL}`);

    // --- Activity counters ---
    const [[{ transferred_count }]] = await db.query(
      `SELECT COUNT(*) AS transferred_count FROM transfers
       WHERE transfer_type='Transfer' AND created_by=?`, [currentUser.id]);
    const [[{ received_count }]] = await db.query(
      `SELECT COUNT(*) AS received_count FROM transfers
       WHERE transfer_type='Surrender' AND to_user_id=? AND status='Returned'`, [currentUser.id]);
    const [[{ total_users }]] = await db.query(
      `SELECT COUNT(*) AS total_users FROM users WHERE role!='Admin'`);

    // --- Dzongkhag breakdown (each row excludes ECIL items) ---
    const [dzongkhagSummary] = await db.query(`
      SELECT d.id AS dzongkhag_id,
             d.name AS dzongkhag_name,
        SUM(CASE WHEN e.id IS NOT NULL AND e.id NOT IN (
          SELECT equipment_id FROM transfers WHERE transfer_type='ECIL' AND status='Returned'
        ) THEN 1 ELSE 0 END) AS total_equipment,
        SUM(CASE WHEN e.status='Functional' AND e.id NOT IN (
          SELECT equipment_id FROM transfers WHERE transfer_type='ECIL' AND status='Returned'
        ) THEN 1 ELSE 0 END) AS functional_count,
        SUM(CASE WHEN e.status='Non-Functional' AND e.id NOT IN (
          SELECT equipment_id FROM transfers WHERE transfer_type='ECIL' AND status='Returned'
        ) THEN 1 ELSE 0 END) AS non_functional_count
      FROM dzongkhags d
      LEFT JOIN equipment e ON e.dzongkhag_id=d.id
      GROUP BY d.id, d.name
      ORDER BY d.name`);

    // --- Pending surrenders from Dzongkhags ---
    const [pendingSurrenders] = await db.query(`
      SELECT t.id AS transfer_id, t.remarks, t.fault_type, t.created_at,
             e.serial_number, e.equipment_type,
             fu.full_name AS from_user, d.name AS dzongkhag_name
      FROM transfers t
      JOIN equipment e  ON t.equipment_id=e.id
      LEFT JOIN users fu     ON t.from_user_id=fu.id
      LEFT JOIN dzongkhags d ON e.dzongkhag_id=d.id
      WHERE t.transfer_type='Surrender' AND t.status='Returning'
      ORDER BY t.created_at DESC`);

    // --- Equipment ready to send to ECIL (Only explicitly surrendered or uploaded via Excel) ---
    const [readyForEcil] = await db.query(`
      SELECT e.id, e.serial_number, e.equipment_type, e.status,
             d.name AS dzongkhag_name,
             t_sur.fault_type,
             t_sur.remarks AS surrender_remarks,
             t_sur.updated_at AS received_at
      FROM equipment e
      LEFT JOIN dzongkhags d ON e.dzongkhag_id=d.id
      -- Change LEFT JOIN to INNER JOIN so an active surrender transfer record MUST exist
      INNER JOIN transfers t_sur ON t_sur.equipment_id = e.id 
        AND t_sur.transfer_type = 'Surrender' 
        AND t_sur.status = 'Returned'
      WHERE e.current_holder_id IN (SELECT id FROM users WHERE role='Admin')
        AND e.id NOT IN (
          SELECT equipment_id FROM transfers WHERE transfer_type='ECIL' AND status='Returned'
        )
      ORDER BY e.equipment_type, e.serial_number`);

    res.render('admin/dashboard', {
      title: 'Admin Dashboard',
      summary: {
        ...hqSummary,
        transferred_count,
        received_count,
        total_users,
        total_dzongkhags: 21,
        ecil_count: ecil_count || 0,
        ecb_total:  ecb_total  || 0
      },
      dzongkhagSummary,
      pendingSurrenders: pendingSurrenders || [],
      readyForEcil:      readyForEcil     || []
    });
  } catch (err) {
    console.error('[Dashboard]', err);
    res.status(500).render('error', { code: 500, title: 'Dashboard Error', message: err.message });
  }
};


// ─── DZONGKHAG DETAIL ────────────────────────────────────────

// ─── EQUIPMENT ──────────────────────────────────────────────
exports.getEquipment = async (req, res) => {
  try {
    const { search, page = 1 } = req.query;
    const limit = 20;
    const offset = (page - 1) * limit;
    let where = [`e.id NOT IN (SELECT equipment_id FROM transfers WHERE transfer_type='ECIL' AND status='Returned')`];
    const params = [];

    // Search by serial number only
    if (search && search.trim()) {
      where.push('e.serial_number LIKE ?');
      params.push(`%${search.trim()}%`);
    }

    const whereStr = where.join(' AND ');
    const [equipment] = await db.query(
      `SELECT e.*, d.name AS dzongkhag_name, c.name AS constituency_name, g.name AS gewog_name,
              COALESCE(u.full_name, 'Admin / Thimphu HQ') AS current_holder,
              cb.full_name AS created_by_name
       FROM equipment e
       LEFT JOIN dzongkhags d ON e.dzongkhag_id = d.id
       LEFT JOIN constituencies c ON e.constituency_id = c.id
       LEFT JOIN gewogs g ON e.gewog_id = g.id
       LEFT JOIN users u ON e.current_holder_id = u.id
       LEFT JOIN users cb ON e.created_by = cb.id
       WHERE ${whereStr} ORDER BY e.created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total FROM equipment e WHERE ${whereStr}`,
      params
    );
    const [dzongkhags] = await db.query('SELECT * FROM dzongkhags ORDER BY name');

    res.render('admin/equipment', {
      title: 'Equipment Management',
      equipment, dzongkhags,
      pagination: { page: +page, total, limit, pages: Math.ceil(total / limit) },
      query: req.query
    });
  } catch (err) {
    console.error(err);
    res.redirect('/admin/dashboard');
  }
};

exports.getAddEquipment = async (req, res) => {
  try {
    const [dzongkhags] = await db.query('SELECT * FROM dzongkhags ORDER BY name');
    res.render('admin/equipment-form', { title: 'Add Equipment', equipment: null, dzongkhags });
  } catch (err) {
    console.error(err);
    res.redirect('/admin/equipment');
  }
};

exports.postAddEquipment = async (req, res) => {
  const { equipment_type, serial_number, dzongkhag_id, status, assigned_to } = req.body;
  try {
    const currentUser = req.session.user || req.user;
    if (!equipment_type || !serial_number || !status) {
      req.flash('error', 'Equipment Type, Serial Number and Status are required.');
      return res.redirect('/admin/equipment/add');
    }
    const [exists] = await db.query('SELECT id FROM equipment WHERE serial_number = ?', [serial_number]);
    if (exists.length) { req.flash('error', 'Serial number already exists.'); return res.redirect('/admin/equipment/add'); }

    const isHQ = !dzongkhag_id || dzongkhag_id === 'hq' || dzongkhag_id === '';
    if (!dzongkhag_id) { req.flash('error', 'Please select a Location.'); return res.redirect('/admin/equipment/add'); }

    let holderId, finalDzongkhagId;

    if (isHQ) {
      holderId = currentUser.id;
      const [[hqRow]] = await db.query("SELECT id FROM dzongkhags WHERE name = 'Thimphu HQ' LIMIT 1");
      finalDzongkhagId = hqRow ? hqRow.id : null;
      if (!finalDzongkhagId) { req.flash('error', 'Thimphu HQ not found in database.'); return res.redirect('/admin/equipment/add'); }
    } else {
      finalDzongkhagId = dzongkhag_id;
      if (!assigned_to) {
        req.flash('error', 'Please select a DzEO / DzERO / EA officer. If none listed, create one first under User Management.');
        return res.redirect('/admin/equipment/add');
      }
      const [[officer]] = await db.query(
        "SELECT id FROM users WHERE id = ? AND dzongkhag_id = ? AND role IN ('DzEO','DzERO','EA') AND is_active = 1",
        [assigned_to, dzongkhag_id]
      );
      if (!officer) {
        req.flash('error', 'Selected officer not found or not active in this Dzongkhag.');
        return res.redirect('/admin/equipment/add');
      }
      holderId = officer.id;
    }

    const [result] = await db.query(
      'INSERT INTO equipment (equipment_type, serial_number, dzongkhag_id, constituency_id, gewog_id, status, current_holder_id, created_by) VALUES (?, ?, ?, NULL, NULL, ?, ?, ?)',
      [equipment_type, serial_number, finalDzongkhagId, status, holderId, currentUser.id]
    );
    await db.query('INSERT INTO audit_logs (user_id, action, table_affected, record_id) VALUES (?, ?, ?, ?)',
      [currentUser.id, 'ADD_EQUIPMENT', 'equipment', result.insertId]);
    req.flash('success', isHQ ? `${serial_number} added to Thimphu HQ.` : `${serial_number} added and assigned to officer.`);
    res.redirect('/admin/equipment');
  } catch (err) {
    console.error('[postAddEquipment]', err);
    req.flash('error', 'Failed to add equipment: ' + err.message);
    res.redirect('/admin/equipment/add');
  }
};


exports.getEditEquipment = async (req, res) => {
  try {
    const [[equipment]] = await db.query('SELECT e.* FROM equipment e WHERE e.id = ?', [req.params.id]);
    if (!equipment) {
      req.flash('error', 'Equipment not found.');
      return res.redirect('/admin/equipment');
    }
    const [dzongkhags] = await db.query('SELECT * FROM dzongkhags ORDER BY name');
    res.render('admin/equipment-form', { title: 'Edit Equipment', equipment, dzongkhags, officers: [] });
  } catch (err) { console.error(err); res.redirect('/admin/equipment'); }
};

exports.postEditEquipment = async (req, res) => {
  const { equipment_type, serial_number, dzongkhag_id, status, assigned_to } = req.body;
  const { id } = req.params;
  try {
    const currentUser = req.session.user || req.user;
    const [exists] = await db.query('SELECT id FROM equipment WHERE serial_number = ? AND id != ?', [serial_number, id]);
    if (exists.length) { req.flash('error', 'Serial number already exists.'); return res.redirect(`/admin/equipment/${id}/edit`); }

    // Get current equipment record to preserve holder if not changing
    const [[current]] = await db.query('SELECT current_holder_id, dzongkhag_id FROM equipment WHERE id = ?', [id]);

    let holderId = current ? current.current_holder_id : currentUser.id;
    let finalDzongkhagId = dzongkhag_id || (current ? current.dzongkhag_id : null);
    const isHQ = !dzongkhag_id || dzongkhag_id === 'hq' || dzongkhag_id === '';

    if (isHQ) {
      const [[hqRow]] = await db.query("SELECT id FROM dzongkhags WHERE name = 'Thimphu HQ' LIMIT 1");
      finalDzongkhagId = hqRow ? hqRow.id : current.dzongkhag_id;
      holderId = currentUser.id;
    } else if (assigned_to) {
      // Try to assign to selected officer
      const [[officer]] = await db.query(
        "SELECT id FROM users WHERE id = ? AND dzongkhag_id = ? AND role IN ('DzEO','DzERO','EA') AND is_active = 1",
        [assigned_to, dzongkhag_id]
      );
      if (officer) holderId = officer.id;
    }

    await db.query(
      'UPDATE equipment SET equipment_type=?, serial_number=?, dzongkhag_id=?, status=?, current_holder_id=? WHERE id=?',
      [equipment_type, serial_number, finalDzongkhagId, status, holderId, id]
    );
    await db.query('INSERT INTO audit_logs (user_id, action, table_affected, record_id) VALUES (?, ?, ?, ?)',
      [currentUser.id, 'EDIT_EQUIPMENT', 'equipment', id]);
    req.flash('success', 'Equipment updated successfully.');
    res.redirect('/admin/equipment');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to update equipment: ' + err.message);
    res.redirect(`/admin/equipment/${id}/edit`);
  }
};

exports.deleteEquipment = async (req, res) => {
  try {
    const currentUser = req.session.user || req.user;
    await db.query('DELETE FROM equipment WHERE id = ?', [req.params.id]);
    await db.query('INSERT INTO audit_logs (user_id, action, table_affected, record_id) VALUES (?, ?, ?, ?)',
      [currentUser.id, 'DELETE_EQUIPMENT', 'equipment', req.params.id]);
    req.flash('success', 'Equipment deleted.');
    res.redirect('/admin/equipment');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to delete equipment.');
    res.redirect('/admin/equipment');
  }
};

// ─── DZONGKHAG DETAIL ────────────────────────────────────────
exports.getDzongkhagDetail = async (req, res) => {
  const { id } = req.params;
  try {
    const [[dzong]] = await db.query('SELECT * FROM dzongkhags WHERE id = ?', [id]);
    if (!dzong) { req.flash('error', 'Dzongkhag not found.'); return res.redirect('/admin/dashboard'); }
    const [equipment] = await db.query(
      `SELECT e.*, c.name AS constituency_name, g.name AS gewog_name, u.full_name AS current_holder
       FROM equipment e
       LEFT JOIN constituencies c ON e.constituency_id = c.id
       LEFT JOIN gewogs g ON e.gewog_id = g.id
       LEFT JOIN users u ON e.current_holder_id = u.id
       WHERE e.dzongkhag_id = ?
         AND e.id NOT IN (SELECT equipment_id FROM transfers WHERE transfer_type = 'Surrender')
         AND e.id NOT IN (SELECT equipment_id FROM transfers WHERE transfer_type = 'ECIL' AND status = 'Returned')
       ORDER BY e.created_at DESC`, [id]
    );
    const [transfers] = await db.query(
      `SELECT t.*, e.serial_number, e.equipment_type, fu.full_name AS from_user, tu.full_name AS to_user
       FROM transfers t
       JOIN equipment e ON t.equipment_id = e.id
       LEFT JOIN users fu ON t.from_user_id = fu.id
       LEFT JOIN users tu ON t.to_user_id = tu.id
       WHERE e.dzongkhag_id = ? ORDER BY t.created_at DESC LIMIT 50`, [id]
    );
    res.render('admin/dzongkhag-detail', { title: dzong.name, dzong, equipment, transfers });
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to load Dzongkhag data.');
    res.redirect('/admin/dashboard');
  }
};

// ─── TRANSFERS ───────────────────────────────────────────────
// Admin moves equipment between Dzongkhag stores (Thimphu HQ counts as a
// Dzongkhag in the `dzongkhags` table). The receiving Dzongkhag's
// DzEO/DzERO/EA must confirm receipt before the equipment is counted in
// their inventory — see dzeoController.postReceiveTransfer.
exports.getTransfers = async (req, res) => {
  try {
    const currentUser = req.session.user || req.user;

    // Admin's Transfer History shows ONLY Admin's own activity:
    //  - 'Transfer' records Admin created (Thimphu HQ ⇄ Dzongkhag, Dzongkhag ⇄ Dzongkhag)
    //  - 'Surrender' records Admin received (Dzongkhag → Admin)
    // DzEO/DzERO/EA "Issue To" (RO) and RO/PO "Return" activity is
    // intentionally NOT shown here — that's available system-wide only
    // via the downloadable Reports (PDF/Excel) on the Reports page.
    let transferQuery = `
      SELECT t.*, e.serial_number, e.equipment_type, fu.full_name AS from_user, tu.full_name AS to_user
      FROM transfers t
      LEFT JOIN equipment e ON t.equipment_id = e.id
      LEFT JOIN users fu ON t.from_user_id = fu.id
      LEFT JOIN users tu ON t.to_user_id = tu.id
      WHERE (t.transfer_type = 'Transfer' AND t.created_by = ?)
         OR (t.transfer_type = 'Surrender' AND t.to_user_id = ?)
      ORDER BY t.created_at DESC LIMIT 100
    `;
    const transferParams = [currentUser.id, currentUser.id];

    // Equipment eligible to be moved by Admin: sitting in a Dzongkhag/HQ
    // store (not out in the field with an RO/Presiding Officer) and not
    // already part of an unresolved pending transfer.
    let equipmentQuery = `
      SELECT e.id, e.serial_number, e.equipment_type, e.dzongkhag_id, d.name AS dzongkhag_name
      FROM equipment e
      LEFT JOIN dzongkhags d ON e.dzongkhag_id = d.id
      WHERE e.status = 'Functional'
        AND (e.current_holder_id IS NULL OR e.current_holder_id IN (
          SELECT id FROM users WHERE role IN ('Admin','DzEO','DzERO','EA')
        ))
        AND e.id NOT IN (SELECT equipment_id FROM transfers WHERE status = 'Pending')
    `;
    // Recipients: only Dzongkhag-level officers (DzEO/DzERO/EA) — RO/PO
    // assignment is handled separately by the DzEO's "Issue To" workflow.
    let usersQuery = `
      SELECT u.id, u.full_name, u.role, u.dzongkhag_id, d.name AS dzongkhag_name
      FROM users u
      LEFT JOIN dzongkhags d ON u.dzongkhag_id = d.id
      WHERE u.is_active = 1 AND u.role IN ('DzEO','DzERO','EA')
    `;

    equipmentQuery += " ORDER BY d.name, e.serial_number ASC";
    usersQuery += " ORDER BY d.name, u.full_name ASC";

    const [transfers] = await db.query(transferQuery, transferParams);
    const [equipment] = await db.query(equipmentQuery);
    const [users] = await db.query(usersQuery);
    const [dzongkhags] = await db.query('SELECT * FROM dzongkhags ORDER BY name');

    const [[{ transferred_count }]] = await db.query(
      "SELECT COUNT(*) AS transferred_count FROM transfers WHERE transfer_type = 'Transfer' AND created_by = ?",
      [currentUser.id]
    );
    const [[{ received_count }]] = await db.query(
      "SELECT COUNT(*) AS received_count FROM transfers WHERE transfer_type = 'Surrender' AND to_user_id = ? AND status = 'Received'",
      [currentUser.id]
    );

    res.render('admin/transfers', {
      title: 'Equipment Transfers',
      transfers: transfers || [],
      equipment: equipment || [],
      users: users || [],
      dzongkhags: dzongkhags || [],
      adminStats: { transferred_count, received_count },
      user: currentUser
    });
  } catch (err) {
    console.error("Database query error inside getTransfers:", err);
    req.flash('error', 'Failed to load transfers configuration.');
    res.redirect('/admin/dashboard');
  }
};

// ─── USER MANAGEMENT ─────────────────────────────────────────
exports.getUsers = async (req, res) => {
  try {
    const [users] = await db.query(
      `SELECT u.*, d.name AS dzongkhag_name, c.name AS constituency_name, g.name AS gewog_name,
              ps.name AS polling_station_name
       FROM users u
       LEFT JOIN dzongkhags d ON u.dzongkhag_id = d.id
       LEFT JOIN constituencies c ON u.constituency_id = c.id
       LEFT JOIN gewogs g ON u.gewog_id = g.id
       LEFT JOIN polling_stations ps ON u.polling_station_id = ps.id
       ORDER BY u.role, u.full_name`
    );
    const [dzongkhags] = await db.query('SELECT * FROM dzongkhags ORDER BY name');
    res.render('admin/users', { title: 'User Management', users, dzongkhags });
  } catch (err) {
    console.error(err);
    res.redirect('/admin/dashboard');
  }
};

exports.postCreateUser = async (req, res) => {
  const { full_name, username, password, role, email, dzongkhag_id, constituency_id, gewog_id, polling_station_id } = req.body;
  try {
    // Hard cap: maximum 2000 user accounts in the system.
    const [[{ user_count }]] = await db.query('SELECT COUNT(*) AS user_count FROM users WHERE is_active = 1');
    if (user_count >= 2000) {
      req.flash('error', 'The system has reached the maximum limit of 2,000 active user accounts. Please deactivate unused accounts before creating new ones.');
      return res.redirect('/admin/users');
    }

    const [exists] = await db.query('SELECT id, is_active, full_name FROM users WHERE username = ?', [username]);
    if (exists.length) {
      if (!exists[0].is_active) {
        req.flash('error', `Username "${username}" belongs to a deactivated user (${exists[0].full_name}). Use the ♻️ Reactivate button on that user instead of creating a duplicate, or choose a different username.`);
      } else {
        req.flash('error', 'Username already exists.');
      }
      return res.redirect('/admin/users');
    }

    // Polling Station only applies to a Presiding Officer.
    const finalPollingStationId = role === 'Presiding Officer' ? (polling_station_id || null) : null;
    // Gewog is only relevant for a Presiding Officer (RO stops at Constituency).
    const finalGewogId = role === 'Presiding Officer' ? (gewog_id || null) : null;

    const hashed = await bcrypt.hash(password, 10);
    await db.query(
      'INSERT INTO users (full_name, username, password, role, email, dzongkhag_id, constituency_id, gewog_id, polling_station_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [full_name, username, hashed, role, email || null, dzongkhag_id || null, constituency_id || null, finalGewogId, finalPollingStationId]
    );

    // Email the plain-text username/password to the user (before hashing is irreversible)
    if (email) {
      const result = await sendCredentialsEmail({ to: email, fullName: full_name, username, password, role });
      if (result.sent) {
        req.flash('success', `${role} user created successfully. Login credentials emailed to ${email}.`);
      } else {
        req.flash('success', `${role} user created successfully.`);
        req.flash('error', `Could not email credentials to ${email} (${result.reason}). Please share them manually.`);
      }
    } else {
      req.flash('success', `${role} user created successfully. No email on file — share the username/password manually.`);
    }
    res.redirect('/admin/users');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to create user.');
    res.redirect('/admin/users');
  }
};

exports.deleteUser = async (req, res) => {
  try {
    await db.query("UPDATE users SET is_active = 0 WHERE id = ? AND role != 'Admin'", [req.params.id]);
    req.flash('success', 'User deactivated.');
    res.redirect('/admin/users');
  } catch (err) {
    console.error(err);
    res.redirect('/admin/users');
  }
};

// ─── API: DYNAMIC DROPDOWNS ──────────────────────────────────
exports.getConstituencies = async (req, res) => {
  try {
    const { dzongkhag_id } = req.params;
    const [rows] = await db.query('SELECT id, name FROM constituencies WHERE dzongkhag_id = ? ORDER BY name', [dzongkhag_id]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// DEPRECATED / BROAD ACCESS SAFEGUARDED: Retained for backwards layout safety but unlinked from Cascading View Engine
exports.getGewogs = async (req, res) => {
  try {
    const { dzongkhag_id } = req.params;
    const [rows] = await db.query('SELECT id, name FROM gewogs WHERE dzongkhag_id = ? ORDER BY name', [dzongkhag_id]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// MAIN LOOKUP ROUTE: Fetches ONLY gewogs registered specifically inside the matching constituency
exports.getGewogsByConstituency = async (req, res) => {
  try {
    const { constituency_id } = req.params;
    const [rows] = await db.query('SELECT id, name FROM gewogs WHERE constituency_id = ? ORDER BY name', [constituency_id]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getRoByConstituency = async (req, res) => {
  try {
    const { constituency_id } = req.params;
    const [rows] = await db.query(
      "SELECT id, full_name FROM users WHERE constituency_id = ? AND role = 'RO' AND is_active = 1 ORDER BY full_name",
      [constituency_id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Polling stations within a given Gewog — used when creating/editing a
// Presiding Officer (who is attached to exactly one Polling Station).
exports.getPollingStationsByGewog = async (req, res) => {
  try {
    const { gewog_id } = req.params;
    const [rows] = await db.query(
      'SELECT id, name FROM polling_stations WHERE gewog_id = ? ORDER BY name', [gewog_id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Active DzEO / DzERO / EA officers for a given Dzongkhag — used when
// Admin adds or edits equipment, since every piece of equipment must be
// assigned to one of them (not left unassigned).
exports.getOfficersByDzongkhag = async (req, res) => {
  try {
    const { dzongkhag_id } = req.params;
    const [rows] = await db.query(
      `SELECT id, full_name, role FROM users
       WHERE dzongkhag_id = ? AND role IN ('DzEO','DzERO','EA') AND is_active = 1
       ORDER BY role, full_name`,
      [dzongkhag_id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
// ─── ADMIN BULK TRANSFER (Thimphu HQ ⇄ Dzongkhag, Dzongkhag ⇄ Dzongkhag) ─
exports.postTransfer = async (req, res) => {
  const { to_user_id, transfer_date, remarks } = req.body;
  // Accept single or multiple equipment IDs from checkboxes
  let equipment_ids = req.body.equipment_ids || req.body.equipment_id;
  if (!equipment_ids) equipment_ids = [];
  if (!Array.isArray(equipment_ids)) equipment_ids = [equipment_ids];
  equipment_ids = equipment_ids.filter(Boolean);

  const user = req.session.user || req.user;
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    if (equipment_ids.length === 0) {
      await conn.rollback();
      req.flash('error', 'Please select at least one piece of equipment to transfer.');
      return res.redirect('/admin/transfers');
    }

    const [[recipient]] = await conn.query(
      `SELECT u.id, u.dzongkhag_id, d.name AS dzongkhag_name
       FROM users u LEFT JOIN dzongkhags d ON u.dzongkhag_id = d.id
       WHERE u.id = ? AND u.is_active = 1 AND u.role IN ('DzEO','DzERO','EA')`,
      [to_user_id]
    );
    if (!recipient) {
      await conn.rollback();
      req.flash('error', 'Please select an active DzEO / DzERO / EA officer to receive this equipment.');
      return res.redirect('/admin/transfers');
    }

    let transferred = 0;
    for (const equipment_id of equipment_ids) {
      const [[eq]] = await conn.query(
        `SELECT e.id, e.current_holder_id, e.dzongkhag_id, d.name AS dzongkhag_name
         FROM equipment e LEFT JOIN dzongkhags d ON e.dzongkhag_id = d.id WHERE e.id = ?`,
        [equipment_id]
      );
      if (!eq) continue;
      // Skip if same Dzongkhag
      if (recipient.dzongkhag_id && eq.dzongkhag_id && recipient.dzongkhag_id === eq.dzongkhag_id) continue;
      // Skip if already pending
      const [[pending]] = await conn.query(
        "SELECT id FROM transfers WHERE equipment_id = ? AND status = 'Pending'", [equipment_id]
      );
      if (pending) continue;

      const fromLocation = eq.dzongkhag_name || 'Thimphu HQ';
      const toLocation   = recipient.dzongkhag_name || 'Dzongkhag';

      await conn.query(
        `INSERT INTO transfers (equipment_id, from_user_id, to_user_id, from_location, to_location,
          transfer_date, transfer_type, status, remarks, created_by)
         VALUES (?, ?, ?, ?, ?, ?, 'Transfer', 'Pending', ?, ?)`,
        [equipment_id, eq.current_holder_id || null, recipient.id, fromLocation, toLocation, transfer_date, remarks || null, user.id]
      );
      transferred++;
    }

    await conn.commit();
    if (transferred === 0) {
      req.flash('error', 'No equipment was transferred. Items may already be in that Dzongkhag or have a pending transfer.');
    } else {
      req.flash('success', `${transferred} equipment item(s) transferred. Awaiting receipt confirmation from ${recipient.dzongkhag_name}.`);
    }
    res.redirect('/admin/transfers');
  } catch (err) {
    await conn.rollback();
    console.error(err);
    req.flash('error', 'Failed to record transfer.');
    res.redirect('/admin/transfers');
  } finally { conn.release(); }
};

// Manual status override (e.g. Admin marking a transfer Received on behalf
// of a Dzongkhag). When moving a 'Transfer' record to 'Received', this
// mirrors dzeoController.postReceiveTransfer so equipment location/holder
// stay in sync with the transfer record.
exports.updateTransferStatus = async (req, res) => {
  const { status } = req.body;
  const { id } = req.params;
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [[t]] = await conn.query('SELECT * FROM transfers WHERE id = ?', [id]);
    if (!t) {
      await conn.rollback();
      req.flash('error', 'Transfer not found.');
      return res.redirect('/admin/transfers');
    }
    await conn.query('UPDATE transfers SET status = ?, updated_at = NOW() WHERE id = ?', [status, id]);

    if (status === 'Received' && t.transfer_type === 'Transfer') {
      const [[toUser]] = await conn.query('SELECT id, dzongkhag_id FROM users WHERE id = ?', [t.to_user_id]);
      if (toUser) {
        await conn.query(
          `UPDATE equipment SET current_holder_id = ?, dzongkhag_id = COALESCE(?, dzongkhag_id),
                                 constituency_id = NULL, gewog_id = NULL
           WHERE id = ?`,
          [toUser.id, toUser.dzongkhag_id, t.equipment_id]
        );
      }
    }

    await conn.commit();
    req.flash('success', 'Status updated.');
    res.redirect('/admin/transfers');
  } catch (err) {
    await conn.rollback();
    console.error(err);
    req.flash('error', 'Failed to update status.');
    res.redirect('/admin/transfers');
  } finally { conn.release(); }
};

// ─── EDIT USER (Admin can edit, not delete) ───────────────────
exports.postEditUser = async (req, res) => {
  const { full_name, email, username, password, dzongkhag_id, constituency_id, gewog_id, polling_station_id } = req.body;
  const { id } = req.params;
  try {
    const [[existing]] = await db.query('SELECT role, username FROM users WHERE id = ?', [id]);
    if (!existing) {
      req.flash('error', 'User not found.');
      return res.redirect('/admin/users');
    }
    const isPO = existing.role === 'Presiding Officer';
    // Polling Station and Gewog only apply to a Presiding Officer
    // (RO stops at Constituency).
    const finalPollingStationId = isPO ? (polling_station_id || null) : null;
    const finalGewogId = isPO ? (gewog_id || null) : null;

    // Username can be changed too — just make sure it doesn't collide
    // with another account.
    const finalUsername = (username || existing.username).trim();
    if (finalUsername !== existing.username) {
      const [clash] = await db.query('SELECT id FROM users WHERE username = ? AND id != ?', [finalUsername, id]);
      if (clash.length) {
        req.flash('error', `Username "${finalUsername}" is already taken by another user.`);
        return res.redirect('/admin/users');
      }
    }

    if (password && password.trim()) {
      if (password.trim().length < 6) {
        req.flash('error', 'New password must be at least 6 characters.');
        return res.redirect('/admin/users');
      }
      // Resetting the password too
      const hashed = await bcrypt.hash(password, 10);
      await db.query(
        'UPDATE users SET full_name=?, email=?, username=?, password=?, dzongkhag_id=?, constituency_id=?, gewog_id=?, polling_station_id=? WHERE id=?',
        [full_name, email || null, finalUsername, hashed, dzongkhag_id || null, constituency_id || null, finalGewogId, finalPollingStationId, id]
      );
      const currentUser = req.session.user || req.user;
      await db.query(
        'INSERT INTO audit_logs (user_id, action, table_affected, record_id, details) VALUES (?, ?, ?, ?, ?)',
        [currentUser.id, 'RESET_PASSWORD', 'users', id, `Admin reset password${finalUsername !== existing.username ? ' and changed username to ' + finalUsername : ''} for user #${id}`]
      );
      req.flash('success', 'User updated, including a new password.');
    } else {
      await db.query(
        'UPDATE users SET full_name=?, email=?, username=?, dzongkhag_id=?, constituency_id=?, gewog_id=?, polling_station_id=? WHERE id=?',
        [full_name, email || null, finalUsername, dzongkhag_id || null, constituency_id || null, finalGewogId, finalPollingStationId, id]
      );
      if (finalUsername !== existing.username) {
        const currentUser = req.session.user || req.user;
        await db.query(
          'INSERT INTO audit_logs (user_id, action, table_affected, record_id, details) VALUES (?, ?, ?, ?, ?)',
          [currentUser.id, 'CHANGE_USERNAME', 'users', id, `Admin changed username from "${existing.username}" to "${finalUsername}" for user #${id}`]
        );
      }
      req.flash('success', 'User updated.');
    }
    res.redirect('/admin/users');
  } catch (err) { console.error(err); req.flash('error', 'Failed to update user.'); res.redirect('/admin/users'); }
};

// Deactivate only (no hard delete)
exports.deactivateUser = async (req, res) => {
  await db.query('UPDATE users SET is_active = 0 WHERE id = ?', [req.params.id]);
  req.flash('success', 'User deactivated.');
  res.redirect('/admin/users');
};

// Reactivate a previously deactivated user
exports.activateUser = async (req, res) => {
  await db.query('UPDATE users SET is_active = 1 WHERE id = ?', [req.params.id]);
  req.flash('success', 'User reactivated.');
  res.redirect('/admin/users');
};

// ─── PERMANENTLY DELETE A USER (only if they have no history) ─
// Blocks the delete if the user created any equipment/transfers,
// performed any quarterly check, or ever received a transfer
// (transfers.to_user_id is ON DELETE CASCADE — deleting that user
// would silently wipe those transfer records, so we refuse instead).
exports.deleteUserPermanently = async (req, res) => {
  const { id } = req.params;
  try {
    const [[user]] = await db.query('SELECT id, username, full_name, role FROM users WHERE id = ?', [id]);
    if (!user) { req.flash('error', 'User not found.'); return res.redirect('/admin/users'); }
    if (user.role === 'Admin') {
      req.flash('error', 'Admin accounts cannot be deleted.');
      return res.redirect('/admin/users');
    }

    const [[{ equipment_created }]] = await db.query('SELECT COUNT(*) AS equipment_created FROM equipment WHERE created_by = ?', [id]);
    const [[{ transfers_involved }]] = await db.query(
      'SELECT COUNT(*) AS transfers_involved FROM transfers WHERE created_by = ? OR from_user_id = ? OR to_user_id = ?',
      [id, id, id]
    );
    const [[{ checks_done }]] = await db.query('SELECT COUNT(*) AS checks_done FROM quarterly_checks WHERE checked_by = ?', [id]);
    const [[{ holding_equipment }]] = await db.query('SELECT COUNT(*) AS holding_equipment FROM equipment WHERE current_holder_id = ?', [id]);

    if (equipment_created || transfers_involved || checks_done || holding_equipment) {
      req.flash('error',
        `Cannot delete "${user.full_name}" (${user.username}) — this account has recorded history ` +
        `(equipment added, transfers, or quarterly checks). Deleting it would corrupt those records. ` +
        `Use 🚫 Deactivate instead — it hides the account from active use while preserving history.`
      );
      return res.redirect('/admin/users');
    }

    await db.query('DELETE FROM users WHERE id = ?', [id]);
    req.flash('success', `User "${user.full_name}" (${user.username}) permanently deleted.`);
    res.redirect('/admin/users');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to delete user.');
    res.redirect('/admin/users');
  }
};

// ─── RECEIVE SURRENDERED EQUIPMENT (from DzEO) ────────────────
exports.postReceiveSurrender = async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const { id } = req.params;
    const currentUser = req.session.user || req.user;
    const [[transfer]] = await conn.query(
      "SELECT equipment_id, fault_type FROM transfers WHERE id = ? AND transfer_type = 'Surrender' AND status = 'Returning'", [id]
    );
    if (!transfer) {
      await conn.rollback();
      req.flash('error', 'Pending surrender not found.');
      return res.redirect('/admin/dashboard');
    }
    await conn.query("UPDATE transfers SET status = 'Returned', updated_at = NOW() WHERE id = ?", [id]);
    const newStatus = transfer.fault_type ? 'Non-Functional' : 'Functional';
    await conn.query(
      "UPDATE equipment SET current_holder_id = ?, status = ? WHERE id = ?",
      [currentUser.id, newStatus, transfer.equipment_id]
    );
    await conn.query('INSERT INTO audit_logs (user_id, action, table_affected, record_id) VALUES (?, ?, ?, ?)',
      [currentUser.id, 'RECEIVE_SURRENDER', 'equipment', transfer.equipment_id]);
    await conn.commit();
    req.flash('success', 'Surrendered equipment received into central inventory.');
    res.redirect('/admin/dashboard');
  } catch (err) {
    await conn.rollback();
    console.error(err);
    req.flash('error', 'Failed to process surrender receipt.');
    res.redirect('/admin/dashboard');
  } finally { conn.release(); }
};

// ─── SURRENDER TEMPLATE DOWNLOAD ─────────────────────────────
// Admin can download a pre-formatted Excel template that a Dzongkhag
// fills in to document a surrender batch (equipment added date, planned
// surrender date, serial numbers, condition).
exports.downloadSurrenderTemplate = async (req, res) => {
  try {
    const ExcelJS = require('exceljs');
    const wb  = new ExcelJS.Workbook();
    wb.creator = 'EVM Inventory System';
    const ws  = wb.addWorksheet('Surrender Form');
    const BLUE  = 'FF4472C4', WHITE = 'FFFFFFFF', DARK = 'FF1E3A5F', LIGHT = 'FFD6E4F0';

    ws.columns = [
      { width: 8  },  // Sl. No
      { width: 18 },  // Ballot Unit
      { width: 18 },  // Control Unit
      { width: 10 },  // Year
      { width: 22 },  // Status(Non-Functional)
      { width: 24 },  // Fault Type
      { width: 18 },  // Dzongkhag
    ];

    // Row 1 — blank spacer
    ws.addRow([]); ws.getRow(1).height = 6;

    // Row 2 — Title
    ws.mergeCells('A2:G2');
    ws.getCell('A2').value = 'ELECTION COMMISSION OF BHUTAN — EQUIPMENT SURRENDER FORM';
    ws.getCell('A2').font  = { bold: true, size: 13, color: { argb: DARK } };
    ws.getCell('A2').alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getRow(2).height = 26;

    // Row 3 — blank spacer
    ws.addRow([]); ws.getRow(3).height = 6;

    // Row 4 — subtitle
    ws.mergeCells('A4:G4');
    ws.getCell('A4').value = 'Fill in all fields and submit to Admin / Election Commission HQ';
    ws.getCell('A4').font  = { size: 10, italic: true, color: { argb: 'FF444444' } };
    ws.getCell('A4').alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getRow(4).height = 20;

    // Row 5 — blank spacer
    ws.addRow([]); ws.getRow(5).height = 6;

    // Row 6 — column headers
    const headers = ['Sl. No', 'Ballot Unit(BU)', 'Control Unit(CU)', 'Year',
                     'Status(Non-Functional)', 'Fault Type', 'Dzongkhag'];
    const hRow = ws.getRow(6);
    headers.forEach((h, i) => {
      const cell = hRow.getCell(i + 1);
      cell.value = h;
      cell.font  = { bold: true, color: { argb: WHITE }, size: 11 };
      cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE } };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = {
        top: { style: 'thin', color: { argb: WHITE } }, bottom: { style: 'thin', color: { argb: WHITE } },
        left: { style: 'thin', color: { argb: WHITE } }, right: { style: 'thin', color: { argb: WHITE } }
      };
    });
    hRow.height = 28;

    // Rows 7–16 — blank data rows
    for (let r = 7; r <= 16; r++) {
      const row = ws.getRow(r);
      // Sl. No pre-filled
      const sl = row.getCell(1);
      sl.value = r - 6;
      sl.font  = { size: 10 };
      sl.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT } };
      sl.alignment = { horizontal: 'center', vertical: 'middle' };
      for (let c = 2; c <= 7; c++) {
        const cell = row.getCell(c);
        cell.font   = { size: 10 };
        cell.border = {
          bottom: { style: 'thin', color: { argb: 'FFCCCCCC' } },
          left:   { style: 'thin', color: { argb: 'FFCCCCCC' } },
          right:  { style: 'thin', color: { argb: 'FFCCCCCC' } }
        };
      }
      row.height = 22;
    }

    // Row 18 — note
    ws.mergeCells('A18:G18');
    ws.getCell('A18').value =
      'NOTE: Each row = one BU + CU pair. Enter serial number without prefix (e.g. 2232). ' +
      'Status: write "Non-Functional" if faulty. Fault Type: e.g. "Pin Broken", "Display Fault". ' +
      'After uploading, equipment will appear in the Dashboard ECIL section ready to dispatch.';
    ws.getCell('A18').font  = { size: 9, italic: true, color: { argb: 'FF888888' } };
    ws.getCell('A18').alignment = { wrapText: true };
    ws.getRow(18).height = 36;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="ECB_Equipment_Surrender_Form.xlsx"');
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('[downloadSurrenderTemplate]', err);
    req.flash('error', 'Failed to generate surrender template.');
    res.redirect('/admin/reports');
  }
};


    // ── Title rows ────────────────────────────────────────────
// ─── ADMIN SURRENDER UPLOAD (historical records) ─────────────
// Admin uploads a filled-in Excel file to bulk-import surrender records
// from Dzongkhags (old/historical surrenders not entered in the system).
// The uploaded file must match the template downloaded from Reports.
exports.getSurrenderUpload = async (req, res) => {
  const [dzongkhags] = await db.query('SELECT * FROM dzongkhags ORDER BY name');
  res.render('admin/surrender-upload', { title: 'Upload Surrender Records', dzongkhags });
};

exports.postSurrenderUpload = async (req, res) => {
  try {
    const currentUser = req.session.user || req.user;
    if (!req.file) {
      req.flash('error', 'Please select an Excel file to upload.');
      return res.redirect('/admin/surrender/upload');
    }

    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(req.file.buffer);
    const ws = wb.getWorksheet(1);
    if (!ws) {
      req.flash('error', 'Could not read worksheet.');
      return res.redirect('/admin/surrender/upload');
    }

    // Robust cell reader — handles plain text, rich-text, dates, numbers
    const readCell = (row, idx) => {
      if (!idx) return '';
      const v = row.getCell(idx).value;
      if (v === null || v === undefined)           return '';
      if (v instanceof Date)                       return v.toISOString().split('T')[0];
      if (typeof v === 'object' && v.richText)     return v.richText.map(r => r.text || '').join('').trim();
      if (typeof v === 'object' && v.text)         return String(v.text).trim();
      if (typeof v === 'object' && v.result != null) return String(v.result).trim();
      return String(v).trim();
    };

    // Locate header row (looks for "Ballot Unit" in any cell)
    let headerRowIdx = null;
    let colMap = {};
    ws.eachRow({ includeEmpty: false }, (row, rowNum) => {
      if (headerRowIdx) return;
      const vals = row.values.map(v => {
        if (!v) return '';
        if (typeof v === 'object' && v.richText) return v.richText.map(r => r.text || '').join('').toLowerCase().trim();
        if (typeof v === 'object' && v.text)     return String(v.text).toLowerCase().trim();
        return String(v).toLowerCase().trim();
      });
      if (vals.some(v => v.startsWith('ballot'))) {
        headerRowIdx = rowNum;
        vals.forEach((v, i) => {
          if (v.startsWith('sl'))       colMap.slno    = i;
          if (v.startsWith('ballot'))   colMap.bu      = i;
          if (v.startsWith('control'))  colMap.cu      = i;
          if (v === 'year')             colMap.year    = i;
          if (v.startsWith('status'))   colMap.status  = i;
          if (v.startsWith('fault'))    colMap.fault   = i;
          if (v.startsWith('remark'))   colMap.remarks = i;
          if (v.startsWith('dzong'))    colMap.dzong   = i;
        });
      }
    });

    if (!headerRowIdx || (!colMap.bu && !colMap.cu)) {
      req.flash('error', 'Could not find header row. Use the downloaded template.');
      return res.redirect('/admin/surrender/upload');
    }

    const [[admin]] = await db.query(
      "SELECT id FROM users WHERE role='Admin' AND is_active=1 ORDER BY id LIMIT 1");

    const [dzRows] = await db.query('SELECT id, name FROM dzongkhags');
    const dzMap = {};
    dzRows.forEach(d => { dzMap[d.name.toLowerCase().trim()] = d.id; });
    const hqId = dzMap['thimphu hq'] || null;

    // Parse data rows
    const rowsData = [];
    ws.eachRow({ includeEmpty: false }, (row, rowNum) => {
      if (rowNum <= headerRowIdx) return;
      const buSerial = colMap.bu ? readCell(row, colMap.bu) : '';
      const cuSerial = colMap.cu ? readCell(row, colMap.cu) : '';
      if (!buSerial && !cuSerial) return;

      // Skip rows that are clearly headers or notes (not real data)
      const buLower = buSerial.toLowerCase();
      const cuLower = cuSerial.toLowerCase();
      if (buLower.startsWith('ballot') || buLower.startsWith('sl') ||
          buLower.startsWith('note')   || cuLower.startsWith('control') ||
          buLower.includes('unit'))    return;

      const yearRaw = colMap.year ? row.getCell(colMap.year).value : null;
      const yearStr = yearRaw instanceof Date ? String(yearRaw.getFullYear())
                    : yearRaw ? String(yearRaw).trim().substring(0, 4) : null;

      const dzName  = colMap.dzong   ? readCell(row, colMap.dzong).toLowerCase()  : '';
      const remarks = colMap.remarks ? (readCell(row, colMap.remarks) || null)     : null;

      // Status — Non-Functional if "non" in cell OR fault type is given
      const statusVal   = colMap.status ? readCell(row, colMap.status).toLowerCase() : '';
      const faultVal    = colMap.fault  ? readCell(row, colMap.fault) : '';
      const isNonFunc   = statusVal.includes('non') || statusVal.includes('fault') || faultVal.trim().length > 0;
      const faultType   = faultVal.trim() || (isNonFunc ? 'Non-Functional' : null);

      rowsData.push({ buSerial, cuSerial, yearStr, dzName, remarks, isNonFunc, faultType });
    });

    if (!rowsData.length) {
      req.flash('error', 'No data rows found. Fill in at least one row.');
      return res.redirect('/admin/surrender/upload');
    }

    let imported = 0, skipped = 0;
    const errors = [];
    const conn = await db.getConnection();

    try {
      await conn.beginTransaction();

      for (const row of rowsData) {
        const dzongkhagId   = dzMap[row.dzName] || hqId;
        const transferDate  = new Date().toISOString().split('T')[0];
        const surrenderDate = row.yearStr ? `${row.yearStr}-12-31` : transferDate;
        const eqStatus      = row.isNonFunc ? 'Non-Functional' : 'Functional';
        const faultType     = row.faultType;

        for (const [rawSerial, eqType] of [
          [row.buSerial, 'Ballot Unit'],
          [row.cuSerial, 'Control Unit']
        ]) {
          if (!rawSerial) continue;

          // Skip rows that look like headers or notes
          const lower = rawSerial.toLowerCase();
          if (lower.includes('ballot') || lower.includes('control') ||
              lower.includes('serial') || lower.includes('unit') ||
              lower.startsWith('note') || lower.startsWith('sl')) {
            continue;
          }

          // Auto-add prefix if missing (only digits or short alphanumeric = needs prefix)
          const prefix = eqType === 'Ballot Unit' ? 'BU-' : 'CU-';
          let serial = rawSerial.toUpperCase().startsWith(prefix)
            ? rawSerial : prefix + rawSerial;

          // Enforce max length — serial_number column is VARCHAR(100)
          if (serial.length > 50) {
            errors.push(`Skipped "${serial.substring(0,30)}...": serial number too long (max 50 chars).`);
            skipped++; continue;
          }

          let [[eq]] = await conn.query(
            'SELECT id, current_holder_id FROM equipment WHERE serial_number=?', [serial]);

          let eqId;
          if (eq) {
            eqId = eq.id;
          } else {
            if (!dzongkhagId) {
              errors.push(`${serial}: Dzongkhag "${row.dzName}" not found.`);
              skipped++; continue;
            }
            const [ins] = await conn.query(
              'INSERT INTO equipment (serial_number,equipment_type,dzongkhag_id,status,created_by) VALUES(?,?,?,?,?)',
              [serial, eqType, dzongkhagId, eqStatus, currentUser.id]);
            eqId = ins.insertId;
            eq   = { id: eqId, current_holder_id: currentUser.id };
          }

          // Skip duplicates
          const [[dup]] = await conn.query(
            "SELECT id FROM transfers WHERE equipment_id=? AND transfer_type='Surrender'", [eqId]);
          if (dup) { skipped++; continue; }

          // Insert surrender transfer (status Returned → shows in ECIL section)
          await conn.query(
            `INSERT INTO transfers
              (equipment_id, from_user_id, to_user_id, from_location, to_location,
               transfer_date, surrender_date, transfer_type, status, fault_type, remarks, created_by)
             VALUES (?,?,?,'Dzongkhag Store','Election Commission HQ',?,?,'Surrender','Returned',?,?,?)`,
            [eqId, eq.current_holder_id, admin.id,
             transferDate, surrenderDate, faultType, row.remarks, currentUser.id]);

          // Update equipment: assign to Admin, set correct status
          await conn.query(
            `UPDATE equipment SET current_holder_id=?, status=?,
             dzongkhag_id=COALESCE(dzongkhag_id,?) WHERE id=?`,
            [admin.id, eqStatus, dzongkhagId, eqId]);

          imported++;
        }
      }

      await conn.commit();
      const msg = errors.length
        ? `Imported ${imported}, skipped ${skipped}. Issues: ${errors.slice(0,3).join('; ')}`
        : `Imported ${imported} item(s). ${skipped > 0 ? skipped + ' duplicate(s) skipped. ' : ''}` +
          `They are ready on the Dashboard to surrender to ECIL.`;
      req.flash(errors.length ? 'error' : 'success', msg);
    } catch (e) {
      await conn.rollback(); throw e;
    } finally { conn.release(); }

    res.redirect('/admin/surrender/upload');
  } catch (err) {
    console.error('[postSurrenderUpload]', err);
    req.flash('error', 'Upload failed: ' + err.message);
    res.redirect('/admin/surrender/upload');
  }
};

exports.postSurrenderToEcil = async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const currentUser = req.session.user || req.user;
    const { remarks, ecil_date } = req.body;

    let equipment_ids = req.body.equipment_ids || [];
    if (!Array.isArray(equipment_ids)) equipment_ids = [equipment_ids];
    equipment_ids = equipment_ids.map(String).filter(Boolean);

    if (!equipment_ids.length) {
      await conn.rollback();
      req.flash('error', 'Please select at least one piece of equipment to surrender to ECIL.');
      return res.redirect('/admin/dashboard');
    }

    const transferDate = ecil_date || new Date().toISOString().split('T')[0];
    let surrendered = 0;
    const skipped = [];

    for (const eqId of equipment_ids) {
      // Skip if already surrendered to ECIL
      const [[already]] = await conn.query(
        `SELECT id FROM transfers WHERE equipment_id=? AND transfer_type='ECIL'`, [eqId]);
      if (already) { skipped.push(eqId); continue; }

      // Get equipment details incl. fault_type from its surrender transfer record
      const [[eq]] = await conn.query(
        `SELECT e.id, e.serial_number, e.status,
                t.fault_type AS surrender_fault
         FROM equipment e
         LEFT JOIN transfers t ON t.id=(
           SELECT id FROM transfers
           WHERE equipment_id=e.id AND transfer_type='Surrender' AND status='Returned'
           ORDER BY id DESC LIMIT 1
         )
         WHERE e.id=?`, [eqId]);
      if (!eq) { skipped.push(eqId); continue; }

      // Equipment surrendered to ECIL is always Non-Functional by default
      // (it is being returned to the manufacturer for disposal/repair)
      const faultType = eq.surrender_fault || 'Surrendered to ECIL';

      await conn.query(
        `INSERT INTO transfers
           (equipment_id, from_user_id, to_user_id, from_location, to_location,
            transfer_date, transfer_type, status, fault_type, remarks, created_by)
         VALUES (?, ?, ?, 'Election Commission HQ', 'ECIL Hyderabad',
                 ?, 'ECIL', 'Returned', ?, ?, ?)`,
        [eqId, currentUser.id, currentUser.id, transferDate, faultType, remarks || null, currentUser.id]);

      // Mark equipment Non-Functional and clear holder (gone from ECB)
      await conn.query(
        `UPDATE equipment SET current_holder_id=NULL, status='Non-Functional' WHERE id=?`, [eqId]);

      await conn.query(
        `INSERT INTO audit_logs (user_id, action, table_affected, record_id)
         VALUES (?, 'ECIL_SURRENDER', 'equipment', ?)`,
        [currentUser.id, eqId]);
      surrendered++;
    }

    await conn.commit();

    if (surrendered === 0) {
      req.flash('error', 'No equipment surrendered — items may already be in ECIL.');
    } else {
      req.flash('success',
        `${surrendered} item(s) surrendered to ECIL Hyderabad and marked Non-Functional.` +
        (skipped.length ? ` ${skipped.length} already in ECIL — skipped.` : ''));
    }
    res.redirect('/admin/dashboard');
  } catch (err) {
    await conn.rollback();
    console.error('[ECIL surrender]', err.message);
    if (err.message && err.message.includes('Data truncated')) {
      req.flash('error',
        'ECIL surrender failed — run this SQL on your database: ' +
        "ALTER TABLE transfers MODIFY transfer_type ENUM('Transfer','Issue','Return','Surrender','ReceiveBack','ECIL') NOT NULL DEFAULT 'Transfer';");
    } else {
      req.flash('error', 'Failed to surrender to ECIL: ' + err.message);
    }
    res.redirect('/admin/dashboard');
  } finally { conn.release(); }
};

// ─── ECIL REPORT ──────────────────────────────────────────────
// Admin can download a summary of all equipment surrendered to ECIL.
exports.downloadEcilReport = async (req, res) => {
  const { format } = req.query;
  try {
    const [rows] = await db.query(`
      SELECT e.serial_number, e.equipment_type,
             d.name AS dzongkhag_name,
             t.transfer_date AS ecil_date, t.remarks,
             surrenderT.transfer_date AS surrendered_from_dzongkhag,
             fu.full_name AS surrendered_by_dzongkhag
      FROM transfers t
      JOIN equipment e ON t.equipment_id = e.id
      LEFT JOIN dzongkhags d ON e.dzongkhag_id = d.id
      LEFT JOIN users fu ON t.from_user_id = fu.id
      LEFT JOIN transfers surrenderT ON surrenderT.equipment_id = e.id
        AND surrenderT.transfer_type = 'Surrender' AND surrenderT.status = 'Returned'
      WHERE t.transfer_type = 'ECIL' AND t.status = 'Returned'
      ORDER BY t.transfer_date DESC, e.equipment_type, e.serial_number
    `);

    const columns = [
      { key: 'serial_number', label: 'Serial Number' },
      { key: 'equipment_type', label: 'Equipment Type' },
      { key: 'dzongkhag_name', label: 'Dzongkhag' },
      { key: 'surrendered_from_dzongkhag', label: 'Surrendered from Dzongkhag (Date)' },
      { key: 'surrendered_by_dzongkhag', label: 'Surrendered By' },
      { key: 'ecil_date', label: 'Dispatched to ECIL (Date)' },
      { key: 'remarks', label: 'Remarks' },
    ];

    const reportController = require('./reportController');
    // Use internal generateExcel / generatePDF helpers via reportController
    if (format === 'excel') {
      const ExcelJS = require('exceljs');
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('ECIL Surrender Report');
      ws.columns = columns.map(c => ({ header: c.label, key: c.key, width: 22 }));
      ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
      rows.forEach(r => {
        const rowData = {};
        columns.forEach(c => {
          let v = r[c.key];
          if (v instanceof Date) v = v.toLocaleDateString();
          rowData[c.key] = v || '—';
        });
        ws.addRow(rowData);
      });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="ECIL_Surrender_Report.xlsx"');
      await wb.xlsx.write(res);
      return res.end();
    }

    // PDF via pdfkit
    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({ margin: 40, size: 'A4', layout: 'landscape' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="ECIL_Surrender_Report.pdf"');
    doc.pipe(res);
    doc.fontSize(14).text('ECIL Surrender Report — Election Commission of Bhutan', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(9).text(`Generated: ${new Date().toLocaleString()}`, { align: 'right' });
    doc.moveDown(1);
    if (!rows.length) {
      doc.fontSize(11).text('No equipment surrendered to ECIL yet.', { align: 'center' });
    } else {
      const colWidths = [90, 80, 80, 90, 90, 90, 100];
      let x = 40, y = doc.y;
      columns.forEach((c, i) => {
        doc.fontSize(8).font('Helvetica-Bold').text(c.label, x, y, { width: colWidths[i], lineBreak: false });
        x += colWidths[i];
      });
      doc.moveDown(0.5);
      rows.forEach(r => {
        x = 40; y = doc.y;
        if (y > 520) { doc.addPage(); y = 40; }
        columns.forEach((c, i) => {
          let v = r[c.key];
          if (v instanceof Date) v = v.toLocaleDateString();
          doc.fontSize(7).font('Helvetica').text(String(v || '—'), x, y, { width: colWidths[i], lineBreak: false });
          x += colWidths[i];
        });
        doc.moveDown(0.4);
      });
    }
    doc.end();
  } catch (err) {
    console.error(err);
    req.flash('error', 'Report generation failed.');
    res.redirect('/admin/dashboard');
  }
};