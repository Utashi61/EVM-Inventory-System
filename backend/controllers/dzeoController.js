const db = require('../config/database');
const { FAULT_TYPES } = require('../utils/constants');

const getDzongkhagId = (req) => req.session?.user?.dzongkhag_id || req.user?.dzongkhag_id || null;
const getUserId = (req) => req.session?.user?.id || req.user?.id;
const getUser = (req) => req.session?.user || req.user;

// Current quarter label, e.g. 'Q3-2026'.
// (Reverted back to quarterly — the functionality check is required
// every quarter, not once a year.)
function currentQuarterLabel(d = new Date()) {
  const q = Math.floor(d.getMonth() / 3) + 1;
  return `Q${q}-${d.getFullYear()}`;
}

// ─── DASHBOARD ──────────────────────────────────────────────
exports.getDashboard = async (req, res) => {
  const dzongkhag_id = getDzongkhagId(req);
  if (!dzongkhag_id) { req.flash('error', 'Session expired.'); return res.redirect('/login'); }
  try {
    // "In Dzongkhag Store" = equipment currently held at the Dzongkhag
    // office level — i.e. NOT yet issued down to an RO/Presiding Officer,
    // and NOT surrendered up to Admin. This is a live current-possession
    // count (via current_holder_id), not a historical transfer count, so
    // it always matches "My Equipment" below.
    const [[summary]] = await db.query(`
      SELECT COUNT(*) AS total_equipment,
        SUM(status = 'Functional') AS functional,
        SUM(status = 'Non-Functional') AS non_functional
      FROM equipment e
      WHERE e.dzongkhag_id = ?
        AND (e.current_holder_id IS NULL OR e.current_holder_id IN (
          SELECT id FROM users WHERE dzongkhag_id = ? AND role IN ('DzEO','DzERO','EA')
        ))`, [dzongkhag_id, dzongkhag_id]);

    // Currently issued out to an RO/Presiding Officer and not yet
    // returned — a live count, not "every Issue transfer ever made".
    const [[{ issued_to_ro }]] = await db.query(
      `SELECT COUNT(*) AS issued_to_ro
       FROM equipment e JOIN users u ON e.current_holder_id = u.id
       WHERE e.dzongkhag_id = ? AND u.role IN ('RO','Presiding Officer')`,
      [dzongkhag_id]
    );
    // Historical count of equipment this Dzongkhag has surrendered up to
    // Admin (an activity count, not a current-inventory figure — once
    // surrendered, that equipment no longer appears in "In Dzongkhag
    // Store" above).
    const [[{ surrendered_to_hq }]] = await db.query(
      `SELECT COUNT(*) AS surrendered_to_hq FROM transfers t
       WHERE t.transfer_type = 'Surrender' AND t.status = 'Returned'
         AND t.from_user_id IN (SELECT id FROM users WHERE dzongkhag_id = ? AND role IN ('DzEO','DzERO','EA'))`,
      [dzongkhag_id]
    );
    const [pendingReturns] = await db.query(`
      SELECT t.id AS transfer_id, t.transfer_date, t.remarks, t.fault_type,
             e.serial_number, e.equipment_type, fu.full_name AS from_user
      FROM transfers t JOIN equipment e ON t.equipment_id = e.id
      LEFT JOIN users fu ON t.from_user_id = fu.id
      WHERE t.to_user_id = ? AND t.status = 'Returning'
      ORDER BY t.created_at DESC`, [getUserId(req)]);

    // ─── INCOMING TRANSFERS FROM ADMIN (Thimphu HQ ⇄ Dzongkhag, or
    // Dzongkhag ⇄ Dzongkhag) — awaiting this Dzongkhag's confirmation ───
    const [incomingTransfers] = await db.query(`
      SELECT t.id AS transfer_id, t.transfer_date, t.remarks, t.from_location, t.to_location,
             e.serial_number, e.equipment_type, fu.full_name AS from_user
      FROM transfers t JOIN equipment e ON t.equipment_id = e.id
      LEFT JOIN users fu ON t.from_user_id = fu.id
      WHERE t.to_user_id = ? AND t.status = 'Pending' AND t.transfer_type = 'Transfer'
      ORDER BY t.created_at DESC`, [getUserId(req)]);

    // ─── QUARTERLY FUNCTIONALITY CHECK SUMMARY ────────────────────────
    const quarterLabel = currentQuarterLabel();
    const [[{ checked_this_quarter }]] = await db.query(
      `SELECT COUNT(*) AS checked_this_quarter FROM equipment WHERE dzongkhag_id = ? AND last_checked_quarter = ?`,
      [dzongkhag_id, quarterLabel]
    );

    res.render('dzeo/dashboard', {
      title: 'Dashboard',
      summary: { ...summary, issued_to_ro, surrendered_to_hq },
      pendingReturns: pendingReturns || [],
      incomingTransfers: incomingTransfers || [],
      quarterlyCheck: {
        quarterLabel,
        checked: checked_this_quarter || 0,
        total: summary.total_equipment || 0,
        pending: (summary.total_equipment || 0) - (checked_this_quarter || 0)
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).render('error', {
      code: 500,
      title: 'Dashboard Error',
      message: 'Failed to load dashboard. This usually means the database schema is out of date — make sure database/migration_v2.sql has been run. Check the server console for the exact SQL error.'
    });
  }
};

// ─── CONFIRM RECEIPT OF RETURNED EQUIPMENT ──────────────────
exports.postReceiveReturn = async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const { id } = req.params;
    const dzeoUserId = getUserId(req);
    const [[transfer]] = await conn.query(
      "SELECT equipment_id, fault_type FROM transfers WHERE id = ? AND status = 'Returning'", [id]
    );
    if (!transfer) {
      await conn.rollback();
      req.flash('error', 'Pending return not found.');
      return res.redirect('/dzeo/dashboard');
    }
    await conn.query("UPDATE transfers SET status = 'Returned', updated_at = NOW() WHERE id = ?", [id]);
    // Update equipment status based on fault type
    const newStatus = transfer.fault_type ? 'Non-Functional' : 'Functional';
    await conn.query(
      "UPDATE equipment SET current_holder_id = ?, constituency_id = NULL, gewog_id = NULL, status = ? WHERE id = ?",
      [dzeoUserId, newStatus, transfer.equipment_id]
    );
    await conn.commit();
    req.flash('success', 'Equipment received back into inventory.');
    res.redirect('/dzeo/dashboard');
  } catch (err) {
    await conn.rollback();
    console.error(err);
    req.flash('error', 'Failed to process return.');
    res.redirect('/dzeo/dashboard');
  } finally { conn.release(); }
};

