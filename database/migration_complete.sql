-- ============================================================
-- COMPLETE MIGRATION — Compatible with MySQL 5.7 and MySQL 8+
-- Run this on your existing evm_management database.
-- Each step checks before modifying — safe to run multiple times.
-- ============================================================
USE evm_management;

-- ─── STEP 1: ENUM fix — add ReceiveBack + ECIL ───────────────
-- This always runs MODIFY (safe — it's idempotent).
ALTER TABLE transfers
  MODIFY transfer_type
  ENUM('Transfer','Issue','Return','Surrender','ReceiveBack','ECIL')
  NOT NULL DEFAULT 'Transfer';

-- ─── STEP 2: Add columns to transfers (if missing) ───────────
-- start_date
SET @col = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'transfers'
    AND COLUMN_NAME  = 'start_date'
);
SET @sql = IF(@col = 0,
  'ALTER TABLE transfers ADD COLUMN start_date DATE NULL AFTER transfer_date',
  'SELECT ''start_date already exists'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- surrender_date
SET @col = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'transfers'
    AND COLUMN_NAME  = 'surrender_date'
);
SET @sql = IF(@col = 0,
  'ALTER TABLE transfers ADD COLUMN surrender_date DATE NULL AFTER start_date',
  'SELECT ''surrender_date already exists'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- signature
SET @col = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'transfers'
    AND COLUMN_NAME  = 'signature'
);
SET @sql = IF(@col = 0,
  'ALTER TABLE transfers ADD COLUMN signature TEXT NULL AFTER remarks',
  'SELECT ''signature already exists'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ─── STEP 3: Create polling_stations table if missing ─────────
CREATE TABLE IF NOT EXISTS polling_stations (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    name          VARCHAR(150) NOT NULL,
    presiding_name VARCHAR(150) NULL,
    dzongkhag_id  INT NOT NULL,
    constituency_id INT NOT NULL,
    gewog_id      INT NOT NULL,
    created_by    INT NOT NULL,
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (dzongkhag_id)    REFERENCES dzongkhags(id) ON DELETE CASCADE,
    FOREIGN KEY (constituency_id) REFERENCES constituencies(id) ON DELETE CASCADE,
    FOREIGN KEY (gewog_id)        REFERENCES gewogs(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by)      REFERENCES users(id),
    UNIQUE KEY unique_station_per_gewog (gewog_id, name)
);

-- ─── STEP 4: Add presiding_name to polling_stations if missing ─
SET @col = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'polling_stations'
    AND COLUMN_NAME  = 'presiding_name'
);
SET @sql = IF(@col = 0,
  'ALTER TABLE polling_stations ADD COLUMN presiding_name VARCHAR(150) NULL AFTER name',
  'SELECT ''presiding_name already exists'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ─── STEP 5: Add polling_station_id to users if missing ───────
SET @col = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'users'
    AND COLUMN_NAME  = 'polling_station_id'
);
SET @sql = IF(@col = 0,
  'ALTER TABLE users ADD COLUMN polling_station_id INT NULL AFTER gewog_id',
  'SELECT ''polling_station_id on users already exists'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ─── STEP 6: Add polling_station_id to equipment if missing ───
SET @col = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'equipment'
    AND COLUMN_NAME  = 'polling_station_id'
);
SET @sql = IF(@col = 0,
  'ALTER TABLE equipment ADD COLUMN polling_station_id INT NULL AFTER gewog_id',
  'SELECT ''polling_station_id on equipment already exists'' AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ─── STEP 7: Create transfer_forms table if missing ───────────
CREATE TABLE IF NOT EXISTS transfer_forms (
    id                INT AUTO_INCREMENT PRIMARY KEY,
    transfer_id       INT NOT NULL,
    form_type         ENUM('issue','return','receive_back') NOT NULL,
    file_path         VARCHAR(500) NOT NULL,
    original_filename VARCHAR(255) NOT NULL,
    uploaded_by       INT NOT NULL,
    uploaded_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (transfer_id) REFERENCES transfers(id) ON DELETE CASCADE,
    FOREIGN KEY (uploaded_by) REFERENCES users(id)
);

-- ─── VERIFY ──────────────────────────────────────────────────
SELECT
  COLUMN_NAME,
  COLUMN_TYPE
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME   = 'transfers'
  AND COLUMN_NAME  = 'transfer_type';

SELECT 'Migration complete!' AS status;
