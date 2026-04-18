
const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  isActive: { type: Boolean, default: true }, // Admin khóa/mở
  isUninstalled: { type: Boolean, default: false }, // Người dùng gỡ Ext
  extVersion: { type: String, default: "N/A" },
  lastIp: { type: String },
  lastLogin: { type: Date },
  lastActiveAt: { type: Date, default: Date.now },
  uninstalledAt: { type: Date },
  lastInstalledAt: { type: Date },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.models.User || mongoose.model('User', UserSchema);
