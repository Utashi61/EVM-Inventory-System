const express = require('express');
const router = express.Router();
const path   = require('path');
const multer = require('multer');
// In-memory for admin Excel uploads (small files); disk storage via roController for signed forms
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// PDF-only upload for signed forms
const uploadPDF = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf' || file.originalname.toLowerCase().endsWith('.pdf')) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are accepted for signed forms.'));
    }
  }
});
const authController  = require('../controllers/authController');
const adminController = require('../controllers/adminController');
const dzeoController  = require('../controllers/dzeoController');
const roController    = require('../controllers/roController');
const reportController= require('../controllers/reportController');
const { isAuthenticated, isAdmin, isDzEO, isRO } = require('../middleware/auth');

// ─── AUTH ─────────────────────────────────────────────────────
router.get('/',       (req, res) => res.redirect('/login'));
router.get('/login',           authController.getLogin);
router.post('/login',          authController.postLogin);
router.get('/logout',          authController.logout);
router.get('/change-password', isAuthenticated, authController.getChangePassword);
router.post('/change-password',isAuthenticated, authController.postChangePassword);

// ─── ADMIN ───────────────────────────────────────────────────
router.get('/admin/dashboard',           isAuthenticated, isAdmin, adminController.getDashboard);
router.get('/admin/dzongkhag/:id',       isAuthenticated, isAdmin, adminController.getDzongkhagDetail);

// Equipment
router.get('/admin/equipment',           isAuthenticated, isAdmin, adminController.getEquipment);
router.get('/admin/equipment/add',       isAuthenticated, isAdmin, adminController.getAddEquipment);
router.post('/admin/equipment/add',      isAuthenticated, isAdmin, adminController.postAddEquipment);
router.get('/admin/equipment/:id/edit',  isAuthenticated, isAdmin, adminController.getEditEquipment);
router.post('/admin/equipment/:id/edit', isAuthenticated, isAdmin, adminController.postEditEquipment);

// Admin Transfers
router.get('/admin/transfers',           isAuthenticated, isAdmin, adminController.getTransfers);
router.post('/admin/transfers',          isAuthenticated, isAdmin, adminController.postTransfer);
router.post('/admin/transfers/:id/status', isAuthenticated, isAdmin, adminController.updateTransferStatus);

// User Management
router.get('/admin/users',               isAuthenticated, isAdmin, adminController.getUsers);
router.post('/admin/users/create',       isAuthenticated, isAdmin, adminController.postCreateUser);
router.post('/admin/users/:id/edit',     isAuthenticated, isAdmin, adminController.postEditUser);
router.post('/admin/users/:id/deactivate', isAuthenticated, isAdmin, adminController.deactivateUser);
router.post('/admin/users/:id/activate',   isAuthenticated, isAdmin, adminController.activateUser);
router.post('/admin/users/:id/delete',     isAuthenticated, isAdmin, adminController.deleteUserPermanently);

// Reports
router.get('/admin/reports',             isAuthenticated, isAdmin, reportController.getAdminReports);
router.get('/admin/reports/generate',    isAuthenticated, isAdmin, reportController.generateAdminReport);

// Receive surrendered equipment (from DzEO)
router.post('/admin/surrender/:id/receive', isAuthenticated, isAdmin, adminController.postReceiveSurrender);

// ─── DzEO (also DzERO and EA) ────────────────────────────────
router.get('/dzeo/dashboard',            isAuthenticated, isDzEO, dzeoController.getDashboard);
router.post('/dzeo/receive-return/:id',  isAuthenticated, isDzEO, dzeoController.postReceiveReturn);
router.post('/dzeo/transfers/:id/receive', isAuthenticated, isDzEO, dzeoController.postReceiveTransfer);
router.get('/dzeo/equipment/add',        isAuthenticated, isDzEO, dzeoController.getAddEquipment);
router.post('/dzeo/equipment/add',       isAuthenticated, isDzEO, dzeoController.postAddEquipment);
router.get('/dzeo/polling-stations',     isAuthenticated, isDzEO, dzeoController.getPollingStations);
router.post('/dzeo/polling-stations',    isAuthenticated, isDzEO, dzeoController.postAddPollingStation);

// Equipment
router.get('/dzeo/equipment',            isAuthenticated, isDzEO, dzeoController.getEquipment);
router.get('/dzeo/equipment/:id/edit',   isAuthenticated, isDzEO, dzeoController.getEditEquipment);
router.post('/dzeo/equipment/:id/edit',  isAuthenticated, isDzEO, dzeoController.postEditEquipment);
// DzEO cannot delete equipment — delete route intentionally omitted

// RO Equipment — view only, no edit or delete

// Issue To (replaces Transfer for DzEO)
router.get('/dzeo/issue-to',             isAuthenticated, isDzEO, dzeoController.getIssueTo);
router.post('/dzeo/issue-to',            isAuthenticated, isDzEO, dzeoController.postIssueTo);

// Quarterly Functionality Check
router.get('/dzeo/quarterly-check',      isAuthenticated, isDzEO, dzeoController.getQuarterlyCheck);
router.post('/dzeo/quarterly-check',     isAuthenticated, isDzEO, dzeoController.postQuarterlyCheck);

// Surrender Equipment (DzEO → Admin)
router.get('/dzeo/surrender',            isAuthenticated, isDzEO, dzeoController.getSurrender);
router.post('/dzeo/surrender',           isAuthenticated, isDzEO, dzeoController.postSurrender);