// ─── CONFIRM RECEIPT OF EQUIPMENT SENT BY ADMIN ──────────────
// Admin moves equipment from Thimphu HQ (or another Dzongkhag) to this
// Dzongkhag; the equipment only becomes part of this Dzongkhag's
// inventory once the DzEO/DzERO/EA here confirms receipt.
exports.postReceiveTransfer = async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const { id } = req.params;
    const currentUser = getUser(req);
    const [[transfer]] = await conn.query(
      "SELECT equipment_id FROM transfers WHERE id = ? AND to_user_id = ? AND status = 'Pending' AND transfer_type = 'Transfer'",
      [id, currentUser.id]
    );
    if (!transfer) {
      await conn.rollback();
      req.flash('error', 'Pending transfer not found.');
      return res.redirect('/dzeo/dashboard');
    }
    await conn.query("UPDATE transfers SET status = 'Received', updated_at = NOW() WHERE id = ?", [id]);
    await conn.query(
      `UPDATE equipment SET current_holder_id = ?, dzongkhag_id = ?, constituency_id = NULL, gewog_id = NULL
       WHERE id = ?`,
      [currentUser.id, currentUser.dzongkhag_id, transfer.equipment_id]
    );
    await conn.commit();
    req.flash('success', 'Equipment received into your Dzongkhag inventory.');
    res.redirect('/dzeo/dashboard');
  } catch (err) {
    await conn.rollback();
    console.error(err);
    req.flash('error', 'Failed to process transfer receipt.');
    res.redirect('/dzeo/dashboard');
  } finally { conn.release(); }
};

// ─── ADD EQUIPMENT (DzEO/DzERO/EA — scoped to own Dzongkhag) ─
exports.getAddEquipment = async (req, res) => {
  const dzongkhag_id = getDzongkhagId(req);
  if (!dzongkhag_id) return res.redirect('/login');
  res.render('dzeo/equipment-form', { title: 'Add Equipment', equipment: null, constituencies: [], gewogs: [] });
};

