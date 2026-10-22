# 两个网站的完整恢复

此备份是私有完整备份，含数据库、打卡照片、志愿凭证、真实排班及联系人、两个网站源码和构建产物、豆包环境配置、Cloudflare 隧道运行凭据。请保持备份私有，不上传公开GitHub。公开GitHub版本的示例数据不能替换备份里的生产配置。

1. 从Google Drive下载最近成功上传的 `elite-workbench-full-日期-时间.zip`，核对SHA256；解压到新电脑的工作目录。`MANIFEST.json`记录每个文件的SHA256和数据库各类记录数量。先核验文件散列和SQLite `PRAGMA integrity_check`。
2. 安装Node.js 22.13或更高版本、Python3，以及官方cloudflared。项目未备份node_modules或原电脑的运行时，按两个项目说明重新安装依赖。主站执行 `npm ci`；可使用备份dist直接运行，也可 `npm run build` 重建。
3. 保留 `elite-workbench-server/data/workbench.sqlite` 及整个 `data/photos`；不要重新导入旧数据库。备份通过SQLite在线备份API生成完整数据库，不依赖原电脑的WAL/SHM文件。
4. 根据新路径修改两个网站的deployment服务文件中的WorkingDirectory、ExecStart、EnvironmentFile和.env里的DATA_DIR。保留原环境变量的值，服务使用 `--env-file` 或systemd EnvironmentFile加载环境文件。不要只复制公开源码而丢掉真实seed、联系人或ark.env。
5. 将 `cloudflared/隧道ID.json` 放入新电脑私有凭据目录，设置0600权限。修改 `deployment/cloudflared.yml` 的credentials-file路径；保留同一隧道ID及两个域名路由。安装后运行同一隧道即可继续使用既有DNS路由，不需要备份Cloudflare管理证书。
6. 启动主站127.0.0.1:3000、报名页127.0.0.1:3100和隧道，核对 `/health`、两域名、个人档案、报名数据、照片及AI识别。systemd服务文件仅作模板，替换旧电脑绝对路径和运行时路径后重新启用；可使用loginctl enable-linger确保用户服务开机运行。
7. 新电脑还需重新配置Google Drive连接与每天04:00的备份任务；本机备份脚本为 `scripts/backup-site.py`，运行会生成新完整备份。不会在恢复时自动重建旧电脑的Codex计划任务。

凌晨任务按Asia/Shanghai时间运行；只有成功创建、上传并验证的备份才记为成功。电脑损坏后可恢复到最后一次成功备份时点，之后的新数据不在该快照中。

## 2026-10-21 公网服务器部署
生产根目录 /opt/elite-sites 。主站Nginx直连203.0.113.10并使用Let\x27s Encrypt证书，其他原隧道域名由服务器Cloudflare Tunnel提供。Node路径 /usr/local/lib/elite/node（24.19.0），项目运行时不依赖原电脑。恢复后使用新的服务器路径修改服务环境。server-config/ 包含此网站Nginx配置、systemd服务/备份定时器与主站TLS恢复材料，请严格保密。新服务器需安装Node、Nginx、Certbot、Python3、cloudflared并重建系统用户elite-site，再核对目录权限。不要覆盖服务器上其他网站的Nginx配置。
服务器03:55生成本地备份；04:00 Google Drive上传由原电脑Codex负责，离线则不能上传，恢复后补传。服务器本地备份与Google Drive已验证备份必须区分。
