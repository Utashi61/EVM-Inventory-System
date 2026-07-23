-- ============================================================
-- MIGRATION v5 — apply to an EXISTING evm_management database
-- Run AFTER migration_v4.sql
-- ============================================================
USE evm_management;

-- 1. Add presiding_name to polling_stations (PO role removed; the
--    presiding officer's name is now stored directly on the station).
ALTER TABLE polling_stations
    ADD COLUMN presiding_name VARCHAR(150) NULL AFTER name;

-- 2. Add start_date (equipment added to inventory), surrender_date, and
--    signature (base64 data-URL or filename) to transfers.
ALTER TABLE transfers
    ADD COLUMN start_date DATE NULL AFTER transfer_date,
    ADD COLUMN surrender_date DATE NULL AFTER start_date,
    ADD COLUMN signature TEXT NULL AFTER remarks;

-- 3. Remove the unique constraint on polling_stations so multiple stations
--    per gewog are allowed (previously enforced gewog+name uniqueness — keep
--    that constraint as-is, just making sure presiding_name is nullable).
-- (No action needed — the UNIQUE KEY is on (gewog_id, name), which is fine.)

-- 4. Equipment with current_holder_id = NULL is now treated as held by
--    Admin / Thimphu HQ. No schema change needed — the application layer
--    handles the display. No migration needed for existing NULL rows.

-- 5. Transfer forms: uploaded signed issue/return receipts
CREATE TABLE IF NOT EXISTS transfer_forms (
    id INT AUTO_INCREMENT PRIMARY KEY,
    transfer_id INT NOT NULL,
    form_type ENUM('issue','return') NOT NULL,
    file_path VARCHAR(500) NOT NULL,
    original_filename VARCHAR(255) NOT NULL,
    uploaded_by INT NOT NULL,
    uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (transfer_id) REFERENCES transfers(id) ON DELETE CASCADE,
    FOREIGN KEY (uploaded_by) REFERENCES users(id)
);

-- 6. Add ReceiveBack to transfers.transfer_type ENUM
--    (RO confirming receipt of equipment returned from a Polling Station)
ALTER TABLE transfers
    MODIFY transfer_type ENUM('Transfer','Issue','Return','Surrender','ReceiveBack') NOT NULL DEFAULT 'Transfer';

-- 7. Add 'receive_back' to transfer_forms.form_type ENUM
ALTER TABLE transfer_forms
    MODIFY form_type ENUM('issue','return','receive_back') NOT NULL;

-- 8. Add ECIL to transfer_type ENUM (Admin surrenders equipment to ECIL Hyderabad)
ALTER TABLE transfers
    MODIFY transfer_type ENUM('Transfer','Issue','Return','Surrender','ReceiveBack','ECIL') NOT NULL DEFAULT 'Transfer';
