console.log("NEW roController loaded - v2");
const db = require('../config/database');
const path = require('path');
const fs   = require('fs');
const { FAULT_TYPES } = require('../utils/constants');
const { generateIssueForm, generateReturnForm } = require('../utils/formGenerator');

const getUser = (req) => req.session?.user || req.user;

// Ensure uploads directory exists
const UPLOADS_DIR = path.join(__dirname, '../../uploads/forms');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// ─── DASHBOARD (RO only — Presiding Officer has its own dashboard) ──
async function getDashboard(req, res) {
  try {
    const currentUser = getUser(req);
    if (!currentUser) return res.redirect('/login');
    const roUserId = currentUser.id;

    // "In RO's possession" = assigned to this RO AND not yet issued to a
    // Polling Station. Once equipment is issued to a PS (polling_station_id
    // is set), it leaves the RO's live inventory count even though
    // current_holder_id still points to the RO.
    const [[summary]] = await db.query(`
      SELECT
        SUM(CASE WHEN status = 'Functional'     THEN 1 ELSE 0 END) AS functional_count,
        SUM(CASE WHEN status = 'Non-Functional' THEN 1 ELSE 0 END) AS non_functional_count
      FROM equipment
      WHERE current_holder_id = ?
        AND (polling_station_id IS NULL OR polling_station_id = 0)`, [roUserId]);

    // Historical: how many times this RO has returned equipment to DzEO
    const [[{ returned_count }]] = await db.query(
      `SELECT COUNT(*) AS returned_count FROM transfers WHERE from_user_id = ? AND status = 'Returned' AND transfer_type = 'Return'`,
      [roUserId]
    );
    // Live: equipment currently sitting at a Polling Station (issued by this RO)
    const [[{ issued_to_ps }]] = await db.query(
      `SELECT COUNT(*) AS issued_to_ps FROM equipment
       WHERE current_holder_id = ? AND polling_station_id IS NOT NULL AND polling_station_id != 0`,
      [roUserId]
    );
    // Incoming: DzEO/DzERO/EA has issued to this RO, awaiting acceptance
    const [incomingTransfers] = await db.query(`
      SELECT t.id AS transfer_id, t.remarks, t.created_at,
             e.serial_number, e.equipment_type, fu.full_name AS from_user
      FROM transfers t JOIN equipment e ON t.equipment_id = e.id
      LEFT JOIN users fu ON t.from_user_id = fu.id
      WHERE t.to_user_id = ? AND t.status = 'Pending' AND t.transfer_type = 'Issue'
      ORDER BY t.created_at DESC`, [roUserId]);

    // Equipment being returned to this RO from a Polling Station
    const [pendingReturnsFromPO] = await db.query(`
      SELECT t.id AS transfer_id, t.remarks, t.fault_type, t.created_at,
             e.serial_number, e.equipment_type, fu.full_name AS from_user
      FROM transfers t JOIN equipment e ON t.equipment_id = e.id
      LEFT JOIN users fu ON t.from_user_id = fu.id
      WHERE t.to_user_id = ? AND t.status = 'Returning' AND t.transfer_type = 'Return'
      ORDER BY t.created_at DESC`, [roUserId]);

    const functional     = Number(summary?.functional_count)     || 0;
    const non_functional = Number(summary?.non_functional_count) || 0;

    console.log('[RO Dashboard Debug]', {
      roUserId,
      functional_count: summary?.functional_count,
      non_functional_count: summary?.non_functional_count,
      functional,
      non_functional,
      equipment_received: functional + non_functional
    });

    res.render('ro/dashboard', {
      title: 'Dashboard',
      summary: {
        equipment_received: functional + non_functional,
        functional, non_functional,
        returned: returned_count || 0,
        issued_to_ps: issued_to_ps || 0,
        pending_transfers: incomingTransfers.length
      },
      incomingTransfers,
      pendingReturnsFromPO
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
    const { search } = req.query;

    let where = 'e.current_holder_id = ? AND e.polling_station_id IS NULL';
    const params = [currentUser.id];
    if (search && search.trim()) {
      where += ' AND e.serial_number LIKE ?';
      params.push(`%${search.trim()}%`);
    }

    const [equipment] = await db.query(`
      SELECT e.*, d.name AS dzongkhag_name, c.name AS constituency_name, g.name AS gewog_name
      FROM equipment e
      LEFT JOIN dzongkhags d ON e.dzongkhag_id = d.id
      LEFT JOIN constituencies c ON e.constituency_id = c.id
      LEFT JOIN gewogs g ON e.gewog_id = g.id
      WHERE ${where}`, params);
    const [pendingTransfers] = await db.query(`
      SELECT t.id AS transfer_id, t.transfer_date, t.remarks, e.serial_number, e.equipment_type, fu.full_name AS from_user
      FROM transfers t JOIN equipment e ON t.equipment_id = e.id
      LEFT JOIN users fu ON t.from_user_id = fu.id
      WHERE t.to_user_id = ? AND t.status = 'Pending'`, [currentUser.id]);
    res.render('ro/equipment', {
      title: 'My Equipment', equipment: equipment || [],
      pendingTransfers: pendingTransfers || [],
      query: req.query || {},
      pagination: { page: 1, limit: 100, total: equipment.length, pages: 1 }
    });
  } catch (err) { console.error(err); res.redirect('/ro/dashboard'); }
}

// ─── ACCEPT TRANSFER ─────────────────────────────────────────
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
      return res.redirect('/ro/dashboard');
    }
    const [[t]] = await conn.query("SELECT equipment_id FROM transfers WHERE id = ?", [id]);
    if (t) {
      await conn.query(
        "UPDATE equipment SET current_holder_id = ?, polling_station_id = NULL, status = 'Functional' WHERE id = ?",
        [currentUser.id, t.equipment_id]
      );
    }
    await conn.commit();
    req.flash('success', 'Equipment accepted into your inventory.');
    res.redirect('/ro/dashboard');
  } catch (err) {
    await conn.rollback();
    console.error(err);
    req.flash('error', 'Failed to accept equipment.');
    res.redirect('/ro/dashboard');
  } finally { conn.release(); }
}

