<<<<<<< HEAD

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
=======
// Import các module cần thiết
const fs = require('fs');
const path = require('path');

// (*** HÀM MỚI: ĐỂ SET HEADER CORS ***)
// Hàm này "mở cửa" cho extension
function setCorsHeaders(response) {
  response.setHeader('Access-Control-Allow-Origin', '*'); // Cho phép mọi nguồn
  response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'X-API-Key, Content-Type');
  return response;
}

// Hàm handler chính của Vercel
export default function handler(request, response) {
  
  // (*** THAY ĐỔI ***)
  // 1. Mở cửa (Set CORS) cho TẤT CẢ các yêu cầu
  response = setCorsHeaders(response);

  // 2. Xử lý yêu cầu OPTIONS (trình duyệt tự động gửi)
  if (request.method === 'OPTIONS') {
    return response.status(200).end();
  }

  // 3. Lấy "Backend Key" mà extension gửi lên (từ header 'x-api-key')
  const incomingKey = request.headers['x-api-key'];

  // 4. Lấy "Backend Key" bí mật bạn đã lưu trên Vercel
  const secretKey = process.env.YOUR_BACKEND_API_KEY;

  // 5. KIỂM TRA BẢO MẬT
  if (!incomingKey || incomingKey !== secretKey) {
    return response.status(401).json({ error: 'Unauthorized' });
  }

  // 6. BẢO MẬT HỢP LỆ: Đọc và trả về file config.json
  try {
    const filePath = path.resolve(process.cwd(), 'config.json');
    const fileData = fs.readFileSync(filePath, 'utf8');
    const config = JSON.parse(fileData);
    
    // Trả về config
    return response.status(200).json(config);

  } catch (error) {
    return response.status(500).json({ error: 'Could not read config file.', details: error.message });
  }
}
>>>>>>> fdb76b0aa26f9a2252a13a997a735afd7f98102b
