const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const nodemailer = require('nodemailer');

let transporter = null;

async function getTransporter() {
  if (transporter) return transporter;

  const { EMAIL_HOST, EMAIL_PORT, EMAIL_SECURE, EMAIL_USER, EMAIL_HELO_NAME, EMAIL_TLS_STRICT } = process.env;

  console.log('[mailer] EMAIL_HOST:', EMAIL_HOST || '(not set)');
  console.log('[mailer] EMAIL_USER:', EMAIL_USER || '(not set)');

  if (!EMAIL_HOST || !EMAIL_USER) {
    console.warn('[mailer] ⚠️  EMAIL_HOST or EMAIL_USER not set — skipping.');
    return null;
  }

  // smtp-relay.gmail.com = Google Workspace SMTP Relay
  // Authentication is via server IP allowlist — NO password needed
  const t = nodemailer.createTransport({
    host:   EMAIL_HOST,
    port:   Number(EMAIL_PORT) || 587,
    secure: EMAIL_SECURE === 'true',
    // No auth block — relay authenticates by IP
    tls: {
      rejectUnauthorized: EMAIL_TLS_STRICT === 'true',
      ...(EMAIL_HELO_NAME ? { servername: EMAIL_HELO_NAME } : {})
    }
  });

  try {
    await t.verify();
    console.log('[mailer] ✅ SMTP relay connection verified.');
    transporter = t;
    return transporter;
  } catch (err) {
    console.error('[mailer] ❌ SMTP relay verify failed:', err.message);
    console.error('[mailer]    Make sure your server IP is allowlisted in Google Admin → Gmail → SMTP Relay Service');
    transporter = null;
    return null;
  }
}

// ─── SEND NEW USER CREDENTIALS ───────────────────────────────
async function sendCredentialsEmail({ to, fullName, username, password, role }) {
  if (!to) return { sent: false, reason: 'no_email' };
  const tx = await getTransporter();
  if (!tx) return { sent: false, reason: 'not_configured' };

  const from     = process.env.EMAIL_FROM || `"EVM Inventory System" <${process.env.EMAIL_USER}>`;
  const loginUrl = process.env.APP_URL || 'http://localhost:3000';

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;color:#1a1a1a;">
      <div style="background:#1E3A5F;padding:20px 24px;border-radius:8px 8px 0 0;">
        <h2 style="color:#fff;margin:0;">EVM Inventory System</h2>
        <p style="color:#c8d8ff;margin:4px 0 0;">Election Commission of Bhutan</p>
      </div>
      <div style="border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;padding:24px;">
        <p>Dear <strong>${fullName}</strong>,</p>
        <p>Your account has been created on the <strong>EVM Inventory System</strong>. Your login credentials are:</p>
        <table style="border-collapse:collapse;width:100%;margin:16px 0;">
          <tr style="background:#f0f4ff;">
            <td style="padding:10px 14px;border:1px solid #e2e8f0;font-weight:bold;width:40%;">Username</td>
            <td style="padding:10px 14px;border:1px solid #e2e8f0;font-family:monospace;">${username}</td>
          </tr>
          <tr>
            <td style="padding:10px 14px;border:1px solid #e2e8f0;font-weight:bold;">Password</td>
            <td style="padding:10px 14px;border:1px solid #e2e8f0;font-family:monospace;font-size:16px;color:#1E3A5F;"><strong>${password}</strong></td>
          </tr>
          <tr style="background:#f0f4ff;">
            <td style="padding:10px 14px;border:1px solid #e2e8f0;font-weight:bold;">Role</td>
            <td style="padding:10px 14px;border:1px solid #e2e8f0;">${role}</td>
          </tr>
        </table>
        <p style="color:#e53e3e;font-size:13px;">⚠️ Please change your password immediately after logging in.</p>
        <a href="${loginUrl}/login" style="background:#1E3A5F;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:bold;">Log In Now →</a>
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0;">
        <p style="font-size:11px;color:#718096;">This is an automated message from the Election Commission of Bhutan EVM Inventory System. Do not reply.</p>
      </div>
    </div>`;

  try {
    const info = await tx.sendMail({ from, to, subject: 'Your EVM Inventory System Login Credentials', html });
    console.log('[mailer] ✅ Credentials sent to', to, '| ID:', info.messageId);
    return { sent: true };
  } catch (err) {
    console.error('[mailer] ❌ Send failed:', err.message);
    transporter = null;
    return { sent: false, reason: 'send_failed', error: err.message };
  }
}

// ─── NOTIFY ADMIN OF RESET REQUEST ───────────────────────────
async function sendAdminResetNotification({ username, fullName, email }) {
  const tx = await getTransporter();
  if (!tx) return { sent: false, reason: 'not_configured' };

  const from       = process.env.EMAIL_FROM || `"EVM Inventory System" <${process.env.EMAIL_USER}>`;
  const adminEmail = process.env.ADMIN_EMAIL || process.env.EMAIL_USER;
  const appUrl     = process.env.APP_URL || 'http://localhost:3000';

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;color:#1a1a1a;">
      <div style="background:#1E3A5F;padding:20px 24px;border-radius:8px 8px 0 0;">
        <h2 style="color:#fff;margin:0;">EVM Inventory System</h2>
        <p style="color:#c8d8ff;margin:4px 0 0;">Password Reset Request</p>
      </div>
      <div style="border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;padding:24px;">
        <p>A user has requested a password reset:</p>
        <table style="border-collapse:collapse;width:100%;margin:16px 0;">
          <tr style="background:#f0f4ff;"><td style="padding:10px 14px;border:1px solid #e2e8f0;font-weight:bold;width:40%;">Full Name</td><td style="padding:10px 14px;border:1px solid #e2e8f0;">${fullName}</td></tr>
          <tr><td style="padding:10px 14px;border:1px solid #e2e8f0;font-weight:bold;">Username</td><td style="padding:10px 14px;border:1px solid #e2e8f0;font-family:monospace;">${username}</td></tr>
          <tr style="background:#f0f4ff;"><td style="padding:10px 14px;border:1px solid #e2e8f0;font-weight:bold;">Email</td><td style="padding:10px 14px;border:1px solid #e2e8f0;">${email}</td></tr>
        </table>
        <p>Please reset this user's password in User Management. The new credentials will be emailed automatically.</p>
        <a href="${appUrl}/admin/users" style="background:#1E3A5F;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:bold;">Go to User Management →</a>
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0;">
        <p style="font-size:11px;color:#718096;">Election Commission of Bhutan — EVM Inventory System</p>
      </div>
    </div>`;

  try {
    await tx.sendMail({ from, to: adminEmail, subject: `Password Reset Request — ${username}`, html });
    return { sent: true };
  } catch (err) {
    console.error('[mailer] Reset notification failed:', err.message);
    return { sent: false, error: err.message };
  }
}