// ─── GET RETURN PAGE ─────────────────────────────────────────
async function getReturn(req, res) {
  try {
    const currentUser = getUser(req);
    if (!currentUser) return res.redirect('/login');
    const [equipment] = await db.query(
      "SELECT id, serial_number, equipment_type, status FROM equipment WHERE current_holder_id = ? AND polling_station_id IS NULL",
      [currentUser.id]
    );
    const [returnHistory] = await db.query(`
      SELECT t.id, t.transfer_date, t.status, t.remarks, t.fault_type, t.updated_at,
             e.serial_number, e.equipment_type,
             (SELECT COUNT(*) FROM transfer_forms tf WHERE tf.transfer_id = t.id AND tf.form_type = 'return') AS form_uploaded
      FROM transfers t JOIN equipment e ON t.equipment_id = e.id
      WHERE t.from_user_id = ? AND t.transfer_type = 'Return'
      ORDER BY t.created_at DESC`, [currentUser.id]);
    res.render('ro/return', {
      title: 'Return Equipment',
      equipment: equipment || [],
      returnHistory: returnHistory || [],
      faultTypes: FAULT_TYPES
    });
  } catch (err) { console.error(err); res.redirect('/ro/dashboard'); }
}

// ─── POST RETURN — RO returns equipment to its Dzongkhag office ─────
// (DzEO, or DzERO/EA acting on the DzEO's behalf)
async function postReturn(req, res) {
  try {
    const currentUser = getUser(req);
    const { equipment_id, condition_status, fault_type, remarks } = req.body;

    const [[recipient]] = await db.query(
      "SELECT id FROM users WHERE dzongkhag_id = ? AND role IN ('DzEO','DzERO','EA') AND is_active = 1 LIMIT 1",
      [currentUser.dzongkhag_id]
    );

    if (!recipient) {
      req.flash('error', 'No active DzEO / DzERO / EA officer found in your Dzongkhag to receive this return.');
      return res.redirect('/ro/return');
    }
    // Only set fault_type if Non-Functional
    const finalFault = (condition_status === 'Non-Functional' && fault_type) ? fault_type : null;
    await db.query(
      `INSERT INTO transfers (equipment_id, from_user_id, to_user_id, from_location, to_location,
        transfer_date, transfer_type, status, fault_type, remarks, created_by)
       VALUES (?, ?, ?, 'Constituency', 'Dzongkhag Store', CURDATE(), 'Return', 'Returning', ?, ?, ?)`,
      [equipment_id, currentUser.id, recipient.id, finalFault, remarks || null, currentUser.id]
    );
    // Clear holder and update status — equipment is now being returned to DzEO
    // current_holder_id = recipient so it appears in DzEO inventory immediately
    await db.query(
      `UPDATE equipment SET current_holder_id = ?, status = ?, polling_station_id = NULL WHERE id = ?`,
      [recipient.id, condition_status === 'Non-Functional' ? 'Non-Functional' : 'Functional', equipment_id]
    );
    req.flash('success', 'Return request submitted. Awaiting confirmation.');
    res.redirect('/ro/dashboard');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Failed to submit return.');
    res.redirect('/ro/return');
  }
}

