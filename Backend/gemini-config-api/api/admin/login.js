
module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { password } = req.body;
    const ADMIN_PASS = process.env.ADMIN_PASSWORD || 'admin123';

    if (password === ADMIN_PASS) {
        return res.json({ success: true, token: 'admin-session-active' });
    } else {
        return res.status(401).json({ error: 'Sai mật khẩu quản trị' });
    }
};
