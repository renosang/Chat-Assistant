// Helper to send messages to Zalo via Webhook URL or official OA OpenAPI
async function sendZaloAlert(message, recipientId = null) {
  let webhookUrl = process.env.ZALO_WEBHOOK_URL;
  if (webhookUrl) {
    webhookUrl = webhookUrl
      .replace('${BOT_TOKEN}', process.env.BOT_TOKEN || '')
      .replace('${ID_GROUP}', process.env.ID_GROUP || '')
      .replace(/"/g, '')
      .trim();
  }
  if (!webhookUrl && process.env.BOT_TOKEN && process.env.ID_GROUP) {
    webhookUrl = `https://bot-api.zapps.me/bot${process.env.BOT_TOKEN}/sendMessage?chat_id=${process.env.ID_GROUP}`;
  }

  const accessToken = process.env.ZALO_ACCESS_TOKEN;
  const targetUserId = recipientId || process.env.ZALO_ADMIN_USER_ID;

  // PHƯƠNG THỨC 1: Sử dụng Zalo Webhook URL của bên thứ 3 (được ưu tiên nếu có cấu hình)
  if (webhookUrl) {
    try {
      console.log('[Zalo Alert] Đang gửi tin nhắn qua Zalo Webhook URL:', webhookUrl);
      
      // Tự động phân tích và trích xuất chat_id từ URL để đẩy vào body (hỗ trợ API dạng Telegram/Zapps)
      let chatId = null;
      try {
        const urlObj = new URL(webhookUrl);
        chatId = urlObj.searchParams.get('chat_id');
      } catch (e) {
        // Bỏ qua nếu lỗi phân tích URL
      }

      const payload = {
        message: message,
        text: message
      };

      if (chatId) {
        payload.chat_id = chatId;
        console.log('[Zalo Alert] Đã trích xuất chat_id vào body:', chatId);
      }

      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        console.error(`[Zalo Alert] ❌ Gửi Webhook thất bại. Status: ${response.status} ${response.statusText}. Response: ${errText}`);
      } else {
        console.log('[Zalo Alert] ✅ Gửi webhook tin nhắn thành công!');
      }
    } catch (err) {
      console.error('[Zalo Alert] ❌ Lỗi kết nối Zalo Webhook:', err);
    }
    return;
  }

  // PHƯƠNG THỨC 2: Sử dụng API Zalo OA chính thức
  if (accessToken && targetUserId) {
    try {
      console.log(`[Zalo Alert] Đang gửi tin nhắn tới Zalo User ID: ${targetUserId} qua OA API`);
      const response = await fetch('https://openapi.zalo.me/v2.0/oa/message', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'access_token': accessToken
        },
        body: JSON.stringify({
          recipient: {
            user_id: targetUserId
          },
          message: {
            text: message
          }
        })
      });
      
      const resData = await response.json();
      if (resData.error !== 0) {
        console.error(`[Zalo Alert] ❌ Gửi tin nhắn OA thất bại. Lỗi Zalo: ${resData.message} (Mã lỗi: ${resData.error})`);
      } else {
        console.log('[Zalo Alert] ✅ Gửi tin nhắn qua Zalo OA thành công!');
      }
    } catch (err) {
      console.error('[Zalo Alert] ❌ Lỗi kết nối API Zalo:', err);
    }
    return;
  }

  console.warn('[Zalo Alert] ⚠️ Chưa cấu hình ZALO_WEBHOOK_URL hoặc cặp khóa ZALO_ACCESS_TOKEN & ZALO_ADMIN_USER_ID trong .env');
}

module.exports = { sendZaloAlert };
