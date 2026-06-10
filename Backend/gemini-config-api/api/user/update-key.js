const connectToDatabase = require('../../lib/db');
const User = require('../../models/User');
const { encrypt } = require('../../lib/crypto');
const jwt = require('jsonwebtoken');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    await connectToDatabase();

    // 1. Xác thực Token
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'Missing Auth Token' });
    
    const token = authHeader.split(' ')[1];
    const JWT_SECRET = process.env.JWT_SECRET || 'secret-key-123';
    
    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (err) {
      return res.status(403).json({ error: 'Invalid Token' });
    }

    // 2. Lấy API Key từ Body
    const { apiKey } = req.body;
    if (!apiKey) {
        return res.status(400).json({ error: "Missing API Key" });
    }

    // 3. Mã hóa và Lưu
    const encryptedKey = encrypt(apiKey);
    
    await User.findByIdAndUpdate(decoded.userId, { 
        encryptedApiKey: encryptedKey 
    });

    return res.status(200).json({ success: true, message: "API Key updated securely." });

  } catch (error) {
    console.error("Update Key Error:", error);
    return res.status(500).json({ error: 'Server Error' });
  }
};