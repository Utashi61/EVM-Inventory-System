/**
 * Generates Excel receipt forms for equipment handovers.
 * Issue form   → RO gives equipment to a Polling Station; PO signs.
 * Return form  → PS returns equipment to RO; RO signs.
 */
const ExcelJS = require('exceljs');

const DARK  = 'FF1E3A5F';
const GOLD  = 'FFD4AF37';
const WHITE = 'FFFFFFFF';
const LIGHT = 'FFF0F4FF';

function headerStyle(ws, cell, text, size = 12) {
  ws.getCell(cell).value = text;
  ws.getCell(cell).font  = { bold: true, color: { argb: WHITE }, size };
  ws.getCell(cell).fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: DARK } };
  ws.getCell(cell).alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
}

function labelCell(ws, cell, text) {
  ws.getCell(cell).value = text;
  ws.getCell(cell).font  = { bold: true, size: 10 };
  ws.getCell(cell).fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT } };
  ws.getCell(cell).border = { bottom: { style: 'thin', color: { argb: 'FFCCCCCC' } } };
}

function valueCell(ws, cell, text) {
  ws.getCell(cell).value = text || '—';
  ws.getCell(cell).font  = { size: 10 };
  ws.getCell(cell).border = { bottom: { style: 'thin', color: { argb: 'FFCCCCCC' } } };
}

function signBox(ws, startRow, label) {
  ws.mergeCells(`A${startRow}:D${startRow}`);
  ws.getCell(`A${startRow}`).value = label;
  ws.getCell(`A${startRow}`).font  = { bold: true, size: 10 };
  ws.getCell(`A${startRow}`).fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT } };

  // Blank lines for name + signature
  ['Name:', 'Designation:', 'Date:', 'Signature:'].forEach((lbl, i) => {
    const r = startRow + 1 + i;
    ws.getCell(`A${r}`).value = lbl;
    ws.getCell(`A${r}`).font  = { size: 10 };
    ws.mergeCells(`B${r}:D${r}`);
    ws.getCell(`B${r}`).border = { bottom: { style: 'medium', color: { argb: 'FF000000' } } };
    ws.getRow(r).height = lbl === 'Signature:' ? 50 : 18;
  });
  return startRow + 5;
}

/**
 * Build and write the ISSUE RECEIPT form to the HTTP response.
 * Called when RO clicks "Download Issue Form" for a specific transfer.
 */
