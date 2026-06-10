require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Ánh xạ các Vercel Serverless Functions thành Express Routes
const apiRoutes = {
  '/api/login': require('./api/login'),
  '/api/config': require('./api/config'),
  '/api/admin/login': require('./api/admin/login'),
  '/api/admin/users': require('./api/admin/users'),
  '/api/admin/settings': require('./api/admin/settings'),
  '/api/user/heartbeat': require('./api/user/heartbeat'),
  '/api/user/uninstalled': require('./api/user/uninstalled'),
  '/api/user/update-key': require('./api/user/update-key'),
  '/api/deactivate': require('./api/deactivate')
};

// Đăng ký tất cả các HTTP methods (GET, POST, PUT, DELETE, OPTIONS) cho từng Route
Object.keys(apiRoutes).forEach(route => {
  app.all(route, async (req, res) => {
    try {
      await apiRoutes[route](req, res);
    } catch (error) {
      console.error(`Error in route ${route}:`, error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Internal Server Error' });
      }
    }
  });
});

// Phục vụ giao diện trang Admin dưới dạng file tĩnh
app.use('/admin', express.static(path.join(__dirname, 'admin')));

// Chuyển hướng khi truy cập trang chủ
app.get('/', (req, res) => {
  res.redirect('/admin/index.html');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 VPS Server is running at http://localhost:${PORT}`);
  console.log(`👉 Admin Panel: http://localhost:${PORT}/admin/index.html`);
});
