
const connectToDatabase = require('../lib/db');
const User = require('../models/User');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    await connectToDatabase();
    const { username, password } = req.body;

    const user = await User.findOne({ username });
    if (!user) {
      return res.status(401).json({ message: 'Tài khoản không tồn tại.' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Sai mật khẩu.' });
    }

    if (!user.isActive) {
      return res.status(403).json({ message: 'Tài khoản đã bị vô hiệu hóa. Vui lòng liên hệ Admin.', code: 'ACCOUNT_DISABLED' });
    }

    const { version } = req.body;
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    user.lastIp = ip;
    user.lastLogin = new Date();
    user.lastActiveAt = new Date(); // Cập nhật để hiện Online ngay lập tức
    user.isUninstalled = false;
    user.lastInstalledAt = new Date(); // Đánh dấu thời điểm cài đặt/login lại
    if (version) user.extVersion = version; // Lưu version mới nhất
    await user.save();

    const JWT_SECRET = process.env.JWT_SECRET || 'secret-key-123';
    // TĂNG LÊN 365 NGÀY
    const token = jwt.sign(
      { userId: user._id, username: user.username },
      JWT_SECRET,
      { expiresIn: '365d' }
    );

    return res.status(200).json({ token, username: user.username });
  } catch (error) {
    console.error('Login Error:', error);
    return res.status(500).json({ message: 'Lỗi server nội bộ' });
  }
};