// ─── RO CONFIRMS RECEIPT OF EQUIPMENT RETURNED BY A PO ───────
async function postReceiveReturn(req, res) {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const currentUser = getUser(req);
    const { id } = req.params;
    const [[transfer]] = await conn.query(
      "SELECT equipment_id, fault_type FROM transfers WHERE id = ? AND to_user_id = ? AND status = 'Returning'",
      [id, currentUser.id]
    );
    if (!transfer) {
      await conn.rollback();
      req.flash('error', 'Pending return not found.');
      return res.redirect('/ro/dashboard');
    }
    await conn.query("UPDATE transfers SET status = 'Returned', updated_at = NOW() WHERE id = ?", [id]);
    const newStatus = transfer.fault_type ? 'Non-Functional' : 'Functional';
    await conn.query(
      "UPDATE equipment SET current_holder_id = ?, polling_station_id = NULL, status = ? WHERE id = ?",
      [currentUser.id, newStatus, transfer.equipment_id]
    );
    await conn.commit();
    req.flash('success', 'Equipment received from Presiding Officer into your inventory.');
    res.redirect('/ro/dashboard');
  } catch (err) {
    await conn.rollback();
    console.error(err);
    req.flash('error', 'Failed to process return.');
    res.redirect('/ro/dashboard');
  } finally { conn.release(); }
}

module.exports = { getDashboard, getMyEquipment, postAcceptTransfer, getReturn, postReturn, postReceiveReturn, getIssueToPO, postIssueToPO, downloadIssueForm, downloadReturnForm, downloadReceiveBackForm, postUploadForm, postConfirmReceiveBack, getFormsList, getEditEquipment, postEditEquipment, deleteEquipment };

// ─── RO ISSUES EQUIPMENT TO A PRESIDING OFFICER ──────────────
// Each Presiding Officer is attached to exactly one Polling Station,
// within the RO's own Constituency.
async function getIssueToPO(req, res) {
  try {
    const currentUser = getUser(req);
    if (!currentUser) return res.redirect('/login');

    // Group issues by DATE + polling station so one Form/Upload covers all
    // equipment issued together on the same day to the same station
    const [issueGroups] = await db.query(
      `SELECT DATE_FORMAT(t.transfer_date, '%Y-%m-%d') AS issue_date,
              ANY_VALUE(COALESCE(ps.name, t.to_location, '—')) AS polling_station_name,
              ANY_VALUE(ps.id)     AS station_id,
              ANY_VALUE(t.status)  AS status,
              GROUP_CONCAT(e.serial_number ORDER BY e.equipment_type SEPARATOR ', ') AS serials,
              GROUP_CONCAT(e.equipment_type ORDER BY e.equipment_type SEPARATOR ', ') AS types,
              COUNT(*)             AS item_count,
              MIN(t.id)            AS sample_transfer_id,
              MAX(CASE WHEN EXISTS(
                SELECT 1 FROM transfer_forms tf
                WHERE tf.transfer_id = t.id AND tf.form_type = 'issue'
              ) THEN 1 ELSE 0 END) AS form_uploaded
       FROM transfers t
       JOIN equipment e ON t.equipment_id = e.id
       LEFT JOIN polling_stations ps ON e.polling_station_id = ps.id
       WHERE t.from_user_id = ? AND t.transfer_type = 'Issue'
       GROUP BY DATE_FORMAT(t.transfer_date, '%Y-%m-%d'), COALESCE(ps.name, t.to_location)
       ORDER BY issue_date DESC, polling_station_name`,
      [currentUser.id]
    );

    // Equipment currently at a Polling Station — use DISTINCT on equipment
    // to avoid duplicates when the same item has multiple transfer records
    const [atPollingStations] = await db.query(
      `SELECT e.id AS equipment_id, e.serial_number, e.equipment_type, e.status,
              ps.id AS station_id, ps.name AS station_name, ps.presiding_name,
              t.id AS transfer_id, t.transfer_date
       FROM equipment e
       JOIN polling_stations ps ON e.polling_station_id = ps.id
       LEFT JOIN transfers t ON t.id = (
         SELECT id FROM transfers
         WHERE equipment_id = e.id
           AND from_user_id = ?
           AND transfer_type = 'Issue'
         ORDER BY id DESC LIMIT 1
       )
       WHERE e.current_holder_id = ? AND e.polling_station_id IS NOT NULL
       ORDER BY ps.name, e.serial_number`,
      [currentUser.id, currentUser.id]
    );

    // Receive-back records: transfers of type 'Return' created when RO
    // receives equipment back from a PS.
    const [receivedBack] = await db.query(
      `SELECT DATE(t.transfer_date) AS receive_date,
              ANY_VALUE(t.from_location) AS station_name,
              GROUP_CONCAT(e.serial_number ORDER BY e.equipment_type SEPARATOR ', ') AS serials,
              GROUP_CONCAT(e.equipment_type ORDER BY e.equipment_type SEPARATOR ', ') AS types,
              COUNT(*) AS item_count,
              MIN(t.id) AS sample_transfer_id,
              MAX(CASE WHEN EXISTS(
                SELECT 1 FROM transfer_forms tf
                WHERE tf.transfer_id = t.id AND tf.form_type = 'receive_back'
              ) THEN 1 ELSE 0 END) AS form_uploaded
       FROM transfers t JOIN equipment e ON t.equipment_id = e.id
       WHERE t.to_user_id = ? AND t.transfer_type = 'ReceiveBack'
         AND e.id NOT IN (
           SELECT equipment_id FROM transfers
           WHERE transfer_type = 'Return' AND from_user_id = ?
         )
       GROUP BY DATE(t.transfer_date), t.from_location
       ORDER BY receive_date DESC, station_name`, [currentUser.id, currentUser.id]
    );

    // Equipment this RO currently holds (for issuing)
    const [equipment] = await db.query(
      `SELECT id, serial_number, equipment_type FROM equipment
       WHERE current_holder_id = ? AND status = 'Functional' AND polling_station_id IS NULL
       ORDER BY equipment_type, serial_number`,
      [currentUser.id]
    );
    // Load polling stations — use constituency_id if set, else fall back to dzongkhag
    const [stations] = await db.query(
      `SELECT ps.id, ps.name, ps.presiding_name, ps.gewog_id, g.name AS gewog_name
       FROM polling_stations ps
       LEFT JOIN gewogs g ON ps.gewog_id = g.id
       WHERE ps.constituency_id = ?
          OR (? IS NULL AND ps.dzongkhag_id = ?)
       ORDER BY ps.name`,
      [currentUser.constituency_id, currentUser.constituency_id, currentUser.dzongkhag_id]
    );

    res.render('ro/issue-to', { title: 'Issue To Polling Station', issueGroups, equipment, stations, atPollingStations, receivedBack });
  } catch (err) { console.error(err); res.redirect('/ro/dashboard'); }
}

