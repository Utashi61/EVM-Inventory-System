-- ============================================================
-- MIGRATION v4 — apply to an EXISTING evm_management database
-- Run this AFTER migration_v3.sql (polling_stations must already exist).
-- Adds the Presiding-Officer ⇄ Polling-Station attachment needed for
-- the separate RO / Presiding Officer dashboards and the RO → PO
-- "Issue To" workflow.
-- ============================================================
USE evm_management;

-- Presiding Officer's home Polling Station.
ALTER TABLE users
    ADD COLUMN polling_station_id INT NULL AFTER gewog_id,
    ADD CONSTRAINT fk_users_polling_station
        FOREIGN KEY (polling_station_id) REFERENCES polling_stations(id) ON DELETE SET NULL;

-- Where the equipment currently sits, once issued down to a Presiding
-- Officer's Polling Station.
ALTER TABLE equipment
    ADD COLUMN polling_station_id INT NULL AFTER gewog_id,
    ADD CONSTRAINT fk_equipment_polling_station
        FOREIGN KEY (polling_station_id) REFERENCES polling_stations(id) ON DELETE SET NULL;
