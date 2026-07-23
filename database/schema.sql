-- ============================================================
-- EVM Management System - Database Schema
-- MySQL Workbench Compatible (Fully Corrected & Aligned)
-- ============================================================

CREATE DATABASE IF NOT EXISTS evm_management;
USE evm_management;

-- Drop views first to prevent dependencies blocking structural changes
DROP VIEW IF EXISTS v_equipment_details;
DROP VIEW IF EXISTS v_transfer_details;
DROP VIEW IF EXISTS v_dzongkhag_summary;

-- Drop tables in reverse order of dependencies
DROP TABLE IF EXISTS audit_logs;
DROP TABLE IF EXISTS transfers;
DROP TABLE IF EXISTS equipment;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS gewogs;
DROP TABLE IF EXISTS constituencies;
DROP TABLE IF EXISTS dzongkhags;

-- ============================================================
-- 1. DZONGKHAGS
-- ============================================================
CREATE TABLE dzongkhags (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO dzongkhags (name) VALUES
('Bumthang'), ('Chhukha'), ('Dagana'), ('Gasa'), ('Haa'),
('Lhuentse'), ('Mongar'), ('Paro'), ('Pemagatshel'), ('Punakha'),
('Samdrup Jongkhar'), ('Samtse'), ('Sarpang'), ('Thimphu'),
('Trashigang'), ('Trashiyangtse'), ('Trongsa'), ('Tsirang'),
('Wangdue Phodrang'), ('Zhemgang'), ('Thimphu HQ');

-- ============================================================
-- 2. CONSTITUENCIES (Exactly 2 per Dzongkhag in Bhutan)
-- ============================================================
CREATE TABLE constituencies (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    dzongkhag_id INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (dzongkhag_id) REFERENCES dzongkhags(id) ON DELETE CASCADE,
    UNIQUE KEY unique_const_dzong (name, dzongkhag_id)
);

INSERT INTO constituencies (id, name, dzongkhag_id) VALUES
-- Bumthang (Dzongkhag ID = 1)
(1, 'Chhoekhor_Tang', 1), 
(2, 'Chhumig_Ura', 1), 
-- Chhukha (Dzongkhag ID = 2)
(3, 'Bongo_Chapchha', 2),
(4, 'Phuentshogling', 2),
-- Dagana (Dzongkhag ID = 3)
(5, 'Drukjeygang_Tseza', 3),
(6, 'LhamoiDzingkha_Tashiding', 3),
-- Gasa (Dzongkhag ID = 4)
(7, 'Khamaed_Lunana', 4),
(8, 'Khatoed_Laya', 4),
-- Haa (Dzongkhag ID = 5)
(9, 'Bji_Kar-Tshog_Uesu', 5),
(10, 'Sombaykha', 5),
-- Lhuentse (Dzongkhag ID = 6)
(11, 'Gangzur_Minjey', 6),
(12, 'Maenbi_Tsaenkhar', 6),
-- Monggar (Dzongkhag ID  = 7)
(13, 'Dramedtse_Ngatshang', 7),
(14, 'Kengkhar_Weringla', 7),
(15, 'Monggar', 7),
-- Paro (Dzongkhag ID  = 8)
(16, 'Dokar_Sharpa', 8),
(17, 'Lamgong_Wangchang', 8),
-- PemaGatshel (Dzongkhag ID = 9)
(18, 'Khar_Yurung', 9),
(19, 'Nanong_Shumar', 9),
(20, 'Nganglam' , 9),
-- Punakha (Dzongkhag ID = 10)
(21, 'Kabisa_Talog', 10),
(22, 'Lingmukha_Toedwang', 10),
-- Samdrup Jongkhar (Dzongkhag ID = 11)
(23, 'Dewathang_Gomdar', 11),
(24, 'Jomotshangkha_ Martshala', 11),
-- Samtse (Dzongkhag ID = 12)
(25, 'Dophuchen_Tading', 12),
(26, 'Phuentshogpelri_ Samtse', 12),
(27, 'Tashichhoeling', 12),
(28, 'Ugyentse_Yoeseltse', 12),
-- Sarpang (Dzongkhag ID = 13)
(29, 'Gelegphu', 13),
(30, 'Shompangkha', 13),
-- Thimphu (Dzongkhag ID = 14)
(31, 'NorthThimphu', 14), 
(32, 'SouthThimphu', 14),
-- Trashigang (Dzongkhag ID = 15)
(33, 'Bartsham_Shongphu', 15),
(34, 'Kanglung_Samkhar_ Udzorong', 15),
(35, 'Radhi_Sagteng', 15),
(36, 'Thrimshing', 15),
(37, 'Wamrong', 15),
-- TrashiYangtse (Dzongkhag ID = 16)
(38, 'Boomdeling_Jamkhar', 16),
(39, 'Khamdang_Ramjar', 16),
-- Trongsa (Dzongkhag ID = 17)
(40, 'Draagteng_Langthil', 17),
(41, 'Nubi_Tangsibji', 17),
-- Tsirang (Dzongkhag ID = 18)
(42, 'Kilkhorthang_ Mendrelgang', 18),
(43, 'Sergithang_TsirangToed', 18),
-- Wangdue Phodrang (Dzongkhag ID = 19)
(44, 'Athang_Thedtsho', 19),
(45, 'Nyishog_Saephu', 19),
-- Zhemgang (Dzongkhag ID = 20)
(46, 'Bardo_Trong', 20),
(47, 'Panbang', 20);

-- ============================================================
-- 3. GEWOGS (Fixed with direct dzongkhag_id relationship mapping)
-- ============================================================
CREATE TABLE gewogs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    constituency_id INT NOT NULL,
    dzongkhag_id INT NOT NULL, -- ADDED: Resolves dzeoController.js line 72 ER_BAD_FIELD_ERROR
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (constituency_id) REFERENCES constituencies(id) ON DELETE CASCADE,
    FOREIGN KEY (dzongkhag_id) REFERENCES dzongkhags(id) ON DELETE CASCADE,
    UNIQUE KEY unique_gewog_const (name, constituency_id)
);

