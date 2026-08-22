const AuditLog = require('../models/AuditLog');

async function logAction(action, details, req) {
  try {
    const adminIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'Unknown IP';
    await AuditLog.create({ action, details, adminIp });
  } catch (err) {
    console.error('Lỗi khi ghi Audit Log:', err);
  }
}

module.exports = { logAction };
