
const connectToDatabase = require('../../lib/db');
const User = require('../../models/User');
const jwt = require('jsonwebtoken');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    await connectToDatabase();
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).end();

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret-key-123');

    const { version } = req.body;
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    await User.findByIdAndUpdate(decoded.userId, {
      lastActiveAt: new Date(),
      lastIp: ip,
      isUninstalled: false,
      extVersion: version || "N/A"
    });

    return res.status(200).json({ success: true });
  } catch (error) {
    return res.status(401).end();
  }
};
