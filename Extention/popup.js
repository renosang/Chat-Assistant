
const API_BASE_URL = "https://gemini-config-api.vercel.app/api";
const MACRO_API_BASE_URL = "https://macro-react-xi.vercel.app/api";

document.addEventListener('DOMContentLoaded', () => {
  const loginView = document.getElementById('loginView');
  const settingsView = document.getElementById('settingsView');
  const userBadge = document.getElementById('userBadge');

  const usernameInput = document.getElementById('username');
  const passwordInput = document.getElementById('password');
  const btnLogin = document.getElementById('btnLogin');
  const loginMessage = document.getElementById('loginMessage');

  const btnLogout = document.getElementById('btnLogout');
  const currentUserLabel = document.getElementById('currentUser');

  const btnSync = document.getElementById('btnSync');
  const syncMessage = document.getElementById('syncMessage');

  const updateView = document.getElementById('updateView');
  const btnGuide = document.getElementById('btnGuide');
  const guideModal = document.getElementById('guideModal');
  const closeGuide = document.getElementById('closeGuide');
  const linkDownload = document.getElementById('linkDownload');
  const extensionVersion = document.getElementById('extensionVersion');

  // macro system elements
  const macroView = document.getElementById('macroView');
  const btnOpenMacro = document.getElementById('btnOpenMacro');
  const btnBackToMain = document.getElementById('btnBackToMain');
  const macroLoginSection = document.getElementById('macroLoginSection');
  const macroContentSection = document.getElementById('macroContentSection');
  const btnMacroLogin = document.getElementById('btnMacroLogin');
  const macroUsernameInput = document.getElementById('macroUsername');
  const macroPasswordInput = document.getElementById('macroPassword');
  const macroLoginMessage = document.getElementById('macroLoginMessage');
  const macroSearchInput = document.getElementById('macroSearchInput');
  const macroResultsContainer = document.getElementById('macroResults');
  const btnMacroLogout = document.getElementById('btnMacroLogout');

  if (extensionVersion) {
    extensionVersion.textContent = 'v' + chrome.runtime.getManifest().version;

    let clickCount = 0;
    extensionVersion.addEventListener('click', () => {
      clickCount++;
      if (clickCount === 7) {
        chrome.tabs.create({ url: chrome.runtime.getURL('test_area.html') });
        clickCount = 0;
      }
      // Reset counter after 2 seconds of inactivity
      clearTimeout(extensionVersion.clickTimeout);
      extensionVersion.clickTimeout = setTimeout(() => {
        clickCount = 0;
      }, 2000);
    });
  }

  checkVersionAndAuth();
  // We remove the auto-reload on open to avoid redundancy, user can force if needed
  // chrome.runtime.sendMessage({ action: "reloadConfig" });

  const handleEnter = (e) => {
    if (e.key === 'Enter') btnLogin.click();
  };
  usernameInput.addEventListener('keydown', handleEnter);
  passwordInput.addEventListener('keydown', handleEnter);

  btnSync.addEventListener('click', () => {
    setLoading(btnSync, true, 'Đang đồng bộ...');
    showMessage(syncMessage, '', ''); // Clear previous

    chrome.runtime.sendMessage({ action: "reloadConfig" }, (response) => {
      // Background usually sends 'fetching'
      // We'll wait a brief moment to show success if no errors
      setTimeout(() => {
        setLoading(btnSync, false, 'Đồng bộ cấu hình');
        showMessage(syncMessage, 'Đã đồng bộ thành công!', 'green');

        // RE-CHECK VERSION AFTER SYNC
        checkVersionAndAuth();

        // Auto hide message after 3s
        setTimeout(() => showMessage(syncMessage, '', ''), 3000);
      }, 1000);
    });
  });

  const btnOpenReport = document.getElementById('btnOpenReport');
  if (btnOpenReport) {
    btnOpenReport.addEventListener('click', () => {
      chrome.storage.sync.get(['username'], (data) => {
        const userParam = data.username ? `?user=${encodeURIComponent(data.username.toUpperCase())}` : '';
        chrome.tabs.create({ url: chrome.runtime.getURL('admin_report.html' + userParam) });
      });
    });
  }

  // --- Macro System Integration logic ---
  btnOpenMacro.addEventListener('click', () => {
    loginView.classList.remove('active');
    settingsView.classList.remove('active');
    macroView.classList.add('active');
    checkMacroAuthStatus();
  });

  btnBackToMain.addEventListener('click', () => {
    macroView.classList.remove('active');
    settingsView.classList.add('active');
  });

  function checkMacroAuthStatus() {
    chrome.storage.sync.get(['macroAuthToken'], (data) => {
      if (data.macroAuthToken) {
        macroLoginSection.style.display = 'none';
        macroContentSection.style.display = 'block';
      } else {
        macroLoginSection.style.display = 'block';
        macroContentSection.style.display = 'none';
        macroLoginMessage.textContent = '';
      }
    });
  }

  btnMacroLogin.addEventListener('click', async () => {
    const username = macroUsernameInput.value.trim();
    const password = macroPasswordInput.value.trim();

    if (!username || !password) {
      showMessage(macroLoginMessage, 'Vui lòng nhập tên đăng nhập và mật khẩu.', 'red');
      return;
    }

    setLoading(btnMacroLogin, true, 'Đang xác thực Macro...');
    try {
      const response = await fetch(`${MACRO_API_BASE_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });

      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Đăng nhập Macro thất bại.');

      chrome.storage.sync.set({ macroAuthToken: result.token }, () => {
        checkMacroAuthStatus();
      });
    } catch (error) {
      showMessage(macroLoginMessage, error.message, 'red');
    } finally {
      setLoading(btnMacroLogin, false, 'Đăng nhập Macro');
    }
  });

  btnMacroLogout.addEventListener('click', () => {
    chrome.storage.sync.remove(['macroAuthToken'], () => {
      checkMacroAuthStatus();
    });
  });

  btnMacroLogout.addEventListener('click', () => {
    chrome.storage.sync.remove(['macroAuthToken'], () => {
      checkMacroAuthStatus();
    });
  });

  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'sync' && (changes.authToken || changes.username)) {
      checkAuthStatus();
    }
  });

  function checkVersionAndAuth() {
    chrome.storage.local.get(['minVersion', 'downloadUrl'], (local) => {
      const currentVersion = chrome.runtime.getManifest().version;
      const minRequired = local.minVersion || '4.1';

      if (isOutdated(currentVersion, minRequired)) {
        showUpdateView(local.downloadUrl);
      } else {
        checkAuthStatus();
      }
    });
  }

  function isOutdated(current, min) {
    const c = current.split('.').map(Number);
    const m = min.split('.').map(Number);
    for (let i = 0; i < Math.max(c.length, m.length); i++) {
      if ((c[i] || 0) < (m[i] || 0)) return true;
      if ((c[i] || 0) > (m[i] || 0)) return false;
    }
    return false;
  }

  function showUpdateView(url) {
    loginView.classList.remove('active');
    settingsView.classList.remove('active');
    updateView.classList.add('active');
    userBadge.style.display = 'none';
    if (url) linkDownload.href = url;
  }

  btnGuide.addEventListener('click', (e) => {
    e.preventDefault();
    guideModal.classList.add('active');
  });

  closeGuide.addEventListener('click', () => {
    guideModal.classList.remove('active');
  });

  const linkExtensions = document.getElementById('linkExtensions');
  if (linkExtensions) {
    linkExtensions.addEventListener('click', (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: 'chrome://extensions' });
    });
  }

  function checkAuthStatus() {
    chrome.storage.sync.get(['authToken', 'username'], (data) => {
      if (data.authToken) {
        showSettingsView(data);
      } else {
        showLoginView();
      }
    });
  }

  function showLoginView() {
    loginView.classList.add('active');
    settingsView.classList.remove('active');
    updateView.classList.remove('active');
    userBadge.style.display = 'none';
    loginMessage.textContent = '';
    usernameInput.focus();
  }

  function showSettingsView(data) {
    loginView.classList.remove('active');
    settingsView.classList.add('active');
    updateView.classList.remove('active');
    userBadge.style.display = 'flex';
    if (data.username) currentUserLabel.textContent = data.username.toUpperCase();
  }

  btnLogin.addEventListener('click', async () => {
    const username = usernameInput.value.trim();
    const password = passwordInput.value.trim();

    if (!username || !password) {
      showMessage(loginMessage, 'Vui lòng nhập đầy đủ thông tin.', 'red');
      return;
    }

    setLoading(btnLogin, true, 'Đang xác thực...');
    try {
      const response = await fetch(`${API_BASE_URL}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, version: chrome.runtime.getManifest().version })
      });

      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Đăng nhập thất bại.');

      chrome.storage.sync.set({ authToken: result.token, username: username }, () => {
        chrome.runtime.sendMessage({ action: "reloadConfig" });
        checkAuthStatus();
      });
    } catch (error) {
      showMessage(loginMessage, error.message, 'red');
    } finally {
      setLoading(btnLogin, false, 'Đăng nhập');
    }
  });

  btnLogout.addEventListener('click', () => {
    chrome.storage.sync.remove(['authToken', 'username'], () => {
      chrome.storage.local.remove('remoteConfig');
      chrome.runtime.sendMessage({ action: "userLoggedOut" });
      showLoginView();
    });
  });

  const btnUninstall = document.getElementById('btnUninstall');
  const confirmModal = document.getElementById('confirmModal');
  const modalCancel = document.getElementById('modalCancel'); // ID is same
  const modalConfirm = document.getElementById('modalConfirm'); // ID is same

  btnUninstall.addEventListener('click', () => {
    confirmModal.classList.add('active');
  });

  modalCancel.addEventListener('click', () => {
    confirmModal.classList.remove('active');
  });

  modalConfirm.addEventListener('click', async () => {
    setLoading(modalConfirm, true, 'Đang gỡ...');
    modalCancel.disabled = true;

    // Send deactivation message (Background tries to lock account)
    chrome.runtime.sendMessage({ action: "deactivateAccount" }, (res) => {
      // REGARDLESS of server result, we proceed to uninstall as requested by user
      if (chrome.management && chrome.management.uninstallSelf) {
        chrome.management.uninstallSelf({ showConfirmDialog: false }, () => {
          if (chrome.runtime.lastError) {
            // If uninstall fails (unlikely), we at least close the popup
            window.close();
          }
        });
      } else {
        // Fallback for unexpected environments
        window.close();
      }
    });

    // Optional: timeout as ultimate fallback if message response hangs
    setTimeout(() => window.close(), 3000);
  });

  function showMessage(element, text, color) {
    element.textContent = text;
    element.style.color = (color === 'red') ? '#ef4444' : '#10b981';
  }

  function setLoading(btn, isLoading, text) {
    btn.disabled = isLoading;
    const span = btn.querySelector('span');
    if (span) span.textContent = text;
    btn.style.opacity = isLoading ? '0.7' : '1';
  }
});
