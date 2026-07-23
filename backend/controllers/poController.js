const db = require('../config/database');
const { FAULT_TYPES } = require('../utils/constants');

const getUser = (req) => req.session?.user || req.user;

// ─── DASHBOARD ───────────────────────────────────────────────
async function getDashboard(req, res) {
  try {
    const currentUser = getUser(req);
    if (!currentUser) return res.redirect('/login');
    const poUserId = currentUser.id;

    const [[summary]] = await db.query(`
      SELECT
        SUM(CASE WHEN status = 'Functional' THEN 1 ELSE 0 END) AS functional_count,
        SUM(CASE WHEN status = 'Non-Functional' THEN 1 ELSE 0 END) AS non_functional_count
      FROM equipment WHERE current_holder_id = ?`, [poUserId]);

    const [[{ returned_count }]] = await db.query(
      `SELECT COUNT(*) AS returned_count FROM transfers WHERE from_user_id = ? AND status = 'Returned' AND transfer_type = 'Return'`,
      [poUserId]
    );

    // Incoming equipment issued to this PO by its RO — awaiting acceptance
    const [incomingTransfers] = await db.query(`
      SELECT t.id AS transfer_id, t.remarks, t.created_at,
             e.serial_number, e.equipment_type, fu.full_name AS from_user
      FROM transfers t JOIN equipment e ON t.equipment_id = e.id
      LEFT JOIN users fu ON t.from_user_id = fu.id
      WHERE t.to_user_id = ? AND t.status = 'Pending' AND t.transfer_type = 'Issue'
      ORDER BY t.created_at DESC`, [poUserId]);

    const functional = summary?.functional_count || 0;
    const non_functional = summary?.non_functional_count || 0;

    res.render('po/dashboard', {
      title: 'Dashboard',
      summary: {
        equipment_received: functional + non_functional,
        functional, non_functional,
        returned: returned_count || 0,
        pending_transfers: incomingTransfers.length
      },
      incomingTransfers
    });
  } catch (err) {
    console.error(err);
    res.status(500).render('error', {
      code: 500,
      title: 'Dashboard Error',
      message: 'Failed to load dashboard. This usually means the database schema is out of date — make sure database/migration_v4.sql has been run. Check the server console for the exact SQL error.'
    });
  }
}

// ─── MY EQUIPMENT ────────────────────────────────────────────
async function getMyEquipment(req, res) {
  try {
    const currentUser = getUser(req);
    if (!currentUser) return res.redirect('/login');
    const [equipment] = await db.query(`
      SELECT e.*, d.name AS dzongkhag_name, c.name AS constituency_name, g.name AS gewog_name
      FROM equipment e
      LEFT JOIN dzongkhags d ON e.dzongkhag_id = d.id
      LEFT JOIN constituencies c ON e.constituency_id = c.id
      LEFT JOIN gewogs g ON e.gewog_id = g.id
      WHERE e.current_holder_id = ?`, [currentUser.id]);
    const [pendingTransfers] = await db.query(`
      SELECT t.id AS transfer_id, t.transfer_date, t.remarks, e.serial_number, e.equipment_type, fu.full_name AS from_user
      FROM transfers t JOIN equipment e ON t.equipment_id = e.id
      LEFT JOIN users fu ON t.from_user_id = fu.id
      WHERE t.to_user_id = ? AND t.status = 'Pending'`, [currentUser.id]);
    res.render('po/equipment', {
      title: 'My Equipment', equipment: equipment || [],
      pendingTransfers: pendingTransfers || [],
      query: req.query || {},
      pagination: { page: 1, limit: 100, total: equipment.length, pages: 1 }
    });
  } catch (err) { console.error(err); res.redirect('/po/dashboard'); }
}

