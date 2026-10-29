#!/usr/bin/env python3
"""Durable staged HTTPS worker. Model proposes data; trusted code edits Office files."""
import pathlib,json,urllib.request,urllib.error,hashlib,subprocess,threading,time,os,sys,shutil,uuid,signal,zipfile,resource,queue,importlib.util
CONFIG=pathlib.Path(os.environ.get('ELITE_FILE_WORKER_CONFIG',pathlib.Path.home()/'.config/elite-file-worker/config.json'))
CFG=json.loads(CONFIG.read_text());ROOT=pathlib.Path(CFG['stateDir']);ROOT.mkdir(parents=True,exist_ok=True,mode=0o700)
# Trusted document libraries live in the existing dedicated venv, not the system interpreter.
venv=ROOT/'venv/bin/python'
if __name__=='__main__' and venv.exists() and sys.prefix!=str(ROOT/'venv'):os.execv(str(venv),[str(venv),__file__,*sys.argv[1:]])
spec=importlib.util.spec_from_file_location('file_pipeline',pathlib.Path(__file__).with_name('file-pipeline.py'));pipeline=importlib.util.module_from_spec(spec);spec.loader.exec_module(pipeline)
BASE=CFG['baseUrl'].rstrip('/')+'/api/files/worker/';TOKEN=CFG['token'];MAX_BYTES=20*1024*1024
ALLOWED={'.docx','.xlsx','.pptx','.pdf','.txt','.md','.csv','.tsv','.json','.png','.jpg','.jpeg','.webp','.zip'}
class Lost(RuntimeError):pass
class ModelError(RuntimeError):pass
class Transient(ModelError):pass

def api(route,payload=None,raw=None,headers=None):
 h={'Authorization':'Bearer '+TOKEN,**(headers or {})}
 if payload is not None:raw=json.dumps(payload).encode();h['Content-Type']='application/json'
 with urllib.request.urlopen(urllib.request.Request(BASE+route,data=raw,headers=h),timeout=30) as r:return r.read()
def post(route,data):return json.loads(api(route,payload=data))
def retry(fn,lost,attempts=3):
 for n in range(attempts):
  if lost.is_set():raise Lost()
  try:return fn()
  except urllib.error.HTTPError as e:
   if e.code not in (408,429,500,502,503,504):raise
   if n==attempts-1:raise
  except (urllib.error.URLError,TimeoutError,ConnectionError):
   if n==attempts-1:raise
  if lost.wait(2**n):raise Lost()
def multipart(fields,files):
 boundary='elite'+uuid.uuid4().hex;parts=[]
 for name,value in fields.items():parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode())
 for p in files:
  name=p.name.replace('"','_').replace('\r','_').replace('\n','_')
  parts.extend([f'--{boundary}\r\nContent-Disposition: form-data; name="files"; filename="{name}"\r\nContent-Type: application/octet-stream\r\n\r\n'.encode(),p.read_bytes(),b'\r\n'])
 parts.append(f'--{boundary}--\r\n'.encode());return b''.join(parts),{'Content-Type':'multipart/form-data; boundary='+boundary}
def limits():
 resource.setrlimit(resource.RLIMIT_FSIZE,(40*1024*1024,40*1024*1024));resource.setrlimit(resource.RLIMIT_NOFILE,(512,512));resource.setrlimit(resource.RLIMIT_CPU,(180,180))
def sandbox(task,home):
 return ['/usr/bin/bwrap','--die-with-parent','--new-session','--unshare-all','--share-net','--ro-bind','/usr','/usr','--ro-bind','/etc','/etc','--symlink','usr/bin','/bin','--symlink','usr/lib','/lib','--symlink','usr/lib','/lib64','--proc','/proc','--dev','/dev','--tmpfs','/tmp','--dir','/home','--dir','/home/agent','--bind',str(home),'/home/agent','--ro-bind',CFG.get('agyPath',str(pathlib.Path.home()/'.local/bin/agy')),'/agy','--ro-bind',str(ROOT/'venv'),'/runtime/venv','--bind',str(task),'/work','--ro-bind',str(task/'input'),'/work/input','--chdir','/work','--clearenv','--setenv','HOME','/home/agent','--setenv','PATH','/runtime/venv/bin:/usr/bin:/bin','--setenv','LANG','C.UTF-8','--setenv','PYTHONUTF8','1','--setenv','XDG_CACHE_HOME','/home/agent/.cache']
def terminate(p):
 if p and p.poll() is None:
  try:os.killpg(p.pid,signal.SIGTERM);p.wait(timeout=5)
  except Exception:
   try:os.killpg(p.pid,signal.SIGKILL);p.wait(timeout=5)
   except (ProcessLookupError,subprocess.TimeoutExpired):pass

