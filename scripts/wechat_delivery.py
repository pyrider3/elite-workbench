"""Private deterministic delivery, with bounded retry backoff and optional ServerChan."""
import json,os,pathlib,re,subprocess,time,urllib.parse,urllib.request

def write_private(path,data):
 temp=path.with_suffix('.tmp');temp.write_text(json.dumps(data));os.chmod(temp,0o600);temp.replace(path)

def deliver(config,message,private,cli):
 private=pathlib.Path(private);state_path=private/'delivery.json'
 credentials=private/'serverchan.json'
 key=json.loads(credentials.read_text()).get('sendkey','') if credentials.exists() else ''
 provider='serverchan' if key else 'openclaw'
 state=json.loads(state_path.read_text()) if state_path.exists() else {}
 now=time.time()
 if state.get('provider')==provider and now<state.get('retryAt',0):
  raise RuntimeError('通知通道等待重试，未发送记录将保留')
 try:
  if key:
   if not re.fullmatch(r'SCT[0-9A-Za-z]+',key):raise ValueError('invalid key')
   title=message.splitlines()[0][:80]
   body=urllib.parse.urlencode({'title':title,'desp':message}).encode()
   request=urllib.request.Request('https://sctapi.ftqq.com/'+key+'.send',data=body,headers={'Content-Type':'application/x-www-form-urlencoded'})
   with urllib.request.urlopen(request,timeout=20) as response:result=json.load(response)
   if result.get('code')!=0:raise RuntimeError('provider rejected delivery')
  else:
   p=subprocess.run([cli,'message','send','--channel','openclaw-weixin','--account',config['account'],'--target',config['target'],'--message',message,'--json'],capture_output=True,text=True,timeout=55)
   if p.returncode:raise RuntimeError('OpenClaw rejected delivery')
 except Exception:
  failures=state.get('failures',0)+1 if state.get('provider')==provider else 1
  write_private(state_path,{'provider':provider,'failures':failures,'retryAt':now+min(900,60*2**min(failures-1,4)),'lastFailureAt':now})
  raise RuntimeError('微信通知发送失败；已启用退避重试，待发送记录保留。请检查通道绑定或额度。') from None
 write_private(state_path,{'provider':provider,'failures':0,'retryAt':0,'lastSuccessAt':now})
