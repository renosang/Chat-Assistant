
const connectToDatabase = require('../lib/db');
const User = require('../models/User');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { sendZaloAlert } = require('../lib/zaloAlert');

// Bộ nhớ đệm lưu số lần đăng nhập sai theo IP
const failedAttemptsMap = new Map();
const ATTEMPT_LIMIT = 5;
const COOLDOWN_TIME = 5 * 60 * 1000; // 5 phút

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

  // Xử lý đếm đăng nhập sai
  const trackFailedAttempt = async () => {
    const now = Date.now();
    let record = failedAttemptsMap.get(ip) || { count: 0, lastAttempt: now };
    if (now - record.lastAttempt > COOLDOWN_TIME) {
      record.count = 0;
    }
    record.count += 1;
    record.lastAttempt = now;
    failedAttemptsMap.set(ip, record);

    if (record.count >= ATTEMPT_LIMIT) {
      const timeStr = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
      await sendZaloAlert(`🚨 CẢNH BÁO: Phát hiện hành vi dò mật khẩu liên tục từ IP: ${ip} (Thất bại ${record.count} lần liên tiếp) lúc ${timeStr}.`);
    }
  };

  try {
    await connectToDatabase();
    const { username, password } = req.body;

    const user = await User.findOne({ username });
    if (!user) {
      await trackFailedAttempt();
      return res.status(401).json({ message: 'Tài khoản không tồn tại.' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      await trackFailedAttempt();
      return res.status(401).json({ message: 'Sai mật khẩu.' });
    }

    if (!user.isActive) {
      return res.status(403).json({ message: 'Tài khoản đã bị vô hiệu hóa. Vui lòng liên hệ Admin.', code: 'ACCOUNT_DISABLED' });
    }

    // Xóa bộ đếm sai khi đăng nhập thành công
    failedAttemptsMap.delete(ip);

    const { version, userAgent } = req.body;
    user.lastIp = ip;
    user.lastLogin = new Date();
    user.lastActiveAt = new Date(); // Cập nhật để hiện Online ngay lập tức
    user.isUninstalled = false;
    user.lastInstalledAt = new Date(); // Đánh dấu thời điểm cài đặt/login lại
    if (version) user.extVersion = version; // Lưu version mới nhất
    await user.save();

    const { updateDevice } = require('../lib/deviceHelper');
    await updateDevice(user._id, userAgent || req.headers['user-agent'], ip, version);

    // Kiểm tra đăng nhập từ nước ngoài (không chặn đăng nhập nhưng cảnh báo Zalo)
    if (ip && ip !== '127.0.0.1' && ip !== '::1' && !ip.startsWith('192.168.') && !ip.startsWith('10.')) {
      const cleanIp = ip.replace(/^.*:/, '');
      fetch(`https://ipinfo.io/${cleanIp}/json`)
        .then(res => res.json())
        .then(data => {
          if (data && data.country && data.country !== 'VN') {
            const timeStr = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
            sendZaloAlert(`🌍 CẢNH BÁO: Nhân viên @${user.username} (${user.fullName || 'Chưa cập nhật họ tên'}) đăng nhập thành công từ quốc gia lạ ngoài Việt Nam.\n📍 Vị trí: ${data.city || 'Chưa rõ'}, ${data.country}\n🌐 IP: ${ip} lúc ${timeStr}.`);
          }
        })
        .catch(err => console.error('[Zalo Alert] Lỗi định vị IP nước ngoài:', err));
    }

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