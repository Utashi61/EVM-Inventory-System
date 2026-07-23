const db = require('../config/database');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');

// ─── SHARED CONSTANTS ─────────────────────────────────────────
const DARK   = 'FF1E3A5F';
const GOLD   = 'FFD4AF37';
const WHITE  = 'FFFFFFFF';
const LIGHT  = 'FFF0F4FF';
const STRIPE = 'FFF5F7FF';
const GREEN  = 'FF22C55E';
const RED    = 'FFEF4444';
const BLUE   = 'FF3B82F6';

// ─── ECB HEADER (all reports) ─────────────────────────────────
function addEcbHeader(ws, title, subtitle, colCount) {
  const lastCol = String.fromCharCode(64 + colCount);

  // Row 1 — Organisation name
  ws.mergeCells(`A1:${lastCol}1`);
  ws.getCell('A1').value = 'ELECTION COMMISSION OF BHUTAN';
  ws.getCell('A1').font  = { bold: true, size: 14, color: { argb: WHITE } };
  ws.getCell('A1').fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: DARK } };
  ws.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(1).height = 30;

  // Row 2 — Report title
  ws.mergeCells(`A2:${lastCol}2`);
  ws.getCell('A2').value = title;
  ws.getCell('A2').font  = { bold: true, size: 12, color: { argb: DARK } };
  ws.getCell('A2').alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(2).height = 24;

  // Row 3 — subtitle / date
  if (subtitle) {
    ws.mergeCells(`A3:${lastCol}3`);
    ws.getCell('A3').value = subtitle;
    ws.getCell('A3').font  = { size: 9, italic: true, color: { argb: 'FF666666' } };
    ws.getCell('A3').alignment = { horizontal: 'center' };
    ws.getRow(3).height = 16;
  }
  ws.addRow([]); // blank row 4
  return subtitle ? 4 : 3;
}

// ─── TABLE HEADER ROW ─────────────────────────────────────────
function addTableHeader(ws, rowNum, columns) {
  const row = ws.getRow(rowNum);
  columns.forEach((col, i) => {
    const cell = row.getCell(i + 1);
    cell.value = col.label;
    cell.font  = { bold: true, size: 10, color: { argb: WHITE } };
    cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: DARK } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = { bottom: { style: 'medium', color: { argb: GOLD } } };
  });
  row.height = 24;
}

// ─── DATA ROWS ────────────────────────────────────────────────
function addDataRows(ws, startRow, columns, rows) {
  rows.forEach((r, i) => {
    const row = ws.getRow(startRow + i);
    columns.forEach((col, ci) => {
      const cell = row.getCell(ci + 1);
      let val = r[col.key];
      if (val instanceof Date) val = val.toLocaleDateString('en-BT');
      cell.value = val != null ? val : '—';
      cell.font  = { size: 10 };
      cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: i % 2 === 0 ? LIGHT : WHITE } };
      cell.alignment = { vertical: 'middle', wrapText: true };
      // Colour-code status cells
      if (col.key === 'status' || col.key === 'condition') {
        const v = String(val || '').toLowerCase();
        if (v.includes('functional') && !v.includes('non')) cell.font = { size: 10, bold: true, color: { argb: GREEN } };
        else if (v.includes('non') || v.includes('fault')) cell.font = { size: 10, bold: true, color: { argb: RED } };
      }
    });
    row.height = 18;
  });
}

// ─── SET COLUMN WIDTHS ────────────────────────────────────────
function setColWidths(ws, columns) {
  columns.forEach((col, i) => {
    ws.getColumn(i + 1).width = col.width || 18;
  });
}

