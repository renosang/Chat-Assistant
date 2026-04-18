const fs = require('fs');
let content = fs.readFileSync('c:/Users/Thanh Sang/Downloads/Trợ lí chat V4.1 building/Extention/content.js', 'utf8');

const startIdx = content.indexOf('function diffHighlight(');
const endIdx = content.indexOf('// ---------- UTILS ----------');

if (startIdx !== -1 && endIdx !== -1) {
    const replacement = `function diffHighlight(original, suggested, pronounConflict = null, analysis = null) {
  const words1 = original.split(/(\\s+)/);
  const words2 = suggested.split(/(\\s+)/);

  // Regex for pronouns
  const pronounRegex = /(^|[^a-zA-Z0-9À-ỹ])(anh|chị|bạn|mình|a\\/c|anh\\/chị|chị\\/anh)(?=$|[^a-zA-Z0-9À-ỹ])/gi;

  const isWordInErrors = (word, errorList) => {
    if (!errorList || !errorList.length) return false;
    const cleanW = word.trim().toLowerCase();
    return errorList.some(err => {
      if (err.msg && err.msg.toLowerCase().includes(\`"\${cleanW}"\`)) return true;
      if (err.word && err.word.trim().toLowerCase() === cleanW) return true;
      return false;
    });
  };

  const isWordInGrammarErrors = (word, grammarList) => {
    if (!grammarList || !grammarList.length) return false;
    const cleanW = word.trim().toLowerCase();
    return grammarList.some(err => 
      err.msg && err.msg.toLowerCase().includes(\`"\${cleanW}"\`) && 
      (err.msg.includes("Telex") || err.msg.includes("VNI") || err.msg.includes("bất thường"))
    );
  };

  let html = "";
  let i = 0, j = 0;

  while (j < words2.length) {
    const w1 = words1[i] || "";
    const w2 = words2[j];

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

    if (w1.normalize() === w2.normalize()) {
      if (isCrit) {
        html += \`<span class="gemini-highlight-red">\${escapeHtml(w2)}</span>\`;
      } else if (isPronoun && pronounConflict) {
        html += \`<span class="gemini-highlight-blue">\${escapeHtml(w2)}</span>\`;
      } else if (isWarn) {
        html += \`<span class="gemini-highlight-amber">\${escapeHtml(w2)}</span>\`;
      } else {
        html += escapeHtml(w2);
      }
      i++;
    } else {
      // Something changed. Fast-forward space matches to prevent cascading diff errors
      if (w1.trim().normalize() === w2.trim().normalize()) {
        const spaceClass = w2.trim() === "" ? "gemini-processed-msg gemini-highlight-space" : "gemini-processed-text";
        html += \`<span class="\${spaceClass}" style="color: #059669; font-weight: 600;">\${escapeHtml(w2)}</span>\`;
        i++;
        j++;
        continue;
      }

      if (isCrit) {
        html += \`<span class="gemini-highlight-red">\${escapeHtml(w2)}</span>\`;
      } else if (isPronoun) {
        html += \`<span class="gemini-highlight-blue">\${escapeHtml(w2)}</span>\`;
      } else if (isWarn) {
        html += \`<span class="gemini-highlight-amber">\${escapeHtml(w2)}</span>\`;
      } else {
        // It's a non-critical difference (e.g. grammar correction)
        const highlightClass = w2.trim() === "" ? "gemini-processed-msg gemini-highlight-space" : "gemini-processed-text";
        html += \`<span class="\${highlightClass}" style="color: #059669; font-weight: 600;">\${escapeHtml(w2)}</span>\`;
      }

      // Re-sync logic
      const s1 = superClean(w1);
      const s2 = superClean(w2);
      if (s1 === s2 || i >= words1.length) {
        i++;
      } else {
        let found = false;
        for (let k = i + 1; k < Math.min(i + 15, words1.length); k++) {
          if (words1[k].normalize() === w2.normalize() || superClean(words1[k]) === s2) {
            i = k + 1;
            found = true;
            break;
          }
        }
        if (!found && w1.trim() && w2.trim()) {
          i++; 
        }
      }
    }
    j++;
  }

  return html;
}

`;

    content = content.substring(0, startIdx) + replacement + content.substring(endIdx);
    fs.writeFileSync('c:/Users/Thanh Sang/Downloads/Trợ lí chat V4.1 building/Extention/content.js', content, 'utf8');
    console.log('Successfully replaced diffHighlight block!');
} else {
    console.log('Could not find start/end bounds', startIdx, endIdx);
}
