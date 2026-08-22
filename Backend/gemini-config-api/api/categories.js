const connectToDatabase = require('../lib/db');
const mongoose = require('mongoose');

// Define Category schema for gemini-config-api
const CategorySchema = new mongoose.Schema({
  name: { type: String, required: true },
  parent: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', default: null }
});

const Category = mongoose.models.Category || mongoose.model('Category', CategorySchema);

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    await connectToDatabase();
    
    // 1. Direct DB Query
    let categories = await Category.find().sort({ name: 1 }).lean();
    
    // 2. Fallback to HTTP fetching if DB has no category records
    if (!categories || categories.length === 0) {
      const urls = [
        'http://localhost:5000/api/categories',
        'https://macro.beegadget.net/api/categories'
      ];
      for (const url of urls) {
        try {
          const fetchRes = await fetch(url);
          if (fetchRes && fetchRes.ok) {
            const data = await fetchRes.json();
            if (Array.isArray(data) && data.length > 0) {
              categories = data;
              break;
            }
          }
        } catch (e) {}
      }
    }

    return res.status(200).json(categories || []);
  } catch (error) {
    console.error('Error fetching categories in config-api:', error);
    return res.status(500).json({ error: error.message });
  }
};