exports.postAddEquipment = async (req, res) => {
  const dzongkhag_id = getDzongkhagId(req);
  const currentUser = getUser(req);
  const { equipment_type, serial_number, status } = req.body;
  if (!dzongkhag_id) return res.redirect('/login');
  try {
    const [exists] = await db.query('SELECT id FROM equipment WHERE serial_number = ?', [serial_number]);
    if (exists.length) {
      req.flash('error', 'Serial number already exists.');
      return res.redirect('/dzeo/equipment/add');
    }
    // Always assigned to the officer adding it — never unassigned.
    const [result] = await db.query(
      'INSERT INTO equipment (equipment_type, serial_number, dzongkhag_id, constituency_id, gewog_id, status, current_holder_id, created_by) VALUES (?, ?, ?, NULL, NULL, ?, ?, ?)',
      [equipment_type, serial_number, dzongkhag_id, status, currentUser.id, currentUser.id]
    );
    await db.query('INSERT INTO audit_logs (user_id, action, table_affected, record_id) VALUES (?, ?, ?, ?)',
      [currentUser.id, 'ADD_EQUIPMENT', 'equipment', result.insertId]);
    req.flash('success', 'Equipment added and assigned to you successfully.');
    res.redirect('/dzeo/equipment');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to add equipment.');
    res.redirect('/dzeo/equipment/add');
  }
};

// ─── EQUIPMENT LIST ──────────────────────────────────────────
exports.getEquipment = async (req, res) => {
  const dzongkhag_id = getDzongkhagId(req);
  if (!dzongkhag_id) return res.redirect('/login');
  const { page = 1 } = req.query;
  const limit = 50, offset = (page - 1) * limit;
  // Show ALL equipment for this Dzongkhag regardless of who holds it
  // EXCEPT equipment that has been surrendered (transfer_type='Surrender')
  const whereStr = `e.dzongkhag_id = ? AND e.id NOT IN (
    SELECT equipment_id FROM transfers WHERE transfer_type = 'Surrender'
  )`;
  const params   = [dzongkhag_id];  try {
    const [equipment] = await db.query(
      `SELECT e.*, c.name AS constituency_name, g.name AS gewog_name, u.full_name AS current_holder
       FROM equipment e
       LEFT JOIN constituencies c ON e.constituency_id = c.id
       LEFT JOIN gewogs g ON e.gewog_id = g.id
       LEFT JOIN users u ON e.current_holder_id = u.id
       WHERE ${whereStr} ORDER BY e.equipment_type, e.serial_number LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total FROM equipment e WHERE ${whereStr}`, params);
    res.render('dzeo/equipment', {
      title: 'Equipment Management', equipment,
      pagination: { page: +page, total, limit, pages: Math.ceil(total / limit) },
      query: {}
    });
  } catch (err) { console.error(err); res.redirect('/dzeo/dashboard'); }
};


// ─── EDIT EQUIPMENT ──────────────────────────────────────────
exports.getEditEquipment = async (req, res) => {
  const dzongkhag_id = getDzongkhagId(req);
  try {
    const [rows] = await db.query('SELECT * FROM equipment WHERE id = ? AND dzongkhag_id = ?', [req.params.id, dzongkhag_id]);
    if (!rows.length) return res.redirect('/dzeo/equipment');
    res.render('dzeo/equipment-form', { title: 'Edit Equipment', equipment: rows[0], constituencies: [], gewogs: [] });
  } catch (err) { console.error(err); res.redirect('/dzeo/equipment'); }
};

exports.postEditEquipment = async (req, res) => {
  const { equipment_type, serial_number, status } = req.body;
  const { id } = req.params;
  const dzongkhag_id = getDzongkhagId(req);
  try {
    const [exists] = await db.query('SELECT id FROM equipment WHERE serial_number = ? AND id != ?', [serial_number, id]);
    if (exists.length) { req.flash('error', 'Serial number already exists.'); return res.redirect(`/dzeo/equipment/${id}/edit`); }
    await db.query(
      'UPDATE equipment SET equipment_type=?, serial_number=?, status=? WHERE id=? AND dzongkhag_id=?',
      [equipment_type, serial_number, status, id, dzongkhag_id]
    );
    req.flash('success', 'Equipment updated.');
    res.redirect('/dzeo/equipment');
  } catch (err) { console.error(err); res.redirect(`/dzeo/equipment/${id}/edit`); }
};

