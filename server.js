// server.js - Express 后端代理服务器
// 用途：
// 1. 解决浏览器 CORS 跨域问题
// 2. 隐藏 API Key，避免暴露在前端代码中
// 3. 支持用户自定义 API 地址和 Key（通过请求头传递）
// 4. 托管 uni-app 打包后的静态文件

const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// 解析 JSON 请求体（用于非代理路由）
app.use(express.json());

// ========== 动态代理中间件：/api/* 请求转发到真实 API ==========
app.use('/api', (req, res, next) => {
  // 1. 读取用户自定义配置（优先级最高）
  const userApiBase = req.headers['x-api-base'];
  const userApiKey = req.headers['x-api-key'];

  // 2. 回退到环境变量（Railway 部署时配置）
  const defaultApiBase = process.env.API_TARGET || 'https://api.deepseek.com';
  const defaultApiKey = process.env.API_KEY || '';

  // 3. 确定最终使用的目标 API
  let targetBase = userApiBase || defaultApiBase;
  const targetKey = userApiKey || defaultApiKey;

  // 4. 自动补全 OpenAI 兼容路径
  if (targetBase && !targetBase.endsWith('/completions') && !targetBase.endsWith('/chat/completions')) {
    targetBase = targetBase.replace(/\/$/, '');
  }

  console.log('[Proxy] 请求路径:', req.path);
  console.log('[Proxy] 目标 API:', targetBase);
  console.log('[Proxy] 使用自定义 Key:', !!userApiKey);

  // 5. 动态创建代理中间件
  const proxy = createProxyMiddleware({
    target: targetBase,
    changeOrigin: true,
    pathRewrite: {
      '^/api': '', // 移除 /api 前缀，转发到真实 API 路径
    },
    onProxyReq: (proxyReq, req, res) => {
      // 注入 Authorization 头（携带 API Key）
      if (targetKey) {
        proxyReq.setHeader('Authorization', `Bearer ${targetKey}`);
      }
      // 移除前端传来的自定义头（避免泄露给第三方 API）
      proxyReq.removeHeader('x-api-base');
      proxyReq.removeHeader('x-api-key');

      console.log('[Proxy] 最终请求头:', {
        host: proxyReq.getHeader('host'),
        authorization: proxyReq.getHeader('authorization') ? '***已设置***' : '未设置',
        contentType: proxyReq.getHeader('content-type')
      });
    },
    onProxyRes: (proxyRes, req, res) => {
      // 支持流式传输（SSE）
      if (proxyRes.headers['content-type']?.includes('text/event-stream')) {
        console.log('[Proxy] 检测到 SSE 流式响应');
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
      }
    },
    onError: (err, req, res) => {
      console.error('[Proxy] 代理错误:', err.message);
      res.status(500).json({
        error: '代理请求失败',
        message: err.message,
        details: '请检查 API 地址和 Key 是否正确'
      });
    },
    // 支持 WebSocket（如果未来需要）
    ws: true,
    // 日志级别
    logLevel: 'warn'
  });

  proxy(req, res, next);
});

// ========== 静态文件托管：dist/build/h5 ==========
const staticPath = path.join(__dirname, 'dist', 'build', 'h5');
app.use(express.static(staticPath));

// ========== Vue 路由回退：防止刷新 404 ==========
app.get('*', (req, res) => {
  // 如果是 API 请求，不回退到 index.html
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'API 路径不存在' });
  }
  // 所有其他路径返回 index.html（交给前端路由处理）
  res.sendFile(path.join(staticPath, 'index.html'));
});

// ========== 启动服务器 ==========
app.listen(PORT, () => {
  console.log('='.repeat(50));
  console.log('🎮 无限旅团后端服务器已启动');
  console.log('='.repeat(50));
  console.log(`📡 监听端口: ${PORT}`);
  console.log(`📂 静态文件目录: ${staticPath}`);
  console.log(`🔑 默认 API 目标: ${process.env.API_TARGET || 'https://api.deepseek.com'}`);
  console.log(`🔐 环境变量 API_KEY: ${process.env.API_KEY ? '已设置' : '未设置（用户需自行配置）'}`);
  console.log('='.repeat(50));
  console.log('💡 用户可通过请求头 X-API-Base 和 X-API-Key 自定义 API');
  console.log('='.repeat(50));
});
