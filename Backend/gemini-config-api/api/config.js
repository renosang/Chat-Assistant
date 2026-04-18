
const connectToDatabase = require('../lib/db');
const Settings = require('../models/Settings');
const User = require('../models/User');
const jwt = require('jsonwebtoken');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    await connectToDatabase();

    const settings = await Settings.findOne({ type: 'global' }).lean();

    const publicConfig = {
      minVersion: settings?.minVersion || "4.1",
      downloadUrl: settings?.downloadUrl || ""
    };

    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(200).json(publicConfig);

    const token = authHeader.split(' ')[1];
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret-key-123');
      const user = await User.findById(decoded.userId);
      if (!user || !user.isActive) return res.status(403).json({ error: 'Disabled' });

      // Tự động cập nhật trạng thái Online khi fetch config thành công
      user.lastActiveAt = new Date();
      user.isUninstalled = false;
      await user.save();

      return res.status(200).json({
        ...publicConfig,
        isEnabled: settings?.isEnabled ?? true,
        allBrands: settings?.allBrands || [],
        allMarketplaces: settings?.allMarketplaces || [],
        brandGroups: settings?.brandGroups || [],
        typoDictionary: settings?.typoDictionary || [],
        forbiddenRules: settings?.forbiddenRules || { VI: [], EN: [] }
      });
    } catch (err) {
      return res.status(200).json(publicConfig);
    }
  } catch (error) {
    return res.status(500).json({ error: 'Server Error' });
  }
};
