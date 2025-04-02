const express = require('express');
const cors = require('cors');
const awsService = require('./awsService');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3001;

// JSON 文件路径
const USERS_FILE = '/root/server/data/users.json';

// 中间件配置
app.use(cors());
app.use(express.json());

// 添加路由模块
const awsRoutes = require('./routes/awsRoutes');
app.use('/api', awsRoutes);  // 👈 添加这一行


// 获取指定区域的实例信息
app.post('/api/describe-instances', async (req, res) => {
  try {
    const { region } = req.body;
    const result = await awsService.describeInstances(region);
    res.json({ success: true, data: result });
  } catch (err) {
    console.error("获取实例信息失败：", err);
    res.status(500).json({ success: false, message: '获取实例失败', error: err.message });
  }
});

// ✅ 注册接口（写入 users.json）
app.post('/api/register', (req, res) => {
  const { username, email, password } = req.body;

  if (!username || !email || !password) {
    return res.status(400).json({ message: '请填写完整信息' });
  }

  let users = [];
  try {
    if (fs.existsSync(USERS_FILE)) {
      const raw = fs.readFileSync(USERS_FILE, 'utf-8');
      users = JSON.parse(raw || '[]');
      console.log("📚 当前用户数据：", users);
    } else {
      console.log("⚠️ USERS_FILE 文件不存在");
    }
  } catch (err) {
    console.error("❌ 用户数据读取失败：", err);
    return res.status(500).json({ message: '服务器内部错误' });
  }

  const exists = users.find(user => user.email === email);
  if (exists) {
    return res.status(409).json({ message: '该邮箱已被注册' });
  }

  users.push({ username, email, password });

  try {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
    console.log('✅ 当前注册用户:', users);
    res.json({ message: '注册成功' });
  } catch (err) {
    console.error('写入用户数据失败:', err);
    res.status(500).json({ message: '写入用户失败' });
  }
});

// ✅ 登录接口（读取 users.json）
app.post('/api/login', (req, res) => {
  const { email, password } = req.body;

  console.log("📁 当前 USERS_FILE 路径是：", USERS_FILE);
  console.log("📨 客户端提交邮箱:", email);
  console.log("📨 客户端提交密码:", password);

  if (!email || !password) {
    return res.status(400).json({ message: '请输入邮箱和密码' });
  }

  let users = [];
  try {
    console.log("🔍 准备检查 users.json 是否存在");
    console.log("🔍 fs.existsSync 返回：", fs.existsSync(USERS_FILE));

    if (fs.existsSync(USERS_FILE)) {
      const raw = fs.readFileSync(USERS_FILE, 'utf-8');
      users = JSON.parse(raw || '[]');
      console.log("📚 读取到的用户数组:", users);
    } else {
      console.log("⚠️ USERS_FILE 不存在！");
    }
  } catch (err) {
    console.error("❌ 读取用户失败:", err);
    return res.status(500).json({ message: '服务器内部错误' });
  }

  console.log("🔍 开始查找用户...");
  const user = users.find(u => u.email === email && u.password === password);

  if (!user) {
    console.log("❌ 没有找到匹配的用户！");
    return res.status(401).json({ message: '用户不存在或密码错误' });
  }

  console.log("✅ 找到用户:", user);
  res.json({ message: '登录成功', username: user.username });
});


// 创建实例接口
app.post('/api/create-instance', async (req, res) => {
  try {
    const { region } = req.body;
    const result = await awsService.createEc2InstanceWithAutoKeyAndSG(region);
    res.json({ success: true, data: result });
  } catch (err) {
    console.error('创建实例失败:', err);
    res.status(500).json({ success: false, message: '创建实例失败', error: err.message });
  }
});


// 启动服务
app.listen(PORT, () => {
  console.log(`✅ 后端服务已启动：http://localhost:${PORT}`);
});