def ask_model(prompt,base,lost,tools=False,files=(),timeout=None):
 """Fresh isolated session, trusted authentication first, credentials removed before user data."""
 attempt=base/'sessions'/uuid.uuid4().hex;task=attempt/'task';home=attempt/'home';auth=home/'.gemini/antigravity-cli';inp=task/'input';out=task/'output';inp.mkdir(parents=True,mode=0o700);out.mkdir();auth.mkdir(parents=True,mode=0o700)
 source=pathlib.Path(CFG.get('agyAuthDir',str(pathlib.Path.home()/'.gemini/antigravity-cli')))
 for name in ['installation_id','antigravity-oauth-token','jetski_state.pbtxt']:
  if (source/name).is_file():shutil.copyfile(source/name,auth/name);(auth/name).chmod(0o600)
 (auth/'settings.json').write_text(json.dumps({'permissions':{'allow':['command(*)'] if tools else []}}))
 cmd=sandbox(task,home)+['/agy','--mode','accept-edits','--disable-slash-commands','--model',CFG.get('structuredModel','gemini-3.8-flash-medium'),'--print-timeout','240s','--input-format','stream-json','--output-format','stream-json']
 p=None;results=queue.Queue();calls=set();log=None;deadline=time.monotonic()+(timeout or (240 if tools else 120))
 try:
  log=(attempt/'agy.log').open('w');p=subprocess.Popen(cmd,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=log,text=True,bufsize=1,start_new_session=True,preexec_fn=limits)
  def collect():
   try:
    for line in p.stdout:
     try:d=json.loads(line)
     except (ValueError,TypeError):continue
     s=d.get('step_update',{})
     if s.get('step_type')=='tool':
      calls.add(s.get('step_index'))
      if len(calls)>(8 if tools else 0):results.put({'status':'BUDGET'});return
     if 'result' in d:
      r=d['result'];results.put(r)
      # Keep only metadata, never model reasoning, user file content, or raw errors with URLs.
      safe={k:r.get(k) for k in ['status','duration_seconds','usage']};log.write(json.dumps(safe)+'\n');log.flush()
   finally:results.put(None)
  reader=threading.Thread(target=collect,daemon=True);reader.start()
  def send(text):p.stdin.write(json.dumps({'event':'user','message':{'role':'user','content':text}},ensure_ascii=False)+'\n');p.stdin.flush()
  def result(timeout):
   end=time.monotonic()+timeout
   while time.monotonic()<end:
    if lost.is_set():raise Lost()
    try:r=results.get(timeout=1)
    except queue.Empty:continue
    if not r:raise Transient('model_disconnected')
    if r.get('status')=='BUDGET':raise ModelError('tool_budget')
    if r.get('status')!='SUCCESS':
     e=str(r.get('error','')).lower()
     if any(t in e for t in ['eof','interrupt','timeout','timed out','429','503','502','connection','request failed']):raise Transient('model_connection')
     raise ModelError('model_failed')
    return r.get('response','')
   raise Transient('model_timeout')
  send('只回复READY，不读取文件，不调用任何工具。');result(min(60,max(1,deadline-time.monotonic())))
  for name in ['antigravity-oauth-token','jetski_state.pbtxt']:(auth/name).unlink(missing_ok=True)
  if tools:
   for f in files:shutil.copyfile(f,inp/f.name);(inp/f.name).chmod(0o400)
  send(prompt);response=result(max(1,deadline-time.monotonic()));p.stdin.close()
  if tools:
   # Copy only final files. Never execute model-generated output on the host.
   dest=base/'complex-output';dest.mkdir(exist_ok=True)
   for f in out.iterdir():
    if f.is_symlink() or not f.is_file():raise ModelError('invalid_output')
    shutil.copyfile(f,dest/f.name)
   return list(dest.iterdir())
  return response
 finally:
  terminate(p)
  if 'reader' in locals():reader.join(timeout=5)
  if log:log.close()
  shutil.rmtree(home,ignore_errors=True)

