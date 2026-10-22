# 小菁对话式报名源码

导出的是 2026-10-11 当前网页实际加载的前端源码，包含小菁形象、表情、动画、步骤切换、部门介绍及手动报名备用页面。没有包含报名数据、数据库、密码、登录凭据或其他网站功能。

## 文件
- public/qing.html：对话页布局与小菁结构。
- public/qing.js：问答步骤、校验、提交与交互。
- public/qing-reactions.js：动作、表情及反应。
- public/qing*.css：布局、角色、脸部、花饰、动画及手机适配。
- public/index.html、app.js、style.css、department.css：/biao 手动报名入口。

未打包没有被当前 qing.html 引用的 qing-state-machine.js，避免误加载旧动画方案。小菁形象由 HTML/CSS 绘制，无需外部角色图片。

## 本地预览
安装 Node.js 22 或更新版本，在此目录执行 node preview.mjs，然后访问 http://localhost:3100 。不要直接双击 HTML，因为页面使用从网站根目录开始的资源路径。预览服务器只提供前端，不保存报名；点击提交会明确返回“预览模式未连接报名数据库”。

## 接入自己的后端
页面向同源 POST /api/applications 发送 JSON：name、grade（大一/大二）、college、department（办公室/新媒体/项目部/实践部）、other_department（可选）、introduction、contact、note（可选）。成功返回 HTTP 201 和 {"ok":true}，错误返回非 2xx 和 {"error":"错误说明"}。须由后端验证字段并保存信息。

部署路由：/ 和 /qing 指向 qing.html，/biao 指向 index.html；其余文件按 public 目录公开。原站后端及数据库不在此包。
