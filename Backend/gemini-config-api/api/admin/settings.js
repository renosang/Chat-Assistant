
const connectToDatabase = require('../../lib/db');
const Settings = require('../../models/Settings');
const { logAction } = require('../../lib/auditLogger');
const { sendZaloAlert } = require('../../lib/zaloAlert');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  await connectToDatabase();

  if (req.method === 'GET') {
    let settings = await Settings.findOne({ type: 'global' }).lean();
    if (!settings) return res.json({ brandGroups: [], typoDictionary: [] });
    return res.json(settings);
  }

  if (req.method === 'POST') {
    const data = req.body;
    try {
      const result = await Settings.updateOne(
        { type: 'global' },
        {
          $set: {
            isEnabled: data.isEnabled,
            promptTemplate: data.promptTemplate,
            allBrands: data.allBrands || [],
            allMarketplaces: data.allMarketplaces || [],
            brandGroups: data.brandGroups || [],
            typoDictionary: data.typoDictionary || [],
            forbiddenRules: data.forbiddenRules || { VI: [], EN: [] },
            categoryChannelMappings: data.categoryChannelMappings || [],
            motivationConfig: data.motivationConfig || undefined,
            minVersion: data.minVersion || '4.1',
            downloadUrl: data.downloadUrl || '',
            updatedAt: new Date()
          }
        },
        { upsert: true }
      );
      const saved = await Settings.findOne({ type: 'global' }).lean();
      await logAction('UPDATE_SETTINGS', 'Cập nhật cấu hình hệ thống toàn cục (Global Settings)', req);
      
      // Gửi cảnh báo Zalo
      const timeStr = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
      await sendZaloAlert(`⚙️ CẤU HÌNH: Cấu hình hệ thống toàn cục (Global Settings) đã được cập nhật thành công từ trang quản trị lúc ${timeStr}.`);

      return res.json(saved);
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }
};
