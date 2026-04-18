
const connectToDatabase = require('../../lib/db');
const User = require('../../models/User');

module.exports = async (req, res) => {
  const { u } = req.query; // Nhận username từ URL
  if (!u) return res.send("Cảm ơn bạn đã sử dụng.");

  try {
    await connectToDatabase();
    await User.findOneAndUpdate({ username: u }, { isUninstalled: true });
    
    // Trả về trang thông báo thân thiện
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(`
        <div style="text-align:center; padding: 50px; font-family: sans-serif;">
            <h1>Đã gỡ cài đặt thành công</h1>
            <p>Chúng tôi rất tiếc khi thấy bạn rời đi. Nếu có góp ý, hãy liên hệ Admin.</p>
            <a href="https://onpoint.vn" style="color: #2563eb;">Quay lại trang chủ</a>
        </div>
    `);
  } catch (e) {
    return res.send("Goodbye!");
  }
};
