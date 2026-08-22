
const mongoose = require('mongoose');

const DeviceSchema = new mongoose.Schema({
  deviceId: { type: String, required: true },
  deviceName: { type: String }, // vd: "Chrome (Windows)"
  lastIp: { type: String },
  location: { type: String, default: "Chưa rõ" },
  extVersion: { type: String, default: "N/A" },
  lastActiveAt: { type: Date, default: Date.now }
});

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
  blockComplaintTicket: { type: Boolean, default: false }, // Tính năng chặn tạo ticket khiếu nại
  devices: [DeviceSchema], // Danh sách thiết bị đăng nhập
  fullName: { type: String, default: "" }, // Họ và tên nhân viên
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.models.User || mongoose.model('User', UserSchema);
