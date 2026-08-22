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

    const motivationConfig = {
      isEnabled: settings?.motivationConfig?.isEnabled ?? true,
      intervalSeconds: settings?.motivationConfig?.intervalSeconds || 12,
      displayMode: settings?.motivationConfig?.displayMode || 'sequential',
      theme: settings?.motivationConfig?.theme || 'indigo',
      showMascot: settings?.motivationConfig?.showMascot ?? true,
      messages: (settings?.motivationConfig?.messages && settings.motivationConfig.messages.length > 0) 
        ? settings.motivationConfig.messages 
        : [
            { id: "1", text: "Chào khách hàng đầu ngày thật tươi tắn nhé!", category: "greeting", isActive: true, priority: 3, timeSlot: "morning" },
            { id: "2", text: "Sử dụng đúng danh xưng giúp khách hàng cảm thấy được tôn trọng!", category: "tip", isActive: true, priority: 3, timeSlot: "all" },
            { id: "3", text: "Hãy luôn đồng cảm, khách hàng sẽ rất trân trọng đó!", category: "encouragement", isActive: true, priority: 3, timeSlot: "all" },
            { id: "4", text: "Nhớ kiểm tra lịch sử chat và đơn hàng trước khi tư vấn nhé!", category: "tip", isActive: true, priority: 3, timeSlot: "all" },
            { id: "5", text: "Hãy soát lại ticket thật kỹ trước khi gửi SWAT bạn nhé!", category: "reminder", isActive: true, priority: 3, timeSlot: "afternoon" },
            { id: "6", text: "Điền đầy đủ thông tin khi tạo ticket khiếu nại nhé!", category: "reminder", isActive: true, priority: 3, timeSlot: "all" },
            { id: "7", text: "Cố gắng lên nào, bạn đang làm rất tốt công việc của mình đó!", category: "encouragement", isActive: true, priority: 3, timeSlot: "afternoon" },
            { id: "8", text: "Một nụ cười của khách hàng là niềm vui của chúng ta!", category: "encouragement", isActive: true, priority: 3, timeSlot: "all" }
          ]
    };

    const publicConfig = {
      minVersion: settings?.minVersion || "4.1",
      downloadUrl: settings?.downloadUrl || "",
      motivationConfig
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

      const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
      const { updateDevice } = require('../lib/deviceHelper');
      await updateDevice(user._id, req.headers['user-agent'], ip, user.extVersion);

      return res.status(200).json({
        ...publicConfig,
        isEnabled: settings?.isEnabled ?? true,
        allBrands: settings?.allBrands || [],
        allMarketplaces: settings?.allMarketplaces || [],
        brandGroups: settings?.brandGroups || [],
        typoDictionary: settings?.typoDictionary || [],
        forbiddenRules: settings?.forbiddenRules || { VI: [], EN: [] },
        categoryChannelMappings: settings?.categoryChannelMappings || [],
        blockComplaintTicket: user.blockComplaintTicket ?? false // Tính năng chặn tạo ticket
      });
    } catch (err) {
      return res.status(200).json(publicConfig);
    }
  } catch (error) {
    return res.status(500).json({ error: 'Server Error' });
  }
};
