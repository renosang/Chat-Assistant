
const mongoose = require('mongoose');

const SettingsSchema = new mongoose.Schema({
  type: { type: String, default: 'global', unique: true },
  isEnabled: { type: Boolean, default: true },
  promptTemplate: { type: String, required: true },
  allBrands: [{ type: String }],
  allMarketplaces: [{ type: String }],
  brandGroups: { type: mongoose.Schema.Types.Mixed },
  typoDictionary: [{
    error: String,
    fix: String
  }],
  forbiddenRules: {
    VI: [{
      word: String,
      exception: String
    }],
    EN: [String]
  },
  minVersion: { type: String, default: '4.1' },
  downloadUrl: { type: String, default: '' },
  updatedAt: { type: Date, default: Date.now }
}, {
  minimize: false,
  strict: false
});

module.exports = mongoose.models.Settings || mongoose.model('Settings', SettingsSchema);
