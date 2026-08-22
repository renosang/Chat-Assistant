const crypto = require('crypto');
const connectToDatabase = require('../lib/db');
const { logAction } = require('../lib/auditLogger');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-zalo-signature');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const signature = req.headers['x-zalo-signature'];
  const secretToken = process.env.ZALO_SECRET_TOKEN;

  // Xác thực chữ ký Zalo (nếu có cấu hình Secret Token)
  if (secretToken && signature) {
    const rawBody = JSON.stringify(req.body);
    const computedSignature = crypto
      .createHmac('sha256', secretToken)
      .update(rawBody)
      .digest('hex');
      
    if (signature !== computedSignature) {
      console.warn('[Zalo Webhook] Sai chữ ký xác thực');
      return res.status(401).json({ error: 'Invalid signature' });
    }
  }

  try {
    await connectToDatabase();
    const event = req.body;
    
    console.log('[Zalo Webhook] Nhận sự kiện:', JSON.stringify(event));

    // Phân tích sự kiện tin nhắn Zalo gửi đến
    let logMsg = `Zalo Webhook nhận sự kiện: ${event.event_name || 'Không rõ loại sự kiện'}`;
    if (event.message && event.message.text) {
      const senderId = (event.message.from && event.message.from.id) || (event.sender && event.sender.id) || 'User ẩn';
      const chatId = (event.message.chat && event.message.chat.id) || (senderId !== 'User ẩn' ? senderId : null);
      
      logMsg = `Zalo Bot nhận tin nhắn từ User ID ${senderId} (Chat ID: ${chatId || 'Không rõ'}): "${event.message.text}"`;

      // Trả lời tự động lại cho user / group
      if (chatId) {
        const { sendZaloAlert } = require('../lib/zaloAlert');
        await sendZaloAlert(`🤖 [Auto-Response] Hệ thống đã nhận được tin nhắn của bạn: "${event.message.text}"`, chatId);
      }
    }

    // Ghi nhận vào Audit Logs hệ thống
    await logAction('ZALO_EVENT', logMsg, req);

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('[Zalo Webhook Error]:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
};