// ─── ISSUE TO (was: Transfers) ───────────────────────────────
exports.getIssueTo = async (req, res) => {
  const dzongkhag_id = getDzongkhagId(req);
  try {
    const [issues] = await db.query(
      `SELECT t.*, e.serial_number, e.equipment_type, tu.full_name AS to_user
       FROM transfers t
       JOIN equipment e ON t.equipment_id = e.id
       JOIN users tu ON t.to_user_id = tu.id
       WHERE e.dzongkhag_id = ? AND t.transfer_type = 'Issue'
       ORDER BY t.created_at DESC`, [dzongkhag_id]
    );
    // Equipment still sitting in this Dzongkhag's store, available to
    // issue — same scope as "My Equipment" / the dashboard: held by any
    // active DzEO/DzERO/EA in this Dzongkhag (not just the logged-in
    // officer), and not yet issued out or surrendered.
    const [equipment] = await db.query(
      `SELECT id, serial_number, equipment_type FROM equipment
       WHERE dzongkhag_id = ? AND status = 'Functional'
       AND (current_holder_id IS NULL OR current_holder_id IN (
         SELECT id FROM users WHERE dzongkhag_id = ? AND role IN ('DzEO','DzERO','EA')
       ))
       ORDER BY equipment_type, serial_number`,
      [dzongkhag_id, dzongkhag_id]
    );
    // How many of each equipment type are left in the Dzongkhag store
    // right now — shown as the live "remaining" counter on the issue form.
    const [typeCounts] = await db.query(
      `SELECT equipment_type, COUNT(*) AS available
       FROM equipment
       WHERE dzongkhag_id = ? AND status = 'Functional'
       AND (current_holder_id IS NULL OR current_holder_id IN (
         SELECT id FROM users WHERE dzongkhag_id = ? AND role IN ('DzEO','DzERO','EA')
       ))
       GROUP BY equipment_type`,
      [dzongkhag_id, dzongkhag_id]
    );
    const [constituencies] = await db.query('SELECT * FROM constituencies WHERE dzongkhag_id = ? ORDER BY name', [dzongkhag_id]);
    // DzEO/DzERO/EA only issue down to RO — RO is responsible for issuing
    // further down to a Presiding Officer themselves.
    const [ros] = await db.query(
      "SELECT id, full_name, constituency_id, gewog_id, role FROM users WHERE dzongkhag_id = ? AND role = 'RO' AND is_active = 1 ORDER BY full_name",
      [dzongkhag_id]
    );
    res.render('dzeo/issue-to', { title: 'Issue To', issues, equipment, typeCounts, constituencies, ros });
  } catch (err) { console.error(err); res.redirect('/dzeo/dashboard'); }
};

exports.postIssueTo = async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const user = getUser(req);
    const { to_user_id, constituency_id, remarks } = req.body;
    // Equipment can come in as a single value or an array, depending on
    // how many checkboxes were ticked.
    let equipmentIds = req.body.equipment_ids || req.body.equipment_id;
    if (!equipmentIds) equipmentIds = [];
    if (!Array.isArray(equipmentIds)) equipmentIds = [equipmentIds];
    equipmentIds = equipmentIds.filter(Boolean);

    if (equipmentIds.length === 0) {
      await conn.rollback();
      req.flash('error', 'Please select at least one piece of equipment to issue.');
      return res.redirect('/dzeo/issue-to');
    }

    // DzEO/DzERO/EA can only issue to an RO (not directly to a Presiding
    // Officer — the RO handles that handoff themselves).
    const [[receiver]] = await conn.query(
      "SELECT id, full_name, constituency_id FROM users WHERE id = ? AND role = 'RO' AND is_active = 1",
      [to_user_id]
    );
    if (!receiver) {
      await conn.rollback();
      req.flash('error', 'Please select an active RO to receive this equipment.');
      return res.redirect('/dzeo/issue-to');
    }

    const finalConstId = constituency_id || receiver.constituency_id || null;

    for (const equipmentId of equipmentIds) {
      await conn.query(
        // RO only operates at Constituency level — no Gewog assigned here.
        `INSERT INTO transfers (equipment_id, from_user_id, to_user_id, from_location, to_location,
          transfer_date, transfer_type, status, remarks, created_by)
         VALUES (?, ?, ?, 'Dzongkhag Store', 'Constituency', CURDATE(), 'Issue', 'Pending', ?, ?)`,
        [equipmentId, user.id, receiver.id, remarks || null, user.id]
      );
      await conn.query(
        // Issuing to an RO — no Gewog or Polling Station assigned yet.
        `UPDATE equipment SET current_holder_id = ?, constituency_id = ?, gewog_id = NULL, polling_station_id = NULL WHERE id = ?`,
        [receiver.id, finalConstId, equipmentId]
      );
    }

    await conn.commit();
    req.flash('success', `${equipmentIds.length} equipment item(s) issued to ${receiver.full_name} (RO).`);
    res.redirect('/dzeo/issue-to');
  } catch (err) {
    await conn.rollback();
    console.error(err);
    req.flash('error', 'Failed to issue equipment.');
    res.redirect('/dzeo/issue-to');
  } finally { conn.release(); }
};

