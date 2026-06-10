
const connectToDatabase = require('../lib/db');
const User = require('../models/User');
const jwt = require('jsonwebtoken');

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) return res.status(401).json({ message: 'Unauthorized' });

        const token = authHeader.split(' ')[1];
        let decoded;
        try {
            decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret-key-123');
        } catch (err) {
            return res.status(401).json({ message: 'Invalid token' });
        }

        await connectToDatabase();

        // Tìm và cập nhật user: khóa tài khoản và đánh dấu đã gỡ
        const user = await User.findByIdAndUpdate(
            decoded.userId,
            {
                isActive: false,
                isUninstalled: true,
                uninstalledAt: new Date()
            },
            { new: true }
        );

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        console.log(`[Backend] User ${user.username} deactivated.`);
        return res.status(200).json({ success: true, message: 'Account deactivated' });
    } catch (error) {
        console.error('Deactivation Error:', error);
        return res.status(500).json({ message: 'Internal Server Error' });
    }
};
