# 菁英工作台

React + TypeScript + Node.js + SQLite 的独立部署网站，含值班排班、照片打卡、个人档案、志愿时长审核、报名管理和多入口招募表单。

## 启动

需要 Node.js 24 LTS（最低22.13）。

```sh
npm ci
cp .env.example .env
# 填写自己的 INITIAL_PASSWORD_SUPERADMIN，可选填写 INITIAL_PASSWORD_RECRUIT
npm run build
node --env-file=.env server.mjs
```

默认访问 http://localhost:3000。开发启动：`node --env-file=.env server.mjs --dev`。首次启动导入示例排班；现有数据库不会被初始配置覆盖。其他管理角色可用 INITIAL_PASSWORD_VIEWER/OFFICE/MEDIA/PROJECT/PRACTICE 设置初始密码，未配置时生成随机密码，再由超级管理员在后台设置。

## 功能

- 固定排班、逐人单/双周、单日调整、请假恢复自动状态。
- 到场照片打卡、同设备重叠班次限制、缺岗及累计时长。
- AI识别时长申请、核对后提交、审核与修改、附件管理。
- 招募表单制作与版本管理，发布至 /a、/b、/c、/d、/e；支持开始时间、截止时间和数量上限。
- 全部或单场地高清排班图导出，手机预览与保存。
- 报名结果筛选、详情和CSV导出。

## 报名站

`qing-signup/` 是配套报名网站源码，默认端口3100。它通过后端接口把报名写入主站数据库。

```sh
PUBLIC_URL=http://localhost:3100 BACKEND_URL=http://127.0.0.1:3000 BACKEND_ORIGIN=http://localhost:3000 node qing-signup/server.mjs
```

生产部署应使用 Nginx HTTPS 反向代理，将3000/3100端口只绑定本机，进程交给systemd管理。数据库在data/workbench.sqlite，照片及附件在data/photos。备份恢复必须同时包含数据库、照片和私有配置；公开源码不能代替完整数据备份。

## 检查

```sh
npm run check
npm test
npm run build
python3 -m unittest discover -s tests -p 'test_*.py'
```

## 公开版本说明

同步日期：2026-10-22。真实排班人员和联系方式已替换为示例；无生产数据库、照片、报名结果、密码、SSH密钥、AI密钥、TLS证书或Cloudflare凭据。示例人员、域名及运营脚本路径需要按自己的环境配置。可选通知脚本是确定性程序，不调用AI模型；微信通道本身仍受平台会话限制，不保证主动通知永久有效。
