const crypto = require('crypto');
const User = require('../models/User');

function parseUserAgent(ua) {
  if (!ua) return { os: 'Chưa rõ OS', browser: 'Chưa rõ Browser' };
  
  let os = 'Chưa rõ OS';
  if (/windows/i.test(ua)) os = 'Windows';
  else if (/macintosh|mac os x/i.test(ua)) os = 'macOS';
  else if (/linux/i.test(ua)) os = 'Linux';
  else if (/android/i.test(ua)) os = 'Android';
  else if (/iphone|ipad|ipod/i.test(ua)) os = 'iOS';

  let browser = 'Chưa rõ Browser';
  if (/cococ/i.test(ua) || /coc_coc/i.test(ua)) browser = 'Cốc Cốc';
  else if (/edg/i.test(ua)) browser = 'Edge';
  else if (/opr/i.test(ua) || /opera/i.test(ua)) browser = 'Opera';
  else if (/chrome/i.test(ua)) browser = 'Chrome';
  else if (/firefox/i.test(ua)) browser = 'Firefox';
  else if (/safari/i.test(ua)) browser = 'Safari';

  return { os, browser };
}

async function getIpLocation(ip) {
  if (!ip || ip === '127.0.0.1' || ip === '::1' || ip.startsWith('192.168.') || ip.startsWith('10.')) {
    return 'Local / Private';
  }
  // Remove ipv6 prefix if mapped
  const cleanIp = ip.replace(/^.*:/, '');
  try {
    const res = await fetch(`https://ipinfo.io/${cleanIp}/json`);
    if (res.ok) {
      const data = await res.json();
      if (data.city && data.country) {
        return `${data.city}, ${data.country}`;
      } else if (data.country) {
        return data.country;
      }
    }
  } catch (e) {
    console.error('Lỗi định vị IP với ipinfo.io:', e);
  }
  return 'Chưa rõ';
}

async function updateDevice(userId, userAgent, ip, version) {
  const ua = userAgent || 'Unknown User Agent';
  const deviceId = crypto.createHash('md5').update(ua).digest('hex');

  const { os, browser } = parseUserAgent(ua);
  const deviceName = `${browser} (${os})`;
  const location = await getIpLocation(ip);

  // 1. Cập nhật thiết bị hiện tại nếu đã tồn tại
  const updateResult = await User.updateOne(
    { _id: userId, 'devices.deviceId': deviceId },
    {
      $set: {
        'devices.$.deviceName': deviceName,
        'devices.$.lastIp': ip,
        'devices.$.location': location,
        'devices.$.extVersion': version || 'N/A',
        'devices.$.lastActiveAt': new Date()
      }
    }
  );

  // 2. Nếu không có thiết bị nào được cập nhật, thêm thiết bị mới vào danh sách
  if (updateResult.matchedCount === 0) {
    await User.updateOne(
      { _id: userId, 'devices.deviceId': { $ne: deviceId } },
      {
        $push: {
          devices: {
            deviceId,
            deviceName,
            lastIp: ip,
            location,
            extVersion: version || 'N/A',
            lastActiveAt: new Date()
          }
        }
      }
    );
  }
}

module.exports = { updateDevice, parseUserAgent, getIpLocation };
