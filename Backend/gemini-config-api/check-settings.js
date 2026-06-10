require('dotenv').config();
const mongoose = require('mongoose');

async function check() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        const Settings = require('./models/Settings');
        const settings = await Settings.findOne({ type: 'global' }).lean();
        console.log("Settings in DB:", settings);
        
        // Also check if any macros exist just in case
        console.log("Total brands in DB:", settings ? settings.allBrands.length : 0);
    } catch (e) {
        console.error(e);
    } finally {
        mongoose.disconnect();
    }
}
check();
