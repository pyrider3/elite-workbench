#!/usr/bin/env python3
"""Limited health inspection and service restart; never changes website data/config."""
import argparse,json,subprocess,time,urllib.request
SERVICES={'workbench':'elite-workbench.service','signup':'qing-signup.service','tunnel':'elite-workbench-tunnel.service'}
URLS={'workbench':'http://127.0.0.1:3000/health','signup':'http://127.0.0.1:3100/','public_workbench':'https://dj.qnjyxh.xyz/','public_signup':'https://new.qnjyxh.xyz/'}
def health():
 out={}
 for key,url in URLS.items():
  try:
   with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0'}),timeout=12) as r:out[key]={'ok':r.status==200,'status':r.status}
  except Exception as e:out[key]={'ok':False,'error':type(e).__name__}
 out['services']={k:subprocess.run(['systemctl','--user','is-active',v],capture_output=True,text=True).stdout.strip() for k,v in SERVICES.items()}
 return out
p=argparse.ArgumentParser();p.add_argument('action',choices=['status','repair']);a=p.parse_args()
before=health()
if a.action=='repair':
 restart=[]
 for k in ('workbench','signup'):
  if not before[k]['ok'] or before['services'][k]!='active':restart.append(k)
 if before['services']['tunnel']!='active' or (before['workbench']['ok'] and before['signup']['ok'] and (not before['public_workbench']['ok'] or not before['public_signup']['ok'])):restart.append('tunnel')
 for k in restart:subprocess.run(['systemctl','--user','restart',SERVICES[k]],check=True)
 if restart:time.sleep(2)
 print(json.dumps({'before':before,'restarted':restart,'after':health()},ensure_ascii=False))
else:print(json.dumps(before,ensure_ascii=False))
