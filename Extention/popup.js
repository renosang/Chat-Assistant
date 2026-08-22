
const API_BASE_URL = "https://api.beegadget.net/api";
const MACRO_API_BASE_URL = "https://macro.beegadget.net/api";

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
        chrome.tabs.create({ url: chrome.runtime.getURL('demo.html') });
        clickCount = 0;
      }
      // Reset counter after 2 seconds of inactivity
      clearTimeout(extensionVersion.clickTimeout);
      extensionVersion.clickTimeout = setTimeout(() => {
        clickCount = 0;
      }, 2000);
    });
  }

  checkAuthStatus();
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
      // Broadcast to all active tabs to clear macro cache immediately
      chrome.tabs.query({}, (tabs) => {
        tabs.forEach(tab => {
          if (tab.id) {
            chrome.tabs.sendMessage(tab.id, { action: "clearMacroCache" }).catch(() => {});
          }
        });
      });

      setTimeout(() => {
        setLoading(btnSync, false, 'Đồng bộ cấu hình');
        showMessage(syncMessage, 'Đã đồng bộ thành công và xóa bộ nhớ đệm!', 'green');

        // RE-CHECK VERSION AFTER SYNC
        checkAuthStatus();

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
    chrome.storage.sync.get(['macroAuthToken'], async (data) => {
      if (data.macroAuthToken) {
        try {
          const response = await fetch(`${MACRO_API_BASE_URL}/auth/me`, {
            headers: { 'Authorization': `Bearer ${data.macroAuthToken}` }
          });
          if (response.status === 401) {
            chrome.storage.sync.remove(['macroAuthToken']);
            return;
          }
          macroLoginSection.style.display = 'none';
          macroContentSection.style.display = 'block';
        } catch (err) {
          console.error('Lỗi xác thực phiên Macro:', err);
          // Gặp lỗi kết nối mạng tạm thời vẫn giữ giao diện kết nối
          macroLoginSection.style.display = 'none';
          macroContentSection.style.display = 'block';
        }
      } else {
        macroLoginSection.style.display = 'block';
        macroContentSection.style.display = 'none';
        macroLoginMessage.textContent = '';
      }
    });
  }

  btnMacroLogin.addEventListener('click', handleMacroLogin);

  // Enter key support for macro login
  [macroUsernameInput, macroPasswordInput].forEach(input => {
    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') handleMacroLogin();
    });
  });

  async function handleMacroLogin() {
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
        body: JSON.stringify({ username, password, clientType: 'extension' })
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
  }

  btnMacroLogout.addEventListener('click', () => {
    chrome.storage.sync.get(['macroAuthToken'], (data) => {
      if (data.macroAuthToken) {
        fetch(`${MACRO_API_BASE_URL}/auth/logout`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${data.macroAuthToken}`
          }
        }).catch(err => console.error('Lỗi khi gọi API logout macro:', err));
      }
      chrome.storage.sync.remove(['macroAuthToken'], () => {
        checkMacroAuthStatus();
      });
    });
  });

  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'sync') {
      if (changes.authToken || changes.username) {
        checkAuthStatus();
      }
      if (changes.macroAuthToken) {
        checkMacroAuthStatus();
      }
    }
  });



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
    userBadge.style.display = 'none';
    loginMessage.textContent = '';
    usernameInput.focus();
  }

  function showSettingsView(data) {
    loginView.classList.remove('active');
    settingsView.classList.add('active');
    userBadge.style.display = 'flex';
    if (data.username) currentUserLabel.textContent = data.username.toUpperCase();
  }

  btnLogin.addEventListener('click', handleLogin);

  // Enter key support for main login
  [usernameInput, passwordInput].forEach(input => {
    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') handleLogin();
    });
  });

  async function handleLogin() {
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
        body: JSON.stringify({ 
          username, 
          password, 
          version: chrome.runtime.getManifest().version
        })
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
  }

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
      // Web Store suggests avoiding management.uninstallSelf if possible.
      // We will just close the popup and let the user uninstall via chrome://extensions if they wish.
      window.close();
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

  // --- DISPLAY MODE & EYE CARE LOGIC ---
  const themeButtons = document.querySelectorAll('.theme-mode-btn');
  const dimmerRange = document.getElementById('dimmerRange');
  const dimmerVal = document.getElementById('dimmerVal');

  let currentThemeMode = 'light';
  let currentDimmerVal = 100;

  chrome.storage.sync.get(['themeMode', 'dimmerValue'], (data) => {
    if (data.themeMode) currentThemeMode = data.themeMode;
    if (data.dimmerValue !== undefined) currentDimmerVal = data.dimmerValue;

    updateThemeModeUI(currentThemeMode);
    if (dimmerRange && dimmerVal) {
      dimmerRange.value = currentDimmerVal;
      dimmerVal.textContent = currentDimmerVal + '%';
    }
  });

  const darkModeCustomSection = document.getElementById('darkModeCustomSection');

  function updateThemeModeUI(mode) {
    themeButtons.forEach(btn => {
      if (btn.dataset.mode === mode) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    if (darkModeCustomSection) {
      if (mode === 'dark' || mode === 'auto') {
        darkModeCustomSection.style.display = 'block';
      } else {
        darkModeCustomSection.style.display = 'none';
      }
    }
  }

  function notifyTabsThemeChange(mode, dimmer) {
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach(tab => {
        if (tab.id) {
          chrome.tabs.sendMessage(tab.id, { action: "THEME_MODE_CHANGED", mode, dimmer }).catch(() => {});
        }
      });
    });
  }

  themeButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const selectedMode = btn.dataset.mode;
      currentThemeMode = selectedMode;
      updateThemeModeUI(selectedMode);
      chrome.storage.sync.set({ themeMode: selectedMode }, () => {
        notifyTabsThemeChange(selectedMode, currentDimmerVal);
      });
    });
  });

  if (dimmerRange) {
    dimmerRange.addEventListener('input', (e) => {
      const val = parseInt(e.target.value, 10);
      currentDimmerVal = val;
      if (dimmerVal) dimmerVal.textContent = val + '%';
      chrome.storage.sync.set({ dimmerValue: val }, () => {
        notifyTabsThemeChange(currentThemeMode, val);
      });
    });
  }

  // --- POPUP TAB NAVIGATION LOGIC ---
  const popupTabBtns = document.querySelectorAll('.popup-nav-btn');
  const popupTabPanes = document.querySelectorAll('.popup-tab-pane');

  popupTabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.dataset.tab;
      
      popupTabBtns.forEach(b => b.classList.remove('active'));
      popupTabPanes.forEach(p => p.classList.remove('active'));

      btn.classList.add('active');
      const targetPane = document.getElementById(targetId);
      if (targetPane) targetPane.classList.add('active');
    });
  });

  // --- PRESET, ACCENT & FONT SIZE HANDLERS ---
  const presetCards = document.querySelectorAll('.preset-card');
  const accentDots = document.querySelectorAll('.accent-dot');
  const fontSizeRange = document.getElementById('fontSizeRange');
  const fontSizeVal = document.getElementById('fontSizeVal');

  chrome.storage.sync.get(['darkModePreset', 'themeAccent', 'chatFontSize'], (data) => {
    if (data.darkModePreset) {
      presetCards.forEach(card => card.classList.toggle('active', card.dataset.preset === data.darkModePreset));
    }
    if (data.themeAccent) {
      accentDots.forEach(dot => dot.classList.toggle('active', dot.dataset.accent === data.themeAccent));
    }
    if (data.chatFontSize && fontSizeRange && fontSizeVal) {
      fontSizeRange.value = data.chatFontSize;
      fontSizeVal.textContent = data.chatFontSize + 'px';
    }
  });

  presetCards.forEach(card => {
    card.addEventListener('click', () => {
      const selectedPreset = card.dataset.preset;
      presetCards.forEach(c => c.classList.toggle('active', c.dataset.preset === selectedPreset));
      chrome.storage.sync.set({ darkModePreset: selectedPreset }, () => {
        notifyTabsSettingChange('PRESET_CHANGED', { preset: selectedPreset });
      });
    });
  });

  accentDots.forEach(dot => {
    dot.addEventListener('click', () => {
      const selectedAccent = dot.dataset.accent;
      accentDots.forEach(d => d.classList.toggle('active', d.dataset.accent === selectedAccent));
      chrome.storage.sync.set({ themeAccent: selectedAccent }, () => {
        notifyTabsSettingChange('ACCENT_CHANGED', { accent: selectedAccent });
      });
    });
  });

  if (fontSizeRange) {
    fontSizeRange.addEventListener('input', (e) => {
      const val = e.target.value;
      if (fontSizeVal) fontSizeVal.textContent = val + 'px';
      chrome.storage.sync.set({ chatFontSize: val }, () => {
        notifyTabsSettingChange('FONT_SIZE_CHANGED', { fontSize: val });
      });
    });
  }

  function notifyTabsSettingChange(action, data) {
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach(tab => {
        if (tab.id) {
          chrome.tabs.sendMessage(tab.id, { action, ...data }).catch(() => {});
        }
      });
    });
  }
});
