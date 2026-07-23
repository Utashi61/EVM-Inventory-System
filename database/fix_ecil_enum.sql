-- Run this to fix the ECIL surrender error (Data truncated for column 'transfer_type')
USE evm_management;

ALTER TABLE transfers
  MODIFY transfer_type
  ENUM('Transfer','Issue','Return','Surrender','ReceiveBack','ECIL')
  NOT NULL DEFAULT 'Transfer';

-- Verify:
SELECT COLUMN_TYPE FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = 'evm_management'
  AND TABLE_NAME   = 'transfers'
  AND COLUMN_NAME  = 'transfer_type';
