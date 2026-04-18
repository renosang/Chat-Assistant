
const testCases = [
    { text: "Chào anh/chị, anh vui lòng đợi em", expected: true, desc: "Neutral + Male conflict" },
    { text: "Chào anh hoặc chị", expected: false, desc: "Pure Neutral (hoặc)" },
    { text: "Chào anh và chị", expected: false, desc: "Pure Neutral (và)" },
    { text: "Anh hoặc chị vui lòng báo anh giúp em", expected: true, desc: "Neutral + Male conflict (mixed)" },
    { text: "Chào chị/anh", expected: false, desc: "Pure Neutral (slash reversed)" },
    { text: "Chào a/c", expected: false, desc: "Pure Neutral (a/c)" },
    { text: "Chào anh, chị vui lòng đợi", expected: true, desc: "Male + Female conflict" },
    { text: "Chào bạn, anh đợi em", expected: true, desc: "Friend + Male conflict" },
    { text: "Chào anh/chị, bạn đợi em", expected: true, desc: "Neutral + Friend conflict" },
];

function checkPronounConsistency(text) {
    const results = { grammar: [] };
    const lower = text.toLowerCase();

    const B = "(^|[^\\p{L}\\p{N}])";
    const E = "(?=$|[^\\p{L}\\p{N}])";

    // The NEW regex
    const rxAC = new RegExp(`${B}(anh\\s*(?:\\/|hoặc|v\\s*à)\\s*chị|chị\\s*(?:\\/|hoặc|v\\s*à)\\s*anh|a\\s*\\/\\s*c|c\\s*\\/\\s*a)${E}`, "giu");
    const rxA = new RegExp(`${B}(anh)${E}`, "giu");
    const rxC = new RegExp(`${B}(chị)${E}`, "giu");
    const rxB = new RegExp(`${B}(bạn)${E}`, "giu");
    const rxM = new RegExp(`${B}(mình)${E}`, "giu");

    const has = (rx, src) => {
        rx.lastIndex = 0;
        return !!rx.exec(src);
    };

    const masked = lower.replace(rxAC, (full, _b, keyword) => full.replace(keyword, " ".repeat(keyword.length)));

    const found = {
        "Anh/Chị": has(rxAC, lower),
        "Anh": has(rxA, masked),
        "Chị": has(rxC, masked),
        "Bạn": has(rxB, lower),
        "Mình": has(rxM, lower)
    };

    const detectedModes = Object.keys(found).filter((k) => found[k]);

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
    return results;
}

console.log("--- PRONOUN CONSISTENCY TEST ---");
testCases.forEach(tc => {
    const result = checkPronounConsistency(tc.text);
    const isConflict = result.grammar.length > 0;
    const pass = isConflict === tc.expected;
    console.log(`${pass ? "✅" : "❌"} [${tc.desc}] "${tc.text}" -> ${isConflict ? result.grammar[0].msg : "OK"}`);
});
