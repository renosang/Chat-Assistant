const connectToDatabase = require('../../lib/db');
const User = require('../../models/User');
const bcrypt = require('bcryptjs');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  await connectToDatabase();

  // GET: Lấy danh sách users
  if (req.method === 'GET') {
    const users = await User.find({}).sort({ createdAt: -1 }).select('-password');
    return res.json(users);
  }

  // POST: Tạo user mới
  if (req.method === 'POST') {
    const { username, password } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);
    try {
      const newUser = await User.create({ username, password: hashedPassword });
      return res.json(newUser);
    } catch (e) {
      return res.status(400).json({ error: 'Username already exists' });
    }
  }

  // PUT: Cập nhật trạng thái (Active/Inactive)
  if (req.method === 'PUT') {
    const { id, isActive, password } = req.body;
    const updateData = {};
    if (typeof isActive !== 'undefined') updateData.isActive = isActive;
    if (password) updateData.password = await bcrypt.hash(password, 10);
    
    const updatedUser = await User.findByIdAndUpdate(id, updateData, { new: true }).select('-password');
    return res.json(updatedUser);
  }

  // DELETE: Xóa user
  if (req.method === 'DELETE') {
    const { id } = req.query;
    await User.findByIdAndDelete(id);
    return res.json({ success: true });
  }
};