// Reports
router.get('/dzeo/reports',              isAuthenticated, isDzEO, reportController.getDzeoReports);
router.get('/dzeo/reports/generate',     isAuthenticated, isDzEO, reportController.generateDzeoReport);

// ─── RO ───────────────────────────────────────────────────────
router.get('/ro/dashboard',              isAuthenticated, isRO, roController.getDashboard);
router.get('/ro/equipment',              isAuthenticated, isRO, roController.getMyEquipment);
router.post('/ro/transfers/:id/accept',  isAuthenticated, isRO, roController.postAcceptTransfer);
router.get('/ro/return',                 isAuthenticated, isRO, roController.getReturn);
router.post('/ro/return',                isAuthenticated, isRO, roController.postReturn);
router.post('/ro/receive-return/:id',    isAuthenticated, isRO, roController.postReceiveReturn);

// Issue To (RO → Polling Station)
router.get('/ro/issue-to',                          isAuthenticated, isRO, roController.getIssueToPO);
router.post('/ro/issue-to',                         isAuthenticated, isRO, roController.postIssueToPO);
router.get('/ro/issue-form',                        isAuthenticated, isRO, roController.downloadIssueForm);
router.get('/ro/transfers/:id/issue-form',          isAuthenticated, isRO, roController.downloadIssueForm);
router.get('/ro/transfers/:id/return-form',         isAuthenticated, isRO, roController.downloadReturnForm);
router.post('/ro/transfers/:id/upload/:form_type',  isAuthenticated, isRO,
  uploadPDF.single('signed_form'), roController.postUploadForm);
router.post('/ro/issue-form/upload',                isAuthenticated, isRO,
  uploadPDF.single('signed_form'), async (req, res) => {
    req.params.form_type = 'issue';
    const { issue_date, station_name } = req.body;
    // Find the first transfer_id for this date group to attach the form to
    const db2 = require('../config/database');
    const currentUser = req.session?.user;
    const [[t]] = await db2.query(
      `SELECT t.id FROM transfers t
       JOIN equipment e ON t.equipment_id = e.id
       LEFT JOIN polling_stations ps ON e.polling_station_id = ps.id
       WHERE t.from_user_id = ? AND t.transfer_type = 'Issue'
         AND DATE(t.transfer_date) = ?
       ORDER BY t.id LIMIT 1`, [currentUser.id, issue_date]);
    req.params.id = t ? String(t.id) : '0';
    roController.postUploadForm(req, res);
  });

// Receive Back from Polling Station
router.get('/ro/polling-stations/:stationId/receive-back-form', isAuthenticated, isRO, roController.downloadReceiveBackForm);
router.post('/ro/polling-stations/:stationId/upload-receive-back', isAuthenticated, isRO,
  uploadPDF.single('signed_form'), async (req, res, next) => {
    req.params.form_type = 'receive_back';
    // Use a dummy transfer_id based on stationId for the form record
    req.params.id = req.params.stationId;
    roController.postUploadForm(req, res);
  });
router.post('/ro/polling-stations/:stationId/confirm-receive-back', isAuthenticated, isRO, roController.postConfirmReceiveBack);

router.get('/ro/reports',                isAuthenticated, isRO, reportController.getRoReports);
router.get('/ro/reports/generate',       isAuthenticated, isRO, reportController.generateRoReport);

router.get('/admin/surrender/template',         isAuthenticated, isAdmin, adminController.downloadSurrenderTemplate);
router.get('/admin/surrender/upload',           isAuthenticated, isAdmin, adminController.getSurrenderUpload);
router.post('/admin/surrender/upload',          isAuthenticated, isAdmin, upload.single('surrender_file'), adminController.postSurrenderUpload);
router.post('/admin/surrender/:id/receive',     isAuthenticated, isAdmin, adminController.postReceiveSurrender);
router.post('/admin/ecil/surrender',            isAuthenticated, isAdmin, adminController.postSurrenderToEcil);
router.get('/admin/ecil/report',               isAuthenticated, isAdmin, adminController.downloadEcilReport);

// ─── API: Dynamic Dropdowns ───────────────────────────────────
router.get('/admin/transfer-forms',             isAuthenticated, isAdmin, roController.getFormsList);
router.get('/admin/download-form/:id',          isAuthenticated, isAdmin, async (req, res) => {
  try {
    const db = require('../config/database');
    const path = require('path');
    const fs   = require('fs');
    const [[form]] = await db.query('SELECT * FROM transfer_forms WHERE id = ?', [req.params.id]);
    if (!form) return res.status(404).send('File not found');
    const filePath = path.join(__dirname, '../../', form.file_path);
    if (!fs.existsSync(filePath)) return res.status(404).send('File not found on server. Please re-upload.');
    res.download(filePath, form.original_filename);
  } catch (err) { res.status(500).send('Download error: ' + err.message); }
});
router.get('/api/constituencies/:dzongkhag_id',           isAuthenticated, adminController.getConstituencies);
router.get('/api/gewogs/by-constituency/:constituency_id',isAuthenticated, adminController.getGewogsByConstituency);
router.get('/api/gewogs/:dzongkhag_id',                   isAuthenticated, adminController.getGewogs);
router.get('/api/ro/:constituency_id',                    isAuthenticated, adminController.getRoByConstituency);
router.get('/api/gewogs-by-constituency/:id',             isAuthenticated, adminController.getGewogsByConstituency);
router.get('/api/polling-stations/by-gewog/:gewog_id',    isAuthenticated, adminController.getPollingStationsByGewog);
router.get('/api/officers/by-dzongkhag/:dzongkhag_id',     isAuthenticated, adminController.getOfficersByDzongkhag);

module.exports = router;