INSERT INTO gewogs (name, constituency_id, dzongkhag_id) VALUES
-- Inside Bumthang's Chhoekhor_Tang Constituency (ID = 1, Dzongkhag = 1)
('Chhoekhor', 1, 1),
('Tang', 1, 1),

-- Inside Bumthang's Chhumig_Ura Constituency (ID = 2, Dzongkhag = 1)
('Chhumig', 2, 1),
('Ura', 2, 1),

-- Inside Bongo_Chapchha Constituency (ID = 3, Dzongkhag = 2)
('Bjagchhog', 3, 2),
('Bongo', 3, 2),
('Chapchha', 3, 2),
('Darla', 3, 2),
('Getana', 3, 2),

-- Inside Phuentshogling Constituency (ID = 4, Dzongkhag = 2)
('Doongna', 4, 2),
('Geling', 4, 2),
('Loggchina', 4, 2),
('Maedtabkha', 4, 2),
('Phuentshogling', 4, 2),
('Samphelling', 4, 2),
-- Inside Drukjeygang_Tseza Constituency (ID = 5, Dzongkhag = 3)
('Drukjeygang', 5, 3),
('Gozhi', 5, 3),
('Karna', 5, 3),
('Khebisa', 5, 3),
('Largyab', 5, 3),
('Tseza', 5, 3),
('Tsangkha', 5, 3),
-- Inside LhamoiDzingkha_Tashiding Constituency (ID = 6, Dzongkhag = 3)
('Karmaling', 6, 3),
('Dorona', 6, 3),
('Gesarling', 6, 3),
('LhamoiDzingkha', 6, 3),
('Nichula', 6, 3),
('Tashiding', 6, 3),
('Tsenda-Gang', 6, 3),

-- Inside Khamaed_Lunana Constituency (ID = 7, Dzongkhag = 4)
('Khamaed', 7, 4),
('Lunana', 7, 4),
-- Inside Khatoed_Laya Constituency (ID = 8, Dzongkhag = 4)
('Khatoed', 8, 4),
('Laya', 8, 4),

-- Inside Bji_Kar-Tshog_Uesu Constituency (ID = 9, Dzongkhag = 5)
('Bji', 9, 5),
('Kar-tshog', 9, 5),
('Uesu', 9, 5),
-- Inside Sombaykha Constituency (ID = 10, Dzongkhag = 5)
('Gakiling', 10, 5),
('Samar', 10, 5),
('Sangbay', 10, 5),

-- Inside Gangzur_Minjey Constituency (ID = 11, Dzongkhag = 6)
('Gangzur', 11, 6),
('Khoma', 11, 6),
('Kurtoed', 11, 6),
('Minjey', 11, 6),
-- Inside Maenbi_Tsaenkhar Constituency (ID = 12, Dzongkhag = 6)
('Jarey', 12, 6),
('Maenbi', 12, 6),
('Maedtsho', 12, 6),
('Tsaenkhar', 12, 6),

