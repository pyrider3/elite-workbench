# 文件处理运维

网站 /files 为正式入口。页面下方管理入口已替换为文件处理；上方姓名弹窗的管理员登录页签使用原管理员账号权限与会话。

上传1至5个文件，合计20MB，要求2至4000字；同一浏览器最多3个未完成任务、24小时5个新任务，同一网络24小时20个任务，队列最多30个任务。文件保存7天、任务记录保存30天。记录按HttpOnly私有Cookie隔离，不能只凭姓名查看他人文件。清除浏览器数据将失去原任务访问权限。

服务器 FILE_WORKER_TOKEN 从 deployment/file-worker.env 加载。worker仅通过HTTPS领取和回传文件，不连接家庭SSH。任务SQLite持久化在原entries表，输入输出在data/file-tasks；自动私有备份纳入文件引用与散列校验。备份恢复时必须恢复file-tasks和部署env。

Dell用户服务 elite-file-worker.service 常驻，配置 ~/.config/elite-file-worker/config.json，程序 ~/.local/share/elite-file-worker/file-worker.py，虚拟环境和任务工作目录在同目录。systemctl --user status/restart elite-file-worker；journalctl --user -u elite-file-worker --no-pager 查看不含文件内容的日志。配置token与CLI登录材料不得公开。程序启动前运行 --check-isolation。

任务60秒租约，每10秒心跳；失联后重新排队，连续两次领取后失联置失败，可手动重试，累计最多4次处理。处理最长15分钟，取消会停止处理且拒绝旧租约回传。进度为准备文件、AI处理、回传结果，不伪造AI百分比。Dell离线时任务排队，原网站继续运行。

每个AI任务在bubblewrap中运行：不挂载Dell用户目录、网站目录、worker令牌和其他任务。只挂载当前输入输出、只读系统程序、文档库和该任务的CLI登录副本；输入只读。用户文件与要求送入AI前先执行受信任的空白登录回合，随后移除任务环境内的OAuth及登录状态文件；不让用户任务接触令牌文件。每任务CLI状态在结束后删除。agy使用 --mode accept-edits，由外层bubblewrap提供文件隔离；避免嵌套agy内部sandbox导致终端失败，不使用全局跳过权限参数；仅隔离任务的CLI配置允许command(*)，以运行Python文档处理。模型凭据是运行CLI所需的专用副本，网络用于连接模型服务。未做任意恶意程序的形式化安全认证。

输入支持docx/xlsx/pptx/pdf/txt/md/csv/tsv/json/png/jpg/jpeg/webp，结果另支持zip。禁止执行上传文件的程序或宏。所有下载均附件响应，结果不作为HTML执行。默认模型gemini-3.8-flash-high。AI处理结果仍须用户核对。

## 2026-10-23 分阶段处理 v2

新 `file-pipeline.py` 负责固定提取/渲染，不执行AI生成的代码。Word/PPT直接修改OOXML文本节点，保留未修改的包内容与文字run格式；Excel由openpyxl写回，公式不交给AI修改。AI只返回有编号的JSON修改清单/新文档内容，默认 `gemini-3.8-flash-medium`，结构化通道不允许工具。最多一次结构修复、连接暂时故障有限重试，总计最多3次模型尝试且有6分钟预算，单次最多2分钟（包括可信登录回合）。每次仍先空白登录、删除登录文件，再发送用户数据；任务间不共享会话。

纯Office转PDF通过固定LibreOffice程序执行，禁网络、无登录材料，独立用户配置，90秒上限。Dell需要只读可移植运行库 `~/.local/share/elite-file-worker/tools/opt/libreoffice26.2`，可用配置officePath覆盖。普通xlsx展示图片走固定Pillow排版模板，逐格换行/分页，不调用AI；复杂图片/版式或超出结构化上限的任务保留隔离agy通道，最多8次工具调用/4分钟。复杂通道仅保存最终成品，不承诺恢复模型内部思考或任意命令的中间状态。

检查点在Dell `jobs/<jobId>/v2/`，按版本/原文件哈希/要求隔离：缓存输入、extracted.json、plan.json、rendered.json、validated.json。原子替换写入并校验SHA256，渲染失败复用已验证计划，回传失败复用成品；新进程/同任务重新领取也可继续。取消和旧租约仍拒绝发布结果。此缓存依赖Dell磁盘，不是云端异机备份；源输入/已完成下载结果依然纳入网站备份。每阶段heartbeat写真实进度；失败只暴露固定分类，不泄漏上游URL、凭据和文件正文。回传确认丢失后使用原租约摘要幂等确认，防止重复落盘或重跑AI。

本机Node测试80项；Python回归 `venv/bin/python tests/file-worker-pipeline.test.py` 覆盖计划/成品恢复、损坏缓存重建、Word格式和Excel公式保留、路径与readonly校验。真实验收数据必须用独立SQLite/端口，不能占用线上队列或覆盖生产数据库。生产上线前备份，确认无在途任务后更新网页后端和Dell worker；不要将staging配置token/baseUrl覆盖正式配置。