async function postIssueToPO(req, res) {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const currentUser = getUser(req);
    const { polling_station_id, remarks } = req.body;

    // Accept single or multiple equipment IDs from the checkboxes
    let equipmentIds = req.body.equipment_ids || req.body.equipment_id;
    if (!equipmentIds) equipmentIds = [];
    if (!Array.isArray(equipmentIds)) equipmentIds = [equipmentIds];
    equipmentIds = equipmentIds.filter(Boolean);

    if (equipmentIds.length === 0) {
      await conn.rollback();
      req.flash('error', 'Please select at least one piece of equipment to issue.');
      return res.redirect('/ro/issue-to');
    }

    const [[station]] = await conn.query(
      `SELECT ps.id, ps.name, ps.gewog_id, ps.constituency_id
       FROM polling_stations ps
       WHERE ps.id = ?`,
      [polling_station_id]
    );
    if (!station) {
      await conn.rollback();
      req.flash('error', 'Selected Polling Station not found. Please refresh and try again.');
      return res.redirect('/ro/issue-to');
    }

    let issued = 0;
    for (const equipment_id of equipmentIds) {
      const [[eq]] = await conn.query(
        'SELECT id FROM equipment WHERE id = ? AND current_holder_id = ?', [equipment_id, currentUser.id]
      );
      if (!eq) continue;

      await conn.query(
        `INSERT INTO transfers (equipment_id, from_user_id, to_user_id, from_location, to_location,
          transfer_date, transfer_type, gewog_id, status, remarks, created_by)
         VALUES (?, ?, ?, 'Constituency', ?, CURDATE(), 'Issue', ?, 'Received', ?, ?)`,
        [equipment_id, currentUser.id, currentUser.id, station.name,
         station.gewog_id || null, remarks || null, currentUser.id]
      );
      await conn.query(
        `UPDATE equipment SET gewog_id = ?, polling_station_id = ? WHERE id = ?`,
        [station.gewog_id || null, station.id, equipment_id]
      );
      issued++;
    }

    await conn.commit();
    req.flash('success', `${issued} equipment item(s) issued to ${station.name}.`);
    res.redirect('/ro/issue-to');
  } catch (err) {
    await conn.rollback();
    console.error('[postIssueToPO]', err.message);
    req.flash('error', 'Failed to issue equipment: ' + err.message);
    res.redirect('/ro/issue-to');
  } finally { conn.release(); }
}