-- Inside Dramedtse_Ngatshang Constituency (ID = 13, Dzongkhag = 7)
('Balam', 13, 7),
('Chagsakhar', 13, 7),
('Dramedtse', 13, 7),
('Na-Rang', 13, 7),
('Ngatshang', 13, 7),
('Shermuhoong', 13, 7),
('Thang-Rong', 13, 7),
-- Inside Kengkhar_Weringla Constituency (ID = 14, Dzongkhag = 7)
('Gongdue', 14, 7),
('Jurmed', 14, 7),
('Kengkhar', 14, 7),
('Saling', 14, 7),
('Silambi', 14, 7),
-- Inside Monggar Constituency (ID = 15, Dzongkhag = 7)
('Chhaling', 15, 7),
('Drepoong', 15, 7),
('Monggar', 15, 7),
('Tsakaling', 15, 7),
('Tsamang', 15, 7),

-- Inside Dokar_Sharpa Constituency (ID = 16, Dzongkhag = 8)
('Dokar', 16, 8),
('Loong-nyi', 16, 8),
('Nagya', 16, 8),
('Sharpa', 16, 8),
-- Inside Lamgong_Wangchang Constituency (ID = 17, Dzongkhag = 8)
('Dopshar-ri', 17, 8),
('Doteng ', 17, 8),
('Hoongrel', 17, 8),
('Lamgong', 17, 8),
('Tsento', 17, 8),
('Wangchang', 17, 8),

-- Inside Khar_Yurung Constituency (ID = 18, Dzongkhag = 9)
('Chhimoong', 18, 9),
('Chongshing', 18, 9),
('Dungmaed', 18, 9),
('Khar', 18, 9),
('Yurung', 18, 9),
-- Inside Nanong_Shumar Constituency (ID = 19, Dzongkhag = 9)
('Nanong', 19, 9),
('Shumar', 19, 9),
('Zobel', 19, 9),
-- Inside Nganglam Constituency (ID = 20, Dzongkhag = 9)
('Chhoekhorling', 20, 9),
('Dechhenling', 20, 9),
('Norboogang', 20, 9),

-- Inside Kabisa_Talog Constituency (ID = 21, Dzongkhag = 10)
('Barp', 21, 10),
('Guma', 21, 10),
('Goenshari', 21, 10),
('Kabisa', 21, 10),
('Talog', 21, 10),
('Toepaisa', 21, 10),
-- Inside Lingmukha_Toedwang Constituency (ID = 22, Dzongkhag = 10)
('Chhubu', 22, 10),
('Dzomi', 22, 10),
('Lingmukha', 22, 10),
('Shelnga-Bjemi', 22, 10),
('Toedwang', 22, 10),

-- Inside Dewathang_Gomdar Constituency (ID = 23, Dzongkhag = 11)
('Dewathang', 23, 11),
('Gomdar', 23, 11),
('Orong', 23, 11),
('Phuentshogthang', 23, 11),
('Wangphu', 23, 11),
-- Inside Jomotshangkha_ Martshala Constituency (ID = 24, Dzongkhag = 11)
('Langchenphu', 24, 11),
('Lauri', 24, 11),
('Martshala', 24, 11),
('Pemathang', 24, 11),
('Samrang', 24, 11),
('Serthig', 24, 11),

-- Inside Dophuchen_Tading Constituency (ID = 25, Dzongkhag = 12)
('Duenchhukha', 25, 12),
('Dophuchen', 25, 12),
('Doomtoed', 25, 12),
('Tading', 25, 12),
-- Inside Phuentshogpelri_ Samtse Constituency (ID = 26, Dzongkhag = 12)
('Norboogang', 26, 12),
('Phuentshogpelri', 26, 12),
('Samtse', 26, 12),
-- Inside Tashichhoeling Constituency (ID = 27, Dzongkhag = 12)
('Norgaygang', 27, 12),
('Pemaling', 27, 12),
('Tashichhoeling', 27, 12),
('Tendruk', 27, 12),
-- Inside Ugyentse_Yoeseltse Constituency (ID = 28, Dzongkhag = 12)
('Sang-Ngag- Chhoeling', 28, 12),
('Namgyalchhoeling', 28, 12),
('Ugyentse', 28, 12),
('Yoeseltse', 28, 12),

