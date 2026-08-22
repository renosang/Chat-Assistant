const connectToDatabase = require('../../lib/db');
const AuditLog = require('../../models/AuditLog');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    await connectToDatabase();
    
    // Fetch logs sorted by latest first, limit to latest 50 logs (or adjust as needed)
    const logs = await AuditLog.find({}).sort({ createdAt: -1 }).limit(100).lean();
    return res.json(logs);
  } catch (error) {
    console.error('Audit Log Fetch Error:', error);
    return res.status(500).json({ error: 'Server Error' });
  }
};
