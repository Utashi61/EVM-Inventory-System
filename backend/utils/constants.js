// ─── SHARED CONSTANTS ─────────────────────────────────────────
// Single source of truth for the Non-Functionality / fault-type
// dropdown used on:
//   - RO / Presiding Officer "Return Equipment" form
//   - DzEO "Surrender Equipment" form
const FAULT_TYPES = [
  'Pin Broken',
  'Pin Bend',
  'Beep Sound',
  'Display Error',
  'Link Error',
  'Clock Error',
  'Press Error',
  'Read Error',
  'Clip Broken',
  'Others'
];

module.exports = { FAULT_TYPES };