-- Inside Gelegphu Constituency (ID = 29, Dzongkhag = 13)
('Samtenling', 29, 13),
('Chhuzanggang', 29, 13),
('Gelegphu', 29, 13),
('JigmeChhoeling', 29, 13),
('Serzhong', 29, 13),
('Tareythang', 29, 13),
('Umling', 29, 13),
-- Inside Shompangkha Constituency (ID = 30, Dzongkhag = 13)
('Dekiling', 30, 13),
('Chhudzom', 30, 13),
('Gakiling', 30, 13),
('Senggey', 30, 13),
('Shompangkha', 30, 13),

-- Inside North Thimphu Constituency (ID = 31, Dzongkhag = 14)
('Kawang', 31, 14),
('Lingzhi', 31, 14),
('Naro', 31, 14),
('Soe', 31, 14),

-- Inside South Thimphu Constituency (ID = 32, Dzongkhag = 14)
('Chang', 32, 14),
('Darkarla', 32, 14),
('Ge-nyen', 32, 14),
('Meadwang', 32, 14),

-- Inside Bartsham_Shongphu Constituency (ID = 33, Dzongkhag = 15)
('Bartsham', 33, 15),
('Bidoong', 33, 15),
('Yangnyer', 33, 15),
('Shongphu', 33, 15),
-- Inside Kanglung_Samkhar_ Udzorong Constituency (ID = 34, Dzongkhag = 15)
('Kanglung', 34, 15),
('Samkhar', 34, 15),
('Udzorong', 34, 15),
-- Inside Radhi_Sagteng Constituency (ID = 35, Dzongkhag = 15)
('Merag', 35, 15),
('Phongmed', 35, 15),
('Radhi', 35, 15),
('Sagteng', 35, 15),
-- Inside Thrimshing Constituency (ID = 36, Dzongkhag = 15)
('Kangpar', 36, 15),
('Thrimshing', 36, 15),
-- Inside Wamrong Constituency (ID = 37, Dzongkhag = 15)
('Khaling', 37, 15),
('Lumang', 37, 15),

-- Inside Boomdeling_Jamkhar Constituency (ID = 38, Dzongkhag = 16)
('Boomdeling', 38, 16),
('Jamkhar', 38, 16),
('Tongmajangsa', 38, 16),
('Yangtse', 38, 16),
-- Inside Khamdang_Ramjar Constituency (ID = 39, Dzongkhag = 16)
('Ramjar', 39, 16),
('Khamdang', 39, 16),
('Toedtsho', 39, 16),
('Yalang', 39, 16),

-- Inside Draagteng_Langthil Constituency (ID = 40, Dzongkhag = 17)
('Draagteng', 40, 17),
('Korphu', 40, 17),
('Langthil', 40, 17),
-- Inside Nubi_Tangsibji Constituency (ID = 41, Dzongkhag = 17)
('Nubi', 41, 17),
('Tangsibji', 41, 17),

-- Inside Kilkhorthang_ Mendrelgang Constituency (ID = 42, Dzongkhag = 18)
('Barshong', 42, 18),
('Patshaling', 42, 18),
('Kilkhorthang', 42, 18),
('Mendrelgang', 42, 18),
('Rangthangling', 42, 18),
('Tsholingkhar', 42, 18),
-- Inside Sergithang_TsirangToed Constituency (ID = 43, Dzongkhag = 18)
('Doonglagang', 43, 18),
('Gosarling', 43, 18),
('Sergithang', 43, 18),
('Pungtenchhu', 43, 18),
('Semjong', 43, 18),
('Tsirang Toed', 43, 18),

-- Inside Athang_Thedtsho Constituency (ID = 44, Dzongkhag = 19)
('Athang', 44, 19),
('Bjednag', 44, 19),
('Darkar', 44, 19),
('GaseTshogongm', 44, 19),
('GaseTshowogm', 44, 19),
('Nahi', 44, 19),
('Thedtsho', 44, 19),
('Ruebisa', 44, 19),
-- Inside Nyishog_saephu Constituency (ID = 45, Dzongkhag = 19)
('Dangchhu', 45, 19),
('Gangteng', 45, 19),
('Kazhi', 45, 19),
('Nyishog', 45, 19),
('Phangyuel', 45, 19),
('Phobji', 45, 19),
('Saephu', 45, 19),

