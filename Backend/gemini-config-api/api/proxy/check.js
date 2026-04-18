const connectToDatabase = require('../../lib/db');
const User = require('../../models/User');
const Settings = require('../../models/Settings');
const { decrypt } = require('../../lib/crypto');
const jwt = require('jsonwebtoken');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    await connectToDatabase();

    // 1. Xác thực Token
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'Missing Auth Token' });
    const token = authHeader.split(' ')[1];
    const JWT_SECRET = process.env.JWT_SECRET || 'secret-key-123';
    
    let decoded;
    try {
        decoded = jwt.verify(token, JWT_SECRET);
    } catch (err) {
        return res.status(403).json({ error: 'Token expired or invalid' });
    }

    // 2. Lấy User và Decrypt Key
    const user = await User.findById(decoded.userId);
    if (!user || !user.isActive) return res.status(403).json({ error: 'Account disabled' });
    
    if (!user.encryptedApiKey) {
        return res.status(400).json({ error: 'Missing Gemini API Key. Please update in Extension Settings.' });
    }

    const apiKey = decrypt(user.encryptedApiKey);
    if (!apiKey) return res.status(500).json({ error: 'Decryption failed' });

    // 3. Lấy Global Settings (Prompt)
    let settings = await Settings.findOne({ type: 'global' });
    const promptTemplate = settings ? settings.promptTemplate : "Please fix grammar for: {{TEXT}}";

    // 4. Chuẩn bị Prompt
    const { text, modelName } = req.body;
    
    // Inject Safe Words (Logic giống background.js cũ)
    const safeWords = ["anh", "chị", "em", "mình", "shop", "bạn", "nhé", "ạ", "dạ", "vâng", "nha", "tép", "tép thám tử", "cskh"];
    const safeWordsStr = safeWords.map(w => `"${w}"`).join(', ');

    let finalPrompt = promptTemplate
        .replace(new RegExp("{{SAFE_WORDS}}", "g"), safeWordsStr)
        .replace(new RegExp("{{TEXT}}", "g"), text);

    // 5. Gọi Gemini API (Server-to-Server)
    const targetModel = modelName || 'gemini-2.5-flash-lite';
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${targetModel}:generateContent?key=${apiKey}`;
    
    const geminiRes = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            contents: [{ parts: [{ text: finalPrompt }] }],
            generationConfig: { responseMimeType: "application/json" }
        })
    });

    if (!geminiRes.ok) {
        const errText = await geminiRes.text();
        console.error("Gemini API Error:", errText);
        return res.status(geminiRes.status).json({ error: `Gemini Error: ${geminiRes.statusText}` });
    }

    const data = await geminiRes.json();
    const jsonText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";

    // Parse JSON sạch
    let cleanJson = jsonText.trim();
    if (cleanJson.startsWith('```json')) {
        cleanJson = cleanJson.replace(/^```json/, '').replace(/```$/, '');
    } else if (cleanJson.startsWith('```')) {
        cleanJson = cleanJson.replace(/^```/, '').replace(/```$/, '');
    }

    let aiResults = [];
    try {
        const parsed = JSON.parse(cleanJson);
        aiResults = Array.isArray(parsed) ? parsed : (parsed.errors || []);
    } catch (e) {
        console.warn("Backend JSON Parse Error:", e);
    }

    // Trả kết quả về cho Extension
    return res.json({ results: aiResults });

  } catch (error) {
    console.error("Proxy Error:", error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
};