// ─── QUARTERLY FUNCTIONALITY CHECK ───────────────────────────
exports.getQuarterlyCheck = async (req, res) => {
  const dzongkhag_id = getDzongkhagId(req);
  if (!dzongkhag_id) return res.redirect('/login');
  const quarterLabel = currentQuarterLabel();
  try {
    const [equipment] = await db.query(
      `SELECT e.*, qc.status AS last_check_status, qc.fault_type AS last_check_fault, qc.remarks AS last_check_remarks
       FROM equipment e
       LEFT JOIN quarterly_checks qc ON qc.equipment_id = e.id AND qc.quarter_label = ?
       WHERE e.dzongkhag_id = ?
         AND e.id NOT IN (SELECT equipment_id FROM transfers WHERE transfer_type = 'Surrender')
       ORDER BY (e.last_checked_quarter = ? OR e.last_checked_quarter IS NULL) DESC, e.serial_number ASC`,
      [quarterLabel, dzongkhag_id, quarterLabel]
    );
    const [history] = await db.query(
      `SELECT qc.*, e.serial_number, e.equipment_type
       FROM quarterly_checks qc JOIN equipment e ON qc.equipment_id = e.id
       WHERE qc.dzongkhag_id = ? ORDER BY qc.checked_at DESC LIMIT 50`,
      [dzongkhag_id]
    );
    res.render('dzeo/quarterly-check', {
      title: 'Quarterly Equipment Check',
      equipment: equipment || [],
      history: history || [],
      quarterLabel,
      faultTypes: FAULT_TYPES
    });
  } catch (err) { console.error(err); req.flash('error', 'Failed to load quarterly check.'); res.redirect('/dzeo/dashboard'); }
};

exports.postQuarterlyCheck = async (req, res) => {
  const dzongkhag_id = getDzongkhagId(req);
  const userId = getUserId(req);
  const { equipment_id, status, fault_type, remarks } = req.body;
  const quarterLabel = currentQuarterLabel();
  const finalFault = (status === 'Non-Functional' && fault_type) ? fault_type : null;
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    // Make sure the equipment belongs to this DzEO's Dzongkhag
    const [[eq]] = await conn.query('SELECT id FROM equipment WHERE id = ? AND dzongkhag_id = ?', [equipment_id, dzongkhag_id]);
    if (!eq) { await conn.rollback(); req.flash('error', 'Equipment not found in your Dzongkhag.'); return res.redirect('/dzeo/quarterly-check'); }

    await conn.query(
      `INSERT INTO quarterly_checks (equipment_id, dzongkhag_id, quarter_label, status, fault_type, remarks, checked_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE status = VALUES(status), fault_type = VALUES(fault_type),
         remarks = VALUES(remarks), checked_by = VALUES(checked_by), checked_at = NOW()`,
      [equipment_id, dzongkhag_id, quarterLabel, status, finalFault, remarks || null, userId]
    );
    await conn.query(
      `UPDATE equipment SET status = ?, last_checked_at = NOW(), last_checked_quarter = ? WHERE id = ?`,
      [status, quarterLabel, equipment_id]
    );
    await conn.commit();
    req.flash('success', `Functionality status recorded for ${quarterLabel}.`);
    res.redirect('/dzeo/quarterly-check');
  } catch (err) {
    await conn.rollback();
    console.error(err);
    req.flash('error', 'Failed to record quarterly check.');
    res.redirect('/dzeo/quarterly-check');
  } finally { conn.release(); }
};