-- Inside Bardo_Trong Constituency (ID = 46, Dzongkhag = 20)
('Bardo', 46, 20),
('Nangkor', 46, 20),
('Shingkhar', 46, 20),
('Trong', 46, 20),
-- Inside Panbang Constituency (ID = 47, Dzongkhag = 20)
('Bjoka', 47, 20),
('Goshing', 47, 20),
('Ngangla', 47, 20),
('Phangkhar', 47, 20);

-- ============================================================
-- 4. USERS
-- ============================================================
CREATE TABLE users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    full_name VARCHAR(150) NOT NULL,
    username VARCHAR(100) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    role ENUM('Admin', 'DzEO', 'DzERO', 'EA', 'RO', 'Presiding Officer') NOT NULL,
    email VARCHAR(200) DEFAULT NULL,
    dzongkhag_id INT,
    constituency_id INT,
    gewog_id INT,
    polling_station_id INT,    -- Presiding Officer is attached to exactly one Polling Station
                                -- (FK added below, once the polling_stations table exists)
    is_active TINYINT(1) DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (dzongkhag_id) REFERENCES dzongkhags(id) ON DELETE SET NULL,
    FOREIGN KEY (constituency_id) REFERENCES constituencies(id) ON DELETE SET NULL,
    FOREIGN KEY (gewog_id) REFERENCES gewogs(id) ON DELETE SET NULL
);

-- Default Admin user (password: Admin@123)
INSERT INTO users (id, full_name, username, password, role) VALUES
(1, 'System Administrator', 'admin', '$2a$10$ihmgf3RI3Bn2jEcGO/1.Peo/bbQqBihriq/zR4cg4Wkbyyxb.yJcm', 'Admin');

-- CORRECTED SEED DATA: Aligned formatting to avoid dropdown rendering failure (NorthThimphu ID = 31)
INSERT INTO users (id, full_name, username, password, role, dzongkhag_id, constituency_id) VALUES
(2, 'Sonam Tobgay', 'thimphu_dzeo', '$2a$10$ihmgf3RI3Bn2jEcGO/1.Peo/bbQqBihriq/zR4cg4Wkbyyxb.yJcm', 'DzEO', 14, NULL),
(3, 'Pema Wangdi', 'ro_north_thimphu', '$2a$10$ihmgf3RI3Bn2jEcGO/1.Peo/bbQqBihriq/zR4cg4Wkbyyxb.yJcm', 'RO', 14, 31);

-- ============================================================
-- 5. EQUIPMENT
-- ============================================================
CREATE TABLE equipment (
    id INT AUTO_INCREMENT PRIMARY KEY,
    equipment_type ENUM('Ballot Unit', 'Control Unit', 'Battery') NOT NULL,
    serial_number VARCHAR(100) NOT NULL UNIQUE,
    dzongkhag_id INT NOT NULL,
    constituency_id INT,
    gewog_id INT,
    polling_station_id INT,    -- set once equipment is issued down to a Presiding Officer
                                -- (FK added below, once the polling_stations table exists)
    status ENUM('Functional', 'Non-Functional') NOT NULL DEFAULT 'Functional',
    current_holder_id INT,
    created_by INT NOT NULL,
    last_checked_at TIMESTAMP NULL DEFAULT NULL,     -- last quarterly functionality check
    last_checked_quarter VARCHAR(20) DEFAULT NULL,   -- e.g. 'Q3-2026'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (dzongkhag_id) REFERENCES dzongkhags(id),
    FOREIGN KEY (constituency_id) REFERENCES constituencies(id) ON DELETE SET NULL,
    FOREIGN KEY (gewog_id) REFERENCES gewogs(id) ON DELETE SET NULL,
    FOREIGN KEY (current_holder_id) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (created_by) REFERENCES users(id)
);