async function generateIssueForm(res, { transfer, equipment, stationName, roName, constituency }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'EVM Inventory System';
  const ws = wb.addWorksheet('Issue Receipt');
  ws.columns = [
    { width: 22 }, { width: 28 }, { width: 22 }, { width: 28 }
  ];

  // Title block
  ws.mergeCells('A1:D1');
  headerStyle(ws, 'A1', 'ELECTION COMMISSION OF BHUTAN', 14);
  ws.getRow(1).height = 30;

  ws.mergeCells('A2:D2');
  headerStyle(ws, 'A2', 'EVM EQUIPMENT ISSUE RECEIPT', 12);
  ws.getRow(2).height = 24;

  ws.mergeCells('A3:D3');
  ws.getCell('A3').value = '(To be signed by the Presiding Officer upon receipt of equipment)';
  ws.getCell('A3').font  = { italic: true, size: 9, color: { argb: 'FF666666' } };
  ws.getCell('A3').alignment = { horizontal: 'center' };
  ws.getRow(3).height = 16;

  ws.addRow([]); // blank row 4

  // Details block
  labelCell(ws, 'A5', 'Constituency');   valueCell(ws, 'B5', constituency);
  labelCell(ws, 'C5', 'Polling Station'); valueCell(ws, 'D5', stationName);
  labelCell(ws, 'A6', 'Issue Date');     valueCell(ws, 'B6', transfer.transfer_date
    ? new Date(transfer.transfer_date).toLocaleDateString('en-BT') : '');
  labelCell(ws, 'C6', 'Issued By (RO)'); valueCell(ws, 'D6', roName);
  ws.getRow(5).height = 20; ws.getRow(6).height = 20;

  ws.addRow([]);

  // Equipment table header
  ws.mergeCells('A8:D8');
  ws.getCell('A8').value = 'EQUIPMENT DETAILS';
  ws.getCell('A8').font  = { bold: true, size: 10, color: { argb: WHITE } };
  ws.getCell('A8').fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: GOLD } };
  ws.getCell('A8').alignment = { horizontal: 'center' };

  ['#', 'Serial Number', 'Equipment Type', 'Condition'].forEach((h, i) => {
    const cell = ws.getRow(9).getCell(i + 1);
    cell.value = h; cell.font = { bold: true, size: 10 };
    cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT } };
    cell.border = { bottom: { style: 'medium' } };
  });
  ws.getRow(9).height = 20;

  const eqList = Array.isArray(equipment) ? equipment : [equipment];
  eqList.forEach((eq, i) => {
    const r = 10 + i;
    ws.getCell(`A${r}`).value = i + 1;
    ws.getCell(`B${r}`).value = eq.serial_number;
    ws.getCell(`C${r}`).value = eq.equipment_type;
    ws.getCell(`D${r}`).value = eq.status || 'Functional';
    ws.getRow(r).height = 18;
    ['A','B','C','D'].forEach(col => {
      ws.getCell(`${col}${r}`).border = { bottom: { style: 'thin', color: { argb: 'FFCCCCCC' } } };
    });
  });

  const afterEq = 10 + eqList.length + 1;
  ws.addRow([]);

  // Remarks
  labelCell(ws, `A${afterEq}`, 'Remarks');
  ws.mergeCells(`B${afterEq}:D${afterEq}`);
  ws.getCell(`B${afterEq}`).value = transfer.remarks || '';
  ws.getCell(`B${afterEq}`).border = { bottom: { style: 'thin' } };
  ws.getRow(afterEq).height = 18;

  ws.addRow([]);
  ws.addRow([]);

  // Signature blocks side by side
  const sigRow = afterEq + 3;
  ws.mergeCells(`A${sigRow}:B${sigRow}`);
  ws.getCell(`A${sigRow}`).value = 'ISSUED BY (Returning Officer)';
  ws.getCell(`A${sigRow}`).font  = { bold: true, size: 10, color: { argb: WHITE } };
  ws.getCell(`A${sigRow}`).fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: DARK } };
  ws.getCell(`A${sigRow}`).alignment = { horizontal: 'center' };

  ws.mergeCells(`C${sigRow}:D${sigRow}`);
  ws.getCell(`C${sigRow}`).value = 'RECEIVED BY (Presiding Officer)';
  ws.getCell(`C${sigRow}`).font  = { bold: true, size: 10, color: { argb: WHITE } };
  ws.getCell(`C${sigRow}`).fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: DARK } };
  ws.getCell(`C${sigRow}`).alignment = { horizontal: 'center' };
  ws.getRow(sigRow).height = 24;

  ['Name', 'Designation', 'Date', 'Signature'].forEach((lbl, i) => {
    const r = sigRow + 1 + i;
    ws.getCell(`A${r}`).value = lbl + ':';
    ws.getCell(`A${r}`).font  = { size: 9 };
    ws.getCell(`B${r}`).border = { bottom: { style: 'medium' } };
    ws.getCell(`C${r}`).value = lbl + ':';
    ws.getCell(`C${r}`).font  = { size: 9 };
    ws.getCell(`D${r}`).border = { bottom: { style: 'medium' } };
    ws.getRow(r).height = lbl === 'Signature' ? 55 : 20;
  });

  // Pre-fill RO name
  ws.getCell(`B${sigRow + 1}`).value = roName;

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="Issue_Receipt_${eqList.map(e=>e.serial_number).join('_')}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
}

/**
 * Build and write the RETURN RECEIPT form to the HTTP response.
 * Called when RO clicks "Download Return Form" for a specific return transfer.
 */
