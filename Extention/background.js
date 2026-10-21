// --- CONFIGURATION ---
const API_BASE_URL = "https://macro.beegadget.net/api";
const API_URL = `${API_BASE_URL}/config`;
const HEARTBEAT_URL = `${API_BASE_URL}/user/heartbeat`;
const CONFIG_ALARM = "ASSISTANT_AUTO_FETCH";
const HEARTBEAT_ALARM = "ASSISTANT_HEARTBEAT";

// 1. SETUP ALARMS & LISTENERS
chrome.runtime.onInstalled.addListener(() => {
  fetchRemoteConfig();
  sendHeartbeat();
  chrome.alarms.create(CONFIG_ALARM, { periodInMinutes: 10 });
  chrome.alarms.create(HEARTBEAT_ALARM, { periodInMinutes: 1 });
  chrome.runtime.setUninstallURL("");
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === CONFIG_ALARM) fetchRemoteConfig();
  if (alarm.name === HEARTBEAT_ALARM) sendHeartbeat();
});

chrome.runtime.onStartup.addListener(() => {
  fetchRemoteConfig();
  sendHeartbeat();
});

// Lắng nghe thay đổi AuthToken trong Storage để tải config ngay lập tức
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'sync' && changes.authToken) {
    fetchRemoteConfig();
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "reloadConfig") {
    fetchRemoteConfig();
    sendResponse({ status: "fetching" });
  }
  if (request.action === "openExtensions") {
    chrome.tabs.create({ url: 'chrome://extensions/' });
  }
  if (request.action === "deactivateAccount") {
    handleDeactivation(sendResponse);
    return true;
  }
  if (request.action === "ALERT_VIOLATION_ZALO") {
    sendViolationAlertToServer(request.data, sendResponse);
    return true;
  }
  if (request.action === "forceLogout") {
    forceLogoutUser(request.reason);
    sendResponse({ status: "logged_out" });
    return true;
  }
});

async function sendViolationAlertToServer(alertData, sendResponse) {
  try {
    const syncData = await chrome.storage.sync.get([
      'macroAuthToken',
      'macroUser',
      'macroUsername',
      'username',
      'authToken'
    ]);

    const token = syncData.macroAuthToken || syncData.authToken;
    const headers = { 'Content-Type': 'application/json' };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    // Tự động làm giàu danh tính CS nếu dữ liệu DOM chưa nhận diện được
    if (!alertData.csUser || alertData.csUser.name === 'CS_Unknown' || alertData.csUser.account === 'CS') {
      const user = syncData.macroUser;
      if (user && user.username) {
        alertData.csUser = {
          name: user.fullName || user.username,
          account: user.username,
          group: user.team || 'Default',
          userId: user.id
        };
      } else if (syncData.macroUsername || syncData.username) {
        const u = syncData.macroUsername || syncData.username;
        alertData.csUser = {
          name: u,
          account: u,
          group: 'Default'
        };
      }
    }

    const response = await fetch(`${API_BASE_URL}/utils/violation-alert`, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(alertData)
    });

    if (response.ok) {
      const res = await response.json();
      sendResponse({ success: true, res });
    } else {
      sendResponse({ success: false, status: response.status });
    }
  } catch (err) {
    sendResponse({ success: false, error: err.message });
  }
}

// 2. CORE FUNCTIONS
async function fetchRemoteConfig() {
  try {
    const settings = await chrome.storage.sync.get(['authToken']);
    const headers = {};
    if (settings.authToken) {
      headers['Authorization'] = `Bearer ${settings.authToken}`;
    }

    const apiUrl = `${API_URL}?t=${Date.now()}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const response = await fetch(apiUrl, { headers, signal: controller.signal }).catch(() => null);
    clearTimeout(timer);

    if (response) {
      if (response.status === 401 || response.status === 403) {
        await forceLogoutUser("Tài khoản của bạn đã bị vô hiệu hóa hoặc phiên đăng nhập hết hạn.");
        return false;
      }

      if (response.ok) {
        const config = await response.json();

        await chrome.storage.local.set({
          remoteConfig: config
        });

        // Notify all tabs including the active one
        chrome.tabs.query({}, (tabs) => {
          tabs.forEach(tab => {
            chrome.tabs.sendMessage(tab.id, { action: "CONFIG_UPDATED", config }).catch(() => {});
          });
        });
        return true;
      }
    }
    return false;
  } catch (error) {
    console.warn("[Assistant BG] Network check error:", error.message || error);
  }
}

async function forceLogoutUser(reason = "Tài khoản của bạn đã bị khóa hoặc phiên đăng nhập hết hạn.") {
  try {
    await chrome.storage.sync.remove([
      'authToken', 
      'username', 
      'macroAuthToken', 
      'macroUsername', 
      'macroUser'
    ]);
    await chrome.storage.local.remove(['remoteConfig']);
    
    // Broadcast kick to all active tabs
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach(tab => {
        if (tab.id) {
          chrome.tabs.sendMessage(tab.id, { action: "FORCE_LOGOUT", reason }).catch(() => {});
        }
      });
    });
  } catch (err) {
    console.error("[Assistant BG] Error during force logout:", err);
  }
}

async function handleDeactivation(sendResponse) {
  try {
    const settings = await chrome.storage.sync.get(['authToken', 'username']);
    if (!settings.authToken) return sendResponse({ success: false, message: "Unauthenticated" });

    const response = await fetch(`${API_BASE_URL}/deactivate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${settings.authToken}`
      },
      body: JSON.stringify({ reason: "Manual uninstallation request" })
    });

    if (response.ok) {
      await forceLogoutUser("Bạn đã gỡ cài đặt tiện ích.");
      sendResponse({ success: true });
    } else {
      sendResponse({ success: false, message: "Server rejected" });
    }
  } catch (err) {
    sendResponse({ success: false, message: err.message });
  }
}

async function sendHeartbeat() {
  try {
    const settings = await chrome.storage.sync.get(['authToken']);
    if (!settings.authToken) return;

    const response = await fetch(HEARTBEAT_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${settings.authToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ 
        version: chrome.runtime.getManifest().version
      })
    });

    if (response) {
      if (response.status === 401 || response.status === 403) {
        await forceLogoutUser("Tài khoản của bạn đã bị khóa bởi Quản trị viên.");
        return;
      }
    }
  } catch (error) {
    // Silently ignore network failures
  }
}