// ─── DOWNLOAD ISSUE FORM (grouped by date + station) ────────
async function downloadIssueForm(req, res) {
  try {
    const currentUser = getUser(req);
    const { issue_date, station_name } = req.query;
    const { id } = req.params; // single transfer id fallback

    let equipment;
    let stationName;
    let transferDate;

    if (issue_date) {
      [equipment] = await db.query(
        `SELECT e.serial_number, e.equipment_type, e.status,
                MAX(t.to_location) AS station_name
         FROM transfers t
         JOIN equipment e ON t.equipment_id = e.id
         WHERE DATE_FORMAT(t.transfer_date, '%Y-%m-%d') = ?
           AND t.transfer_type = 'Issue'
         GROUP BY e.id, e.serial_number, e.equipment_type, e.status
         ORDER BY e.equipment_type, e.serial_number`,
        [issue_date]
      );
      stationName  = decodeURIComponent(station_name || '') || equipment[0]?.station_name || '—';
      transferDate = issue_date;
    } else {
      // Fallback: single transfer
      const [[t]] = await db.query(
        `SELECT t.*, e.serial_number, e.equipment_type, e.status, ps.name AS ps_name
         FROM transfers t JOIN equipment e ON t.equipment_id = e.id
         LEFT JOIN polling_stations ps ON e.polling_station_id = ps.id
         WHERE t.id = ? AND t.from_user_id = ?`, [id, currentUser.id]);
      if (!t) { req.flash('error', 'Transfer not found.'); return res.redirect('/ro/issue-to'); }
      equipment   = [{ serial_number: t.serial_number, equipment_type: t.equipment_type, status: t.status }];
      stationName = t.ps_name || t.to_location || '—';
      transferDate = t.transfer_date;
    }

    if (!equipment?.length) { req.flash('error', 'No equipment found.'); return res.redirect('/ro/issue-to'); }

    const { generateIssueForm } = require('../utils/formGenerator');
    await generateIssueForm(res, {
      transfer: { transfer_date: transferDate, remarks: '' },
      equipment,
      stationName,
      roName: currentUser.full_name,
      constituency: currentUser.constituency_name
    });
  } catch (err) { console.error('[downloadIssueForm]', err.message, err.stack); req.flash('error', 'Failed to generate form: ' + err.message); res.redirect('/ro/issue-to'); }
}

// ─── DOWNLOAD RETURN FORM (Excel receipt for Polling Station → RO) ───
async function downloadReturnForm(req, res) {
  try {
    const currentUser = getUser(req);
    const { id } = req.params;
    const [[transfer]] = await db.query(
      `SELECT t.*, e.serial_number, e.equipment_type, e.status,
              ps.name AS polling_station_name
       FROM transfers t
       JOIN equipment e ON t.equipment_id = e.id
       LEFT JOIN polling_stations ps ON e.polling_station_id = ps.id
       WHERE t.id = ? AND t.to_user_id = ? AND t.transfer_type = 'Return'`,
      [id, currentUser.id]
    );
    if (!transfer) {
      req.flash('error', 'Return record not found.');
      return res.redirect('/ro/return');
    }
    await generateReturnForm(res, {
      transfer,
      equipment: [{ serial_number: transfer.serial_number, equipment_type: transfer.equipment_type, status: transfer.status }],
      stationName: transfer.from_location || transfer.polling_station_name || '—',
      roName: currentUser.full_name,
      constituency: currentUser.constituency_name
    });
  } catch (err) { console.error(err); req.flash('error', 'Failed to generate return form.'); res.redirect('/ro/return'); }
}

// ─── UPLOAD SIGNED FORM ───────────────────────────────────────
async function postUploadForm(req, res) {
  try {
    const currentUser = getUser(req);
    const { id, form_type } = req.params;
    const redirectTo = form_type === 'return' ? '/ro/return' : '/ro/issue-to';

    if (!req.file) {
      req.flash('error', 'Please select a file to upload.');
      return res.redirect(redirectTo);
    }

    // Ensure directory exists
    if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

    // Save file to disk
    const ext      = path.extname(req.file.originalname).toLowerCase();
    const filename = `${form_type}_${id}_${Date.now()}${ext}`;
    const filePath = path.join(UPLOADS_DIR, filename);
    fs.writeFileSync(filePath, req.file.buffer);

    // For receive_back uploads, id = stationId (not a transfer id).
    // Find the latest ReceiveBack transfer for this station/RO, or
    // find the latest Issue transfer to store the record against.
    let transferId = null;

    if (form_type === 'receive_back') {
      // Try latest ReceiveBack transfer by this RO
      const [[rbT]] = await db.query(
        `SELECT id FROM transfers WHERE from_user_id = ? AND transfer_type = 'ReceiveBack'
         ORDER BY id DESC LIMIT 1`, [currentUser.id]
      );
      if (rbT) {
        transferId = rbT.id;
      } else {
        // Fall back to latest Issue transfer for equipment at this station
        const [[isT]] = await db.query(
          `SELECT t.id FROM transfers t
           JOIN equipment e ON t.equipment_id = e.id
           WHERE t.from_user_id = ? AND t.transfer_type = 'Issue'
             AND e.polling_station_id = ?
           ORDER BY t.id DESC LIMIT 1`,
          [currentUser.id, id]
        );
        transferId = isT ? isT.id : null;
      }
    } else {
      transferId = id;
    }

    if (!transferId) {
      req.flash('error', 'Could not find a matching transfer record. Please confirm receipt first, then upload the form.');
      return res.redirect(redirectTo);
    }

    await db.query(
      'INSERT INTO transfer_forms (transfer_id, form_type, file_path, original_filename, uploaded_by) VALUES (?,?,?,?,?)',
      [transferId, form_type, `uploads/forms/${filename}`, req.file.originalname, currentUser.id]
    );
    req.flash('success', 'Signed form uploaded successfully.');
    res.redirect(redirectTo);
  } catch (err) {
    console.error('[postUploadForm]', err.message);
    req.flash('error', 'Upload failed: ' + err.message);
    res.redirect('/ro/issue-to');
  }
}

