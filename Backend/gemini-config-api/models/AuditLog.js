const mongoose = require('mongoose');

const AuditLogSchema = new mongoose.Schema({
  action: { type: String, required: true }, // vd: CREATE_USER, UPDATE_SETTINGS, LOCK_USER, DELETE_USER, REMOVE_DEVICE
  details: { type: String, required: true }, // Mô tả chi tiết hành động bằng tiếng Việt
  adminIp: { type: String }, // Địa chỉ IP thực hiện request
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.models.AuditLog || mongoose.model('AuditLog', AuditLogSchema);
