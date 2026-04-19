if (window.GEMINI_CONTENT_SCRIPT_LOADED) {
  console.log("[Gemini] Content script already loaded. Skipping.");
} else {
  window.GEMINI_CONTENT_SCRIPT_LOADED = true;

  let currentActiveTextarea = null;
  let suggestionPanel = null;
  let geminiOverlay = null;
  let typingTimer;
  let cachedConfig = null;
  let forceAllowSend = false;
  let userSavedPosition = null;
  let userSavedSize = null;
  let userSavedOpacity = 1.0;
  let isMinimized = false;
  let sessionPronounPrefs = {}; // Store selected pronoun per sessionKey
  let macroSearchOverlay = null;
  let macroFullPreview = null;
  let macroHideTimer = null;

  /**
   * Helper to replace pronouns while preserving case
   * Target pronouns: anh/chị, anh chị, anh, chị
   */
  function translatePronouns(text, target) {
    if (!text || !target) return text;
    // Map of target to normalized value
    const replacement = target === "anh/chị" ? "anh/chị" : target.toLowerCase();
    
    // Improved Regex: Unicode-aware matching for Vietnamese characters
    // Matches compounds like "anh/chị" first, then individual pronouns
    const regex = /(?<!\p{L})(anh[\s/]+chị|anh\s+chị|anh|chị)(?!\p{L})/giu;

    
    return text.replace(regex, (match) => {
      // 1. ALL CAPS
      if (match === match.toUpperCase() && match.length > 1) {
        return replacement.toUpperCase();
      }
      // 2. Capitalized (Sentence case)
      if (match[0] === match[0].toUpperCase()) {
        return replacement.charAt(0).toUpperCase() + replacement.slice(1);
      }
    // 3. Lowercase
    return replacement;
  });
}

/**
 * Helper to get text from either a textarea or a contenteditable element
 */
function getChatText(el) {
  if (!el) return "";
  return el.tagName === "TEXTAREA" ? el.value : el.innerText;
}

/**
 * Helper to set text to either a textarea or a contenteditable element
 */
function setChatText(el, text) {
  if (!el) return;
  if (el.tagName === "TEXTAREA") {
    el.value = text;
  } else {
    el.innerText = text;
  }
  // Dispatch input event for both types
  el.dispatchEvent(new Event("input", { bubbles: true }));
}



  // Load saved position and state
  chrome.storage.sync.get(['geminiPanelPos', 'geminiPanelMinimized', 'geminiPanelSize', 'geminiPanelOpacity'], (data) => {
    if (data.geminiPanelPos) userSavedPosition = data.geminiPanelPos;
    if (data.geminiPanelMinimized) isMinimized = data.geminiPanelMinimized;
    if (data.geminiPanelSize) userSavedSize = data.geminiPanelSize;
    if (data.geminiPanelOpacity !== undefined) userSavedOpacity = data.geminiPanelOpacity;
  });

  function makeDraggable(el, handleSelector) {
    const handle = el.querySelector(handleSelector);
    if (!handle) return;

    let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
    
    handle.onmousedown = (e) => {
      if (document.activeElement?.tagName === "INPUT" || document.activeElement?.tagName === "TEXTAREA") return;
      e = e || window.event;
      // Don't drag if clicking buttons or inputs (like the opacity slider)
      if (e.target.tagName === "BUTTON" || e.target.tagName === "INPUT") return;
      
      e.preventDefault();
      pos3 = e.clientX;
      pos4 = e.clientY;
      document.onmouseup = () => {
        document.onmouseup = null;
        document.onmousemove = null;
        el.classList.remove("gemini-dragging");
        // Save position
        userSavedPosition = { top: el.style.top, left: el.style.left };
        chrome.storage.sync.set({ geminiPanelPos: userSavedPosition });
      };
      document.onmousemove = (e) => {
        e = e || window.event;
        e.preventDefault();
        pos1 = pos3 - e.clientX;
        pos2 = pos4 - e.clientY;
        pos3 = e.clientX;
        pos4 = e.clientY;
        el.style.top = (el.offsetTop - pos2) + "px";
        el.style.left = (el.offsetLeft - pos1) + "px";
        el.style.transform = "none";
        el.classList.add("gemini-dragging");
      };
    };
  }

  let compiledData = {
    brands: null,
    marketplaces: null,
    typoLookup: {}
  };

  const MACRO_API_BASE_URL = "https://macro-react-xi.vercel.app/api";

  const doneTypingInterval = 400;

  // ---------- MOOD & EMPATHY SETTINGS ----------
  const MOOD_INDICATORS = {
    // 1. Phàn nàn / Tiêu cực (General Complaints)
    complaint: [
      "tệ", "kém", "bực", "lừa đảo", "không hài lòng", "tố cáo", "report", "phốt",
      "thái độ", "ăn chặn", "thất vọng", "vô trách nhiệm", "như hạch", "như l", "đcm", "dm", "clm", "vcl", "mất dạy", "vớ vẩn",
      "hoàn hàng", "trả hàng", "không cải thiện", "làm ăn không uy tín", "chán đời", "trả lời chán",
      "treo đầu dê", "lừa dối", "quá tệ", "thất vọng quá", "không bao giờ quay lại", "cạch mặt", "uy tín ở đâu"
    ],
    // 2. Logistics (Vận chuyển & Giao hàng) - Urgent & Delayed
    logistics: [
      "chờ lâu quá", "gần 1 tuần rồi", "ship lâu", "bao ngày lấy hàng không thành công",
      "không cập nhật", "kho long bình", "đứng yên", "không liên lạc được shipper",
      "shipper bảo hàng cấm giao", "giao nhầm", "sai địa chỉ", "nhầm người nhận",
      "ship gấp", "cần gấp", "ship sớm", "giao sớm", "giao gấp", "nhanh hộ", "đang cần",
      "khi nào có hàng", "bao giờ giao", "chậm trễ", "lâu thế", "hối đơn", "giục đơn", "đi hàng chưa"
    ],
    // 3. Product Quality (Sản phẩm & Chất lượng)
    quality: [
      "bể vỡ", "móp méo", "vòi hỏng", "tách nước", "đốm đen", "vón cục",
      "nóng rát", "nổi mụn", "kích ứng", "mùi hôi", "mùi hắc",
      "cận date", "không biết đọc ngày sản xuất", "hết hạn", "hsd",
      "hàng cũ", "đã qua sử dụng", "trầy xước", "không giống hình", "sai mẫu", "sai màu", "sai size"
    ],
    // 4. Fake Suspicion (Nghi ngờ hàng giả)
    fakeSuspicion: [
      "hàng giả", "fake", "nhái", "không chính hãng", "check code", "auth không", "tem mác",
      "thật hay giả", "khác biệt bao bì", "quét mã", "check var", "hàng trộn", "không có tem"
    ],
    // 5. Gifts & Promos (Quà tặng & Khuyến mãi)
    gifts: [
      "thiếu quà", "sai quà", "không có quà", "quà minigame", "lỗi hiển thị quà",
      "không áp dụng được voucher", "không thanh toán được", "mã giảm giá",
      "không nhận được quà", "chưa có quà", "quà của mình đâu", "quà tặng đâu", "quà kèm theo"
    ],
    // 6. Service Experience (Trải nghiệm & Cảm xúc)
    service: [
      "alo", "shop ơi", "sao chưa trả lời", "trả lời đi em", "mệt quá", "sao hỏi đi hỏi lại",
      "pending quá hạn", "tư vấn sai", "nhân viên thái độ", "trả lời chậm", "đợi mãi",
      "rep đi", "trả lời đi", "có ai không", "đang cần gấp mà"
    ],

    // Case Exclusion (Optional/Over-empathy)
    exclude: [
      "giá bao nhiêu", "thành phần", "cách dùng", "còn hàng không", "khi nào có live",
      "mình bao nhiêu tuổi", "da mình là", "tư vấn cho mình", "chọn size", "có hsd đến khi nào",
      "hướng dẫn sử dụng", "review", "cho mình xem hình thật"
    ],

    emojis: ["😠", "😡", "🤬", "👿", "👎", "😤", "☹️", "😟"],
    lastAnalyzedText: null,
    lastActiveSession: null
  };

  let moodAlertPanel = null;

  // ---------- REPORTING SYSTEM ----------
  const REPORT_KEY = "gemini_quality_logs";

  function reportQualityAction(actionType, detail = {}) {
    // Always fetch latest username from sync storage or cached config
    chrome.storage.sync.get(['username'], (sync) => {
      const accountName = (sync.username || cachedConfig?.username || "GUEST").toUpperCase();
      const context = getCurrentContext();
      const csUser = getCurrentCSUser();

      const logEntry = {
        timestamp: new Date().toISOString(),
        account: accountName,
        user: accountName, // Use extension login as primary identity
        group: csUser.group,
        brand: context.currentBrand,
        platform: context.currentMarketplace,
        customerId: context.customerId, // Added for tracking
        action: actionType,
        details: detail,
        url: window.location.href
      };

      console.log("[Gemini Report] Recording action:", logEntry);

      // 1. Send to Server (via Background)
      chrome.runtime.sendMessage({ action: "SAVE_QUALITY_LOG", data: logEntry }, (response) => {
        if (chrome.runtime.lastError) {
          console.warn("[Report] Background current unreachable for server logging:", chrome.runtime.lastError);
        } else {
          console.log("[Report] Server sync attempted:", response);
        }
      });

      // 2. Fallback: Save to Local Storage (Keep for personal view)
      chrome.storage.local.get(REPORT_KEY, (data) => {
        const logs = data[REPORT_KEY] || [];
        logs.push(logEntry);
        chrome.storage.local.set({ [REPORT_KEY]: logs.slice(-500) });
      });
    });
  }

  function getCurrentCSUser() {
    let name = "CS_Unknown";
    let group = "Group_Default";

    // Check for common user profile elements
    const userEl = document.querySelector(".user-profile-name, .account-name, .username");
    if (userEl) {
      // Clean up internal newlines and extra spaces
      let raw = userEl.textContent.trim().replace(/\s+/g, ' ');
      // Handle mock format: "CS: Nguyễn Văn A (Nhóm 1)"
      if (raw.startsWith("CS:")) {
        const match = raw.match(/CS:\s*([^(]+)(?:\(([^)]+)\))?/);
        if (match) {
          name = match[1].trim();
          if (match[2]) group = match[2].trim();
        } else {
          name = raw.replace("CS:", "").trim();
        }
      } else {
        name = raw;
      }
    }

    // Fallback if we are in the Extension's own popup/pages, use logged in username
    if (name === "CS_Unknown" && cachedConfig?.username) {
      name = cachedConfig.username.toUpperCase();
    }

    return { name, group };
  }

  const CONFIG = {
    MANAGEMENT_DOMAINS: ["admin.onpoint.vn", "admin.opollo.vn", "admin.opollo.com", "onpoint.vn", "opollo.vn"],
    ACTIVE_ITEM_SELECTORS: [
      "li.channel-items__el.active",
      "li.active",
      ".chat-item--active",
      ".active-session",
      ".session-item.active",
      ".list-item.active",
      ".active .channel-name-wrapper",
      ".channel-item.active",
      ".li-chat-item.active",
      "[class*='active'][class*='item']",
      ".active"
    ],
    NAME_SELECTORS: [
      "span.channel-name",
      ".channel-name",
      ".name",
      ".session-name",
      ".title",
      ".brand-name",
      ".item-name",
      "div.text-truncate"
    ],
    CUSTOMER_ID_SELECTORS: [
      "h6.mb-0.mr-1",        // admin.onpoint customer name
      ".customer-id",
      ".id-khach",
      ".customer-name",
      ".recipient-id",
      ".chat-id",
      ".user-id",
      ".order-id"
    ],

    // ✅ Nút send thực tế bạn cung cấp + fallback
    SEND_BUTTON_SELECTORS: [
      "button.button--icon.btn.btn-primary.btn-sm",
      "button[aria-label*='Send' i]",
      "button[title*='Send' i]",
      "button[aria-label*='Gửi' i]",
      "button[title*='Gửi' i]",
      ".send-btn",
      ".btn-send",
      ".composer-send-button",
      "[class*='send'][role='button']"
    ].join(",")
  };

  // ---------- ANALYSIS ----------

  function getAnalysis(text) {
    if (!cachedConfig || !text) {
      return { forbidden: [], brands: [], platforms: [], typos: [], grammar: [], formatting: [], suggestedText: text || "" };
    }

    const results = { forbidden: [], brands: [], platforms: [], typos: [], grammar: [], formatting: [], suggestedText: "" };
    const context = getCurrentContext();

    // 0) Formatting: dư khoảng cách
    const spaceRegex = / {2,}/g;
    let spaceMatch;
    while ((spaceMatch = spaceRegex.exec(text)) !== null) {
      if (spaceMatch.index === spaceRegex.lastIndex) spaceRegex.lastIndex++;
    }

    // 1) Forbidden
    if (compiledData.forbidden) {
      compiledData.forbidden.lastIndex = 0;
      let match;
      while ((match = compiledData.forbidden.exec(text)) !== null) {
        const word = match[1];
        results.forbidden.push({ word, msg: `TỪ CẤM: ${word}` });
        if (match.index === compiledData.forbidden.lastIndex) compiledData.forbidden.lastIndex++;
      }
    }

    // 2) Brand mismatch
    if (!context.isExternal && context.currentBrand !== "general" && compiledData.brands) {
      compiledData.brands.lastIndex = 0;
      let match;
      const foundBrands = new Set();
      while ((match = compiledData.brands.exec(text)) !== null) {
        const word = match[1];
        if (!areBrandsRelated(word, context.currentBrand, cachedConfig.brandGroups)) {
          const cw = superClean(word);
          if (cw !== context.currentMarketplace && !foundBrands.has(cw)) {
            foundBrands.add(cw);
            results.brands.push({ word, msg: `SAI BRAND (ĐANG CHAT: ${context.currentBrand.toUpperCase()})` });
          }
        }
        if (match.index === compiledData.brands.lastIndex) compiledData.brands.lastIndex++;
      }
    }

    // 3) Platform mismatch
    if (compiledData.marketplaces) {
      compiledData.marketplaces.lastIndex = 0;
      let match;
      while ((match = compiledData.marketplaces.exec(text)) !== null) {
        const word = match[1].toLowerCase();
        if (word === context.currentMarketplace || context.currentMarketplace.includes(word)) continue;

        const currentLabel = context.currentMarketplace.charAt(0).toUpperCase() + context.currentMarketplace.slice(1);
        results.platforms.push({
          word: match[1],
          msg: `SAI SÀN: ${match[1].toUpperCase()} (ĐANG CHAT: ${currentLabel.toUpperCase()})`
        });
        if (match.index === compiledData.marketplaces.lastIndex) compiledData.marketplaces.lastIndex++;
      }
    }

    // 4) Pronoun strict
    checkPronounConsistency(text, results);

    // 5) Repetition (Unicode) - 1 to 3 words
    const repeatRegex = /(^|[\s,.!?;"'“”(){}\[\]-])(\p{L}+(?:\s+\p{L}+){0,2})[\s\n]+\2(?=([\s,.!?;"'“”(){}\[\]-]|$))/giu;
    let repeatMatch;
    while ((repeatMatch = repeatRegex.exec(text)) !== null) {
      const duplicated = repeatMatch[2];
      results.grammar.push({ word: duplicated, msg: `Phát hiện lặp cụm từ: "${duplicated} ${duplicated}"` });
      if (repeatMatch.index === repeatRegex.lastIndex) repeatRegex.lastIndex++;
    }

    // 6) Suggestions (punctuation/case/typo)
    let finalText = text;
    finalText = finalText.replace(repeatRegex, (full, prefix, word) => `${prefix}${word}`);
    finalText = finalText.replace(/ {2,}/g, " ");
    finalText = processSentenceMechanics(finalText, compiledData.typoLookup);

    results.suggestedText = finalText;

    // 7) Chat Polish (Greetings/Questions/Tone)
    polishChatTone(text, results);

    // 8) Add detailed mechanics errors (each as its own line)
    addMechanicsErrors(text, finalText, results);

    return results;
  }

  /**
   * RULE:
   * - Trước dấu phẩy: không có space. Sau dấu phẩy: đúng 1 space. Sau dấu phẩy viết thường.
   * - Sau . ! ? : có 1 space nếu còn chữ tiếp theo (cùng dòng) và viết hoa chữ cái đầu câu.
   * - Đầu câu: viết hoa.
   * - Typo: thay theo typoLookup, giữ case chữ cái đầu nếu từ gốc viết hoa.
   */
  function processSentenceMechanics(text, typoLookup) {
    if (!text) return "";

    let s = text;

    // Active Chat Polish: Greeting Commas
    // Dạ em chào anh -> Dạ, em chào anh
    s = s.replace(/^(Dạ|Chào (?:anh|chị|em|bạn|quý khách))(?!\s*[,!])/gi, "$1,");

    // comma spacing
    s = s.replace(/\s+,/g, ",");
    s = s.replace(/,([^\s\n])/g, ", $1");
    s = s.replace(/,\s{2,}/g, ", ");

    // end punctuation spacing
    s = s.replace(/\s+([.!?])/g, "$1");
    s = s.replace(/([.!?])([^\s\n])/g, "$1 $2");
    s = s.replace(/([.!?])\s{2,}/g, "$1 ");

    const chars = Array.from(s);
    let out = [];
    let buffer = "";
    let sentenceStart = true;
    let afterComma = false;

    // Skip leading non-letters to correctly identifying sentence start
    let firstLetterFound = false;

    const flushWord = () => {
      if (!buffer) return "";

      let processed = buffer;
      const lower = buffer.toLowerCase();

      // typoLookup check
      if (typoLookup && typoLookup[lower]) {
        processed = typoLookup[lower];
        const a0 = buffer[0];
        if (a0 === a0.toUpperCase() && a0 !== a0.toLowerCase()) {
          processed = processed.charAt(0).toUpperCase() + processed.slice(1);
        }
      } else if (buffer.length > 2) {
        // Stop auto-stripping Telex/VNI markers to avoid mangling English words.
        // Suggestions will be made via detailed error messages instead.


        // Generic Joined Word splitting (Common prefixes)
        // anhbạn -> anh bạn, chịem -> chị em
        const commonPrefixes = ["anh", "chị", "bạn", "em", "con", "người", "sản", "shopee", "tiktok"];
        for (const pref of commonPrefixes) {
          if (lower.startsWith(pref) && lower.length > pref.length + 1) {
            // Additional check: second part should also be letters
            const rest = lower.slice(pref.length);
            if (/^\p{L}+$/u.test(rest)) {
              processed = buffer.slice(0, pref.length) + " " + buffer.slice(pref.length);
              break;
            }
          }
        }
      }

      // case rules
      const first = processed[0];
      if (first && /\p{L}/u.test(first)) {
        if (sentenceStart) {
          processed = first.toLocaleUpperCase() + processed.slice(1);
        } else if (afterComma) {
          // MÀU NHIỆM: Chỉ viết thường lại nếu đó là 1 từ tiếng Việt hợp lệ 
          // để không vô tình sửa sai danh từ riêng tiếng Anh (Senka, Combo, Clear...)
          if (typeof isPossibleVietnameseSyllable === "function" && isPossibleVietnameseSyllable(processed.toLowerCase())) {
            processed = first.toLocaleLowerCase() + processed.slice(1);
          }
        }
      }

      buffer = "";
      afterComma = false;
      sentenceStart = false;

      return processed;
    };

    for (let i = 0; i < chars.length; i++) {
      const ch = chars[i];

      if (/\p{L}/u.test(ch)) {
        if (!firstLetterFound) {
          firstLetterFound = true;
          sentenceStart = true;
        }
        buffer += ch;
        continue;
      }

      out.push(flushWord());
      out.push(ch);

      if (ch === ",") {
        afterComma = true;
      } else if (ch === "." || ch === "!" || ch === "?") {
        sentenceStart = true;
        afterComma = false;
      } else if (ch === "\n") {
        sentenceStart = true;
        afterComma = false;
      }
    }

    out.push(flushWord());

    let final = out.join("");
    final = final.replace(/\s+,/g, ",");
    final = final.replace(/\s+([.!?])/g, "$1");
    final = final.replace(/,([^\s\n])/g, ", $1");
    final = final.replace(/([.!?])([^\s\n])/g, "$1 $2");
    final = final.replace(/ {2,}/g, " ");

    return final;
  }

  function addMechanicsErrors(original, suggested, results) {
    const msgs = new Set();
    const lowerOri = original.toLowerCase();

    // 1. Spacing formatting errors
    const spaceErrors = [];

    const excessSpaceMatches = original.matchAll(/(\S+\s{2,}\S+)/g);
    for (const match of excessSpaceMatches) {
      spaceErrors.push(`"${match[0]}"`);
    }

    const spaceBeforePuncMatches = original.matchAll(/(\S+\s+[.,!?:;])/g);
    for (const match of spaceBeforePuncMatches) {
      spaceErrors.push(`"${match[0]}"`);
    }

    const missingSpaceMatches = original.matchAll(/(\S+[.,!?:;][^\s\n\d]\S*)/g);
    for (const match of missingSpaceMatches) {
      spaceErrors.push(`"${match[0]}"`);
    }

    if (spaceErrors.length > 0) {
      msgs.add(`Lỗi định dạng khoảng cách tại: ${spaceErrors.join(", ")}`);
    }

    // 4. Telex/Typing errors (trailing markers)
    const telexRegex = /\b([a-zà-ỹ]{2,})([jfrsx]+)\b/gi;
    let telexMatch;
    const telexErrors = new Set();
    while ((telexMatch = telexRegex.exec(original)) !== null) {
      if (telexMatch[1].length > 1) { // Basic sanity
        const baseWord = telexMatch[1].toLowerCase();
        if (typeof isPossibleVietnameseSyllable === "function" && isPossibleVietnameseSyllable(baseWord)) {
          telexErrors.add(`"${telexMatch[0]}"`);
        }
      }
    }
    if (telexErrors.size > 0) {
      msgs.add(`Lỗi đánh máy (Telex): ${Array.from(telexErrors).join(", ")}`);
    }

    // 4a. VNI errors (trailing numbers)
    const vniRegex = /\b(\p{L}+)([1-9]+)\b/giu;
    let vniMatch;
    const vniErrors = new Set();
    while ((vniMatch = vniRegex.exec(original)) !== null) {
      const baseWord = vniMatch[1].toLowerCase();
      if (typeof isPossibleVietnameseSyllable === "function" && isPossibleVietnameseSyllable(baseWord)) {
        vniErrors.add(`"${vniMatch[0]}"`);
      }
    }
    if (vniErrors.size > 0) {
      msgs.add(`Lỗi đánh máy (VNI): ${Array.from(vniErrors).join(", ")}`);
    }

    // 5. Joined Words (Dính chữ / Thiếu khoảng cách)
    const commonPrefixes = ["anh", "chị", "bạn", "em", "con", "người", "sản", "shopee", "tiktok"];
    const words = original.split(/[\s,.!?]+/);
    words.forEach(w => {
      const lw = w.toLowerCase();
      for (const pref of commonPrefixes) {
        if (lw.startsWith(pref) && lw.length > pref.length + 1) {
          const rest = lw.slice(pref.length);
          if (/^\p{L}+$/u.test(rest)) {
            msgs.add(`Lỗi thiếu khoảng cách (dính chữ) tại: "${w}"`);
            break;
          }
        }
      }
    });

    // 6. Grammar/Sentence starts - Improved regex to count actual fixes
    const getLowerStartCount = (str) => {
      return str.split(/[.!?\n]\s+/).filter(s => s.trim().length > 0 && /^\p{Ll}/u.test(s.trim())).length;
    };
    if (getLowerStartCount(original) > getLowerStartCount(suggested)) {
      msgs.add("Lỗi không viết hoa chữ cái đầu câu");
    }

    const countOriginalUpperAfterComma = (original.match(/, ?\p{Lu}/gu) || []).length;
    const countSuggestedUpperAfterComma = (suggested.match(/, ?\p{Lu}/gu) || []).length;
    if (countOriginalUpperAfterComma > countSuggestedUpperAfterComma) {
      msgs.add("Lỗi sau dấu phẩy phải viết thường");
    }

    // Removed generic "Chuẩn hoá..." if we already have specific messages
    if (suggested !== original && msgs.size === 0) {
      msgs.add("Cần chuẩn hoá dấu câu và viết hoa theo chuẩn tiếng Việt");
    }

    msgs.forEach((m) => {
      if (m) results.grammar.push({ word: "mechanics", msg: m });
    });
  }

  // ---------- PRONOUN STRICT (5 MODES) ----------

  function checkPronounConsistency(text, results) {
    const lower = text.toLowerCase();

    const B = "(^|[^\\p{L}\\p{N}])";
    const E = "(?=$|[^\\p{L}\\p{N}])";

    const rxAC = new RegExp(`${B}(anh\\s*(?:\\/|hoặc|v\\s*à)\\s*chị|chị\\s*(?:\\/|hoặc|v\\s*à)\\s*anh|a\\s*\\/\\s*c|c\\s*\\/\\s*a)${E}`, "giu");
    const rxA = new RegExp(`${B}(anh)${E}`, "giu");
    const rxC = new RegExp(`${B}(chị)${E}`, "giu");
    const rxB = new RegExp(`${B}(bạn)${E}`, "giu");
    const rxM = new RegExp(`${B}(mình)${E}`, "giu");

    const has = (rx, src) => {
      rx.lastIndex = 0;
      return !!rx.exec(src);
    };

    // Mask the neutral AC pronouns to check for specific ones separately
    const masked = lower.replace(rxAC, (full, _b, keyword) => full.replace(keyword, " ".repeat(keyword.length)));

    const found = {
      "Anh/Chị": has(rxAC, lower),
      "Anh": has(rxA, masked),
      "Chị": has(rxC, masked),
      "Bạn": has(rxB, lower),
      "Mình": has(rxM, lower)
    };

    const detectedModes = Object.keys(found).filter((k) => found[k]);

    // Conflict logic:
    // 1. AC Set (Anh/Chị, Anh, Chị) mixed with B Set (Bạn, Mình)
    // 2. Mixing Neutral AC with Specific Anh or Chị
    // 3. Mixing Specific Anh with Specific Chị
    const hasNeutralAC = found["Anh/Chị"];
    const hasSpecificA = found["Anh"];
    const hasSpecificC = found["Chị"];
    const hasACSet = hasNeutralAC || hasSpecificA || hasSpecificC;
    const hasBSet = found["Bạn"] || found["Mình"];

    let conflict = false;
    if (hasACSet && hasBSet) conflict = true;
    if (hasNeutralAC && (hasSpecificA || hasSpecificC)) conflict = true;
    if (hasSpecificA && hasSpecificC) conflict = true;

    if (conflict || detectedModes.length > 2) {
      results.grammar.push({
        word: "conflict_pronoun",
        msg: `Lỗi xưng hô không đồng nhất: ${detectedModes.join(" + ")}`
      });
    }
  }

  // ---------- BLOCKING RULES ----------

  function hasBlockingErrors(analysis) {
    // ✅ ONLY these 3 block sending
    return (analysis.forbidden?.length || 0) > 0 || (analysis.brands?.length || 0) > 0 || (analysis.platforms?.length || 0) > 0;
  }

  function enforceBlockIfNeeded(reasonEvent) {
    if (forceAllowSend) {
      console.log("[Gemini] Bypass activated: Allowing action.");
      forceAllowSend = false; // Reset immediately
      return false;
    }

    const t = reasonEvent?.target;
    const btn = t?.closest?.(".btn-primary, button[type='submit'], .btn-save");
    const isTicketAlert = btn && document.querySelector('input[name="concern_id"]');

    if (isTicketAlert) {
      const ticketErrors = getTicketValidationErrors();
      if (ticketErrors.length > 0) {
        if (reasonEvent) {
          reasonEvent.preventDefault?.();
          reasonEvent.stopPropagation?.();
          reasonEvent.stopImmediatePropagation?.();
        }
        showTicketBlockingAlert(ticketErrors, btn);
        return true;
      }
    }

    const latestVal = getChatText(currentActiveTextarea).trim();
    if (!latestVal) return false;

    if (!cachedConfig) return false;

    const analysis = getAnalysis(latestVal);
    const isBlocking = hasBlockingErrors(analysis);

    // Debug log for specifically for test pages
    console.log("[Gemini] enforceBlockIfNeeded (Chat):", { isBlocking, event: reasonEvent?.type });

    if (isBlocking) {
      console.log("[Gemini] 🛑 BLOCKING detected. Halting event.");

      // Crucial: Stop immediately to prevent page script from running
      if (reasonEvent) {
        reasonEvent.preventDefault?.();
        reasonEvent.stopPropagation?.();
        reasonEvent.stopImmediatePropagation?.();
      }

      showBlockingAlert(analysis);
      return true;
    }
    return false;
  }

  function getTicketValidationErrors() {
    const errors = [];

    // 1. Check Concern Issue (Starts with "Khiếu nại")
    const concernEl = document.querySelector('div.css-1uccc91-singleValue');
    const concernText = (concernEl?.textContent || "").trim();

    if (!concernText.toLowerCase().startsWith("khiếu nại")) {
      return []; // Not a complaint, skip extra validation
    }

    // 2. Check Mandatory Fields
    const fieldMap = {
      "order_id": "Order Number",
      "order_item_sku": "Order item SKU",
      "order_item_name": "Order product name"
    };

    Object.keys(fieldMap).forEach(name => {
      const input = document.querySelector(`input[name="${name}"]`);
      if (!input || !input.value.trim()) {
        errors.push(fieldMap[name]);
      }
    });

    // 3. Check Root Cause
    const rootCauseInput = document.querySelector('input[name="root_cause_id"]');
    if (!rootCauseInput || !rootCauseInput.value.trim()) {
      errors.push("Root Cause");
    }

    // 4. Check Description (Quill Editor)
    const quillEditor = document.querySelector('.ql-editor');
    const descText = (quillEditor?.textContent || "").trim();
    if (!descText || descText === "") {
      errors.push("Description");
    }

    return errors;
  }

  function showTicketBlockingAlert(errors, targetButton) {
    if (!suggestionPanel) createUIElements();

    const mascotUrl = chrome.runtime.getURL("mascot_alert.png");
    const errorListHtml = errors.map(e => `<li>• ${e}</li>`).join("");

    suggestionPanel.innerHTML = `
      <div class="gemini-block-alert">
        <div class="gemini-alert-mascot">
          <img src="${mascotUrl}" alt="Mascot" />
        </div>
        <div class="gemini-alert-content">
          <h3 class="gemini-alert-title">SOP Nhắc Nhở! 🎀</h3>
          <p class="gemini-alert-msg" style="text-align: left; margin-bottom: 15px;">
            Hành trình Khiếu nại cần điền đầy đủ thông tin nè. Bạn đang thiếu:
          </p>
          <ul style="text-align: left; list-style: none; padding: 0; margin-bottom: 20px; font-size: 14px; color: #ef4444; font-weight: 600;">
            ${errorListHtml}
          </ul>
          <div class="gemini-alert-actions">
             <button class="gemini-alert-btn-main" id="gemini-ticket-fix">Kiểm tra ngay</button>
             <button class="gemini-alert-btn-sub" id="gemini-ticket-bypass">Vẫn lưu</button>
          </div>
        </div>
      </div>
    `;

    suggestionPanel.style.display = "block";
    if (geminiOverlay) geminiOverlay.style.display = "block";
    suggestionPanel.classList.add("gemini-blocking-active");
    suggestionPanel.style.position = "fixed";
    suggestionPanel.style.left = "50%";
    suggestionPanel.style.top = "50%";
    suggestionPanel.style.transform = "translate(-50%, -50%)";
    suggestionPanel.style.zIndex = "9999999";

    document.getElementById("gemini-ticket-fix")?.addEventListener("click", () => {
      suggestionPanel.style.display = "none";
      suggestionPanel.classList.remove("gemini-blocking-active");
    });

    document.getElementById("gemini-ticket-bypass")?.addEventListener("click", () => {
      suggestionPanel.style.display = "none";
      suggestionPanel.classList.remove("gemini-blocking-active");
      forceAllowSend = true;
      targetButton?.click(); // Re-trigger the button click
    });
  }

  function showBlockingAlert(analysis) {
    if (!suggestionPanel) createUIElements();

    let issue = "vi phạm";
    if (analysis.forbidden?.length) issue = "sai Từ cấm";
    else if (analysis.brands?.length) issue = "sai Brand";
    else if (analysis.platforms?.length) issue = "sai Sàn";

    const mascotUrl = chrome.runtime.getURL("mascot_alert.png");

    suggestionPanel.innerHTML = `
    <div class="gemini-block-alert">
      <div class="gemini-alert-mascot">
        <img src="${mascotUrl}" alt="Mascot" />
      </div>
      <div class="gemini-alert-content">
        <h3 class="gemini-alert-title">Hông bé ơi! 🛑</h3>
        <p class="gemini-alert-msg">Đang <strong>${issue}</strong> kìa! Kiểm tra lại nha không là bị ký warning đó. 😂</p>
        <div class="gemini-alert-actions">
           <button class="gemini-alert-btn-main" id="gemini-alert-fix">Kiểm tra ngay</button>
           <div class="gemini-alert-btn-sub-row">
             <button class="gemini-alert-btn-sub" id="gemini-alert-bypass">Vẫn gửi</button>
             <button class="gemini-alert-btn-sub" id="gemini-alert-close">Đóng</button>
           </div>
        </div>
      </div>
    </div>
  `;

    suggestionPanel.style.display = "block";
    if (geminiOverlay) geminiOverlay.style.display = "block";
    suggestionPanel.classList.add("gemini-blocking-active");

    // Center only for blocking alert
    suggestionPanel.style.position = "fixed";
    suggestionPanel.style.left = "50%";
    suggestionPanel.style.top = "50%";
    suggestionPanel.style.transform = "translate(-50%, -50%)";
    suggestionPanel.style.width = "auto";
    suggestionPanel.style.height = "auto";
    suggestionPanel.style.zIndex = "9999999";

    document.getElementById("gemini-alert-fix")?.addEventListener("click", () => {
      suggestionPanel.classList.remove("gemini-blocking-active");
      showSuggestionPanel(analysis);
    });
    document.getElementById("gemini-alert-bypass")?.addEventListener("click", () => {
      // LOG: Bypass action
      reportQualityAction("bypass_block", {
        issue: issue,
        text: getChatText(currentActiveTextarea).trim()
      });

      forceAllowSend = true;
      suggestionPanel.classList.remove("gemini-blocking-active");
      hideUI();

      // Tìm và click nút gửi thật
      const sendBtn = document.querySelector(CONFIG.SEND_BUTTON_SELECTORS);
      if (sendBtn) {
        console.log("[Gemini] User bypassed: Triggering send button click.");
        sendBtn.click();
      } else {
        // Fallback: nếu không tìm thấy nút, ít nhất người dùng có thể thử gõ Enter lại
        console.warn("[Gemini] Bypassed but send button not found for auto-click.");
      }
    });
    document.getElementById("gemini-alert-close")?.addEventListener("click", () => {
      suggestionPanel.classList.remove("gemini-blocking-active");
      hideUI();
    });
  }

  // ---------- UI ----------

  function showSuggestionPanel(analysis) {
    const latestVal = getChatText(currentActiveTextarea);
    updateToolbarStatus(analysis, latestVal);
    if (!suggestionPanel) createUIElements();
    if (!suggestionPanel) return; // Critical failure safety

    // Force visibility and top-most layer
    suggestionPanel.style.display = "block";
    suggestionPanel.style.position = "fixed"; 
    suggestionPanel.style.zIndex = "2147483647";
    suggestionPanel.style.visibility = "visible";
    suggestionPanel.style.opacity = "1";

    if (isMinimized) {
      suggestionPanel.classList.add("gemini-is-minimized");
    } else {
      suggestionPanel.classList.remove("gemini-is-minimized");
    }

    suggestionPanel.style.opacity = userSavedOpacity;

    if (userSavedPosition) {
      suggestionPanel.style.top = userSavedPosition.top;
      suggestionPanel.style.left = userSavedPosition.left;
      suggestionPanel.style.transform = "none";
    } else {
      suggestionPanel.style.left = "";
      suggestionPanel.style.top = "";
      suggestionPanel.style.transform = "";
    }

    if (userSavedSize && !isMinimized) {
      suggestionPanel.style.width = userSavedSize.width;
      suggestionPanel.style.height = userSavedSize.height;
    }

    const valNow = getChatText(currentActiveTextarea);
    const suggestedText = analysis.suggestedText || valNow || "";
    const isDifferent = suggestedText !== valNow;

    const critKeywords = ["Từ cấm", "Sai Brand", "Sai Sàn"];
    const lines = [];

    // Detect pronoun conflict
    const pronounConflict = (analysis.grammar || []).find(g => g && g.word === "conflict_pronoun");

    // grammar (pronoun/mechanics/repetition)
     (analysis.grammar || []).filter(g => g && g.msg).forEach(g => {
       const isCrit = critKeywords.some(k => g.msg.toLowerCase().includes(k.toLowerCase()));
       const isProcessed = g.msg.startsWith("Đã sửa") || g.msg.startsWith("Đã thêm");
       // TREAT ALL grammar/mechanics items as warnings by default to ensure an icon shows up
       const isWarn = true; 
       lines.push({ text: g.msg, crit: isCrit, processed: isProcessed, warn: isWarn && !isProcessed });
     });

    // forbidden/brand/platform each as its own line
    (analysis.forbidden || []).forEach(v => lines.push({ text: v.msg, crit: true }));
    (analysis.brands || []).forEach(v => lines.push({ text: v.msg, crit: true }));
    (analysis.platforms || []).forEach(v => lines.push({ text: v.msg, crit: true }));

    // unique keep order
    const seen = new Set();
    const finalLines = [];
    for (const l of lines) {
      const key = (l.text || "").trim();
      if (!key) continue;
      if (seen.has(key)) continue;
      seen.add(key);
      finalLines.push(l);
    }

    // SORT BY PRIORITY:
    // 1. Critical (crit: true) -> Priority 1
    // 2. Processed (processed: true) -> Priority 2
    // 3. Detected/Warn (warn: true or others) -> Priority 3
    finalLines.sort((a, b) => {
      const getP = (item) => {
        if (item.crit) return 1;
        if (item.processed) return 2;
        return 3;
      };
      return getP(a) - getP(b);
    });

    const errorsHtml = finalLines.length
      ? `<ul class="gemini-list">
        ${finalLines.map(l => {
        let cls = "";
        if (l.crit) cls = "gemini-crit-error";
        else if (l.processed) cls = "gemini-processed-msg";
        else if (l.warn) cls = "gemini-warn-msg";
        return `<li class="${cls}">${escapeHtml(l.text)}</li>`;
      }).join("")}
      </ul>`
      : `<div class="gemini-empty">✅ Không phát hiện lỗi.</div>`;

    if (suggestedText.length > 150) {
      suggestionPanel.classList.add("gemini-wide");
    } else {
      suggestionPanel.classList.remove("gemini-wide");
    }

    const hasErrors = finalLines.length > 0;
    const showEditor = (hasErrors || isDifferent || pronounConflict);

    const fullHighlightedText = showEditor
      ? diffHighlight(valNow, suggestedText, pronounConflict, analysis)
      : escapeHtml(suggestedText);

    let displayHtml = fullHighlightedText;
    let isFragmented = false;

    // Focused View: Only show lines with errors/changes if the text is multiline
    if (showEditor && suggestedText.includes('\n')) {
      const lines = fullHighlightedText.split('\n');
      const errorLines = lines.filter(l => l.includes('gemini-highlight-') || l.includes('gemini-processed-'));
      
      if (errorLines.length > 0 && errorLines.length < lines.length) {
        displayHtml = errorLines.join('<div class="gemini-fragment-divider">...</div>');
        isFragmented = true;
      }
    }

    // Store state for the Apply button
    suggestionPanel.__fullSuggestedText = suggestedText;
    suggestionPanel.__isFragmented = isFragmented;
    suggestionPanel.__analysis_source = valNow;

    const suggestHtml = showEditor
      ? `
      <details class="gemini-details" open>
        <summary class="gemini-summary">
          ✨ Gợi ý chỉnh sửa
          <span class="gemini-summary-hint"></span>
        </summary>

        <div class="gemini-suggest-wrap">
          <div class="gemini-suggest-edit ${isFragmented ? 'gemini-is-fragmented' : ''}" id="gemini-suggest-content" contenteditable="${isFragmented ? 'false' : 'true'}" spellcheck="false" style="max-height: 250px; overflow-y: auto;">${displayHtml}</div>
        </div>
      </details>
    `
      : ``;

    const actionsHtml = `
    <div class="gemini-actions ${!showEditor ? 'gemini-actions-alone' : ''}">
      ${showEditor ? '<button class="gemini-apply-btn" id="gemini-apply-suggest" type="button">Áp dụng</button>' : ''}
      <button class="gemini-secondary-btn" id="gemini-close-panel" type="button">Đóng</button>
    </div>
  `;

    // UI now only shows warnings, no editor or footer buttons
    suggestionPanel.innerHTML = `
    <div class="gemini-panel ${isMinimized ? 'gemini-minimized-state' : ''}" style="max-height: 85vh !important; display: flex !important; flex-direction: column !important; overflow: hidden !important; min-width: 320px;">
      <div class="gemini-panel-header" id="gemini-drag-handle" style="cursor: move;">
        <div class="gemini-title" style="font-size: 12px;">✨ Kiểm tra nội dung</div>
        <div class="header-tools" style="display: flex; align-items: center; gap: 4px;">
          <div class="gemini-opacity-wrapper" style="display: none; align-items: center; gap: 6px; background: rgba(255,255,255,0.9); padding: 2px 8px; border-radius: 10px; border: 1px solid #ddd; margin-right: 2px; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
             <span style="font-size: 9px; font-weight: 800; color: #6366f1;">${Math.round(userSavedOpacity * 100)}%</span>
             <input type="range" id="gemini-opacity-slider" min="0.2" max="1" step="0.05" value="${userSavedOpacity}" style="width: 50px; height: 3px; cursor: pointer;">
          </div>
          <button class="gemini-min-btn" id="gemini-opacity-toggle" title="Độ trong suốt" type="button" style="padding: 4px;">🌓</button>
          <button class="gemini-min-btn" id="gemini-minimize-toggle" title="${isMinimized ? 'Mở rộng' : 'Thu nhỏ'}" type="button" style="padding: 4px;">
            ${isMinimized ? '🔳' : '➖'}
          </button>
          <button class="gemini-x" id="gemini-x-btn" type="button" aria-label="Close" style="padding: 4px 6px;">✕</button>
        </div>
      </div>

      <div class="gemini-panel-body" style="flex: 1; overflow-y: auto; padding: 12px; ${isMinimized ? 'display: none;' : ''}">
        ${errorsHtml}
      </div>

      <div class="gemini-resize-handle" style="${isMinimized ? 'display: none;' : ''}"></div>
    </div>
  `;

    suggestionPanel.style.display = "block";
    makeDraggable(suggestionPanel, "#gemini-drag-handle");

    // Persist size changes
    if (!isMinimized) {
      const ro = new ResizeObserver(entries => {
        for (let entry of entries) {
           const { width, height } = entry.contentRect;
           if (width > 0 && height > 0) {
              userSavedSize = { width: suggestionPanel.style.width, height: suggestionPanel.style.height };
              chrome.storage.sync.set({ geminiPanelSize: userSavedSize });
           }
        }
      });
      ro.observe(suggestionPanel);
    }

    const toggleMinimize = () => {
      isMinimized = !isMinimized;
      chrome.storage.sync.set({ geminiPanelMinimized: isMinimized });
      showSuggestionPanel(analysis); // Re-render
    };

    document.getElementById("gemini-minimize-toggle")?.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleMinimize();
    });

    // Opacity control
    const opWrapper = suggestionPanel.querySelector(".gemini-opacity-wrapper");
    document.getElementById("gemini-opacity-toggle")?.addEventListener("click", (e) => {
      e.stopPropagation();
      opWrapper.style.display = opWrapper.style.display === "none" ? "flex" : "none";
    });

    const opSlider = document.getElementById("gemini-opacity-slider");
    opSlider?.addEventListener("input", (e) => {
      const val = parseFloat(e.target.value);
      suggestionPanel.style.opacity = val;
      userSavedOpacity = val;
      opWrapper.querySelector("span").textContent = `${Math.round(val * 100)}%`;
      chrome.storage.sync.set({ geminiPanelOpacity: val });
    });

    const close = () => hideUI();
    document.getElementById("gemini-x-btn")?.addEventListener("click", close);

    // Reposition panel
    repositionPanel();
  }

  function repositionPanel() {
    if (!suggestionPanel || !currentActiveTextarea || suggestionPanel.style.display === "none") return;
    if (isMinimized) return; // Don't snap bubble back
    if (userSavedPosition) return; // Respect manual drag

    const rect = currentActiveTextarea.getBoundingClientRect();
    const panelHeight = suggestionPanel.offsetHeight || 160;
    const panelWidth = suggestionPanel.offsetWidth || 400;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // Predict positioning
    let topPos = rect.top - panelHeight - 40;

    // If not enough space above, move below
    if (topPos < 10) {
      topPos = rect.bottom + 10;
      if (topPos + panelHeight > viewportHeight - 10) {
        topPos = 10; // Fallback to safe top
      }
    }

    // Failsafe: if topPos is still wacky or textarea is hidden
    if (rect.width === 0 || rect.height === 0 || isNaN(topPos)) {
      topPos = 20; 
    }

    suggestionPanel.style.top = `${topPos}px`;

    // Horizontal positioning
    let leftPos = rect.left;
    if (leftPos + panelWidth > viewportWidth - 20) {
      leftPos = viewportWidth - panelWidth - 20;
    }
    if (leftPos < 10 || isNaN(leftPos)) leftPos = 10;

    suggestionPanel.style.left = `${leftPos}px`;
  }

  function handleInput(e) {
    currentActiveTextarea = e.target;

    const nowVal = getChatText(currentActiveTextarea).trim();
    if (!nowVal) {
      hideUI();
      updateToolbarStatus(null, ""); // Explicitly clear toolbar when truly empty
      return;
    }

    clearTimeout(typingTimer);
    const textareaRef = currentActiveTextarea;

    typingTimer = setTimeout(() => {
      if (!textareaRef || textareaRef !== currentActiveTextarea) return;

      // Ensure config is loaded or try to reload
      if (!cachedConfig) {
        chrome.storage.local.get("remoteConfig", (data) => {
          if (data.remoteConfig) updateCachedConfig(data.remoteConfig);
        });
      }

      const latestVal = getChatText(textareaRef).trim();
      if (!latestVal) {
        hideUI();
        updateToolbarStatus(null, ""); 
        return;
      }

      const analysis = getAnalysis(latestVal);
      updateToolbarStatus(analysis, latestVal);

      const isDifferent = analysis.suggestedText !== latestVal;
      const hasError =
        (analysis.forbidden?.length || 0) > 0 ||
        (analysis.brands?.length || 0) > 0 ||
        (analysis.platforms?.length || 0) > 0 ||
        (analysis.typos?.length || 0) > 0 ||
        (analysis.grammar?.length || 0) > 0 ||
        (analysis.formatting?.length || 0) > 0 ||
        isDifferent;

      if (hasError) showSuggestionPanel(analysis);
      else hideUI();
    }, doneTypingInterval);
  }

  function hideUI() {
    clearTimeout(typingTimer);
    if (suggestionPanel) {
      suggestionPanel.style.display = "none";
      suggestionPanel.classList.remove("gemini-blocking-active");
    }
    if (geminiOverlay) {
      geminiOverlay.style.display = "none";
    }
    forceAllowSend = false;

    // REMOVED: statusPill.style.display = "none" from here
    // Toolbar should be managed solely by updateToolbarStatus(analysis, text)
    // to allow 'Perfect' label to persist even when suggestion panel is hidden.
  }

  // ---------- SEND BLOCK HOOKS ----------

  function onTextareaKeyDown(ev) {
    if (ev.key === "Enter" && !ev.shiftKey) {
      const blocked = enforceBlockIfNeeded(ev);
      if (blocked) return;
      
      // If not blocked, check if message sent (cleared) after a short delay
      setTimeout(() => {
        const val = getChatText(ev.target).trim();
        if (!val) hideUI();
      }, 300);
    }

    if (ev.key === "Escape") hideUI();
  }

  // 2) Block form submit
  function onFormSubmit(ev) {
    if (!currentActiveTextarea) return;
    const form = ev.target;
    if (form && form.contains(currentActiveTextarea)) {
      const blocked = enforceBlockIfNeeded(ev);
      if (blocked) return;
    }
  }

  // 3) Block send button click (exact button from your HTML + fallback)
  function onGlobalClickCapture(ev) {
    const t = ev.target;
    if (!t) return;

    // exact send button
    let btn = t.closest?.("button.button--icon.btn.btn-primary.btn-sm");

    // fallback: button--icon with text Send
    if (!btn) {
      const candidate = t.closest?.("button.button--icon");
      if (candidate) {
        const label = (candidate.textContent || "").trim().toLowerCase();
        if (label === "send" || label.includes("send")) btn = candidate;
      }
    }

    // broader fallback selectors (in case UI changes)
    if (!btn) btn = t.closest?.(CONFIG.SEND_BUTTON_SELECTORS);

    // ✅ TRICK: Also allow "Save" buttons if on a ticket form
    if (!btn) {
      const isTicketForm = document.querySelector('input[name="concern_id"]');
      if (isTicketForm) {
        btn = t.closest?.(".btn-primary, .btn-save, button[type='submit']");
      }
    }

    if (!btn) return;

    const blocked = enforceBlockIfNeeded(ev);
    if (blocked) return;

    // Not blocked: check if message sent after delay
    setTimeout(() => {
      const activeEl = currentActiveTextarea || document.activeElement;
      const val = getChatText(activeEl).trim();
      if (!val) hideUI();
    }, 300);
  }

  // ---------- CONFIG & CACHE ----------

  function updateCachedConfig(config) {
    if (!config) return;
    cachedConfig = config;

    const createRegex = (list) => {
      if (!list || list.length === 0) return null;
      const pattern = list
        .filter(Boolean)
        .sort((a, b) => b.length - a.length)
        .map(escapeRegExp)
        .join("|");
      return new RegExp(`(?:^|[^a-zA-Z0-9À-ỹ])(${pattern})(?=$|[^a-zA-Z0-9À-ỹ])`, "gi");
    };

    compiledData.brands = createRegex(config.allBrands || []);
    compiledData.marketplaces = createRegex(config.allMarketplaces || []);

    // Also compile forbidden words from rules
    const forbiddenList = (config.forbiddenRules?.VI || []).map(r => r.word);
    compiledData.forbidden = createRegex(forbiddenList);

    compiledData.typoLookup = {};
    if (config.typoDictionary && Array.isArray(config.typoDictionary)) {
      config.typoDictionary.forEach((item) => {
        if (item.error && item.fix) compiledData.typoLookup[item.error.trim().toLowerCase()] = item.fix.trim();
      });
    }

    console.log("[Gemini Content] Updated Config.");
  }

  // ---------- DIFF & HIGHLIGHT ----------

  function diffHighlight(original, suggested, pronounConflict = null, analysis = null) {
    const sOrig = (original || "").trim();
    const sSug = (suggested || sOrig || "").trim();
    const words1 = sOrig.split(/(\s+)/);
    const words2 = sSug.split(/(\s+)/);

    const pronounRegex = /(?<!\p{L})(anh[\s/]+chị|anh\s+chị|anh|chị)(?!\p{L})/giu;
    
    const isWordInErrors = (word, list) => {
      if (!list || !list.length) return false;
      const c = word.trim().toLowerCase();
      return list.some(e => (e.msg && e.msg.toLowerCase().includes(`"${c}"`)) || (e.word && e.word.trim().toLowerCase() === c));
    };

    const isGrammarError = (word, list) => {
      if (!list || !list.length) return false;
      const c = word.trim().toLowerCase();
      return list.some(e => e.msg && e.msg.toLowerCase().includes(`"${c}"`) && (e.msg.includes("Telex") || e.msg.includes("VNI") || e.msg.includes("bất thường")));
    };

    let html = "";
    let i = 0;
    for (let j = 0; j < words2.length; j++) {
      const w2 = words2[j];
      const w1 = words1[i] || "";

      pronounRegex.lastIndex = 0;
      const isP = pronounRegex.test(w2);
      let isC = false, isW = false;

      if (analysis) {
        if (isWordInErrors(w2, analysis.forbidden) || isWordInErrors(w2, analysis.brands) || isWordInErrors(w2, analysis.platforms)) isC = true;
        if (!isC && isGrammarError(w2, analysis.grammar)) isW = true;
      }

      if (w1.normalize() === w2.normalize()) {
        if (isC) html += `<span class="gemini-highlight-red">${escapeHtml(w2)}</span>`;
        else if (isP && pronounConflict) html += `<span class="gemini-highlight-blue">${escapeHtml(w2)}</span>`;
        else if (isW) html += `<span class="gemini-highlight-amber">${escapeHtml(w2)}</span>`;
        else html += escapeHtml(w2);
        i++;
      } else {
        // Mismatch
        if (isC) html += `<span class="gemini-highlight-red">${escapeHtml(w2)}</span>`;
        else if (isP) html += `<span class="gemini-highlight-blue">${escapeHtml(w2)}</span>`;
        else if (isW) html += `<span class="gemini-highlight-amber">${escapeHtml(w2)}</span>`;
        else {
          const cls = w2.trim() === "" ? "gemini-processed-msg gemini-highlight-space" : "gemini-processed-text";
          html += `<span class="${cls}">${escapeHtml(w2)}</span>`;
        }
        // Sync
        if (words1[i+1] && words1[i+1].normalize() === w2.normalize()) i += 2;
        else if (w1.trim() && w2.trim()) i++;
      }
    }
    return html;
  }

  // ---------- UTILS ----------

  function escapeHtml(s) {
    return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function superClean(str) {
    if (!str) return "";
    return str
      .toString()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]/g, "")
      .trim();
  }

  function areBrandsRelated(foundBrand, contextBrand, groups) {
    if (!foundBrand || !contextBrand) return false;
    const fb = superClean(foundBrand);
    const cb = superClean(contextBrand);
    if (fb === cb || cb.includes(fb) || fb.includes(cb)) return true;

    const safeGroups = groups || [];
    for (const group of safeGroups) {
      if (!Array.isArray(group)) continue;
      const cleanMembers = group.map((m) => superClean(m));
      if (
        cleanMembers.some((m) => fb === m || fb.includes(m)) &&
        cleanMembers.some((m) => cb === m || cb.includes(m))
      ) return true;
    }
    return false;
  }

  // ---------- SEMANTIC & PHONETIC (LOCAL) ----------

  /**
   * Validates if a word follows Vietnamese phonetic rules (Syllable structure).
   * This is a heuristic-based approach to catch typing errors like "bna", "qoa", "hjr".
   */
  function isPossibleVietnameseSyllable(word) {
    const s = word.toLowerCase().normalize("NFC");
    if (!/^[\p{L}]+$/u.test(s)) return true; // Ignore if not pure letters
    if (s.length <= 1) return true; // Short words are hard to validate accurately without dictionary

    // 1. Letters that DO NOT exist in Vietnamese alphabet
    if (/[fzjvw]/i.test(s)) return false;

    // 2. English consonant clusters & combinations not valid in VN
    const engClusters = /bl|br|cl|cr|dr|fl|fr|gl|gr|pl|pr|sc|sk|sl|sm|sn|sp|st|sw|tw|wh|wr|sch|scr|shr|sph|spl|spr|squ|str|pt|ct|ft|lt|lk|ld|lf|lp|rk|rc|rd|rf|rp|rt|mp|nt|nd|nc|nk|nx|mb|ll|rr|ss|cc|mm|nn|dd|pp|bb|gg/i;

    if (engClusters.test(s)) return false;

    // Check for impossible character combinations in Vietnamese
    const impossible = [
      /[aeiouyáàảãạâấầẩẫậăắằẳẵặéèẻẽẹêếềểễệíìỉĩịóòỏõọôốồổỗộơớờởỡợúùủũụưứừửữựýỳỷỹỵ]{4,}/i, // 4+ vowels
      /[q][^u]/i,                     // q must be followed by u
      /[v][wr]/i,                     // v cannot be followed by w or r
      /[x][gh]/i                      // x cannot be followed by g or h
    ];

    if (impossible.some(rx => rx.test(s))) return false;

    // 3+ consonants check (excluding valid 'ngh' cluster)
    if (/[bcdfghjklmnpqrstvwxz]{3,}/i.test(s.replace(/ngh/gi, ""))) {
      return false;
    }

    // Flag known weird patterns
    if (/(.)\1\1/.test(s)) return false; // 3 identical chars (aaa, bbb)

    // Specific catch for "bna", "qoa", etc.
    const weird = [/^bna$/i, /^qoa$/i, /^hjr$/i, /^vwr$/i, /^xgh$/i];
    if (weird.some(rx => rx.test(s))) return false;

    return true;
  }

  /**
   * Enhances chat professionalism by suggesting punctuation and tone improvements.
   */
  function polishChatTone(text, results) {
    const s = text.toLowerCase();
    const sentences = text.split(/([.!?\n])/).filter(Boolean);

    // 1. Greeting Punctuation (Warning if missed manually)
    if (/^(Dạ|Chào (?:anh|chị|em|bạn|quý khách))(?!\s*[,!])/i.test(text)) {
      results.grammar.push({ word: "greeting", msg: "Đã thêm dấu phẩy sau lời chào giúp câu chat chuyên nghiệp hơn" });
    }

    // 2. Question Detection
    const questionIndicators = [
      /\bcho em hỏi\b/i,
      /\bkhông biết\b/i,
      /\banh có thể\b/i,
      /\bchị có thể\b/i,
      /\bcòn hàng không\b/i,
      /\bgiao chưa\b/i
    ];

    // Check if any sentence starts with indicator but lacks '?'
    sentences.forEach(sent => {
      const trimmed = sent.trim();
      if (questionIndicators.some(rx => rx.test(trimmed)) && !trimmed.endsWith('?')) {
        if (trimmed.length > 5) {
          results.grammar.push({ word: "?", msg: "Câu hỏi nên kết thúc bằng dấu chấm hỏi (?)" });
        }
      }
    });

    // 3. Refined "Nếu... thì" (Only for long, complex sentences)
    if (/\bnếu\b/i.test(s) && !/\bthì\b/i.test(s)) {
      if (s.split(/\s+/).length > 12) {
        results.grammar.push({ word: "mechanics", msg: "Cấu trúc 'Nếu...' dài nên có '...thì...' để rõ mạch văn" });
      }
    }

    // 4. Politeness suggestion for short sentences
    const shortBlunt = /^(đợi xíu|chờ tí|hết hàng|qua xem)$/i;
    if (shortBlunt.test(text.trim())) {
      results.grammar.push({ word: "tone", msg: "Nên thêm 'ạ' hoặc 'nhé' để câu trả lời mềm mỏng hơn" });
    }
  }

  function getCurrentContext() {
    const host = window.location.hostname.toLowerCase();
    let currentMarketplace = "general",
      currentBrand = "general",
      customerId = "N/A",
      isExternal = true;

    const isManagement = CONFIG.MANAGEMENT_DOMAINS.some((d) => host.includes(d)) ||
      window.location.href.includes("test_area.html") ||
      window.location.protocol === "file:";

    if (isManagement) {
      isExternal = false;

      let activeItem = null;
      for (const selector of CONFIG.ACTIVE_ITEM_SELECTORS) {
        activeItem = document.querySelector(selector);
        if (activeItem) break;
      }

      // Extraction for Customer ID
      for (const selector of CONFIG.CUSTOMER_ID_SELECTORS) {
        const el = document.querySelector(selector);
        if (el) {
          customerId = el.textContent.trim().replace(/\s+/g, ' ');
          break;
        }
      }

      if (activeItem) {
        let nameElement = null;
        for (const selector of CONFIG.NAME_SELECTORS) {
          nameElement = activeItem.querySelector(selector);
          if (nameElement) break;
        }

        // Fallback: Nếu không tìm thấy nameElement qua selector, lấy text trực tiếp
        let fullName = "";
        if (nameElement) {
          fullName = (nameElement.textContent || "").trim();
        } else {
          // Thử lấy từ title hoặc text content của chính activeItem nếu nó ngắn
          fullName = (activeItem.title || activeItem.getAttribute('aria-label') || "").trim();
          if (!fullName) {
            const text = (activeItem.textContent || "").trim();
            if (text.length > 0 && text.length < 100) fullName = text;
          }
        }

        const dashRegex = /\s*[-–—|]\s*/;
        if (fullName && dashRegex.test(fullName)) {
          const parts = fullName.split(dashRegex);
          currentBrand = parts[0].trim();
          if (parts.length >= 2) {
            const marketPart = parts[parts.length - 1].trim().toLowerCase();
            if (marketPart.includes("shopee")) currentMarketplace = "shopee";
            else if (marketPart.includes("lazada")) currentMarketplace = "lazada";
            else if (marketPart.includes("tiktok")) currentMarketplace = "tiktok";
            else if (marketPart.includes("tiki")) currentMarketplace = "tiki";
            else currentMarketplace = marketPart;
          }
        } else if (fullName) {
          currentBrand = fullName;
        }
      }

      // Fallback bổ sung cho admin.onpoint.vn: kiểm tra các tab sàn nếu không thấy active item
      if (currentMarketplace === "general") {
        const activeTab = document.querySelector(".ant-tabs-tab-active, .tab-item.active, .nav-link.active");
        if (activeTab) {
          const tabText = activeTab.textContent.toLowerCase();
          if (tabText.includes("shopee")) currentMarketplace = "shopee";
          else if (tabText.includes("lazada")) currentMarketplace = "lazada";
          else if (tabText.includes("tiktok")) currentMarketplace = "tiktok";
        }
      }
    }

    return { currentBrand, currentMarketplace, customerId, isExternal };
  }

  // ---------- MOOD ANALYSIS ----------

  function analyzeMood(text) {
    if (!text) return { isNegative: false, reasons: [], category: null };

    const results = {
      isNegative: false,
      reasons: [],
      category: null
    };

    const lower = text.toLowerCase();

    // Exclusion Check (Don't trigger for pure info requests)
    if (MOOD_INDICATORS.exclude.some(w => lower.includes(w))) {
      return results;
    }

    // Priority 1: Specific Empathy Categories
    // - Quality/Damage
    if (MOOD_INDICATORS.quality.some(w => lower.includes(w))) {
      results.isNegative = true;
      results.category = "quality";
      results.reasons.push("QUALITY_ISSUE");
    }
    // - Fake Suspicion
    else if (MOOD_INDICATORS.fakeSuspicion.some(w => lower.includes(w))) {
      results.isNegative = true;
      results.category = "fake";
      results.reasons.push("FAKE_SUSPICION");
    }
    // - Logistics/Delivery
    else if (MOOD_INDICATORS.logistics.some(w => lower.includes(w))) {
      results.isNegative = true;
      results.category = "logistics";
      results.reasons.push("LOGISTICS_ISSUE");
    }
    // - Gifts/Promos
    else if (MOOD_INDICATORS.gifts.some(w => lower.includes(w))) {
      results.isNegative = true;
      results.category = "gifts";
      results.reasons.push("PROMO_ISSUE");
    }
    // - Service Experience (Pushing/Frustration)
    else if (MOOD_INDICATORS.service.some(w => lower.includes(w))) {
      results.isNegative = true;
      results.category = "service";
      results.reasons.push("SERVICE_ISSUE");
    }
    // - General Complaint
    else if (MOOD_INDICATORS.complaint.some(w => lower.includes(w))) {
      results.isNegative = true;
      results.category = "complaint";
      results.reasons.push("COMPLAINT");
    }

    // Priority 2: Intensive Mood (CAPS / Punc) - These can overlap
    // 1. CAPS LOCK detection
    const letters = text.replace(/[^\p{L}]/gu, "");
    if (letters.length > 5) {
      const caps = letters.replace(/[\p{Ll}]/gu, "").length;
      if (caps / letters.length > 0.7) {
        results.isNegative = true;
        results.reasons.push("CAPS_LOCK");
        if (!results.category) results.category = "angry";
      }
    }

    // 2. Excessive Punctuation
    if (/([?!]){3,}/.test(text)) {
      results.isNegative = true;
      results.reasons.push("PUNCTUATION");
      if (!results.category) results.category = "angry";
    }

    // 4. Negative Emojis
    for (const emoji of MOOD_INDICATORS.emojis) {
      if (text.includes(emoji)) {
        results.isNegative = true;
        results.reasons.push("EMOJI");
        if (!results.category) results.category = "angry";
        break;
      }
    }

    return results;
  }

  function updateMoodAlert(mood) {
    if (!moodAlertPanel) createMoodUI();

    const adviceMap = {
      logistics: {
        title: "Giao hàng hơi chậm túi nè~",
        action: "Đồng cảm với khách vì sự chờ đợi không như mong đợi, xin lỗi chân thành và hứa kiểm tra ngay tiến độ nhé! ✨"
      },
      quality: {
        title: "Sản phẩm gặp chút trục trặc rồi~",
        action: "Hãy thấu hiểu cảm xúc của khách khi nhận hàng không ưng ý, xin lỗi và cam kết hỗ trợ tận tình nha! 💝"
      },
      fake: {
        title: "Khách đang lăn tăn hàng giả nè~",
        action: "Hãy xoa dịu nỗi bất an bằng sự thấu hiểu, khẳng định uy tín và giải đáp kỹ lưỡng để khách an tâm nhé! 🛡️"
      },
      gifts: {
        title: "Quà tặng bị lạc lối rồi~",
        action: "Hãy đồng cảm vì trải nghiệm quà tặng không như mong đợi, xin lỗi và hứa sẽ kiểm tra lại thông tin ngay nhé! 🎀"
      },
      service: {
        title: "Khách đang hối thúc nè~",
        action: "Hãy xin lỗi vì để khách đợi, phản hồi thật nhanh và ngọt ngào để xoa dịu khách nha! ⚡"
      },
      complaint: {
        title: "Khách đang buồn lòng lắm đó~",
        action: "Hãy xin lỗi thật sâu sắc, đừng chỉ 'Cảm ơn' suông mà hãy ôm trọn cảm xúc của khách nhé! ❤️"
      },
      angry: {
        title: "Khách đang cực kỳ gắt luôn~",
        action: "Hãy giữ bình tĩnh, xin lỗi thật khéo và xoa dịu 'ngọn lửa' này ngay lập tức nha! 🧊"
      }
    };

    if (mood.isNegative) {
      const textEl = moodAlertPanel.querySelector(".gemini-mood-text");
      const iconEl = moodAlertPanel.querySelector(".gemini-mood-icon");

      const advice = adviceMap[mood.category] || adviceMap.angry;
      const iconMap = {
        logistics: "🚚",
        quality: "📦",
        fake: "🤨",
        gifts: "🎁",
        service: "😤",
        complaint: "🤬",
        angry: "🔥"
      };

      if (textEl) {
        textEl.innerHTML = `
        <div style="font-size: 16px; font-weight: 700; margin-bottom: 6px; display: flex; align-items: center; gap: 8px;">
          ${iconMap[mood.category] || iconMap.angry} ${advice.title}
        </div>
        <div style="font-size: 14px; font-weight: 500; opacity: 0.9; line-height: 1.5;">${advice.action}</div>
        <div style="margin-top: 12px; padding-top: 10px; border-top: 1px dashed rgba(0,0,0,0.1); font-size: 12px; font-style: italic; opacity: 0.7; color: currentColor;">
          Nếu tớ nhận diện nhầm tình huống, cho tớ xin lỗi nha! ✨
        </div>
      `;
      }
      // We already included the icon in the innerHTML title for better layout, 
      // but let's keep iconEl for backward compatibility or hide it if redundant.
      if (iconEl) iconEl.style.display = "none";

      moodAlertPanel.style.display = "flex";

      // Clear previous classes
      document.body.classList.remove("gemini-mood-negative", "gemini-mood-info");
      moodAlertPanel.className = "";

      // Logic: Red Alert for complaints/quality/service, Blue/Info for logistics/gifts/fake
      const isHighAlert = ["complaint", "quality", "service", "angry"].includes(mood.category) || !mood.category;

      if (isHighAlert) {
        document.body.classList.add("gemini-mood-negative");
        moodAlertPanel.classList.add("gemini-mood-type-error");
      } else {
        document.body.classList.add("gemini-mood-info");
        moodAlertPanel.classList.add("gemini-mood-type-info");
      }
    } else {
      moodAlertPanel.style.display = "none";
      document.body.classList.remove("gemini-mood-negative", "gemini-mood-info");
    }
  }

  function scanCustomerMessages() {
    // proactive check for session changes (especially for admin.onpoint flow)
    const ctx = getCurrentContext();
    const sessionKey = `${ctx.currentBrand}-${ctx.currentMarketplace}-${ctx.customerId}`;

    if (MOOD_INDICATORS.lastActiveSession && MOOD_INDICATORS.lastActiveSession !== sessionKey) {
      console.log("[Gemini Sentiment] Session changed, forcing re-scan.");
      MOOD_INDICATORS.lastAnalyzedText = null; // Force scan
      updateMoodAlert({ isNegative: false }); // Reset alert for new session until scanned
    }
    MOOD_INDICATORS.lastActiveSession = sessionKey;

    // Target messages that are likely from the customer (received/left side)
    const selectors = [
      ".chat-item.chat-item--customer .chat-item__content", // Admin.onpoint exact
      ".chat-item--customer .chat-item__content",
      ".msg.received .chat-item__content",
      ".chat-item--received .chat-item__content",
      ".left-message .chat-item__content",
      ".chat-item__content:not(.sent):not(.right)" // Fallback for mixed lists
    ];

    let allCustomerMsgs = [];
    for (const sel of selectors) {
      const found = document.querySelectorAll(sel);
      if (found.length) {
        allCustomerMsgs = Array.from(found);
        break;
      }
    }

    if (!allCustomerMsgs.length) return;

    // Analyze the LAST 5 messages for better context (in case of scrolling/reading)
    const recentMsgs = allCustomerMsgs.slice(-5);
    const combinedText = recentMsgs.map(m => m.innerText.trim()).join(" | ");

    // Simple deduplication using combined text
    if (combinedText === MOOD_INDICATORS.lastAnalyzedText) return;
    MOOD_INDICATORS.lastAnalyzedText = combinedText;

    // Find the most 'moody' message among the last 5
    let finalMood = { isNegative: false, reasons: [], category: null };

    // Iterate from newest to oldest
    for (let i = recentMsgs.length - 1; i >= 0; i--) {
      const text = recentMsgs[i].innerText.trim();
      if (!text) continue;

      const mood = analyzeMood(text);
      if (mood.isNegative) {
        // Prioritize the FIRST negative mood found (the most recent one)
        finalMood = mood;
        break;
      }
    }

    console.log("[Gemini Sentiment] Final mood from recent history:", finalMood);
    updateMoodAlert(finalMood);
  }

  function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  // ---------- UI init / listeners ----------

  function createUIElements() {
    if (document.getElementById("gemini-suggestion-panel")) {
      suggestionPanel = document.getElementById("gemini-suggestion-panel");
      geminiOverlay = document.getElementById("gemini-overlay");
      return;
    }

    // Create Panel
    suggestionPanel = document.createElement("div");
    suggestionPanel.id = "gemini-suggestion-panel";
    document.body.appendChild(suggestionPanel);

    // Create Overlay (append after panel for sibling CSS selectors)
    geminiOverlay = document.createElement("div");
    geminiOverlay.id = "gemini-overlay";
    geminiOverlay.style.cssText = `
      display: none;
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background: transparent;
      z-index: 9999998;
    `;
    geminiOverlay.addEventListener("click", hideUI);
    document.body.appendChild(geminiOverlay);
  }

  function createMoodUI() {
    if (document.getElementById("gemini-mood-alert")) {
      moodAlertPanel = document.getElementById("gemini-mood-alert");
      return;
    }

    moodAlertPanel = document.createElement("div");
    moodAlertPanel.id = "gemini-mood-alert";
    moodAlertPanel.innerHTML = `
    <div class="gemini-mood-content">
        <span class="gemini-mood-icon" style="align-self: flex-start; margin-top: 2px;"></span>
        <div class="gemini-mood-text" style="flex: 1;">
            Hệ thống phát hiện cảm xúc khách hàng đang không tốt...
        </div>
        <button class="gemini-mood-close" title="Đóng" style="align-self: flex-start;">✕</button>
    </div>
  `;
    document.body.appendChild(moodAlertPanel);

    moodAlertPanel.querySelector(".gemini-mood-close").addEventListener("click", () => {
      moodAlertPanel.style.display = "none";
      document.body.classList.remove("gemini-mood-negative");
    });

    // Inject CSS for mood alert if not already in a stylesheet
    if (!document.getElementById("gemini-mood-styles")) {
      const style = document.createElement("style");
      style.id = "gemini-mood-styles";
      style.textContent = `
            #gemini-mood-alert {
                position: fixed;
                top: 25px;
                left: 50%;
                transform: translateX(-50%);
                z-index: 1000000;
                background: rgba(255, 245, 245, 0.85);
                backdrop-filter: blur(12px);
                border: 1px solid rgba(254, 202, 202, 0.5);
                color: #991b1b;
                padding: 14px 28px;
                border-radius: 24px;
                box-shadow: 0 12px 30px -5px rgba(153, 27, 27, 0.12), 0 4px 10px -2px rgba(153, 27, 27, 0.05);
                display: none;
                align-items: center;
                font-size: 14px;
                font-weight: 600;
                animation: gemini-premium-bounce 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275);
                letter-spacing: -0.01em;
            }
            #gemini-mood-alert.gemini-mood-type-info {
                background: rgba(240, 249, 255, 0.85);
                border-color: rgba(186, 230, 253, 0.5);
                color: #0369a1;
                box-shadow: 0 12px 30px -5px rgba(3, 105, 161, 0.12), 0 4px 10px -2px rgba(3, 105, 161, 0.05);
            }
            .gemini-mood-content {
                display: flex;
                align-items: center;
                gap: 14px;
                max-width: 550px;
                line-height: 1.5;
            }
            .gemini-mood-icon { 
                font-size: 20px;
                filter: drop-shadow(0 2px 4px rgba(0,0,0,0.1));
            }
            .gemini-mood-close {
                background: rgba(0,0,0,0.03);
                border: none;
                color: currentColor;
                opacity: 0.4;
                cursor: pointer;
                font-size: 14px;
                width: 24px;
                height: 24px;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                margin-left: 12px;
                transition: all 0.2s;
            }
            .gemini-mood-close:hover { opacity: 1; background: rgba(0,0,0,0.08); }
            
            @keyframes gemini-premium-bounce {
                from { transform: translate(-50%, -80px) scale(0.9); opacity: 0; }
                to { transform: translate(-50%, 0) scale(1); opacity: 1; }
            }
            
            /* Custom Scrollbar for the glow effect if needed */
            body.gemini-mood-negative::after, body.gemini-mood-info::after {
                content: '';
                position: fixed;
                inset: 10px;
                pointer-events: none;
                border-radius: 20px;
                z-index: 999999;
                transition: all 0.5s ease;
            }
            
            body.gemini-mood-negative::after {
                box-shadow: 0 0 0 4px rgba(239, 68, 68, 0.1), inset 0 0 80px rgba(239, 68, 68, 0.15);
                animation: gemini-soft-pulse-red 3s infinite ease-in-out;
            }
            
            body.gemini-mood-info::after {
                box-shadow: 0 0 0 4px rgba(14, 165, 233, 0.08), inset 0 0 80px rgba(14, 165, 233, 0.12);
                animation: gemini-soft-pulse-blue 3.5s infinite ease-in-out;
            }

            @keyframes gemini-soft-pulse-red {
                0%, 100% { transform: scale(1); opacity: 0.7; }
                50% { transform: scale(1.005); opacity: 1; }
            }
            @keyframes gemini-soft-pulse-blue {
                0%, 100% { transform: scale(1); opacity: 0.6; }
                50% { transform: scale(1.005); opacity: 0.9; }
            }
        `;
      document.head.appendChild(style);
    }
  }

  function attachListeners(element) {
    if (!element || element.dataset.geminiAttached) return;
    element.dataset.geminiAttached = "true";

    element.addEventListener("input", handleInput);
    // Use capture: true to intercept Enter before page scripts
    element.addEventListener("keydown", onTextareaKeyDown, { capture: true });
  }

  // ---------- INIT ----------

  chrome.storage.local.get("remoteConfig", (data) => {
    if (data.remoteConfig) updateCachedConfig(data.remoteConfig);
  });

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "CONFIG_UPDATED") {
      cachedConfig = request.config;
      compileData();
      checkVersion(cachedConfig);
      return;
    }
  });

  // Theo dõi phần tử chat đang active một cách chủ động
  document.addEventListener("focusin", (e) => {
    const el = e.target;
    if (el && (el.tagName === "TEXTAREA" || el.isContentEditable)) {
      currentActiveTextarea = el;
    }
  }, true);

  function scan() {
    const chatInputs = document.querySelectorAll("textarea, [contenteditable='true'], .shopee-text-area__content, .chat-input-container [contenteditable]");
    chatInputs.forEach(attachListeners);
    scanCustomerMessages();
    injectMacroToolbarButton(); // Tích hợp vào thanh công cụ chat
  }
  setInterval(scan, 2000);

  // --- QUICK MACRO INTEGRATION ---

  function applyPronounChange(targetPronoun) {
    const ctx = getCurrentContext();
    const sessionKey = `${ctx.currentBrand}-${ctx.currentMarketplace}-${ctx.customerId}`;
    sessionPronounPrefs[sessionKey] = targetPronoun;

    // 1. Update text in active textarea if any
    findActiveTextarea();

    if (currentActiveTextarea) {
      const isEditable = currentActiveTextarea.isContentEditable;
      const currentText = isEditable ? currentActiveTextarea.innerText : currentActiveTextarea.value;
      const newText = translatePronouns(currentText, targetPronoun);
      
      if (currentText !== newText) {
        if (isEditable) {
          // For contenteditable, try to preserve cursor if possible, but simplest is full replace for this feature
          currentActiveTextarea.innerText = newText;
        } else {
          const start = currentActiveTextarea.selectionStart;
          const end = currentActiveTextarea.selectionEnd;
          currentActiveTextarea.value = newText;
          currentActiveTextarea.selectionStart = start; 
          currentActiveTextarea.selectionEnd = end;
        }
        currentActiveTextarea.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }

    // 2. Update UI (highlight active button)
    document.querySelectorAll(".gemini-pronoun-quick-btn").forEach(btn => {
      btn.classList.toggle("active", btn.dataset.pronoun === targetPronoun);
    });
  }

  function findActiveTextarea() {
    if (currentActiveTextarea && document.contains(currentActiveTextarea)) return;

    // 1. Try currently focused element
    const focused = document.activeElement;
    if (focused && (focused.tagName === "TEXTAREA" || focused.isContentEditable)) {
      currentActiveTextarea = focused;
      return;
    }

    // 2. Shopee & Lazada Specific Selectors (Priority)
    const chatSelectors = [
      ".shopee-text-area__content",             // Shopee contenteditable
      "textarea.shopee-text-area__input",       // Shopee textarea fallback
      ".chat-input-container [contenteditable]", // Lazada
      ".next-input textarea",                   // Lazada fallback
      ".composer textarea",                     // Generic admin tools
      ".editor-container [contenteditable]",    // Generic editor
      "[role='textbox']"                        // Accessibility standard
    ];

    for (const sel of chatSelectors) {
      const found = document.querySelectorAll(sel);
      if (found.length > 0) {
        // Pick the last one found as it's typically the main chat composer at the bottom
        currentActiveTextarea = found[found.length - 1];
        return;
      }
    }

    // 3. Try to find near the toolbar
    const toolbar = document.querySelector(".text-left.d-flex.align-items-center.gap-2.col");
    if (toolbar) {
      const parentChat = toolbar.closest(".chat-container, .chat-box, .composer, .editor-container, .messenger-box") || toolbar.parentElement.parentElement;
      if (parentChat) {
        currentActiveTextarea = parentChat.querySelector("textarea") || parentChat.querySelector("[contenteditable='true']");
        if (currentActiveTextarea) return;
      }
    }

    // 4. Fallback: last textarea/contenteditable on page
    const all = document.querySelectorAll("textarea, [contenteditable='true']");
    if (all.length > 0) currentActiveTextarea = all[all.length - 1];
  }


  function injectMacroToolbarButton() {
    // Target: Thanh công cụ chat mà user đã gửi HTML
    const toolbar = document.querySelector(".text-left.d-flex.align-items-center.gap-2.col");
    if (!toolbar || toolbar.querySelector(".gemini-quick-macro-trigger")) return;

    const span = document.createElement("span");
    span.className = "cursor-pointer gemini-quick-macro-trigger";
    span.title = "Tìm kiếm Macro";
    
    // Icon SVG đồng bộ với style hệ thống của user (text-black-50, stroke-width 2)
    span.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-black-50" style="margin-top: 3px;">
        <circle cx="12" cy="12" r="10"></circle>
        <circle cx="12" cy="12" r="3"></circle>
        <line x1="12" y1="2" x2="12" y2="4"></line>
        <line x1="12" y1="20" x2="12" y2="22"></line>
        <line x1="2" y1="12" x2="4" y2="12"></line>
        <line x1="20" y1="12" x2="22" y2="12"></line>
      </svg>
    `;

    span.style.marginLeft = "4px";
    span.addEventListener("click", (e) => {
      e.stopPropagation();
      openMacroSearchOverlay(span);
    });

    toolbar.appendChild(span);

    // --- Pronoun Buttons ---
    const ctx = getCurrentContext();
    const sessionKey = `${ctx.currentBrand}-${ctx.currentMarketplace}-${ctx.customerId}`;
    const activePronoun = sessionPronounPrefs[sessionKey] || "anh/chị";

    const pronouns = ["Anh/Chị", "Anh", "Chị"];
    pronouns.forEach(p => {
      const pBtn = document.createElement("span");
      pBtn.className = "gemini-pronoun-quick-btn";
      const pVal = p.toLowerCase();
      if (pVal === activePronoun) pBtn.classList.add("active");
      pBtn.dataset.pronoun = pVal;
      pBtn.innerText = p;
      pBtn.title = `Chốt danh xưng: ${p}`;
      
      pBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        applyPronounChange(pVal);
      });
      toolbar.appendChild(pBtn);
    });

    // --- Toolbar Warning Status ---
    const statusPill = document.createElement("div");
    statusPill.id = "gemini-toolbar-status";
    statusPill.className = "gemini-toolbar-status";
    statusPill.style.display = "none"; 
    toolbar.appendChild(statusPill);
  }

  function isCritical(analysis) {
    return (analysis.forbidden?.length > 0 || analysis.brands?.length > 0 || analysis.platforms?.length > 0);
  }

  function updateToolbarStatus(analysis, text) {
    const statusPill = document.getElementById("gemini-toolbar-status");
    if (!statusPill) return;

    // 1. Hide if empty text
    if (!text || text.trim().length === 0) {
      statusPill.classList.remove("pulse", "pulse-green", "minor", "perfect", "critical");
      statusPill.style.display = "none";
      statusPill.innerHTML = ""; // Clear content to prevent sizing artifacts
      return;
    }

    // Reset classes for active states
    statusPill.classList.remove("pulse", "pulse-green", "minor", "perfect", "critical");
    statusPill.style.display = "flex";
    statusPill.innerHTML = "";

    // 2. Critical Errors (Highest Priority - Red)
    // If any critical error is found, we show it and STOP (return) to avoid yellow override
    if (analysis.forbidden?.length > 0) {
      statusPill.innerHTML = `⚠️ CÓ TỪ CẤM`;
      statusPill.classList.add("pulse", "critical");
      return;
    } 
    
    if (analysis.brands?.length > 0) {
      statusPill.innerHTML = `⚠️ SAI BRAND`;
      statusPill.classList.add("pulse", "critical");
      return;
    } 
    
    if (analysis.platforms?.length > 0) {
      statusPill.innerHTML = `⚠️ SAI SÀN`;
      statusPill.classList.add("pulse", "critical");
      return;
    } 

    // 3. Minor Errors (Only if there are REAL grammar warnings or typo/formatting issues)
    // We ignore if it's just a slight difference in punctuation/spacing
    const hasWarnings = (analysis.grammar || []).some(g => g && g.msg && !g.msg.startsWith("Đã sửa") && !g.msg.startsWith("Đã thêm"));
    const cleanSuggested = (analysis.suggestedText || "").replace(/[.,!?\s]/g, "");
    const cleanCurrent = (text || "").replace(/[.,!?\s]/g, "");
    const isActuallyDifferent = cleanSuggested !== cleanCurrent;

    if (hasWarnings || analysis.typos?.length > 0 || isActuallyDifferent) {
      statusPill.classList.add("minor");
      statusPill.innerHTML = "📝 KIỂM TRA LẠI";
    }
    // 4. Perfect State (Everything good - Green)
    else {
      statusPill.classList.add("perfect", "pulse-green");
      statusPill.innerHTML = "✨ QUÁ TUYỆT VỜI";
    }
  }


  function openMacroSearchOverlay(triggerEl) {
    if (!macroSearchOverlay) {
      macroSearchOverlay = document.createElement("div");
      macroSearchOverlay.id = "gemini-macro-overlay";
      macroSearchOverlay.innerHTML = `
        <div class="macro-search-container">
          <input type="text" id="macro-search-input" placeholder="Tìm macro nhanh..." />
          <div id="macro-search-results"></div>
        </div>
      `;
      document.body.appendChild(macroSearchOverlay);

      const input = macroSearchOverlay.querySelector("#macro-search-input");
      let searchTimer;
      input.addEventListener("input", (e) => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => execMacroSearch(e.target.value), 300);
      });
      
      // Prevent closing when clicking inside
      macroSearchOverlay.addEventListener("mousedown", (e) => e.stopPropagation());

      // Close when clicking outside
      document.addEventListener("mousedown", (e) => {
        if (macroSearchOverlay && macroSearchOverlay.style.display === "block") {
          if (!macroSearchOverlay.contains(e.target)) {
            macroSearchOverlay.style.display = "none";
            if (macroFullPreview) macroFullPreview.style.display = "none";
          }
        }
      });

      // Create Full Preview Container
      macroFullPreview = document.createElement("div");
      macroFullPreview.id = "gemini-macro-full-preview";
      macroFullPreview.innerHTML = `<div class="preview-inner"></div>`;
      document.body.appendChild(macroFullPreview);

      // Keep preview open when hovering it
      macroFullPreview.addEventListener("mouseenter", () => {
        if (macroHideTimer) clearTimeout(macroHideTimer);
      });
      macroFullPreview.addEventListener("mouseleave", () => {
        macroHideTimer = setTimeout(() => {
          macroFullPreview.style.display = "none";
        }, 300);
      });
    }

    const rect = triggerEl.getBoundingClientRect();
    macroSearchOverlay.style.display = "block";
    
    // Smart Left positioning
    let left = rect.left;
    if (left + 480 > window.innerWidth) {
      left = window.innerWidth - 500;
    }
    macroSearchOverlay.style.left = `${Math.max(10, left)}px`;

    // Smart Top positioning (Above or Below)
    // We use a safe estimate or wait for first render, but better to prefer UP if room.
    const estimatedHeight = 420; // Max height with scroll + input
    if (rect.top > estimatedHeight) {
      macroSearchOverlay.style.top = `${rect.top - estimatedHeight - 10}px`;
    } else {
      macroSearchOverlay.style.top = `${rect.bottom + 10}px`;
    }

    const input = macroSearchOverlay.querySelector("#macro-search-input");
    input.value = "";
    input.focus();
    execMacroSearch(""); // Load ban đầu
  }

  async function execMacroSearch(q) {
    const resultsDiv = macroSearchOverlay.querySelector("#macro-search-results");
    resultsDiv.innerHTML = '<div class="macro-loading">Đang tìm...</div>';

    chrome.storage.sync.get(['macroAuthToken'], async (data) => {
      if (!data.macroAuthToken) {
        resultsDiv.innerHTML = '<div class="macro-error">Vui lòng đăng nhập hệ thống Macro qua Popup extension.</div>';
        return;
      }

      try {
        const response = await fetch(`${MACRO_API_BASE_URL}/macros/search?q=${encodeURIComponent(q)}`, {
          headers: { 'Authorization': `Bearer ${data.macroAuthToken}` }
        });
        const macros = await response.json();

        resultsDiv.innerHTML = "";
        const context = getCurrentContext();
        const filteredMacros = macros.filter(m => isMacroValidForContext(m, context));

        if (filteredMacros.length === 0) {
          const suffix = (macros.length > 0) ? " (Đã ẩn các mẫu sai sàn/brand)" : "";
          resultsDiv.innerHTML = `<div class="macro-empty">Hông thấy macro nào...${suffix}</div>`;
          return;
        }

        filteredMacros.forEach(m => {
          const plainText = extractTextFromContent(m.content);
          const richHtml = renderMacroAsHtml(m.content);
          const div = document.createElement("div");
          div.className = "macro-search-item";
          
          const categoryName = (m.category && m.category.name) ? m.category.name : (m.category || "Chưa phân loại");
          
          div.innerHTML = `
            <div class="m-category-tag">${escapeHtml(categoryName)}</div>
            <strong>${escapeHtml(m.title)}</strong>
            <p>${escapeHtml(plainText.substring(0, 80))}...</p>
          `;
          
          div.addEventListener("mouseenter", () => {
            if (macroHideTimer) clearTimeout(macroHideTimer);
            if (macroFullPreview) {
              const inner = macroFullPreview.querySelector(".preview-inner");
              if (inner) {
                inner.innerHTML = `
                  <strong>${escapeHtml(m.title)}</strong>
                  <div class="m-content">${richHtml}</div>
                `;
              }
              macroFullPreview.style.display = "block";
              
              // Smart positioning
              const itemRect = div.getBoundingClientRect();
              const overlayRect = macroSearchOverlay.getBoundingClientRect();
              
              let left = overlayRect.right + 12;
              let top = itemRect.top;
              
              // If no space on right, show on left
              if (left + 420 > window.innerWidth) {
                left = overlayRect.left - 422;
              }
              
              // Vertical adjustment
              const previewHeight = macroFullPreview.offsetHeight || 300;
              if (top + previewHeight > window.innerHeight) {
                top = window.innerHeight - previewHeight - 20;
              }

              macroFullPreview.style.left = `${left}px`;
              macroFullPreview.style.top = `${Math.max(10, top)}px`;
            }
          });

          div.addEventListener("mouseleave", () => {
            macroHideTimer = setTimeout(() => {
              if (macroFullPreview) macroFullPreview.style.display = "none";
            }, 300);
          });

          div.addEventListener("click", () => {
            insertMacroToActiveElement(plainText);
            macroSearchOverlay.style.display = "none";
            if (macroFullPreview) macroFullPreview.style.display = "none";
            // Increment usage
            fetch(`${MACRO_API_BASE_URL}/macros/${m._id}/increment-usage`, {
              method: 'PUT',
              headers: { 'Authorization': `Bearer ${data.macroAuthToken}` }
            }).catch(() => {});
          });
          resultsDiv.appendChild(div);
        });
      } catch (err) {
        resultsDiv.innerHTML = '<div class="macro-error">Lỗi kết nối hệ thống Macro.</div>';
      }
    });
  }

  function insertMacroToActiveElement(text) {
    // Apply pronoun translation if preference exists for this session
    const ctx = getCurrentContext();
    const sessionKey = `${ctx.currentBrand}-${ctx.currentMarketplace}-${ctx.customerId}`;
    const pref = sessionPronounPrefs[sessionKey];
    if (pref && pref !== "anh/chị") {
      text = translatePronouns(text, pref);
    }

    // 1. Tìm ô chat đang active
    findActiveTextarea();

    if (!currentActiveTextarea) {
      console.warn("[Gemini] Không tìm thấy ô chat để chèn macro.");
      return;
    }

    if (currentActiveTextarea.isContentEditable) {
      currentActiveTextarea.focus();
      // Xóa selection cũ để chèn vào vị trí cuối hoặc vị trí con trỏ
      const selection = window.getSelection();
      if (selection.rangeCount > 0) {
        document.execCommand('insertText', false, text);
      } else {
        currentActiveTextarea.innerText += text;
      }
    } else {
      const start = currentActiveTextarea.selectionStart;
      const end = currentActiveTextarea.selectionEnd;
      const val = currentActiveTextarea.value;
      currentActiveTextarea.value = val.substring(0, start) + text + val.substring(end);
      currentActiveTextarea.selectionStart = currentActiveTextarea.selectionEnd = start + text.length;
      currentActiveTextarea.dispatchEvent(new Event('input', { bubbles: true }));
      currentActiveTextarea.focus();
    }
  }


  /* ---------- QUICK MACRO FILTERING ALGORITHM ---------- */
  function isMacroValidForContext(macro, context) {
    if (!macro || !context) return true;

    const title = (macro.title || "").toLowerCase();
    const plainText = extractTextFromContent(macro.content).toLowerCase();
    const curMarket = (context.currentMarketplace || "general").toLowerCase();

    // 1. Platform Filtering Logic
    const platforms = ['shopee', 'lazada', 'tiktok', 'tiki'];
    const otherPlatforms = platforms.filter(p => p !== curMarket);
    
    // Rule: Exclude if tagged for other platforms but NOT for current
    if (macro.platformTags) {
      const taggedForOthers = otherPlatforms.some(p => macro.platformTags[p] === true);
      const taggedForCurrent = macro.platformTags[curMarket] === true;
      if (taggedForOthers && !taggedForCurrent) return false;
    }

    // Rule: Exclude if Title or Content mentions other platforms explicitly
    for (const p of otherPlatforms) {
      const regex = new RegExp(`\\b${p}\\b`, 'i');
      if (regex.test(title) || regex.test(plainText)) return false;
    }

    // 2. Brand Filtering Logic
    const curBrand = (context.currentBrand || "general").toLowerCase();
    if (!context.isExternal && curBrand !== "general" && compiledData.brands) {
      compiledData.brands.lastIndex = 0;
      let match;
      while ((match = compiledData.brands.exec(title + " " + plainText)) !== null) {
        const foundBrand = match[1];
        if (!areBrandsRelated(foundBrand, context.currentBrand, cachedConfig?.brandGroups)) {
           return false;
        }
        if (match.index === compiledData.brands.lastIndex) compiledData.brands.lastIndex++;
      }
    }

    return true;
  }

  function stripHtml(html) {
    if (!html) return "";
    try {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      return doc.body.textContent || html.replace(/<[^>]*>/g, '');
    } catch (e) {
      return html.replace(/<[^>]*>/g, '');
    }
  }

  function renderMacroAsHtml(content) {
    if (!content) return "";
    let obj = content;
    if (typeof content === 'string' && (content.startsWith('{') || content.startsWith('['))) {
      try { obj = JSON.parse(content); } catch(e) { obj = content; }
    }
    if (typeof obj === 'string') return stripHtml(obj);

    const parseNode = (node) => {
      if (!node) return "";
      
      // Text node
      if (typeof node.text === 'string') {
        let text = escapeHtml(stripHtml(node.text));
        
        // Handle format (Lexical style)
        if (node.format) {
          if (node.format & 1) text = `<strong>${text}</strong>`; // Bold
          if (node.format & 2) text = `<em>${text}</em>`;   // Italic
          if (node.format & 8) text = `<u>${text}</u>`;   // Underline
        }
        
        // Handle style (colors/highlights)
        if (node.style) {
          const styles = node.style.split(';').filter(s => s.trim());
          const validStyles = styles.filter(s => s.includes('color') || s.includes('background-color'));
          if (validStyles.length) {
            text = `<span style="${validStyles.join(';')}">${text}</span>`;
          }
        }

        // Slate style
        if (node.bold) text = `<strong>${text}</strong>`;
        if (node.italic) text = `<em>${text}</em>`;
        if (node.underline) text = `<u>${text}</u>`;
        if (node.color) text = `<span style="color: ${node.color}">${text}</span>`;
        if (node.backgroundColor) text = `<span style="background-color: ${node.backgroundColor}">${text}</span>`;

        return text;
      }

      if (Array.isArray(node)) return node.map(parseNode).join("");

      if (node.children && Array.isArray(node.children)) {
        const inner = node.children.map(parseNode).join("");
        const type = node.type;
        
        switch (type) {
          case 'bulleted-list': case 'bullet': return `<ul style="margin: 4px 0; padding-left: 1.5em; list-style-type: disc; display: block;">${inner}</ul>`;
          case 'numbered-list': case 'number': return `<ol style="margin: 4px 0; padding-left: 1.5em; list-style-type: decimal; display: block;">${inner}</ol>`;
          case 'list-item': case 'listitem': return `<li style="display: list-item; margin-bottom: 2px;">${inner}</li>`;
          case 'h1': case 'h2': case 'h3': case 'heading': 
            return `<div style="font-weight: 800; font-size: 1.1em; margin: 10px 0 4px 0; display: block; color: #0f172a;">${inner}</div>`;
          case 'quote': 
            return `<blockquote style="border-left: 3px solid #e2e8f0; padding: 4px 12px; margin: 10px 0; color: #64748b; font-style: italic; display: block; background: #f8fafc;">${inner}</blockquote>`;
          case 'paragraph':
            // Use div with safe block display and controlled margin to restore structure
            return `<div style="display: block; margin-bottom: 8px; min-height: 1.2em;">${inner}</div>`;
          default:
            // Default to span for anything else to avoid line breaks inside blocks
            return `<span style="display: inline;">${inner}</span>`;
        }
      }

      if (node.root) return parseNode(node.root);
      if (node.type === 'linebreak') return "<br/>";
      return "";
    };

    try {
      return parseNode(obj);
    } catch(e) {
      return "(Lỗi hiển thị nội dung)";
    }
  }

  function extractTextFromContent(content) {
    if (!content) return "";
    let obj = content;
    if (typeof content === 'string' && (content.startsWith('{') || content.startsWith('['))) {
      try { obj = JSON.parse(content); } catch (e) { obj = content; }
    }

    if (typeof obj === 'string') return stripHtml(obj);
    
    try {
      const extract = (node) => {
        if (!node) return "";
        if (typeof node.text === 'string') return stripHtml(node.text);
        
        if (Array.isArray(node)) {
          return node.map(extract).join("");
        }
        
        if (node.children && Array.isArray(node.children)) {
          const childrenText = node.children.map(extract).join("");
          const blockTypes = ['paragraph', 'list-item', 'listitem', 'h1', 'h2', 'h3', 'quote', 'heading'];
          if (blockTypes.includes(node.type)) return childrenText + "\n";
          return childrenText;
        }

        if (node.root) return extract(node.root);
        if (node.type === 'linebreak' || node.type === 'tab') return "\n";
        return "";
      };
      
      return extract(obj).trim() || "(Không có nội dung)";
    } catch (e) {
      return "(Không có nội dung)";
    }
  }

  // Global capture to block send click & submit
  document.addEventListener("click", onGlobalClickCapture, true);
  document.addEventListener("submit", onFormSubmit, true);
  // Absoulte block: capture Enter at document level for any textarea
  document.addEventListener("keydown", (e) => {
    const el = e.target;
    if (el && (el.tagName === "TEXTAREA" || el.isContentEditable)) {
      if (e.key === "Enter" && !e.shiftKey) {
        onTextareaKeyDown(e);
      }
    }
  }, true);
}


// Auto-hide when clicking outside
document.addEventListener("mousedown", (e) => {
  if (suggestionPanel && suggestionPanel.style.display !== "none") {
      if (geminiOverlay && geminiOverlay.style.display !== "none") return;
      const isInsidePanel = suggestionPanel.contains(e.target);
      const isInsideTextarea = currentActiveTextarea && (currentActiveTextarea.contains(e.target) || e.target === currentActiveTextarea);

      if (!isInsidePanel && !isInsideTextarea) {
        hideUI();
      }
  }

  // Auto-hide Macro Overlay
  const macroOverlay = document.getElementById("gemini-macro-overlay");
  if (macroOverlay && macroOverlay.style.display !== "none") {
    if (!macroOverlay.contains(e.target)) {
      macroOverlay.style.display = "none";
    }
  }
}, true);

// Detect session/context change to auto-hide
let lastContextKey = "";
function checkContextChange() {
  const ctx = getCurrentContext();
  const key = `${ctx.currentBrand}-${ctx.currentMarketplace}`;
  if (lastContextKey && key !== lastContextKey) {
    if (suggestionPanel && suggestionPanel.style.display !== "none") {
      hideUI();
    }
  }
  lastContextKey = key;
}
setInterval(checkContextChange, 1000);