// ─── FORMS LIST (used by Admin to view all uploaded signed forms) ─
async function getFormsList(req, res) {
  try {
    const [forms] = await db.query(
      `SELECT tf.*, u.full_name AS uploaded_by_name,
              t.transfer_date, t.transfer_type, t.to_location, t.from_location,
              e.serial_number, e.equipment_type
       FROM transfer_forms tf
       JOIN users u ON tf.uploaded_by = u.id
       LEFT JOIN transfers t ON tf.transfer_id = t.id
       LEFT JOIN equipment e ON t.equipment_id = e.id
       ORDER BY tf.uploaded_at DESC`
    );
    res.render('admin/transfer-forms', { title: 'Uploaded Signed Forms', forms: forms || [] });
  } catch (err) { console.error(err); req.flash('error', 'Failed to load forms.'); res.redirect('/admin/dashboard'); }
}

// ─── DOWNLOAD RECEIVE-BACK FORM ───────────────────────────────
// RO signs this Excel form confirming they received equipment back from
// a Polling Station. stationId identifies which station's equipment.
async function downloadReceiveBackForm(req, res) {
  try {
    const currentUser = getUser(req);
    const { stationId } = req.params;

    // All equipment from this RO currently at this Polling Station
    const [equipment] = await db.query(
      `SELECT e.id, e.serial_number, e.equipment_type, e.status,
              ps.name AS station_name, ps.presiding_name
       FROM equipment e
       JOIN polling_stations ps ON e.polling_station_id = ps.id
       WHERE e.current_holder_id = ? AND e.polling_station_id = ?
       ORDER BY e.equipment_type, e.serial_number`,
      [currentUser.id, stationId]
    );

    if (!equipment.length) {
      req.flash('error', 'No equipment found at that Polling Station.');
      return res.redirect('/ro/issue-to');
    }

    const stationName = equipment[0].station_name;
    const presidingName = equipment[0].presiding_name;

    // Build the receive-back form using the same generator with a custom shape
    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    wb.creator = 'EVM Inventory System';
    const ws = wb.addWorksheet('Receive Back Receipt');
    ws.columns = [{ width:22 }, { width:28 }, { width:22 }, { width:28 }];

    const DARK='FF1E3A5F', GOLD='FFD4AF37', WHITE='FFFFFFFF', LIGHT='FFF0F4FF';
    const h = (cell, text, size=12) => {
      ws.getCell(cell).value = text;
      ws.getCell(cell).font  = { bold:true, color:{argb:WHITE}, size };
      ws.getCell(cell).fill  = { type:'pattern', pattern:'solid', fgColor:{argb:DARK} };
      ws.getCell(cell).alignment = { horizontal:'center', vertical:'middle', wrapText:true };
    };
    const lbl = (cell, text) => {
      ws.getCell(cell).value = text;
      ws.getCell(cell).font  = { bold:true, size:10 };
      ws.getCell(cell).fill  = { type:'pattern', pattern:'solid', fgColor:{argb:LIGHT} };
    };
    const val = (cell, text) => {
      ws.getCell(cell).value = text || '—';
      ws.getCell(cell).font  = { size:10 };
      ws.getCell(cell).border = { bottom:{ style:'thin', color:{argb:'FFCCCCCC'} } };
    };

    ws.mergeCells('A1:D1'); h('A1','ELECTION COMMISSION OF BHUTAN', 14); ws.getRow(1).height = 30;
    ws.mergeCells('A2:D2'); h('A2','EVM EQUIPMENT RECEIVE-BACK RECEIPT', 12); ws.getRow(2).height = 24;
    ws.mergeCells('A3:D3');
    ws.getCell('A3').value = '(Signed by the Returning Officer confirming receipt of equipment from Polling Station)';
    ws.getCell('A3').font  = { italic:true, size:9, color:{argb:'FF666666'} };
    ws.getCell('A3').alignment = { horizontal:'center' }; ws.getRow(3).height = 16;
    ws.addRow([]);

    lbl('A5','Polling Station'); val('B5', stationName);
    lbl('C5','Presiding Officer'); val('D5', presidingName || '—');
    lbl('A6','Constituency'); val('B6', currentUser.constituency_name);
    lbl('C6','Returned By (RO)'); val('D6', currentUser.full_name);
    lbl('A7','Date Received'); val('B7', new Date().toLocaleDateString('en-BT'));
    ws.getRow(5).height = 20; ws.getRow(6).height = 20; ws.getRow(7).height = 20;
    ws.addRow([]);

    ws.mergeCells('A9:D9');
    ws.getCell('A9').value = 'EQUIPMENT RECEIVED BACK';
    ws.getCell('A9').font  = { bold:true, size:10, color:{argb:WHITE} };
    ws.getCell('A9').fill  = { type:'pattern', pattern:'solid', fgColor:{argb:GOLD} };
    ws.getCell('A9').alignment = { horizontal:'center' };

    ['#','Serial Number','Equipment Type','Condition'].forEach((hdr, i) => {
      const c = ws.getRow(10).getCell(i+1);
      c.value = hdr; c.font = { bold:true, size:10 };
      c.fill = { type:'pattern', pattern:'solid', fgColor:{argb:LIGHT} };
      c.border = { bottom:{ style:'medium' } };
    }); ws.getRow(10).height = 20;

    equipment.forEach((eq, i) => {
      const r = 11 + i;
      ws.getCell(`A${r}`).value = i + 1;
      ws.getCell(`B${r}`).value = eq.serial_number;
      ws.getCell(`C${r}`).value = eq.equipment_type;
      ws.getCell(`D${r}`).value = eq.status || 'Functional';
      ws.getRow(r).height = 18;
      ['A','B','C','D'].forEach(col => {
        ws.getCell(`${col}${r}`).border = { bottom:{ style:'thin', color:{argb:'FFCCCCCC'} } };
      });
    });

    const sigRow = 11 + equipment.length + 2;
    ws.mergeCells(`A${sigRow}:B${sigRow}`);
    ws.getCell(`A${sigRow}`).value = 'RETURNED BY (Polling Station)';
    ws.getCell(`A${sigRow}`).font  = { bold:true, size:10, color:{argb:WHITE} };
    ws.getCell(`A${sigRow}`).fill  = { type:'pattern', pattern:'solid', fgColor:{argb:DARK} };
    ws.getCell(`A${sigRow}`).alignment = { horizontal:'center' };
    ws.mergeCells(`C${sigRow}:D${sigRow}`);
    ws.getCell(`C${sigRow}`).value = 'RECEIVED BY (Returning Officer — signs here)';
    ws.getCell(`C${sigRow}`).font  = { bold:true, size:10, color:{argb:WHITE} };
    ws.getCell(`C${sigRow}`).fill  = { type:'pattern', pattern:'solid', fgColor:{argb:DARK} };
    ws.getCell(`C${sigRow}`).alignment = { horizontal:'center' };
    ws.getRow(sigRow).height = 24;

    ['Name','Designation','Date','Signature'].forEach((lbl2, i) => {
      const r = sigRow + 1 + i;
      ws.getCell(`A${r}`).value = lbl2 + ':'; ws.getCell(`A${r}`).font = { size:9 };
      ws.getCell(`B${r}`).border = { bottom:{ style:'medium' } };
      ws.getCell(`C${r}`).value = lbl2 + ':'; ws.getCell(`C${r}`).font = { size:9 };
      ws.getCell(`D${r}`).border = { bottom:{ style:'medium' } };
      ws.getRow(r).height = lbl2 === 'Signature' ? 55 : 20;
    });
    // Pre-fill RO name for the "Received By" column
    ws.getCell(`D${sigRow + 1}`).value = currentUser.full_name;

    const serials = equipment.map(e => e.serial_number).join('_');
    res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition',`attachment; filename="ReceiveBack_${stationName.replace(/\s+/g,'_')}_${serials}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) { console.error('[downloadReceiveBackForm2]', err.message); req.flash('error','Failed to generate form: ' + err.message); res.redirect('/ro/issue-to'); }
}

// ─── CONFIRM RECEIVE BACK FROM POLLING STATION ───────────────
// RO downloads the form, gets signatures, uploads it, then clicks
// "Confirm" here to move the equipment back into their live inventory.
async function postConfirmReceiveBack(req, res) {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const currentUser = getUser(req);
    const { stationId } = req.params;

    const [items] = await conn.query(
      'SELECT id, serial_number, equipment_type FROM equipment WHERE current_holder_id = ? AND polling_station_id = ?',
      [currentUser.id, stationId]
    );
    if (!items.length) {
      await conn.rollback();
      req.flash('error', 'No equipment found at that Polling Station to receive back.');
      return res.redirect('/ro/issue-to');
    }

    const [[station]] = await conn.query('SELECT name FROM polling_stations WHERE id = ?', [stationId]);
    const stationName = station ? station.name : 'Polling Station';

    for (const item of items) {
      await conn.query(
        `INSERT INTO transfers (equipment_id, from_user_id, to_user_id, from_location, to_location,
          transfer_date, transfer_type, status, created_by)
         VALUES (?, ?, ?, ?, ?, CURDATE(), 'ReceiveBack', 'Returned', ?)`,
        [item.id, currentUser.id, currentUser.id, stationName, currentUser.constituency_name || 'Constituency', currentUser.id]
      );
      await conn.query(
        'UPDATE equipment SET polling_station_id = NULL, gewog_id = NULL WHERE id = ?',
        [item.id]
      );
    }

    await conn.commit();
    req.flash('success', `${items.length} item(s) received back from ${stationName} and returned to your inventory.`);
    res.redirect('/ro/issue-to');
  } catch (err) {
    await conn.rollback();
    console.error('[postConfirmReceiveBack]', err.message);
    // If ReceiveBack ENUM missing from DB, give clear instruction
    if (err.message && err.message.includes('Data truncated')) {
      req.flash('error',
        'Database needs updating. Run this SQL: ' +
        "ALTER TABLE transfers MODIFY transfer_type ENUM('Transfer','Issue','Return','Surrender','ReceiveBack','ECIL') NOT NULL DEFAULT 'Transfer';"
      );
    } else {
      req.flash('error', 'Failed to confirm receipt: ' + err.message);
    }
    res.redirect('/ro/issue-to');
  } finally { conn.release(); }
}