-- ============================================================
-- 6. TRANSFERS
-- ============================================================
CREATE TABLE transfers (
    id INT AUTO_INCREMENT PRIMARY KEY,
    equipment_id INT NOT NULL,
    from_user_id INT,
    to_user_id INT NOT NULL,
    from_location VARCHAR(200),
    to_location VARCHAR(200),
    transfer_date DATE NOT NULL,
    start_date DATE NULL,                  -- date equipment was added to inventory (for surrender)
    surrender_date DATE NULL,              -- planned/actual surrender date
    transfer_type ENUM('Transfer','Issue','Return','Surrender','ReceiveBack','ECIL') NOT NULL DEFAULT 'Transfer',
    gewog_id INT,                          -- filled when DzEO issues to RO
    status ENUM('Pending', 'Received', 'Returning', 'Returned') NOT NULL DEFAULT 'Pending',
    fault_type VARCHAR(100) DEFAULT NULL,  -- filled when equipment returned as Non-Functional
    remarks TEXT,
    signature TEXT NULL,                   -- base64 data-URL or filename of receiver's signature
    created_by INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (equipment_id) REFERENCES equipment(id) ON DELETE CASCADE,
    FOREIGN KEY (from_user_id) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (to_user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (gewog_id) REFERENCES gewogs(id) ON DELETE SET NULL,
    FOREIGN KEY (created_by) REFERENCES users(id)
);

-- ============================================================
-- 7. AUDIT LOGS
-- ============================================================
CREATE TABLE audit_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT,
    action VARCHAR(255) NOT NULL,
    table_affected VARCHAR(100),
    record_id INT,
    details TEXT,
    ip_address VARCHAR(45),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- ============================================================
-- 7A. TRANSFER FORMS — signed receipts uploaded by RO
-- ============================================================
CREATE TABLE transfer_forms (
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

-- ============================================================
-- 7B. QUARTERLY FUNCTIONALITY CHECKS (DzEO)
-- ============================================================
CREATE TABLE quarterly_checks (
    id INT AUTO_INCREMENT PRIMARY KEY,
    equipment_id INT NOT NULL,
    dzongkhag_id INT NOT NULL,
    quarter_label VARCHAR(20) NOT NULL,        -- e.g. 'Q3-2026'
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

-- ============================================================
-- 7C. POLLING STATIONS (added by DzEO / DzERO / EA)
-- Dzongkhag > Constituency > Gewog > Polling Station
-- ============================================================
CREATE TABLE polling_stations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    presiding_name VARCHAR(150) NULL,     -- Name of the Presiding Officer for this station
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

-- Now that polling_stations exists, wire up the FKs declared earlier on
-- users.polling_station_id (Presiding Officer's home station) and
-- equipment.polling_station_id (where equipment currently sits, once
-- issued down to a Presiding Officer).
ALTER TABLE users
    ADD CONSTRAINT fk_users_polling_station
    FOREIGN KEY (polling_station_id) REFERENCES polling_stations(id) ON DELETE SET NULL;

ALTER TABLE equipment
    ADD CONSTRAINT fk_equipment_polling_station
    FOREIGN KEY (polling_station_id) REFERENCES polling_stations(id) ON DELETE SET NULL;

-- ============================================================
-- 8. COMPATIBLE VIEWS
-- ============================================================

-- Equipment Details View
CREATE VIEW v_equipment_details AS
SELECT
    e.id,
    e.equipment_type,
    e.serial_number,
    e.status,
    d.name AS dzongkhag_name,
    c.name AS constituency_name,
    g.name AS gewog_name,
    u.full_name AS current_holder,
    u.role AS holder_role,
    cb.full_name AS created_by_name,
    e.created_at
FROM equipment e
LEFT JOIN dzongkhags d ON e.dzongkhag_id = d.id
LEFT JOIN constituencies c ON e.constituency_id = c.id
LEFT JOIN gewogs g ON e.gewog_id = g.id
LEFT JOIN users u ON e.current_holder_id = u.id
LEFT JOIN users cb ON e.created_by = cb.id;

-- Transfer Details View (Retains tracking foreign keys from_user_id and to_user_id)
CREATE VIEW v_transfer_details AS
SELECT
    t.id,
    t.transfer_date,
    t.status,
    t.remarks,
    e.serial_number,
    e.equipment_type,
    t.from_user_id,
    fu.full_name AS from_user,
    fu.role AS from_role,
    t.to_user_id,
    tu.full_name AS to_user,
    tu.role AS to_role,
    t.from_location,
    t.to_location,
    t.created_at
FROM transfers t
LEFT JOIN equipment e ON t.equipment_id = e.id
LEFT JOIN users fu ON t.from_user_id = fu.id
LEFT JOIN users tu ON t.to_user_id = tu.id;

-- Dzongkhag Summary View
CREATE VIEW v_dzongkhag_summary AS
SELECT
    d.id AS dzongkhag_id,
    d.name AS dzongkhag_name,
    COUNT(e.id) AS total_equipment,
    SUM(CASE WHEN e.status = 'Functional' THEN 1 ELSE 0 END) AS functional,
    SUM(CASE WHEN e.status = 'Non-Functional' THEN 1 ELSE 0 END) AS non_functional
FROM dzongkhags d
LEFT JOIN equipment e ON d.id = e.dzongkhag_id
GROUP BY d.id, d.name;