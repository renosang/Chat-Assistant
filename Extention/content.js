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

  let compiledData = {
    brands: null,
    marketplaces: null,
    typoLookup: {}
  };

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
      return { forbidden: [], brands: [], platforms: [], typos: [], grammar: [], formatting: [], suggestedText: "" };
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
        results.forbidden.push({ word, msg: `Từ cấm: ${word}` });
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
            results.brands.push({ word, msg: `Sai Brand (Đang chat: ${context.currentBrand})` });
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
          msg: `Sai Sàn: ${match[1]} (Đang chat: ${currentLabel})`
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
      msgs.add(`Đã sửa lỗi định dạng khoảng cách tại: ${spaceErrors.join(", ")}`);
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
            msgs.add(`Đã sửa lỗi thiếu khoảng cách tại: "${w}"`);
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
      msgs.add("Đã sửa lỗi không viết hoa chữ cái đầu câu");
    }

    const countOriginalUpperAfterComma = (original.match(/, ?\p{Lu}/gu) || []).length;
    const countSuggestedUpperAfterComma = (suggested.match(/, ?\p{Lu}/gu) || []).length;
    if (countOriginalUpperAfterComma > countSuggestedUpperAfterComma) {
      msgs.add("Đã sửa lỗi sau dấu phẩy phải viết thường");
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

    const latestVal = (currentActiveTextarea?.value || "").trim();
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
           <button class="gemini-alert-btn-sub" id="gemini-alert-bypass">Vẫn gửi</button>
           <button class="gemini-alert-btn-sub" id="gemini-alert-close">Đóng</button>
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
        text: (currentActiveTextarea?.value || "").trim()
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
    if (!suggestionPanel) createUIElements();

    // Reset positioning from Fun Alert if necessary
    suggestionPanel.style.position = "";
    suggestionPanel.style.left = "";
    suggestionPanel.style.top = "";
    suggestionPanel.style.transform = "";
    suggestionPanel.style.width = "";
    suggestionPanel.style.zIndex = "";

    const valNow = (currentActiveTextarea?.value || "");
    const suggestedText = analysis.suggestedText || "";
    const isDifferent = suggestedText !== valNow;

    const critKeywords = ["Từ cấm", "Sai Brand", "Sai Sàn"];
    const lines = [];

    // Detect pronoun conflict
    const pronounConflict = (analysis.grammar || []).find(g => g && g.word === "conflict_pronoun");

    // grammar (pronoun/mechanics/repetition)
    (analysis.grammar || []).filter(g => g && g.msg).forEach(g => {
      const isCrit = critKeywords.some(k => g.msg.includes(k));
      const isProcessed = g.msg.startsWith("Đã sửa") || g.msg.startsWith("Đã thêm");
      const isWarn = g.msg.includes("bất thường") || g.msg.includes("Telex") || g.msg.includes("VNI") ||
        g.msg.includes("lặp cụm từ") || g.msg.includes("dấu chấm hỏi") ||
        g.msg.includes("Cấu trúc") || g.msg.includes("Nên thêm") ||
        g.msg.includes("chuẩn tiếng Việt") || g.msg.includes("Lỗi xưng hô");
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

    // Pronoun Switcher UI - Premium Pill Style
    let pronounBarHtml = "";
    if (pronounConflict) {
      pronounBarHtml = `
      <div class="gemini-pronoun-bar">
        <span class="gemini-pronoun-label">Đổi tất cả:</span>
        <div class="gemini-pronoun-group">
          <button class="gemini-pronoun-btn" data-type="ac">Anh/Chị</button>
          <button class="gemini-pronoun-btn" data-type="a">Anh</button>
          <button class="gemini-pronoun-btn" data-type="c">Chị</button>
        </div>
      </div>
    `;
    }

    const hasErrors = finalLines.length > 0;
    const showEditor = (hasErrors || isDifferent || pronounConflict);

    const highlightedText = showEditor
      ? diffHighlight(valNow, suggestedText, pronounConflict, analysis)
      : escapeHtml(suggestedText);

    // Store analysis state for live updates
    suggestionPanel.__analysis_source = valNow;

    const suggestHtml = showEditor
      ? `
      <details class="gemini-details" open>
        <summary class="gemini-summary">
          ✨ Gợi ý chỉnh sửa
          <span class="gemini-summary-hint"></span>
        </summary>

        <div class="gemini-suggest-wrap">
          ${pronounBarHtml}
          <div class="gemini-suggest-edit" id="gemini-suggest-content" contenteditable="true" spellcheck="false" style="max-height: 200px; overflow-y: auto;">${highlightedText}</div>
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

    suggestionPanel.innerHTML = `
    <div class="gemini-panel" style="max-height: 80vh !important; display: flex !important; flex-direction: column !important; overflow: hidden !important;">
      <div class="gemini-panel-header">
        <div class="gemini-title">Kiểm tra nội dung</div>
        <button class="gemini-x" id="gemini-x-btn" type="button" aria-label="Close">✕</button>
      </div>

      <div class="gemini-panel-body" style="flex: 1; overflow-y: auto; padding-right: 4px;">
        <div class="gemini-section-title">Lỗi phát hiện</div>
        ${errorsHtml}
        ${suggestHtml}
      </div>

      <div class="gemini-panel-footer" style="padding: 12px; background: white; border-top: 1px solid rgba(17,24,39,0.08); z-index: 10;">
        ${actionsHtml}
      </div>
    </div>
  `;

    suggestionPanel.style.display = "block";

    const close = () => hideUI();
    document.getElementById("gemini-close-panel")?.addEventListener("click", close);
    document.getElementById("gemini-x-btn")?.addEventListener("click", close);

    document.getElementById("gemini-apply-suggest")?.addEventListener("click", () => {
      if (!currentActiveTextarea) return;
      const editDiv = document.getElementById("gemini-suggest-content");
      // Use innerText to get clean plain text regardless of highlight spans
      const finalValue = editDiv ? editDiv.innerText : suggestedText;

      // LOG: Correction action
      reportQualityAction("apply_fix", {
        original: (currentActiveTextarea.value || ""),
        suggested: finalValue
      });

      currentActiveTextarea.value = finalValue;
      currentActiveTextarea.dispatchEvent(new Event("input", { bubbles: true }));
      hideUI();
    });

    // Handle pronoun switching
    suggestionPanel.querySelectorAll('.gemini-pronoun-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const type = e.target.dataset.type;
        const editDiv = document.getElementById("gemini-suggest-content");

        // PRESERVE EDITS: Get the current text from the box instead of the original suggestion
        let textToProcess = editDiv ? editDiv.innerText : suggestedText;

        const B = "(^|[^\\p{L}\\p{N}])";
        const E = "(?=$|[^\\p{L}\\p{N}])";
        const rxAll = new RegExp(`${B}(anh\\s*\\/\\s*chị|chị\\s*\\/\\s*anh|a\\s*\\/\\s*c|anh|chị|bạn|mình)${E}`, "giu");

        let replacer = "anh/chị";
        if (type === 'a') replacer = "anh";
        if (type === 'c') replacer = "chị";

        const newText = textToProcess.split('\n').map(line => {
          return line.replace(rxAll, (full, b, word) => {
            const isUpper = word[0] === word[0].toUpperCase() && word[0] !== word[0].toLowerCase();
            let final = replacer;
            if (isUpper) final = final.charAt(0).toUpperCase() + final.slice(1);
            return b + final;
          });
        }).join('\n');

        // Re-render panel with new text to apply highlights to the new pronouns
        analysis.suggestedText = newText;
        showSuggestionPanel(analysis);
      });
    });

    // --- Live Error Detection & Update Logic ---
    const editor = document.getElementById("gemini-suggest-content");
    if (editor) {
      editor.addEventListener("input", () => {
        const currentText = editor.innerText;
        // Re-run full analysis on typed text
        const liveAn = getAnalysis(currentText);

        const liveLines = [];
        (liveAn.grammar || []).filter(g => g && g.msg).forEach(g => {
          const isCrit = critKeywords.some(k => g.msg.includes(k));
          const isProc = g.msg.startsWith("Đã sửa") || g.msg.startsWith("Đã thêm");
          const isWarn = g.msg.includes("bất thường") || g.msg.includes("Telex") || g.msg.includes("VNI");
          liveLines.push({ text: g.msg, crit: isCrit, processed: isProc, warn: isWarn && !isProc });
        });
        (liveAn.forbidden || []).forEach(v => liveLines.push({ text: v.msg, crit: true }));
        (liveAn.brands || []).forEach(v => liveLines.push({ text: v.msg, crit: true }));
        (liveAn.platforms || []).forEach(v => liveLines.push({ text: v.msg, crit: true }));

        // Unique deduplication
        const liveSeen = new Set();
        const finalLive = [];
        for (const l of liveLines) {
          const key = (l.text || "").trim();
          if (!key || liveSeen.has(key)) continue;
          liveSeen.add(key);
          finalLive.push(l);
        }

        // Priority sort
        finalLive.sort((a, b) => {
          const getP = (item) => (item.crit ? 1 : (item.processed ? 2 : 3));
          return getP(a) - getP(b);
        });

        // Update the title and list
        const section = suggestionPanel.querySelector(".gemini-panel-body");
        if (section) {
          let newListHtml = "";
          if (finalLive.length === 0) {
            newListHtml = `<div class="gemini-empty">✅ Tất cả lỗi đã được xử lý.</div>`;
          } else {
            newListHtml = `<ul class="gemini-list">
            ${finalLive.map(l => {
              let cls = "";
              if (l.crit) cls = "gemini-crit-error";
              else if (l.processed) cls = "gemini-processed-msg";
              else if (l.warn) cls = "gemini-warn-msg";
              return `<li class="${cls}">${escapeHtml(l.text)}</li>`;
            }).join("")}
          </ul>`;
          }

          // Find the existing list or empty div and replace it
          const listEl = section.querySelector(".gemini-list, .gemini-empty");
          if (listEl) {
            listEl.outerHTML = newListHtml;
          }
        }
      });
    }

    // Reposition panel
    repositionPanel();

    // Re-position when expanded/collapsed to avoid overlapping
    suggestionPanel.querySelector('details')?.addEventListener('toggle', () => {
      repositionPanel();
    });
  }

  function repositionPanel() {
    if (!suggestionPanel || !currentActiveTextarea || suggestionPanel.style.display === "none") return;

    const rect = currentActiveTextarea.getBoundingClientRect();
    const panelHeight = suggestionPanel.offsetHeight || 160;

    // Predict positioning
    let topPos = rect.top - panelHeight - 40;

    // If not enough space above, move below
    if (topPos < 10) {
      topPos = rect.bottom + 10;
      // Ensure it doesn't go off screen bottom
      const viewportHeight = window.innerHeight;
      if (topPos + panelHeight > viewportHeight - 10) {
        // If no space bottom either, stick to top of screen as fallback
        topPos = 10;
      }
    }

    suggestionPanel.style.top = `${topPos}px`;

    // Horizontal positioning with viewport constraint
    let leftPos = rect.left;
    const panelWidth = suggestionPanel.offsetWidth || 400;
    const viewportWidth = window.innerWidth;

    if (leftPos + panelWidth > viewportWidth - 20) {
      leftPos = viewportWidth - panelWidth - 20;
    }
    if (leftPos < 10) leftPos = 10;

    suggestionPanel.style.left = `${leftPos}px`;
  }

  function handleInput(e) {
    currentActiveTextarea = e.target;

    const nowVal = (currentActiveTextarea?.value || "").trim();
    if (!nowVal) {
      hideUI();
      return;
    }

    clearTimeout(typingTimer);
    const textareaRef = currentActiveTextarea;

    typingTimer = setTimeout(() => {
      if (!textareaRef || textareaRef !== currentActiveTextarea) return;

      const latestVal = (textareaRef.value || "").trim();
      if (!latestVal) {
        hideUI();
        return;
      }

      const analysis = getAnalysis(latestVal);

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
  }

  // ---------- SEND BLOCK HOOKS ----------

  // 1) Block Enter-to-send (Enter without Shift)
  function onTextareaKeyDown(ev) {
    if (!currentActiveTextarea) return;
    if (ev.target !== currentActiveTextarea) return;

    if (ev.key === "Enter" && !ev.shiftKey) {
      const blocked = enforceBlockIfNeeded(ev);
      if (blocked) return;
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
    const words1 = original.split(/(\s+)/);
    const words2 = suggested.split(/(\s+)/);

    // Regex for pronouns
    const pronounRegex = /(^|[^a-zA-Z0-9À-ỹ])(anh|chị|bạn|mình|a\/c|anh\/chị|chị\/anh)(?=$|[^a-zA-Z0-9À-ỹ])/gi;

    // Helper to check if a word is actually in the error list
    const isWordInErrors = (word, errorList) => {
      if (!errorList || !errorList.length) return false;
      const cleanW = word.trim().toLowerCase();
      return errorList.some(err => {
        if (err.msg && err.msg.toLowerCase().includes(`"${cleanW}"`)) return true;
        if (err.word && err.word.trim().toLowerCase() === cleanW) return true;
        return false;
      });
    };

    const isWordInGrammarErrors = (word, grammarList) => {
      if (!grammarList || !grammarList.length) return false;
      const cleanW = word.trim().toLowerCase();
      return grammarList.some(err =>
        err.msg && err.msg.toLowerCase().includes(`"${cleanW}"`) &&
        (err.msg.includes("Telex") || err.msg.includes("VNI") || err.msg.includes("bất thường"))
      );
    };

    let html = "";
    let i = 0, j = 0;

    while (j < words2.length) {
      const w1 = words1[i] || "";
      const w2 = words2[j];

      const telexPattern = /[jfrsx]$/i;
      const vniPattern = /[1-9]$/;

      // Reset regex state
      pronounRegex.lastIndex = 0;
      const isPronoun = pronounRegex.test(w2);

      let isCrit = false;
      let isWarn = false;

      if (analysis) {
        if (isWordInErrors(w2, analysis.forbidden) ||
          isWordInErrors(w2, analysis.brands) ||
          isWordInErrors(w2, analysis.platforms)) {
          isCrit = true;
        }
        if (!isCrit && isWordInGrammarErrors(w2, analysis.grammar)) {
          isWarn = true;
        }
      }

      // Use normalization for comparison to avoid NFC/NFD mismatch
      if (w1.normalize() === w2.normalize()) {
        if (isCrit) {
          html += `<span class="gemini-highlight-red">${escapeHtml(w2)}</span>`;
        } else if (isPronoun && pronounConflict) {
          html += `<span class="gemini-highlight-blue">${escapeHtml(w2)}</span>`;
        } else if (isWarn) {
          html += `<span class="gemini-highlight-amber">${escapeHtml(w2)}</span>`;
        } else {
          html += escapeHtml(w2);
        }

        i++;
      } else {
        // Something changed. Fast-forward space matches to prevent cascading diff errors
        if (w1.trim().normalize() === w2.trim().normalize()) {
          const spaceClass = w2.trim() === "" ? "gemini-processed-msg gemini-highlight-space" : "gemini-processed-text";
          html += `<span class="${spaceClass}">${escapeHtml(w2)}</span>`;
          i++;
          j++;
          continue;
        }

        if (isCrit) {
          html += `<span class="gemini-highlight-red">${escapeHtml(w2)}</span>`;
        } else if (isPronoun) {
          html += `<span class="gemini-highlight-blue">${escapeHtml(w2)}</span>`;
        } else if (isWarn) {
          html += `<span class="gemini-highlight-amber">${escapeHtml(w2)}</span>`;
        } else {
          // It's a non-critical difference (e.g. grammar correction)
          const highlightClass = w2.trim() === "" ? "gemini-processed-msg gemini-highlight-space" : "gemini-processed-text";
          html += `<span class="${highlightClass}">${escapeHtml(w2)}</span>`;
        }

        // Re-sync logic
        const s1 = superClean(w1);
        const s2 = superClean(w2);
        if (s1 === s2 || i >= words1.length) {
          i++;
        } else {
          // Search ahead in words1 (original) to see if this was a deletion or insertion
          // Increased window to 10 for better resilience with long paragraphs
          let found = false;
          for (let k = i + 1; k < Math.min(i + 10, words1.length); k++) {
            if (words1[k].normalize() === w2.normalize() || superClean(words1[k]) === s2) {
              i = k + 1;
              found = true;
              break;
            }
          }
          if (!found && w1.trim() && w2.trim()) {
            i++; // Assume replacement
          }
        }
      }
      j++;
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
        <div style="font-size: 15px; font-weight: 700; margin-bottom: 4px; display: flex; align-items: center; gap: 6px;">
          ${iconMap[mood.category] || iconMap.angry} ${advice.title}
        </div>
        <div style="font-size: 13px; font-weight: 500; opacity: 0.9; line-height: 1.4;">${advice.action}</div>
        <div style="margin-top: 10px; padding-top: 8px; border-top: 1px dashed rgba(0,0,0,0.1); font-size: 11px; font-style: italic; opacity: 0.7; color: currentColor;">
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

    // Create Overlay
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

    // Create Panel
    suggestionPanel = document.createElement("div");
    suggestionPanel.id = "gemini-suggestion-panel";
    document.body.appendChild(suggestionPanel);
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
    element.addEventListener("keydown", onTextareaKeyDown);
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

  function scan() {
    document.querySelectorAll("textarea").forEach(attachListeners);
    scanCustomerMessages();
  }
  setInterval(scan, 2000);

  // Global capture to block send click & submit
  document.addEventListener("click", onGlobalClickCapture, true);
  document.addEventListener("submit", onFormSubmit, true);
}

// Auto-hide when clicking outside
document.addEventListener("mousedown", (e) => {
  if (!suggestionPanel || suggestionPanel.style.display === "none") return;

  // If overlay is visible, it handles the logic
  if (geminiOverlay && geminiOverlay.style.display !== "none") return;

  const isInsidePanel = suggestionPanel.contains(e.target);
  const isInsideTextarea = currentActiveTextarea && (currentActiveTextarea.contains(e.target) || e.target === currentActiveTextarea);

  if (!isInsidePanel && !isInsideTextarea) {
    hideUI();
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
