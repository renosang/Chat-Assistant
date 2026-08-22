
// --- CONFIGURATION ---
const API_BASE_URL = "https://api.beegadget.net/api";
const API_URL = `${API_BASE_URL}/config`;
const HEARTBEAT_URL = `${API_BASE_URL}/user/heartbeat`;
const CONFIG_ALARM = "GEMINI_AUTO_FETCH";
const HEARTBEAT_ALARM = "GEMINI_HEARTBEAT";

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
});

async function getActiveApiUrl() {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1000);
    const res = await fetch(`http://localhost:3010/api/config?t=${Date.now()}`, { signal: controller.signal });
    clearTimeout(timer);
    if (res.ok) {
      return "http://localhost:3010/api";
    }
  } catch (e) {}
  return "https://api.beegadget.net/api";
}

// 2. CORE FUNCTIONS
async function fetchRemoteConfig() {
  try {
    const settings = await chrome.storage.sync.get(['authToken']);
    const headers = {};
    if (settings.authToken) {
      headers['Authorization'] = `Bearer ${settings.authToken}`;
    }

    const baseUrl = await getActiveApiUrl();
    const apiUrl = `${baseUrl}/config?t=${Date.now()}`;
    console.log("[Gemini BG] Fetching from:", apiUrl);

    const response = await fetch(apiUrl, { headers });

    if (response.ok) {
      const config = await response.json();
      
      const typoCount = config.typoDictionary ? config.typoDictionary.length : 0;
      console.log(`[Gemini BG] ✅ Config loaded from ${baseUrl}. Theme: ${config.motivationConfig?.theme}`);

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
      console.error("[Gemini BG] Fetch failed:", response.status, response.statusText);
      return false;
    }
  } catch (error) {
    console.error("[Gemini BG] Network error:", error);
  }
}

async function handleDeactivation(sendResponse) {
  try {
    const settings = await chrome.storage.sync.get(['authToken', 'username']);
    if (!settings.authToken) return sendResponse({ success: false, message: "Unauthenticated" });

    console.log("[Gemini BG] Deactivating account for:", settings.username);

    // Call backend to lock account
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

function checkCriticalErrorsLocally(text, config, context) {
  // Logic fallback cho background (nếu cần xử lý context menu sau này)
  return [];
}

async function sendHeartbeat() {
  try {
    const settings = await chrome.storage.sync.get(['authToken']);
    if (!settings.authToken) return;

    await fetch(HEARTBEAT_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${settings.authToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ 
        version: chrome.runtime.getManifest().version
      })
    });
    console.log("[Gemini BG] Heartbeat sent.");
  } catch (error) {
    console.error("[Gemini BG] Heartbeat failed:", error);
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
      console.error("[Gemini BG] Failed to save log to server:", response.status);
      sendResponse({ success: false, error: response.status });
    }
  } catch (err) {
    console.error("[Gemini BG] Error saving log to server:", err);
    sendResponse({ success: false, error: err.message });
  }
}
