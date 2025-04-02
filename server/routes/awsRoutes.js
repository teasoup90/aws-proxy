const express = require('express');
const router = express.Router();
const awsService = require('../awsService');
const fs = require('fs');
const path = require('path');

const USERS_FILE = '/root/server/data/users.json';

function getUserAwsKey(email) {
  if (!email) return null;
  if (!fs.existsSync(USERS_FILE)) return null;
  const users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'));
  const user = users.find(u => u.email === email);
  if (!user || !user.accessKeyId || !user.secretAccessKey) return null;
  return {
    accessKeyId: user.accessKeyId,
    secretAccessKey: user.secretAccessKey
  };
}

router.post('/register', (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password) return res.json({ message: '请填写完整信息' });

  let users = [];
  if (fs.existsSync(USERS_FILE)) {
    users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'));
  }

  const existingUser = users.find(u => u.email === email);
  if (existingUser) return res.json({ message: '用户已存在' });

  users.push({ username, email, password });
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
  res.json({ message: '注册成功' });
});

router.post('/create-socks5', async (req, res) => {
  const { instanceId, region, email } = req.body;
  const awsKey = getUserAwsKey(email);
  if (!awsKey) return res.status(403).json({ success: false, message: '无效或缺失的 AWS Key' });

  try {
    await awsService.createSocks5(instanceId, region, awsKey);
    res.status(200).json({ success: true, message: 'socks5 创建成功' });
  } catch (error) {
    console.error('❌ socks5 创建失败:', error);
    res.status(500).json({ success: false, message: 'socks5 创建失败' });
  }
});

router.post('/terminate-instance', async (req, res) => {
  const { instanceId, region, email } = req.body;
  const awsKey = getUserAwsKey(email);
  if (!awsKey) return res.status(403).json({ success: false, message: '无效或缺失的 AWS Key' });

  try {
    const result = await awsService.terminateInstance(instanceId, region, awsKey);
    res.json({ success: true, data: result });
  } catch (err) {
    console.error('❌ 终止实例失败:', err);
    res.status(500).json({ success: false, message: '终止实例失败', error: err.message });
  }
});

router.post('/change-ip', async (req, res) => {
  const { instanceId, region, email } = req.body;
  const awsKey = getUserAwsKey(email);
  if (!awsKey) return res.status(403).json({ success: false, message: '无效或缺失的 AWS Key' });

  try {
    const ip = await awsService.changeElasticIP(instanceId, region, awsKey);
    res.json({ success: true, ip });
  } catch (err) {
    console.error('❌ 更换IP失败:', err);
    res.status(500).json({ success: false, message: '更换IP失败', error: err.message });
  }
});

router.post('/set-key', async (req, res) => {
  const { email, accessKeyId, secretAccessKey } = req.body;
  if (!email || !accessKeyId || !secretAccessKey) return res.status(400).json({ success: false, message: '缺少参数' });

  try {
    let users = [];
    if (fs.existsSync(USERS_FILE)) {
      users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'));
    }
    const userIndex = users.findIndex(u => u.email === email);
    if (userIndex === -1) return res.status(404).json({ success: false, message: '用户不存在' });

    users[userIndex].accessKeyId = accessKeyId;
    users[userIndex].secretAccessKey = secretAccessKey;
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
    res.json({ success: true, message: 'Key 已保存到用户信息中' });
  } catch (err) {
    console.error('❌ 保存用户 AWS Key 失败:', err);
    res.status(500).json({ success: false, message: '保存失败', error: err.message });
  }
});

router.post('/authorize-ami', async (req, res) => {
  const { accountId } = req.body;
  if (!accountId || typeof accountId !== 'string') {
    return res.status(400).json({ success: false, message: '缺少或无效的 AWS Account ID' });
  }
  try {
    const result = await awsService.authorizeAmiToAccount(accountId);
    res.json({ success: true, result });
  } catch (err) {
    console.error('❌ AMI 授权失败:', err);
    res.status(500).json({ success: false, message: 'AMI 授权失败', error: err.message });
  }
});

router.get('/elastic-ips', async (req, res) => {
  try {
    const result = await awsService.getAllElasticIPs();
    res.json({ success: true, data: result });
  } catch (err) {
    console.error('❌ 获取弹性 IP 失败:', err);
    res.status(500).json({ success: false, message: '获取弹性 IP 失败', error: err.message });
  }
});

router.post('/release-ip', async (req, res) => {
  const { allocationId, region, email } = req.body;
  const awsKey = getUserAwsKey(email);
  if (!awsKey) return res.status(403).json({ success: false, message: '无效或缺失的 AWS Key' });

  try {
    await awsService.releaseElasticIP(allocationId, region, awsKey);
    res.json({ success: true });
  } catch (err) {
    console.error('❌ 释放弹性 IP 失败:', err);
    res.status(500).json({ success: false, message: '释放失败', error: err.message });
  }
});

router.post('/create-instance', async (req, res) => {
  const { region, email } = req.body;
  const awsKey = getUserAwsKey(email);
  if (!awsKey) return res.status(403).json({ success: false, message: '无效或缺失的 AWS Key' });

  try {
    const result = await awsService.createEc2InstanceWithAutoKeyAndSG(region, awsKey);
    res.json({ success: true, data: result });
  } catch (err) {
    console.error('❌ 创建实例失败:', err);
    res.status(500).json({ success: false, message: '创建实例失败', error: err.message });
  }
});

router.post('/describe-instances', async (req, res) => {
  const { region, email } = req.body;
  const awsKey = getUserAwsKey(email);
  if (!awsKey) return res.status(403).json({ success: false, message: '无效或缺失的 AWS Key' });

  try {
    const result = await awsService.describeInstances(region, awsKey);
    res.json({ success: true, data: result });
  } catch (err) {
    console.error('❌ 获取实例失败:', err);
    res.status(500).json({ success: false, message: '获取实例失败', error: err.message });
  }
});

module.exports = router;