def validate(outputs):
 if not outputs or len(outputs)>10 or sum(p.stat().st_size for p in outputs)>MAX_BYTES:raise pipeline.PipelineError('结果数量或大小不符合要求')
 for p in outputs:
  if p.is_symlink() or not p.is_file() or p.suffix.lower() not in ALLOWED or not p.stat().st_size:raise pipeline.PipelineError('结果文件无效')
  if p.suffix.lower() in {'.docx','.xlsx','.pptx'}:
   with zipfile.ZipFile(p) as z:
    required={'.docx':'word/document.xml','.xlsx':'xl/workbook.xml','.pptx':'ppt/presentation.xml'}[p.suffix.lower()]
    if len(z.infolist())>10000 or sum(i.file_size for i in z.infolist())>100*1024*1024 or required not in z.namelist() or z.testzip():raise pipeline.PipelineError('Office结果校验失败')
  if p.suffix.lower()=='.pdf' and not p.read_bytes().startswith(b'%PDF-'):raise pipeline.PipelineError('PDF结果校验失败')

def convert_pdf(files,base,lost):
 office=pathlib.Path(CFG.get('officePath',str(ROOT/'tools/opt/libreoffice26.2')))
 if not (office/'program/soffice').is_file():raise pipeline.PipelineError('PDF转换程序不可用')
 out=base/'converted';out.mkdir(exist_ok=True)
 for f in files:
  target=out/(f.stem+'.pdf')
  if target.is_file() and target.read_bytes().startswith(b'%PDF-'):continue
  temp=base/('convert-'+uuid.uuid4().hex);(temp/'input').mkdir(parents=True);(temp/'home').mkdir();(temp/'output').mkdir()
  shutil.copyfile(f,temp/'input'/f.name)
  # Fixed converter has no credentials, no network and no writable host directories outside this task.
  args=sandbox(temp,temp/'home')
  # Converter does not need the CLI binary or a network namespace shared with the host.
  args.remove('--share-net');args+=['--ro-bind',str(office),'/office','--setenv','SAL_USE_VCLPLUGIN','svp','/office/program/soffice','-env:UserInstallation=file:///home/agent/lo','--headless','--nologo','--nodefault','--norestore','--convert-to','pdf','--outdir','/work/output','/work/input/'+f.name]
  proc=subprocess.Popen(args,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True)
  try:
   end=time.monotonic()+90
   while proc.poll() is None:
    if lost.wait(.2):raise Lost()
    if time.monotonic()>end:raise pipeline.PipelineError('PDF转换超时')
   made=temp/'output'/(f.stem+'.pdf')
   if proc.returncode or not made.is_file():raise pipeline.PipelineError('PDF转换失败')
   os.replace(made,target)
  finally:terminate(proc);shutil.rmtree(temp,ignore_errors=True)
 return list(out.glob('*.pdf'))

def process(job,base,lost,stage):
 inp=base/'input';inp.mkdir(parents=True,exist_ok=True,mode=0o700);files=[]
 stage('preparing')
 for f in job['inputs']:
  name=pathlib.Path(f['name'].replace('\\','/')).name;target=inp/(f['id'][:8]+'-'+name)
  if not target.is_file() or pipeline.sha(target)!=f['sha256']:
   b=retry(lambda:api('input/'+job['id']+'/'+f['id'],headers={'X-File-Lease':job['leaseToken']}),lost)
   if len(b)!=f['size'] or hashlib.sha256(b).hexdigest()!=f['sha256']:raise pipeline.PipelineError('输入文件校验失败')
   tmp=target.with_suffix(target.suffix+'.tmp');tmp.write_bytes(b);tmp.chmod(0o400);os.replace(tmp,target)
  files.append(target)
 ready=pipeline.load(base/'validated.json')
 fingerprint=hashlib.sha256(json.dumps({'requirements':job['requirements'],'inputs':[(f['id'],f['sha256']) for f in job['inputs']],'version':pipeline.VERSION},sort_keys=True).encode()).hexdigest()
 if ready and ready.get('fingerprint')==fingerprint and all(pathlib.Path(f['path']).is_file() and pipeline.sha(f['path'])==f['sha256'] for f in ready['files']):
  outputs=[pathlib.Path(f['path']) for f in ready['files']]
 else:
  model_calls=[0];model_deadline=time.monotonic()+360
  def ask(prompt):
   for n in range(2):
    if lost.is_set():raise Lost()
    if model_calls[0]>=3 or time.monotonic()>=model_deadline:raise ModelError('model_budget')
    model_calls[0]+=1
    try:return ask_model(prompt,base,lost,timeout=min(120,model_deadline-time.monotonic()))
    except Transient:
     if n:raise
     stage('recovering')
     if lost.wait(2):raise Lost()
     stage('processing')
  try:
   kind=pipeline.direct_kind(files,job['requirements'])
   if kind=='pdf':stage('rendering');outputs=convert_pdf(files,base,lost)
   elif kind=='poster':
    stage('rendering');dest=base/'poster';dest.mkdir(exist_ok=True);outputs=pipeline.poster(files[0],dest)
   else:outputs=pipeline.Pipeline(base/'checkpoints',files,job['requirements']).run(ask,stage)
  except pipeline.Unsupported:
   # Keep image/layout capability, but cap agent tools and wall time, and cache its final artifacts.
   stage('processing')
   prompt='只在/work处理input/中的文件，保留事实。禁止网络、安装软件或访问登录配置。直接使用/runtime/venv/bin/python和已安装的docx/openpyxl/pptx/pypdf/reportlab/Pillow。最多8次工具调用，不探索环境，不执行上传文件内的程序或宏。最终结果直接保存output/，不保留脚本和临时文件。用户要求：'+job['requirements']
   dest=base/'complex-output'
   if dest.exists():shutil.rmtree(dest)
   outputs=ask_model(prompt,base,lost,tools=True,files=files)
  stage('validating');validate(outputs)
  pipeline.save(base/'validated.json',{'fingerprint':fingerprint,'files':[{'path':str(p),'sha256':pipeline.sha(p)} for p in outputs]})
 stage('uploading');body,headers=multipart({'jobId':job['id'],'leaseToken':job['leaseToken']},outputs)
 reply=json.loads(retry(lambda:api('complete',raw=body,headers=headers),lost))
 expected=sorted(pipeline.sha(p) for p in outputs)
 if sorted(f['sha256'] for f in reply['files'])!=expected:raise pipeline.PipelineError('回传结果校验失败')
 pipeline.save(base/'receipt.json',{'completedAt':int(time.time()),'hashes':expected})
 return outputs