// ─── ACCEPT TRANSFER (equipment issued by the RO) ────────────
async function postAcceptTransfer(req, res) {
  const conn = await db.getConnection();
  try {
    const currentUser = getUser(req);
    if (!currentUser) return res.redirect('/login');
    const { id } = req.params;
    await conn.beginTransaction();
    const [result] = await conn.query(
      "UPDATE transfers SET status = 'Received' WHERE id = ? AND to_user_id = ? AND status = 'Pending'",
      [id, currentUser.id]
    );
    if (result.affectedRows === 0) {
      await conn.rollback();
      req.flash('error', 'Transfer not found or already accepted.');
      return res.redirect('/po/dashboard');
    }
    const [[t]] = await conn.query("SELECT equipment_id FROM transfers WHERE id = ?", [id]);
    if (t) {
      await conn.query(
        "UPDATE equipment SET current_holder_id = ?, status = 'Functional' WHERE id = ?",
        [currentUser.id, t.equipment_id]
      );
    }
    await conn.commit();
    req.flash('success', 'Equipment accepted into your inventory.');
    res.redirect('/po/dashboard');
  } catch (err) {
    await conn.rollback();
    console.error(err);
    req.flash('error', 'Failed to accept equipment.');
    res.redirect('/po/dashboard');
  } finally { conn.release(); }
}

// ─── GET RETURN PAGE ─────────────────────────────────────────
async function getReturn(req, res) {
  try {
    const currentUser = getUser(req);
    if (!currentUser) return res.redirect('/login');
    const [equipment] = await db.query(
      "SELECT id, serial_number, equipment_type, status FROM equipment WHERE current_holder_id = ?",
      [currentUser.id]
    );
    const [returnHistory] = await db.query(`
      SELECT t.id, t.transfer_date, t.status, t.remarks, t.fault_type,
             e.serial_number, e.equipment_type, t.updated_at
      FROM transfers t JOIN equipment e ON t.equipment_id = e.id
      WHERE t.from_user_id = ? AND t.transfer_type = 'Return'
      ORDER BY t.created_at DESC`, [currentUser.id]);
    res.render('po/return', {
      title: 'Return Equipment',
      equipment: equipment || [],
      returnHistory: returnHistory || [],
      faultTypes: FAULT_TYPES
    });
  } catch (err) { console.error(err); res.redirect('/po/dashboard'); }
}

// ─── POST RETURN — Presiding Officer returns equipment to its RO ────
// Falls back to the Dzongkhag office (DzEO/DzERO/EA) only if no active
// RO is on record for this Constituency.
async function postReturn(req, res) {
  try {
    const currentUser = getUser(req);
    const { equipment_id, condition_status, fault_type, remarks } = req.body;

    let [[recipient]] = await db.query(
      "SELECT id FROM users WHERE constituency_id = ? AND role = 'RO' AND is_active = 1 LIMIT 1",
      [currentUser.constituency_id]
    );
    if (!recipient) {
      [[recipient]] = await db.query(
        "SELECT id FROM users WHERE dzongkhag_id = ? AND role IN ('DzEO','DzERO','EA') AND is_active = 1 LIMIT 1",
        [currentUser.dzongkhag_id]
      );
    }
    if (!recipient) {
      req.flash('error', 'No active RO (or DzEO/DzERO/EA) found to receive this return.');
      return res.redirect('/po/return');
    }
    // Only set fault_type if Non-Functional
    const finalFault = (condition_status === 'Non-Functional' && fault_type) ? fault_type : null;
    await db.query(
      `INSERT INTO transfers (equipment_id, from_user_id, to_user_id, from_location, to_location,
        transfer_date, transfer_type, status, fault_type, remarks, created_by)
       VALUES (?, ?, ?, 'Polling Station', 'Constituency', CURDATE(), 'Return', 'Returning', ?, ?, ?)`,
      [equipment_id, currentUser.id, recipient.id, finalFault, remarks || null, currentUser.id]
    );
    // Immediately flag as Non-Functional if fault reported
    if (condition_status === 'Non-Functional') {
      await db.query("UPDATE equipment SET status = 'Non-Functional' WHERE id = ?", [equipment_id]);
    }
    req.flash('success', 'Return request submitted. Awaiting confirmation.');
    res.redirect('/po/dashboard');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to submit return.');
    res.redirect('/po/return');
  }
}

module.exports = { getDashboard, getMyEquipment, postAcceptTransfer, getReturn, postReturn };
