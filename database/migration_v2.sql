-- ============================================================
-- MIGRATION v2 — apply to an EXISTING evm_management database
-- Run this in MySQL Workbench AFTER the original schema.sql
-- (only needed if your database was created before this update)
-- ============================================================
USE evm_management;

-- 1. Allow 'Surrender' as a transfer type (DzEO surrendering
--    non-functional / surplus equipment up to Admin)
ALTER TABLE transfers
  MODIFY COLUMN transfer_type ENUM('Transfer','Issue','Return','Surrender') NOT NULL DEFAULT 'Transfer';

-- 2. Track the last quarterly functionality check on each
--    piece of equipment
ALTER TABLE equipment
  ADD COLUMN last_checked_at TIMESTAMP NULL DEFAULT NULL AFTER created_by,
  ADD COLUMN last_checked_quarter VARCHAR(20) DEFAULT NULL AFTER last_checked_at;

-- 3. New table to log every quarterly check performed by a DzEO
CREATE TABLE IF NOT EXISTS quarterly_checks (
    id INT AUTO_INCREMENT PRIMARY KEY,
    equipment_id INT NOT NULL,
    dzongkhag_id INT NOT NULL,
    quarter_label VARCHAR(20) NOT NULL,
    status ENUM('Functional', 'Non-Functional') NOT NULL,
    fault_type VARCHAR(100) DEFAULT NULL,
    remarks TEXT,
    checked_by INT NOT NULL,
    checked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (equipment_id) REFERENCES equipment(id) ON DELETE CASCADE,
    FOREIGN KEY (dzongkhag_id) REFERENCES dzongkhags(id) ON DELETE CASCADE,
    FOREIGN KEY (checked_by) REFERENCES users(id),
    UNIQUE KEY unique_equipment_quarter (equipment_id, quarter_label)
);