async function generateReturnForm(res, { transfer, equipment, stationName, roName, constituency }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'EVM Inventory System';
  const ws = wb.addWorksheet('Return Receipt');
  ws.columns = [
    { width: 22 }, { width: 28 }, { width: 22 }, { width: 28 }
  ];

  ws.mergeCells('A1:D1');
  headerStyle(ws, 'A1', 'ELECTION COMMISSION OF BHUTAN', 14);
  ws.getRow(1).height = 30;

  ws.mergeCells('A2:D2');
  headerStyle(ws, 'A2', 'EVM EQUIPMENT RETURN RECEIPT', 12);
  ws.getRow(2).height = 24;

  ws.mergeCells('A3:D3');
  ws.getCell('A3').value = '(To be signed by the Returning Officer upon return of equipment from Polling Station)';
  ws.getCell('A3').font  = { italic: true, size: 9, color: { argb: 'FF666666' } };
  ws.getCell('A3').alignment = { horizontal: 'center' };
  ws.getRow(3).height = 16;
  ws.addRow([]);

  labelCell(ws, 'A5', 'Constituency');    valueCell(ws, 'B5', constituency);
  labelCell(ws, 'C5', 'Polling Station'); valueCell(ws, 'D5', stationName || '—');
  labelCell(ws, 'A6', 'Return Date');     valueCell(ws, 'B6',
    transfer.updated_at ? new Date(transfer.updated_at).toLocaleDateString('en-BT') : '');
  labelCell(ws, 'C6', 'Received By (RO)'); valueCell(ws, 'D6', roName);
  ws.getRow(5).height = 20; ws.getRow(6).height = 20;
  ws.addRow([]);

  ws.mergeCells('A8:D8');
  ws.getCell('A8').value = 'EQUIPMENT RETURNED';
  ws.getCell('A8').font  = { bold: true, size: 10, color: { argb: WHITE } };
  ws.getCell('A8').fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: GOLD } };
  ws.getCell('A8').alignment = { horizontal: 'center' };

  ['#', 'Serial Number', 'Equipment Type', 'Condition on Return'].forEach((h, i) => {
    const cell = ws.getRow(9).getCell(i + 1);
    cell.value = h; cell.font = { bold: true, size: 10 };
    cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT } };
    cell.border = { bottom: { style: 'medium' } };
  });
  ws.getRow(9).height = 20;

  const eqList = Array.isArray(equipment) ? equipment : [equipment];
  eqList.forEach((eq, i) => {
    const r = 10 + i;
    ws.getCell(`A${r}`).value = i + 1;
    ws.getCell(`B${r}`).value = eq.serial_number;
    ws.getCell(`C${r}`).value = eq.equipment_type;
    ws.getCell(`D${r}`).value = transfer.fault_type
      ? `Non-Functional (${transfer.fault_type})` : 'Functional';
    ws.getRow(r).height = 18;
    ['A','B','C','D'].forEach(col => {
      ws.getCell(`${col}${r}`).border = { bottom: { style: 'thin', color: { argb: 'FFCCCCCC' } } };
    });
  });

  const afterEq = 10 + eqList.length + 1;
  labelCell(ws, `A${afterEq}`, 'Fault Type');
  ws.getCell(`B${afterEq}`).value = transfer.fault_type || 'None';
  labelCell(ws, `C${afterEq}`, 'Remarks');
  ws.getCell(`D${afterEq}`).value = transfer.remarks || '';
  ws.getRow(afterEq).height = 18;
  ws.addRow([]); ws.addRow([]);

  const sigRow = afterEq + 3;
  ws.mergeCells(`A${sigRow}:B${sigRow}`);
  ws.getCell(`A${sigRow}`).value = 'RETURNED BY (Polling Station)';
  ws.getCell(`A${sigRow}`).font  = { bold: true, size: 10, color: { argb: WHITE } };
  ws.getCell(`A${sigRow}`).fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: DARK } };
  ws.getCell(`A${sigRow}`).alignment = { horizontal: 'center' };

  ws.mergeCells(`C${sigRow}:D${sigRow}`);
  ws.getCell(`C${sigRow}`).value = 'RECEIVED BY (Returning Officer)';
  ws.getCell(`C${sigRow}`).font  = { bold: true, size: 10, color: { argb: WHITE } };
  ws.getCell(`C${sigRow}`).fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: DARK } };
  ws.getCell(`C${sigRow}`).alignment = { horizontal: 'center' };
  ws.getRow(sigRow).height = 24;

  ['Name', 'Designation', 'Date', 'Signature'].forEach((lbl, i) => {
    const r = sigRow + 1 + i;
    ws.getCell(`A${r}`).value = lbl + ':';
    ws.getCell(`A${r}`).font  = { size: 9 };
    ws.getCell(`B${r}`).border = { bottom: { style: 'medium' } };
    ws.getCell(`C${r}`).value = lbl + ':';
    ws.getCell(`C${r}`).font  = { size: 9 };
    ws.getCell(`D${r}`).border = { bottom: { style: 'medium' } };
    ws.getRow(r).height = lbl === 'Signature' ? 55 : 20;
  });

  ws.getCell(`D${sigRow + 1}`).value = roName;

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="Return_Receipt_${eqList.map(e=>e.serial_number).join('_')}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
}

module.exports = { generateIssueForm, generateReturnForm };
