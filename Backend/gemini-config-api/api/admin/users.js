const connectToDatabase = require('../../lib/db');
const User = require('../../models/User');
const bcrypt = require('bcryptjs');
const { logAction } = require('../../lib/auditLogger');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  await connectToDatabase();

  // GET: Lấy danh sách users
  if (req.method === 'GET') {
    const users = await User.find({}).sort({ createdAt: -1 }).select('-password');
    return res.json(users);
  }

  // POST: Tạo user mới
  if (req.method === 'POST') {
    const { username, password, fullName } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);
    try {
      const newUser = await User.create({ username, password: hashedPassword, fullName: fullName || "" });
      await logAction('CREATE_USER', `Tạo tài khoản nhân viên mới: ${fullName || username} (@${username})`, req);
      return res.json(newUser);
    } catch (e) {
      return res.status(400).json({ error: 'Username already exists' });
    }
  }

  // PUT: Cập nhật trạng thái (Active/Inactive) hoặc xóa thiết bị
  if (req.method === 'PUT') {
    const { id, isActive, password, blockComplaintTicket, removeDeviceId, fullName } = req.body;
    
    if (removeDeviceId) {
      const originalUser = await User.findById(id);
      const updatedUser = await User.findByIdAndUpdate(
        id,
        { $pull: { devices: { deviceId: removeDeviceId } } },
        { new: true }
      ).select('-password');
      
      const targetDevice = originalUser?.devices?.find(d => d.deviceId === removeDeviceId);
      const deviceLabel = targetDevice ? `${targetDevice.deviceName || 'Thiết bị'} (${targetDevice.lastIp})` : removeDeviceId;
      await logAction('REMOVE_DEVICE', `Đăng xuất / xóa thiết bị: ${deviceLabel} của nhân viên ${updatedUser.fullName || updatedUser.username} (@${updatedUser.username})`, req);
      return res.json(updatedUser);
    }

    const originalUser = await User.findById(id);
    const updateData = {};
    if (typeof isActive !== 'undefined') updateData.isActive = isActive;
    if (typeof blockComplaintTicket !== 'undefined') updateData.blockComplaintTicket = blockComplaintTicket;
    if (typeof fullName !== 'undefined') updateData.fullName = fullName;
    if (password) updateData.password = await bcrypt.hash(password, 10);
    
    const updatedUser = await User.findByIdAndUpdate(id, updateData, { new: true }).select('-password');
    
    // Ghi log chi tiết hành động sửa đổi
    const logs = [];
    if (typeof isActive !== 'undefined' && originalUser.isActive !== isActive) {
      logs.push(`${isActive ? 'Mở khóa' : 'Khóa'} tài khoản`);
    }
    if (typeof blockComplaintTicket !== 'undefined' && originalUser.blockComplaintTicket !== blockComplaintTicket) {
      logs.push(`${blockComplaintTicket ? 'Bật' : 'Tắt'} chặn tạo ticket khiếu nại`);
    }
    if (typeof fullName !== 'undefined' && originalUser.fullName !== fullName) {
      logs.push(`Thay đổi họ tên từ "${originalUser.fullName || 'Trống'}" thành "${fullName}"`);
    }
    if (password) {
      logs.push(`Đặt lại mật khẩu mới`);
    }
    
    if (logs.length > 0) {
      await logAction('UPDATE_USER', `Cập nhật nhân viên ${updatedUser.fullName || updatedUser.username} (@${updatedUser.username}): ${logs.join(', ')}`, req);
    }

    return res.json(updatedUser);
  }

  // DELETE: Xóa user
  if (req.method === 'DELETE') {
    const { id } = req.query;
    const targetUser = await User.findById(id);
    if (targetUser) {
      await User.findByIdAndDelete(id);
      await logAction('DELETE_USER', `Xóa vĩnh viễn nhân viên ${targetUser.fullName || targetUser.username} (@${targetUser.username})`, req);
    }
    return res.json({ success: true });
  }
};