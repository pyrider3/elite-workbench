#!/usr/bin/env python3
"""Consistent private snapshot of both sites. No service restart required."""
import datetime,fcntl,hashlib,json,os,re,sqlite3,tempfile,zipfile
from pathlib import Path
os.umask(0o077)
ROOT=Path(__file__).resolve().parents[1]
SIGNUP=ROOT/'qing-signup'
DEST=ROOT/'work/site-backups'
DEST.mkdir(parents=True,exist_ok=True)
lock=open(DEST/'.backup.lock','a')
fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
stamp=datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=8))).strftime('%Y%m%d-%H%M%S')
output=DEST/f'elite-workbench-full-{stamp}.zip'
partial=output.with_suffix('.zip.partial')
excluded={'node_modules','.runtime','.git','work','__pycache__'}
manifest={'version':1,'createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'timezone':'Asia/Shanghai','github':'https://github.com/pyrider3/elite-workbench','files':{},'databaseCounts':{}}
def add(z,path,name):
 data=path.read_bytes();z.writestr(name,data);manifest['files'][name]={'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()}
try:
 with tempfile.TemporaryDirectory(prefix='snapshot-',dir=DEST) as temp:
  dbpath=Path(temp)/'workbench.sqlite'
  live=sqlite3.connect(f'file:{ROOT}/data/workbench.sqlite?mode=ro',uri=True,timeout=30)
  snapshot=sqlite3.connect(dbpath)
  live.backup(snapshot);live.close()
  assert snapshot.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
  manifest['databaseCounts']=dict(snapshot.execute('SELECT kind,count(*) FROM entries GROUP BY kind'))
  refs=set();file_jobs=[]
  for (raw,) in snapshot.execute('SELECT data FROM entries'):
   d=json.loads(raw)
   if d.get('inputs') and d.get('owner') and d.get('expiresAt',0)>datetime.datetime.now(datetime.timezone.utc).timestamp()*1000:file_jobs.append(d)
   if d.get('photo'):refs.add(d['photo'])
   for a in d.get('attachments',[]):
    if a.get('key'):refs.add(a['key'])
  snapshot.close()
  with zipfile.ZipFile(partial,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
   for base,prefix in [(ROOT,'elite-workbench-server'),(SIGNUP,'qing-signup')]:
    if not base.is_dir():raise RuntimeError('Required site directory missing')
    for path in sorted(base.rglob('*')):
     if not path.is_file() or path.is_symlink():continue
     rel=path.relative_to(base)
     if any(p in excluded for p in rel.parts) or (base==ROOT and rel.parts[0]=='data') or path.suffix in {'.log','.pyc'}:continue
     add(z,path,prefix+'/'+str(rel))
   add(z,dbpath,'elite-workbench-server/data/workbench.sqlite')
   photos=ROOT/'data/photos'
   for key in refs:
    if not re.fullmatch(r'(?:checkins|attachments)/[a-f0-9-]{36}',key):raise RuntimeError('Invalid photo reference')
    if not (photos/key).is_file() or not (photos/(key+'.json')).is_file():raise RuntimeError('Referenced photo missing')
   for path in sorted(photos.rglob('*')):
    if path.is_file():add(z,path,'elite-workbench-server/data/photos/'+str(path.relative_to(photos)))
   for job in file_jobs:
    # Input/output metadata comes from the consistent database snapshot; committed files are immutable.
    for folder,items in [('input',job.get('inputs',[])),('output',job.get('outputs',[]))]:
     for item in items:
      matches=list((ROOT/'data/file-tasks').glob('file-*/'+folder+'/'+item['disk']))
      matches=[p for p in matches if p.is_file() and not p.is_symlink()]
      if len(matches)!=1:raise RuntimeError('Referenced file task artifact missing')
      p=matches[0]
      if hashlib.sha256(p.read_bytes()).hexdigest()!=item['sha256']:raise RuntimeError('File task artifact checksum mismatch')
      add(z,p,'elite-workbench-server/data/'+str(p.relative_to(ROOT/'data')))
   config=(ROOT/'deployment/cloudflared.yml').read_text()
   match=re.search(r'^credentials-file:\s*(.+)$',config,re.M)
   if not match:raise RuntimeError('Tunnel credentials path missing')
   credentials=Path(match[1].strip())
   if credentials.parent!=Path.home()/'.cloudflared':raise RuntimeError('Unexpected tunnel credentials path')
   add(z,credentials,'cloudflared/'+credentials.name)
   if str(ROOT).startswith('/opt/elite-sites/'):
    system_files=[Path('/etc/nginx/sites-available/elite-workbench'),Path('/etc/nginx/sites-available/qing-signup')]
    system_files += [Path('/etc/systemd/system')/(name+'.service') for name in ['elite-workbench','qing-signup','elite-workbench-tunnel','qing-official-site','elite-sites-backup']]
    system_files += [Path('/etc/systemd/system/elite-sites-backup.timer')]
    system_files += list(Path('/etc/systemd/system/elite-workbench.service.d').glob('*.conf'))
    system_files += [Path('/etc/letsencrypt/live/dj.qnjyxh.xyz')/name for name in ['fullchain.pem','privkey.pem']]
    system_files += [Path('/etc/letsencrypt/live/new.qnjyxh.xyz')/name for name in ['fullchain.pem','privkey.pem']]
    for path in system_files:
     if path.is_file():add(z,path,'server-config/'+str(path).lstrip('/'))
   readme=ROOT/'scripts/restore-site.md'
   if readme.exists():add(z,readme,'RESTORE.md')
   z.writestr('MANIFEST.json',json.dumps(manifest,ensure_ascii=False,indent=2))
  with zipfile.ZipFile(partial) as z:
   if z.testzip():raise RuntimeError('ZIP checksum failed')
  os.replace(partial,output)
  summary={'path':str(output),'bytes':output.stat().st_size,'sha256':hashlib.sha256(output.read_bytes()).hexdigest(),'md5':hashlib.md5(output.read_bytes()).hexdigest(),'files':len(manifest['files']),'databaseCounts':manifest['databaseCounts']}
  (DEST/'latest.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2))
  print(json.dumps(summary,ensure_ascii=False))
except BaseException:
 partial.unlink(missing_ok=True)
 raise