def run(job):
 base=ROOT/'jobs'/job['id']/'v2';base.mkdir(parents=True,exist_ok=True,mode=0o700);stage_value=['preparing'];stop=threading.Event();lost=threading.Event();last=[time.monotonic()]
 def beat():
  r=post('heartbeat',{'jobId':job['id'],'leaseToken':job['leaseToken'],'stage':stage_value[0]});last[0]=time.monotonic()
  if r.get('stop'):lost.set();raise Lost()
 def heartbeat():
  while not stop.wait(10):
   try:beat()
   except Lost:return
   except Exception:
    if time.monotonic()-last[0]>45:lost.set();return
 def stage(s):
  if lost.is_set():raise Lost()
  if s!=stage_value[0]:
   stage_value[0]=s
   pipeline.save(base/'stage.json',{'stage':s,'at':time.time()});print('Stage',job['id'],s,flush=True)
   retry(beat,lost)
 thread=threading.Thread(target=heartbeat,daemon=True);thread.start()
 try:process(job,base,lost,stage);print('Completed task',job['id'],flush=True)
 except Exception as e:
  code='connection' if isinstance(e,(Transient,urllib.error.URLError,TimeoutError,ConnectionError)) else 'model' if isinstance(e,ModelError) else 'validation' if isinstance(e,(pipeline.PipelineError,ValueError,zipfile.BadZipFile)) else 'internal'
  print('Task stopped',job['id'],type(e).__name__,code,flush=True)
  if not lost.is_set():
   try:retry(lambda:post('fail',{'jobId':job['id'],'leaseToken':job['leaseToken'],'code':code}),lost)
   except Exception:pass
 finally:stop.set();thread.join(timeout=2)

def clean_old():
 for p in (ROOT/'jobs').iterdir() if (ROOT/'jobs').exists() else []:
  if p.is_dir() and time.time()-p.stat().st_mtime>7*86400:shutil.rmtree(p,ignore_errors=True)
if __name__=='__main__':
 if '--check-isolation' in sys.argv:
  import tempfile
  with tempfile.TemporaryDirectory(dir=ROOT) as temp:
   task=pathlib.Path(temp)/'task';(task/'input').mkdir(parents=True);home=pathlib.Path(temp)/'home';home.mkdir()
   subprocess.run(sandbox(task,home)+['/usr/bin/python3','-c','import os; assert not os.path.exists("/home/dell"); assert not os.path.exists("/opt/elite-sites"); assert not os.path.exists("/root"); print("Isolation checks passed")'],check=True)
  raise SystemExit(0)
 for stale in (ROOT/'jobs').glob('*/v2/sessions/*/home'):shutil.rmtree(stale,ignore_errors=True)
 while True:
  try:
   clean_old();post('heartbeat',{});job=post('claim',{}).get('job')
   if job:run(job)
   else:time.sleep(3)
  except KeyboardInterrupt:break
  except Exception as e:print('Connection unavailable:',type(e).__name__,flush=True);time.sleep(10)