// ─── BUILD EXCEL FILE ─────────────────────────────────────────
async function buildExcel(res, { filename, title, subtitle, columns, rows, extraNote }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'EVM Inventory System';
  const ws = wb.addWorksheet(title.substring(0, 31));

  const headerEndRow = addEcbHeader(ws, title, subtitle, columns.length);
  const tableHeaderRow = headerEndRow + 1;
  addTableHeader(ws, tableHeaderRow, columns);
  addDataRows(ws, tableHeaderRow + 1, columns, rows);
  setColWidths(ws, columns);

  if (extraNote) {
    const noteRow = tableHeaderRow + 1 + rows.length + 1;
    ws.mergeCells(`A${noteRow}:${String.fromCharCode(64 + columns.length)}${noteRow}`);
    ws.getCell(`A${noteRow}`).value = extraNote;
    ws.getCell(`A${noteRow}`).font  = { size: 9, italic: true, color: { argb: 'FF888888' } };
  }

  res.setHeader('Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
}

// ─── BUILD PDF ────────────────────────────────────────────────
function buildPDF(res, { filename, title, subtitle, columns, rows }) {
  const doc = new PDFDocument({ margin: 36, size: 'A4', layout: 'landscape' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.pdf"`);
  doc.pipe(res);

  // Header
  doc.rect(36, 36, doc.page.width - 72, 28).fill('#1E3A5F');
  doc.fontSize(13).font('Helvetica-Bold').fillColor('white')
     .text('ELECTION COMMISSION OF BHUTAN', 36, 43, { width: doc.page.width - 72, align: 'center' });
  doc.moveDown(0.3);
  doc.fontSize(11).font('Helvetica-Bold').fillColor('#1E3A5F').text(title, { align: 'center' });
  if (subtitle) doc.fontSize(8).font('Helvetica').fillColor('#666').text(subtitle, { align: 'center' });
  doc.moveDown(0.5);

  const usableW = doc.page.width - 72;
  const colW = columns.map(c => c.pdfWidth || (usableW / columns.length));
  let x = 36, y = doc.y;

  // Table header
  doc.rect(x, y, usableW, 20).fill('#1E3A5F');
  doc.fontSize(8).font('Helvetica-Bold').fillColor('white');
  let cx = x;
  columns.forEach((col, i) => {
    doc.text(col.label, cx + 2, y + 6, { width: colW[i] - 4, lineBreak: false });
    cx += colW[i];
  });
  y += 20;

  // Data rows
  doc.font('Helvetica').fontSize(7).fillColor('#222');
  rows.forEach((row, ri) => {
    if (y > doc.page.height - 60) { doc.addPage(); y = 50; }
    if (ri % 2 === 0) doc.rect(x, y, usableW, 16).fill('#f0f4ff');
    doc.fillColor('#222');
    cx = x;
    columns.forEach((col, i) => {
      let val = row[col.key];
      if (val instanceof Date) val = val.toLocaleDateString('en-BT');
      doc.text(String(val || '—').substring(0, 28), cx + 2, y + 4, { width: colW[i] - 4, lineBreak: false });
      cx += colW[i];
    });
    y += 16;
  });

  doc.moveDown(1).fontSize(7).fillColor('#999')
     .text(`Generated: ${new Date().toLocaleString()} | EVM Inventory System — Election Commission of Bhutan`,
       { align: 'center' });
  doc.end();
}

// ─── REPORT CONFIGS BY TYPE ───────────────────────────────────
// Each type maps to: SQL query, columns, title
// Matches the exact column layouts from the reference screenshots.

const REPORT_TYPES = {

  // Screenshot: Transfer Report — Sl.No, Serial No, Type, From, To, Date, Status
  transfer: {
    title: 'Transfer Report',
    filename: 'Transfer_Report',
    query: async (filters) => {
      let w = ['1=1']; const p = [];
      if (filters.dzongkhag_id) { w.push('e.dzongkhag_id=?'); p.push(filters.dzongkhag_id); }
      if (filters.user_id) { w.push('(t.from_user_id=? OR t.to_user_id=?)'); p.push(filters.user_id, filters.user_id); }
      const [rows] = await db.query(
        `SELECT t.id, e.serial_number, e.equipment_type,
                COALESCE(fu.full_name, t.from_location, '—') AS from_name,
                COALESCE(tu.full_name, t.to_location, '—')   AS to_name,
                t.transfer_date, t.status, t.remarks
         FROM transfers t
         JOIN equipment e ON t.equipment_id = e.id
         LEFT JOIN users fu ON t.from_user_id = fu.id
         LEFT JOIN users tu ON t.to_user_id   = tu.id
         WHERE t.transfer_type = 'Transfer' AND ${w.join(' AND ')}
         ORDER BY t.transfer_date DESC`, p);
      return rows.map((r, i) => ({ slno: i + 1, ...r }));
    },
    columns: [
      { key: 'slno',          label: 'Sl. No',       width: 7  },
      { key: 'serial_number', label: 'Serial No.',   width: 16 },
      { key: 'equipment_type',label: 'Type',         width: 16 },
      { key: 'from_name',     label: 'Transferred From', width: 22 },
      { key: 'to_name',       label: 'Transferred To',   width: 22 },
      { key: 'transfer_date', label: 'Date',         width: 14 },
      { key: 'status',        label: 'Status',       width: 14 },
      { key: 'remarks',       label: 'Remarks',      width: 24 },
      { key: '_sig',          label: 'Signature',    width: 20 },
    ]
  },

  // Screenshot: Issue Report — Sl.No, Serial No, Type, Issued To (PS), Constituency, Date, Status
  issue: {
    title: 'Issue Report — RO to Polling Station',
    filename: 'Issue_Report',
    query: async (filters) => {
      let w = ["t.transfer_type='Issue'"]; const p = [];
      if (filters.user_id) { w.push('t.from_user_id=?'); p.push(filters.user_id); }
      const [rows] = await db.query(
        `SELECT e.serial_number, e.equipment_type,
                ps.name AS polling_station, c.name AS constituency,
                fu.full_name AS issued_by, t.transfer_date, t.status, t.remarks
         FROM transfers t
         JOIN equipment e ON t.equipment_id = e.id
         LEFT JOIN users fu ON t.from_user_id = fu.id
         LEFT JOIN polling_stations ps ON e.polling_station_id = ps.id
         LEFT JOIN constituencies c ON ps.constituency_id = c.id
         WHERE ${w.join(' AND ')}
         ORDER BY t.transfer_date DESC`, p);
      return rows.map((r, i) => ({ slno: i + 1, ...r }));
    },
    columns: [
      { key: 'slno',            label: 'Sl. No',          width: 7  },
      { key: 'serial_number',   label: 'Serial No.',      width: 16 },
      { key: 'equipment_type',  label: 'Type',            width: 16 },
      { key: 'issued_by',       label: 'Issued By (RO)',  width: 22 },
      { key: 'polling_station', label: 'Polling Station', width: 22 },
      { key: 'constituency',    label: 'Constituency',    width: 20 },
      { key: 'transfer_date',   label: 'Date',            width: 14 },
      { key: 'status',          label: 'Status',          width: 14 },
      { key: '_sig',            label: 'Signature (PO)',  width: 20 },
    ]
  },

  // Screenshot: ECIL Surrender — Sl.No, BU, CU, Surrendered from Dzongkhag, Surrendered By, Dispatched to ECIL, Remarks
  ecil: {
    title: 'ECIL Surrender Report — Election Commission of Bhutan',
    filename: 'ECIL_Surrender_Report',
    query: async () => {
      // Pair BU and CU by matching serial number suffix
      const [rows] = await db.query(
        `SELECT e.serial_number, e.equipment_type, d.name AS dzongkhag_name,
                t.transfer_date AS ecil_date, t.remarks,
                fu.full_name AS surrendered_by
         FROM transfers t
         JOIN equipment e  ON t.equipment_id = e.id
         LEFT JOIN dzongkhags d ON e.dzongkhag_id = d.id
         LEFT JOIN users fu ON t.from_user_id = fu.id
         WHERE t.transfer_type = 'ECIL' AND t.status = 'Returned'
         ORDER BY t.transfer_date DESC, e.equipment_type`);

      // Pair rows: group BU+CU by their numeric suffix
      const pairs = {};
      rows.forEach(r => {
        const suffix = r.serial_number.replace(/^(BU-|CU-|BT-)/i, '');
        if (!pairs[suffix]) pairs[suffix] = { dzongkhag: r.dzongkhag_name, date: r.ecil_date, by: r.surrendered_by, remarks: r.remarks };
        if (r.equipment_type === 'Ballot Unit')  pairs[suffix].bu = r.serial_number;
        if (r.equipment_type === 'Control Unit') pairs[suffix].cu = r.serial_number;
      });

      return Object.values(pairs).map((p, i) => ({
        slno: i + 1,
        ballot_unit:  p.bu || '—',
        control_unit: p.cu || '—',
        dzongkhag:    p.dzongkhag || '—',
        surrendered_by: p.by || '—',
        ecil_date:    p.date,
        remarks:      p.remarks || '—',
      }));
    },
    columns: [
      { key: 'slno',           label: 'Sl. No',                      width: 7  },
      { key: 'ballot_unit',    label: 'Ballot Units (BU)',            width: 18 },
      { key: 'control_unit',   label: 'Control Units (CU)',           width: 18 },
      { key: 'dzongkhag',      label: 'Surrendered from Dzongkhag',   width: 24 },
      { key: 'surrendered_by', label: 'Surrendered By',               width: 22 },
      { key: 'ecil_date',      label: 'Dispatched to ECIL (Date)',    width: 22 },
      { key: 'remarks',        label: 'Remarks',                      width: 24 },
    ]
  },

  // Screenshot: Surrender Form — Dzongkhag surrendering to ECB HQ
  surrender: {
    title: 'Equipment Surrender Form — Dzongkhag to ECB HQ',
    filename: 'Surrender_Form',
    query: async (filters) => {
      let w = ["t.transfer_type='Surrender'"]; const p = [];
      if (filters.dzongkhag_id) { w.push('e.dzongkhag_id=?'); p.push(filters.dzongkhag_id); }
      const [rows] = await db.query(
        `SELECT e.serial_number, e.equipment_type, d.name AS dzongkhag,
                t.transfer_date, t.surrender_date, t.status, t.fault_type, t.remarks,
                fu.full_name AS surrendered_by
         FROM transfers t
         JOIN equipment e ON t.equipment_id = e.id
         LEFT JOIN dzongkhags d ON e.dzongkhag_id = d.id
         LEFT JOIN users fu ON t.from_user_id = fu.id
         WHERE ${w.join(' AND ')}
         ORDER BY t.transfer_date DESC`, p);
      return rows.map((r, i) => {
        // Move remarks-stored fault descriptions into fault_type column
        const faultType = r.fault_type || r.remarks || '—';
        // Only show remarks separately if it's different from what's in fault_type
        const remarks = (r.remarks && r.remarks !== r.fault_type && r.fault_type) ? r.remarks : '—';
        return { slno: i + 1, condition: 'Non-Functional', fault_type: faultType, remarks, ...r };
      });
    },
    columns: [
      { key: 'slno',           label: 'Sl. No',         width: 7  },
      { key: 'serial_number',  label: 'Serial No.',     width: 16 },
      { key: 'equipment_type', label: 'Type',           width: 16 },
      { key: 'dzongkhag',      label: 'Dzongkhag',      width: 18 },
      { key: 'surrendered_by', label: 'Surrendered By', width: 22 },
      { key: 'transfer_date',  label: 'Issue Date',     width: 14 },
      { key: 'surrender_date', label: 'Surrender Date', width: 14 },
      { key: 'condition',      label: 'Condition',      width: 14 },
      { key: 'fault_type',     label: 'Fault Type',     width: 18 },
      { key: 'remarks',        label: 'Remarks',        width: 22 },
      { key: '_sig',           label: 'Signature',      width: 20 },
    ]
  },

  // Screenshot: Functional Form — All functional equipment
  functional: {
    title: 'Functional Equipment Report',
    filename: 'Functional_Equipment',
    query: async (filters) => {
      let w = ["e.status='Functional'"]; const p = [];
      if (filters.dzongkhag_id) { w.push('e.dzongkhag_id=?'); p.push(filters.dzongkhag_id); }
      if (filters.user_id) { w.push('e.current_holder_id=?'); p.push(filters.user_id); }
      const [rows] = await db.query(
        `SELECT e.serial_number, e.equipment_type, d.name AS dzongkhag,
                c.name AS constituency, u.full_name AS current_holder, e.created_at
         FROM equipment e
         LEFT JOIN dzongkhags d ON e.dzongkhag_id = d.id
         LEFT JOIN constituencies c ON e.constituency_id = c.id
         LEFT JOIN users u ON e.current_holder_id = u.id
         WHERE ${w.join(' AND ')}
         ORDER BY d.name, e.equipment_type, e.serial_number`, p);
      return rows.map((r, i) => ({ slno: i + 1, status: 'Functional', ...r }));
    },
    columns: [
      { key: 'slno',           label: 'Sl. No',          width: 7  },
      { key: 'serial_number',  label: 'Serial No.',      width: 16 },
      { key: 'equipment_type', label: 'Type',            width: 16 },
      { key: 'dzongkhag',      label: 'Dzongkhag',       width: 18 },
      { key: 'constituency',   label: 'Constituency',    width: 20 },
      { key: 'current_holder', label: 'Current Holder',  width: 22 },
      { key: 'status',         label: 'Status',          width: 14 },
    ]
  },

  // Screenshot: Non-Functional Form
  non_functional: {
    title: 'Non-Functional Equipment Report',
    filename: 'Non_Functional_Equipment',
    query: async (filters) => {
      let w = ["e.status='Non-Functional'"]; const p = [];
      if (filters.dzongkhag_id) { w.push('e.dzongkhag_id=?'); p.push(filters.dzongkhag_id); }
      if (filters.user_id) { w.push('e.current_holder_id=?'); p.push(filters.user_id); }
      const [rows] = await db.query(
        `SELECT e.serial_number, e.equipment_type, d.name AS dzongkhag,
                c.name AS constituency, u.full_name AS current_holder,
                COALESCE(qc.fault_type, t_last.fault_type) AS fault_type,
                COALESCE(qc.remarks, t_last.remarks) AS remarks,
                qc.checked_at AS last_checked
         FROM equipment e
         LEFT JOIN dzongkhags d ON e.dzongkhag_id = d.id
         LEFT JOIN constituencies c ON e.constituency_id = c.id
         LEFT JOIN users u ON e.current_holder_id = u.id
         LEFT JOIN (
           SELECT equipment_id, fault_type, remarks, checked_at
           FROM quarterly_checks
           WHERE (equipment_id, checked_at) IN (
             SELECT equipment_id, MAX(checked_at) FROM quarterly_checks GROUP BY equipment_id
           )
         ) qc ON qc.equipment_id = e.id
         LEFT JOIN (
           SELECT equipment_id, fault_type, remarks
           FROM transfers
           WHERE fault_type IS NOT NULL
             AND (equipment_id, id) IN (
               SELECT equipment_id, MAX(id) FROM transfers
               WHERE fault_type IS NOT NULL GROUP BY equipment_id
             )
         ) t_last ON t_last.equipment_id = e.id
         WHERE ${w.join(' AND ')}
         ORDER BY d.name, e.equipment_type, e.serial_number`, p);
      return rows.map((r, i) => ({ slno: i + 1, status: 'Non-Functional', ...r }));
    },
    columns: [
      { key: 'slno',           label: 'Sl. No',         width: 7  },
      { key: 'serial_number',  label: 'Serial No.',     width: 16 },
      { key: 'equipment_type', label: 'Type',           width: 16 },
      { key: 'dzongkhag',      label: 'Dzongkhag',      width: 18 },
      { key: 'constituency',   label: 'Constituency',   width: 20 },
      { key: 'current_holder', label: 'Current Holder', width: 22 },
      { key: 'fault_type',     label: 'Fault Type',     width: 18 },
      { key: 'last_checked',   label: 'Last Checked',   width: 16 },
      { key: 'remarks',        label: 'Remarks',        width: 24 },
    ]
  },

  // Screenshot: Quarterly Check
  quarterly_check: {
    title: 'Quarterly Functionality Check Report',
    filename: 'Quarterly_Check',
    query: async (filters) => {
      let w = ['1=1']; const p = [];
      if (filters.dzongkhag_id) { w.push('qc.dzongkhag_id=?'); p.push(filters.dzongkhag_id); }
      const [rows] = await db.query(
        `SELECT qc.quarter_label, e.serial_number, e.equipment_type,
                d.name AS dzongkhag, qc.status, qc.fault_type, qc.remarks,
                u.full_name AS checked_by, qc.checked_at
         FROM quarterly_checks qc
         JOIN equipment e ON qc.equipment_id = e.id
         JOIN dzongkhags d ON qc.dzongkhag_id = d.id
         LEFT JOIN users u ON qc.checked_by = u.id
         WHERE ${w.join(' AND ')}
         ORDER BY qc.checked_at DESC`, p);
      return rows.map((r, i) => ({ slno: i + 1, ...r }));
    },
    columns: [
      { key: 'slno',           label: 'Sl. No',       width: 7  },
      { key: 'quarter_label',  label: 'Quarter',      width: 16 },
      { key: 'serial_number',  label: 'Serial No.',   width: 16 },
      { key: 'equipment_type', label: 'Type',         width: 16 },
      { key: 'dzongkhag',      label: 'Dzongkhag',    width: 18 },
      { key: 'status',         label: 'Condition',    width: 14 },
      { key: 'fault_type',     label: 'Fault Type',   width: 18 },
      { key: 'checked_by',     label: 'Checked By',   width: 20 },
      { key: 'checked_at',     label: 'Date',         width: 16 },
      { key: 'remarks',        label: 'Remarks',      width: 24 },
    ]
  },

  // Screenshot: All Inventory of Dzongkhag
  inventory: {
    title: 'All Equipment Inventory',
    filename: 'Equipment_Inventory',
    query: async (filters) => {
      let w = ['1=1']; const p = [];
      if (filters.dzongkhag_id) { w.push('e.dzongkhag_id=?'); p.push(filters.dzongkhag_id); }
      if (filters.user_id) { w.push('e.current_holder_id=?'); p.push(filters.user_id); }
      const [rows] = await db.query(
        `SELECT e.serial_number, e.equipment_type, d.name AS dzongkhag,
                c.name AS constituency, g.name AS gewog,
                e.status, u.full_name AS current_holder, e.created_at
         FROM equipment e
         LEFT JOIN dzongkhags d ON e.dzongkhag_id = d.id
         LEFT JOIN constituencies c ON e.constituency_id = c.id
         LEFT JOIN gewogs g ON e.gewog_id = g.id
         LEFT JOIN users u ON e.current_holder_id = u.id
         WHERE ${w.join(' AND ')}
         ORDER BY d.name, e.equipment_type, e.serial_number`, p);
      return rows.map((r, i) => ({ slno: i + 1, ...r }));
    },
    columns: [
      { key: 'slno',           label: 'Sl. No',         width: 7  },
      { key: 'serial_number',  label: 'Serial No.',     width: 16 },
      { key: 'equipment_type', label: 'Type',           width: 16 },
      { key: 'dzongkhag',      label: 'Dzongkhag',      width: 18 },
      { key: 'constituency',   label: 'Constituency',   width: 20 },
      { key: 'gewog',          label: 'Gewog',          width: 18 },
      { key: 'current_holder', label: 'Current Holder', width: 22 },
      { key: 'status',         label: 'Status',         width: 14 },
    ]
  },

  // Return form (RO returns to DzEO)
  return: {
    title: 'Equipment Return Report — RO to DzEO',
    filename: 'Return_Report',
    query: async (filters) => {
      let w = ["t.transfer_type='Return'"]; const p = [];
      if (filters.dzongkhag_id) { w.push('e.dzongkhag_id=?'); p.push(filters.dzongkhag_id); }
      if (filters.user_id) { w.push('t.from_user_id=?'); p.push(filters.user_id); }
      const [rows] = await db.query(
        `SELECT e.serial_number, e.equipment_type, d.name AS dzongkhag,
                fu.full_name AS returned_by, tu.full_name AS received_by,
                t.transfer_date, t.status, t.fault_type, t.remarks
         FROM transfers t
         JOIN equipment e ON t.equipment_id = e.id
         LEFT JOIN dzongkhags d ON e.dzongkhag_id = d.id
         LEFT JOIN users fu ON t.from_user_id = fu.id
         LEFT JOIN users tu ON t.to_user_id = tu.id
         WHERE ${w.join(' AND ')}
         ORDER BY t.transfer_date DESC`, p);
      return rows.map((r, i) => ({ slno: i + 1, condition: r.fault_type ? 'Non-Functional' : 'Functional', ...r }));
    },
    columns: [
      { key: 'slno',           label: 'Sl. No',          width: 7  },
      { key: 'serial_number',  label: 'Serial No.',      width: 16 },
      { key: 'equipment_type', label: 'Type',            width: 16 },
      { key: 'dzongkhag',      label: 'Dzongkhag',       width: 18 },
      { key: 'returned_by',    label: 'Returned By (RO)',width: 22 },
      { key: 'received_by',    label: 'Received By (DzEO)', width: 22 },
      { key: 'transfer_date',  label: 'Date',            width: 14 },
      { key: 'condition',      label: 'Condition',       width: 14 },
      { key: 'fault_type',     label: 'Fault Type',      width: 18 },
      { key: 'remarks',        label: 'Remarks',         width: 22 },
      { key: '_sig',           label: 'Signature',       width: 20 },
    ]
  },
};
// Aliases for alternate report_type names used in views
REPORT_TYPES.issued         = REPORT_TYPES.issue;
REPORT_TYPES.quarterly      = REPORT_TYPES.quarterly_check;
REPORT_TYPES.non_functional = REPORT_TYPES.non_functional; // already correct

// ─── GENERIC GENERATE ENDPOINT ────────────────────────────────
async function generateReport(req, res, extraFilters = {}) {
  const { format = 'excel' } = req.query;
  const type = req.query.type || req.query.report_type || 'inventory';
  const config = REPORT_TYPES[type];
  if (!config) {
    req.flash('error', `Unknown report type: ${type}`);
    return res.redirect('back');
  }
  try {
    const filters = {
      // extraFilters from role-based generate functions take priority
      // to prevent DzEO/RO from accessing other users' data via URL params
      dzongkhag_id: extraFilters.dzongkhag_id !== undefined
        ? extraFilters.dzongkhag_id
        : (req.query.dzongkhag_id || null),
      user_id: extraFilters.user_id || null,
    };
    const rows = await config.query(filters);
    const subtitle = `Generated: ${new Date().toLocaleDateString('en-BT')} | Total Records: ${rows.length}`;

    if (format === 'pdf') {
      return buildPDF(res, { filename: config.filename, title: config.title, subtitle, columns: config.columns, rows });
    }
    return await buildExcel(res, { filename: config.filename, title: config.title, subtitle, columns: config.columns, rows });
  } catch (err) {
    console.error('[generateReport]', err);
    req.flash('error', 'Report generation failed: ' + err.message);
    res.redirect('back');
  }
}

// ─── ADMIN REPORTS ────────────────────────────────────────────
exports.getAdminReports = async (req, res) => {
  const [dzongkhags] = await db.query('SELECT * FROM dzongkhags ORDER BY name');
  res.render('admin/reports', { title: 'Reports', dzongkhags, reportTypes: Object.keys(REPORT_TYPES) });
};
// Admin can filter by any dzongkhag or see all
exports.generateAdminReport = (req, res) => generateReport(req, res, {});

// ─── DZEO REPORTS — locked to their own Dzongkhag ─────────────
exports.getDzeoReports = async (req, res) => {
  res.render('dzeo/reports', { title: 'Reports' });
};
exports.generateDzeoReport = (req, res) => {
  // Force dzongkhag_id to the logged-in DzEO's own dzongkhag — cannot see other dzongkhags
  const dzongkhag_id = req.session?.user?.dzongkhag_id || null;
  return generateReport(req, res, { dzongkhag_id });
};

// ─── RO REPORTS — locked to their own data ────────────────────
exports.getRoReports = async (req, res) => {
  res.render('ro/reports', { title: 'Reports' });
};
exports.generateRoReport = (req, res) => {
  const user_id      = req.session?.user?.id || null;
  const dzongkhag_id = req.session?.user?.dzongkhag_id || null;
  return generateReport(req, res, { user_id, dzongkhag_id });
};

// ─── ECIL REPORT (used from admin dashboard download buttons) ─
exports.downloadEcilReport = (req, res) => {
  req.query.type = 'ecil';
  return generateReport(req, res, {});
};