
// --- CONFIGURATION ---
// 1. Máy chủ Quản trị Luật & Cấu hình Extension (https://api.beegadget.net/admin/)
const API_BASE_URL = "https://api.beegadget.net/api";
const API_URL = `${API_BASE_URL}/config`;
const HEARTBEAT_URL = `${API_BASE_URL}/user/heartbeat`;
const CONFIG_ALARM = "GEMINI_AUTO_FETCH";
const HEARTBEAT_ALARM = "GEMINI_HEARTBEAT";

// 2. Máy chủ Macro Assistant & Zalo Alert
const MACRO_API_BASE_URL = "https://macro.beegadget.net/api";

// 1. SETUP ALARMS & LISTENERS
chrome.runtime.onInstalled.addListener(() => {
  console.log("[Gemini BG] Extension Installed. Initializing...");
  fetchRemoteConfig();
  sendHeartbeat();
  chrome.alarms.create(CONFIG_ALARM, { periodInMinutes: 10 });
  chrome.alarms.create(HEARTBEAT_ALARM, { periodInMinutes: 1 }); // Heartbeat mỗi 1 phút
  chrome.runtime.setUninstallURL("");
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === CONFIG_ALARM) fetchRemoteConfig();
  if (alarm.name === HEARTBEAT_ALARM) sendHeartbeat();
});

chrome.runtime.onStartup.addListener(() => {
  console.log("[Gemini BG] Browser Started. Initializing...");
  fetchRemoteConfig();
  sendHeartbeat();
});

// Lắng nghe thay đổi AuthToken trong Storage để tải config ngay lập tức
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'sync' && changes.authToken) {
    console.log("[Gemini BG] AuthToken changed. Reloading config...");
    fetchRemoteConfig();
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "reloadConfig") {
    console.log("[Gemini BG] Manual reload requested.");
    fetchRemoteConfig();
    sendResponse({ status: "fetching" });
  }
  if (request.action === "openExtensions") {
    chrome.tabs.create({ url: 'chrome://extensions/' });
  }
  if (request.action === "validateText") {
    handleValidation(request, sendResponse);
    return true; // Keep channel open
  }
  if (request.action === "deactivateAccount") {
    handleDeactivation(sendResponse);
    return true;
  }
  if (request.action === "SAVE_QUALITY_LOG") {
    saveQualityLogToServer(request.data, sendResponse);
    return true;
  }
  if (request.action === "ALERT_VIOLATION_ZALO") {
    sendViolationAlertToServer(request.data, sendResponse);
    return true;
  }
});

async function getMacroApiUrl() {
  const localPorts = [5000, 3010];
  for (const port of localPorts) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 800);
      const res = await fetch(`http://localhost:${port}/api/utils/proxy-image?url=test&t=${Date.now()}`, { signal: controller.signal });
      clearTimeout(timer);
      if (res.status === 400 || res.ok) {
        return `http://localhost:${port}/api`;
      }
    } catch (e) {}
  }
  return MACRO_API_BASE_URL;
}

async function sendViolationAlertToServer(alertData, sendResponse) {
  try {
    const settings = await chrome.storage.sync.get(['authToken']);
    const headers = { 'Content-Type': 'application/json' };
    if (settings.authToken) {
      headers['Authorization'] = `Bearer ${settings.authToken}`;
    }

    const baseUrl = await getMacroApiUrl();
    console.log('[Gemini BG] Sending violation alert to:', `${baseUrl}/utils/violation-alert`);
    const response = await fetch(`${baseUrl}/utils/violation-alert`, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(alertData)
    });

    if (response.ok) {
      const res = await response.json();
      console.log('[Gemini BG] ✅ Violation alert sent successfully:', res);
      sendResponse({ success: true, res });
    } else {
      console.warn('[Gemini BG] ❌ Violation alert rejected by server:', response.status);
      sendResponse({ success: false, status: response.status });
    }
  } catch (err) {
    console.error('[Gemini BG] Error sending violation alert:', err);
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
    console.log("[Gemini BG] Fetching remote config from:", apiUrl);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const response = await fetch(apiUrl, { headers, signal: controller.signal }).catch(e => null);
    clearTimeout(timer);

    if (response && response.ok) {
      const config = await response.json();
      
      const typoCount = config.typoDictionary ? config.typoDictionary.length : 0;
      console.log(`[Gemini BG] ✅ Config loaded from ${API_BASE_URL}. Theme: ${config.motivationConfig?.theme}`);

      await chrome.storage.local.set({
        remoteConfig: config
      });

      // Notify all tabs including the active one
      chrome.tabs.query({}, (tabs) => {
        tabs.forEach(tab => {
          chrome.tabs.sendMessage(tab.id, { action: "CONFIG_UPDATED", config }).catch(() => { });
        });
      });
      return true;
    } else {
      console.log("[Gemini BG] Fetch remote config skipped or returned non-200 status.");
      return false;
    }
  } catch (error) {
    console.warn("[Gemini BG] Network check:", error.message || error);
  }
}

async function handleDeactivation(sendResponse) {
  try {
    const settings = await chrome.storage.sync.get(['authToken', 'username']);
    if (!settings.authToken) return sendResponse({ success: false, message: "Unauthenticated" });

    console.log("[Gemini BG] Deactivating account for:", settings.username);

    const response = await fetch(`${API_BASE_URL}/deactivate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${settings.authToken}`
      },
      body: JSON.stringify({ reason: "Manual uninstallation request" })
    });

    if (response.ok) {
      // Clear local sensitive data
      await chrome.storage.sync.remove(['authToken', 'username']);
      await chrome.storage.local.remove('remoteConfig');

      sendResponse({ success: true });
    } else {
      console.error("[Gemini BG] Server rejected deactivation:", response.status);
      sendResponse({ success: false, message: "Server rejected" });
    }
  } catch (err) {
    console.error("[Gemini BG] Deactivation error:", err);
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
    if (response.ok) {
      console.log("[Gemini BG] Heartbeat sent.");
    }
  } catch (error) {
    // Silently ignore network failures (offline / local dev mode)
  }
}

async function saveQualityLogToServer(logData, sendResponse) {
  try {
    const settings = await chrome.storage.sync.get(['authToken']);
    const headers = { 'Content-Type': 'application/json' };
    if (settings.authToken) {
      headers['Authorization'] = `Bearer ${settings.authToken}`;
    }

    const response = await fetch(`${API_BASE_URL}/report/save`, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(logData)
    });

    if (response.ok) {
      const res = await response.json();
      sendResponse({ success: true, id: res.id });
    } else {
      sendResponse({ success: false, error: response.status });
    }
  } catch (err) {
    sendResponse({ success: false, error: err.message });
  }
}

function checkCriticalErrorsLocally(text, config, context) {
  // Logic fallback cho background (nếu cần xử lý context menu sau này)
  return [];
}
