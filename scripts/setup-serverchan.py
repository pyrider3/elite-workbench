#!/usr/bin/env python3
"""User-run local secret entry. Never accepts a key in command arguments."""
import getpass,json,os,pathlib,re
private=pathlib.Path(__file__).resolve().parents[1]/'work/wechat-monitor'
print('请先访问 https://sct.ftqq.com 登录并绑定微信通知。免费版每天5条。')
key=getpass.getpass('粘贴 SCT 开头的 SendKey（输入不显示）：').strip()
if not re.fullmatch(r'SCT[0-9A-Za-z]+',key):raise SystemExit('格式无效，未保存。需要 Turbo 版 SCT 密钥。')
private.mkdir(parents=True,exist_ok=True);os.chmod(private,0o700)
p=private/'serverchan.json';fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
with os.fdopen(fd,'w') as f:json.dump({'sendkey':key},f)
os.chmod(p,0o600)
print('已保存在本机私有配置。下一次待发通知将使用 Server酱，不消耗 AI token。')