// ─── SEND NEW PASSWORD AFTER ADMIN RESET ─────────────────────
async function sendPasswordResetEmail({ to, fullName, username, newPassword }) {
  if (!to) return { sent: false, reason: 'no_email' };
  const tx = await getTransporter();
  if (!tx) return { sent: false, reason: 'not_configured' };

  const from     = process.env.EMAIL_FROM || `"EVM Inventory System" <${process.env.EMAIL_USER}>`;
  const loginUrl = process.env.APP_URL || 'http://localhost:3000';

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;color:#1a1a1a;">
      <div style="background:#1E3A5F;padding:20px 24px;border-radius:8px 8px 0 0;">
        <h2 style="color:#fff;margin:0;">EVM Inventory System</h2>
        <p style="color:#c8d8ff;margin:4px 0 0;">Password Reset — Election Commission of Bhutan</p>
      </div>
      <div style="border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;padding:24px;">
        <p>Dear <strong>${fullName}</strong>,</p>
        <p>Your password has been reset by the Administrator. Your new login credentials are:</p>
        <table style="border-collapse:collapse;width:100%;margin:16px 0;">
          <tr style="background:#f0f4ff;"><td style="padding:10px 14px;border:1px solid #e2e8f0;font-weight:bold;width:40%;">Username</td><td style="padding:10px 14px;border:1px solid #e2e8f0;font-family:monospace;">${username}</td></tr>
          <tr><td style="padding:10px 14px;border:1px solid #e2e8f0;font-weight:bold;">New Password</td><td style="padding:10px 14px;border:1px solid #e2e8f0;font-family:monospace;font-size:16px;color:#1E3A5F;"><strong>${newPassword}</strong></td></tr>
        </table>
        <p style="color:#e53e3e;font-size:13px;">⚠️ Please change your password immediately after logging in.</p>
        <a href="${loginUrl}/login" style="background:#1E3A5F;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:bold;">Log In Now →</a>
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0;">
        <p style="font-size:11px;color:#718096;">This is an automated message. Do not reply.</p>
      </div>
    </div>`;

  try {
    await tx.sendMail({ from, to, subject: 'Your EVM Inventory System Password Has Been Reset', html });
    console.log('[mailer] ✅ Password reset email sent to', to);
    return { sent: true };
  } catch (err) {
    console.error('[mailer] ❌ Password reset email failed:', err.message);
    transporter = null;
    return { sent: false, error: err.message };
  }
}

module.exports = { sendCredentialsEmail, sendAdminResetNotification, sendPasswordResetEmail };