// ─── SURRENDER EQUIPMENT (DzEO → Admin) ──────────────────────
exports.getSurrender = async (req, res) => {
  const dzongkhag_id = getDzongkhagId(req);
  if (!dzongkhag_id) return res.redirect('/login');
  try {
    const [equipment] = await db.query(
      `SELECT id, serial_number, equipment_type, status FROM equipment
       WHERE dzongkhag_id = ?
         AND (current_holder_id IS NULL OR current_holder_id IN (
           SELECT id FROM users WHERE dzongkhag_id = ? AND role IN ('DzEO','DzERO','EA')
         ))
         AND id NOT IN (SELECT equipment_id FROM transfers WHERE transfer_type = 'Surrender')
       ORDER BY serial_number`,
      [dzongkhag_id, dzongkhag_id]
    );

    // Group CU and BU with the same serial-number suffix into pairs.
    // e.g. CU-2232 and BU-2232 → same group key "2232"
    const pairMap = {};
    equipment.forEach(eq => {
      const suffix = eq.serial_number.replace(/^(CU|BU|BT)-?/i, '').trim();
      const type   = eq.equipment_type;
      if (!pairMap[suffix]) pairMap[suffix] = { suffix, items: [] };
      pairMap[suffix].items.push(eq);
    });
    const pairs = Object.values(pairMap);

    const userId = getUserId(req);
    const [history] = await db.query(
      `SELECT t.id, t.transfer_date, t.start_date, t.surrender_date, t.status, t.remarks, t.fault_type, t.updated_at,
              e.serial_number, e.equipment_type
       FROM transfers t JOIN equipment e ON t.equipment_id = e.id
       WHERE t.from_user_id = ? AND t.transfer_type = 'Surrender'
       ORDER BY t.created_at DESC`,
      [userId]
    );
    res.render('dzeo/surrender', { title: 'Surrender Equipment', equipment, pairs, history: history || [], faultTypes: FAULT_TYPES });
  } catch (err) { console.error(err); res.redirect('/dzeo/dashboard'); }
};

exports.postSurrender = async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const currentUser = getUser(req);
    const { condition_status, fault_type, remarks, start_date, surrender_date } = req.body;

    // Accept single or multiple equipment IDs — paired CU+BU come as an array.
    let equipment_ids = req.body.equipment_ids || req.body.equipment_id;
    if (!equipment_ids) equipment_ids = [];
    if (!Array.isArray(equipment_ids)) equipment_ids = [equipment_ids];
    equipment_ids = equipment_ids.filter(Boolean);

    if (equipment_ids.length === 0) {
      await conn.rollback();
      req.flash('error', 'Please select equipment to surrender.');
      return res.redirect('/dzeo/surrender');
    }
    if (!start_date || !surrender_date) {
      await conn.rollback();
      req.flash('error', 'Date Added to Inventory and Surrender Date are both required.');
      return res.redirect('/dzeo/surrender');
    }

    // Validate CU/BU pairing: if the selection contains a Control Unit,
    // its matching Ballot Unit must also be selected, and vice versa.
    const [selectedEq] = await conn.query(
      `SELECT id, serial_number, equipment_type FROM equipment WHERE id IN (${equipment_ids.map(() => '?').join(',')})`,
      equipment_ids
    );
    for (const eq of selectedEq) {
      const suffix = eq.serial_number.replace(/^(CU|BU)-?/i, '').trim();
      const isCU = /^CU/i.test(eq.serial_number);
      const isBU = /^BU/i.test(eq.serial_number);
      if (isCU || isBU) {
        const partnerPrefix = isCU ? 'BU' : 'CU';
        // Check if the partner exists in the Dzongkhag store at all
        const [[partner]] = await conn.query(
          `SELECT id, serial_number FROM equipment
           WHERE serial_number REGEXP ? AND dzongkhag_id = ?
             AND (current_holder_id IS NULL OR current_holder_id IN (
               SELECT id FROM users WHERE dzongkhag_id = ? AND role IN ('DzEO','DzERO','EA')
             ))`,
          [`^${partnerPrefix}[-]?${suffix}$`, currentUser.dzongkhag_id, currentUser.dzongkhag_id]
        );
        if (partner && !equipment_ids.includes(String(partner.id))) {
          await conn.rollback();
          req.flash('error', `${eq.serial_number} and ${partner.serial_number} are paired — both Control Unit and Ballot Unit must be surrendered together. Please also select ${partner.serial_number}.`);
          return res.redirect('/dzeo/surrender');
        }
      }
    }

    const [[admin]] = await conn.query(
      "SELECT id FROM users WHERE role = 'Admin' AND is_active = 1 ORDER BY id LIMIT 1"
    );
    if (!admin) {
      await conn.rollback();
      req.flash('error', 'No active Admin account found to receive the surrender.');
      return res.redirect('/dzeo/surrender');
    }

    const finalFault = (condition_status === 'Non-Functional' && fault_type) ? fault_type : null;
    for (const equipment_id of equipment_ids) {
      await conn.query(
        `INSERT INTO transfers (equipment_id, from_user_id, to_user_id, from_location, to_location,
          transfer_date, start_date, surrender_date, transfer_type, status, fault_type, remarks, created_by)
         VALUES (?, ?, ?, 'Dzongkhag Store', 'Election Commission HQ', CURDATE(), ?, ?, 'Surrender', 'Returning', ?, ?, ?)`,
        [equipment_id, currentUser.id, admin.id, start_date, surrender_date, finalFault, remarks || null, currentUser.id]
      );
      if (condition_status === 'Non-Functional') {
        await conn.query("UPDATE equipment SET status = 'Non-Functional' WHERE id = ?", [equipment_id]);
      }
    }
    await conn.commit();
    req.flash('success', `${equipment_ids.length} equipment item(s) surrendered. Awaiting confirmation from Admin.`);
    res.redirect('/dzeo/surrender');
  } catch (err) {
    await conn.rollback();
    console.error(err);
    req.flash('error', 'Failed to surrender equipment.');
    res.redirect('/dzeo/surrender');
  } finally { conn.release(); }
};

