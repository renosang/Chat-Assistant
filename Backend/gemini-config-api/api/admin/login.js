
const { sendZaloAlert } = require('../../lib/zaloAlert');

// Bộ nhớ đệm lưu số lần nhập sai pass Admin theo IP
const adminFailedAttemptsMap = new Map();
const ATTEMPT_LIMIT = 5;
const COOLDOWN_TIME = 5 * 60 * 1000; // 5 phút

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

    const trackFailedAttempt = async () => {
        const now = Date.now();
        let record = adminFailedAttemptsMap.get(ip) || { count: 0, lastAttempt: now };
        if (now - record.lastAttempt > COOLDOWN_TIME) {
            record.count = 0;
        }
        record.count += 1;
        record.lastAttempt = now;
        adminFailedAttemptsMap.set(ip, record);

        if (record.count >= ATTEMPT_LIMIT) {
            const timeStr = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
            await sendZaloAlert(`🚨 CẢNH BÁO NGUY HIỂM: Phát hiện hành vi dò mật khẩu quản trị (Admin Panel) từ IP: ${ip} (Thất bại ${record.count} lần liên tiếp) lúc ${timeStr}.`);
        }
    };

    const { password } = req.body;
    const ADMIN_PASS = process.env.ADMIN_PASSWORD || 'admin123';

    if (password === ADMIN_PASS) {
        adminFailedAttemptsMap.delete(ip);
        return res.json({ success: true, token: 'admin-session-active' });
    } else {
        await trackFailedAttempt();
        return res.status(401).json({ error: 'Sai mật khẩu quản trị' });
    }
};
