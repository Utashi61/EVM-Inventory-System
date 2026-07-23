-- ============================================================
-- MIGRATION v3 — apply to an EXISTING evm_management database
-- Run this in MySQL Workbench AFTER schema.sql (and migration_v2.sql
-- if you applied that one separately).
-- ============================================================
USE evm_management;

-- New table: Polling Stations (Dzongkhag > Constituency > Gewog > Polling
-- Station). Added by DzEO / DzERO / EA from their own Dzongkhag.
CREATE TABLE IF NOT EXISTS polling_stations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    dzongkhag_id INT NOT NULL,
    constituency_id INT NOT NULL,
    gewog_id INT NOT NULL,
    created_by INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (dzongkhag_id) REFERENCES dzongkhags(id) ON DELETE CASCADE,
    FOREIGN KEY (constituency_id) REFERENCES constituencies(id) ON DELETE CASCADE,
    FOREIGN KEY (gewog_id) REFERENCES gewogs(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id),
    UNIQUE KEY unique_station_per_gewog (gewog_id, name)
);