// ─── POLLING STATIONS (DzEO/DzERO/EA — own Dzongkhag only) ───
// Hierarchy: Dzongkhag > Constituency > Gewog > Polling Station.
// The Dzongkhag is always the officer's own; Constituency/Gewog must
// belong to that Dzongkhag.
exports.getPollingStations = async (req, res) => {
  const dzongkhag_id = getDzongkhagId(req);
  if (!dzongkhag_id) return res.redirect('/login');
  try {
    const [stations] = await db.query(
      `SELECT ps.*, c.name AS constituency_name, g.name AS gewog_name, u.full_name AS created_by_name
       FROM polling_stations ps
       LEFT JOIN constituencies c ON ps.constituency_id = c.id
       LEFT JOIN gewogs g ON ps.gewog_id = g.id
       LEFT JOIN users u ON ps.created_by = u.id
       WHERE ps.dzongkhag_id = ?
       ORDER BY c.name, g.name, ps.name`,
      [dzongkhag_id]
    );    const [constituencies] = await db.query(
      'SELECT * FROM constituencies WHERE dzongkhag_id = ? ORDER BY name', [dzongkhag_id]
    );
    res.render('dzeo/polling-stations', {
      title: 'Polling Stations',
      stations: stations || [],
      constituencies: constituencies || []
    });
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to load polling stations.');
    res.redirect('/dzeo/dashboard');
  }
};

exports.postAddPollingStation = async (req, res) => {
  const dzongkhag_id = getDzongkhagId(req);
  const userId = getUserId(req);
  const { name, presiding_name, constituency_id, gewog_id } = req.body;
  if (!dzongkhag_id) return res.redirect('/login');
  try {
    const [[c]] = await db.query('SELECT id FROM constituencies WHERE id = ? AND dzongkhag_id = ?', [constituency_id, dzongkhag_id]);
    if (!c) { req.flash('error', 'That Constituency does not belong to your Dzongkhag.'); return res.redirect('/dzeo/polling-stations'); }
    const [[g]] = await db.query('SELECT id FROM gewogs WHERE id = ? AND constituency_id = ?', [gewog_id, constituency_id]);
    if (!g) { req.flash('error', 'That Gewog does not belong to the selected Constituency.'); return res.redirect('/dzeo/polling-stations'); }

    await db.query(
      'INSERT INTO polling_stations (name, presiding_name, dzongkhag_id, constituency_id, gewog_id, created_by) VALUES (?, ?, ?, ?, ?, ?)',
      [name, presiding_name || null, dzongkhag_id, constituency_id, gewog_id, userId]
    );
    req.flash('success', `Polling station "${name}" added.`);
    res.redirect('/dzeo/polling-stations');
  } catch (err) {
    console.error(err);
    if (err.code === 'ER_DUP_ENTRY') req.flash('error', 'A polling station with that name already exists in this Gewog.');
    else req.flash('error', 'Failed to add polling station.');
    res.redirect('/dzeo/polling-stations');
  }
};