// ─── RO EDIT EQUIPMENT ────────────────────────────────────────
async function getEditEquipment(req, res) {
  try {
    const currentUser = getUser(req);
    const [[equipment]] = await db.query(
      'SELECT * FROM equipment WHERE id = ? AND current_holder_id = ?',
      [req.params.id, currentUser.id]
    );
    if (!equipment) {
      req.flash('error', 'Equipment not found or not in your possession.');
      return res.redirect('/ro/equipment');
    }
    res.render('ro/equipment-form', { title: 'Edit Equipment', equipment });
  } catch (err) { console.error(err); res.redirect('/ro/equipment'); }
}

async function postEditEquipment(req, res) {
  try {
    const currentUser = getUser(req);
    const { equipment_type, serial_number, status } = req.body;
    const { id } = req.params;
    const [exists] = await db.query(
      'SELECT id FROM equipment WHERE serial_number = ? AND id != ?', [serial_number, id]);
    if (exists.length) {
      req.flash('error', 'Serial number already exists.');
      return res.redirect(`/ro/equipment/${id}/edit`);
    }
    await db.query(
      'UPDATE equipment SET equipment_type=?, serial_number=?, status=? WHERE id=? AND current_holder_id=?',
      [equipment_type, serial_number, status, id, currentUser.id]
    );
    await db.query('INSERT INTO audit_logs (user_id, action, table_affected, record_id) VALUES (?,?,?,?)',
      [currentUser.id, 'EDIT_EQUIPMENT', 'equipment', id]);
    req.flash('success', 'Equipment updated.');
    res.redirect('/ro/equipment');
  } catch (err) { console.error(err); req.flash('error', 'Update failed.'); res.redirect('/ro/equipment'); }
}

async function deleteEquipment(req, res) {
  try {
    const currentUser = getUser(req);
    const [[eq]] = await db.query(
      'SELECT id FROM equipment WHERE id = ? AND current_holder_id = ?',
      [req.params.id, currentUser.id]
    );
    if (!eq) {
      req.flash('error', 'Equipment not found or not in your possession.');
      return res.redirect('/ro/equipment');
    }
    await db.query('DELETE FROM equipment WHERE id = ?', [req.params.id]);
    await db.query('INSERT INTO audit_logs (user_id, action, table_affected, record_id) VALUES (?,?,?,?)',
      [currentUser.id, 'DELETE_EQUIPMENT', 'equipment', req.params.id]);
    req.flash('success', 'Equipment deleted.');
    res.redirect('/ro/equipment');
  } catch (err) { console.error(err); req.flash('error', 'Delete failed.'); res.redirect('/ro/equipment'); }
}