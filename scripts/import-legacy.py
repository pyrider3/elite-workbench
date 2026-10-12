#!/usr/bin/env python3
"""Import the association backup; --apply writes, otherwise only validates."""
import argparse,collections,datetime,hashlib,json,pathlib,re,shutil,sqlite3,tempfile,zipfile
parser=argparse.ArgumentParser();parser.add_argument('archive');parser.add_argument('--data-dir',default='data');parser.add_argument('--apply',action='store_true');parser.add_argument('--sync-source',action='store_true',help='Reconcile previous imports with this authoritative source snapshot');args=parser.parse_args()
root=pathlib.Path(args.data_dir).resolve();archive=pathlib.Path(args.archive).resolve();z=zipfile.ZipFile(archive)
archive_hash=hashlib.sha256(archive.read_bytes()).hexdigest()
source='youth-elite-platform';now=datetime.datetime.now(datetime.timezone.utc);stamp=now.strftime('%Y%m%dT%H%M%S%fZ')
db_members=[n for n in z.namelist() if n.endswith('data/volunteer-hours.db')];assert len(db_members)==1,'Expected exactly one source database'
prefix=db_members[0][:-len('data/volunteer-hours.db')]
json_dir='raw-json/' if prefix+'raw-json/records.json' in z.namelist() else 'records-json/'
load=lambda table:json.loads(z.read(prefix+json_dir+table+'.json'))
time=lambda value:int(datetime.datetime.fromisoformat(value.replace('Z','+00:00')).timestamp()*1000) if value else None
records=load('records');apps=load('association_applications');surveys=load('association_surveys');names=load('name_submissions');attachments=load('record_attachments')
# Cross-check the JSON export with its SQLite source, opened read-only.
with tempfile.TemporaryDirectory() as tmp:
 src=pathlib.Path(tmp)/'source.db';src.write_bytes(z.read(db_members[0]));old=sqlite3.connect('file:'+str(src)+'?mode=ro',uri=True);old.row_factory=sqlite3.Row
 for table,rows in [('records',records),('association_applications',apps),('association_surveys',surveys),('name_submissions',names),('record_attachments',attachments)]:
  sql=[dict(r) for r in old.execute('select * from '+table)];assert sorted(sql,key=lambda r:r['id'])==sorted(rows,key=lambda r:r['id']),table+' JSON/SQLite mismatch'
 old.close()
files={};by_record=collections.defaultdict(list);orphans=[];record_ids={r['id'] for r in records}
for a in attachments:
 base=a['file_path'].replace('\\','/').rsplit('/',1)[-1]
 m=re.fullmatch(r'([a-f0-9-]{36})\.(jpg|jpeg|png|webp)',base,re.I);assert m,'Unexpected attachment filename'
 payload=z.read(prefix+'data/attachments/'+base);key='attachments/'+m[1].lower();mime=a['mime_type'];assert mime in ['image/jpeg','image/png','image/webp'],'Unsupported attachment MIME'
 assert payload.startswith(b'\xff\xd8') or payload.startswith(b'\x89PNG') or payload.startswith(b'RIFF'),'Invalid image'
 files[key]=(payload,mime)
 if a['record_id'] not in record_ids:orphans.append(a);continue
 by_record[a['record_id']].append({'id':'legacy:association:attachment:'+str(a['id']),'key':key,'fileName':a['file_name'],'mimeType':mime,'createdAt':time(a['created_at']),'legacyId':a['id']})
entries=[]
def add(kind,table,row,data):
 legacy={'source':source,'table':table,'id':row['id'],'original':row,'archiveSha256':archive_hash}
 entries.append(('legacy:association:'+table+':'+str(row['id']),kind,{**data,'legacy':legacy}))
for r in records:
 assert r['name'] and isinstance(r['hours'],(int,float)) and 0<r['hours']<=100 and r['status'] in ('pending','approved','rejected'),'Invalid volunteer record'
 add('volunteer','records',r,{'name':r['name'],'hours':r['hours'],'event':r['event'] or '', 'note':r['note'] or '', 'status':r['status'],'submittedBy':r['submitted_by'],'createdAt':time(r['created_at']),'reviewedAt':time(r['reviewed_at']),'reviewer':r['reviewer'],'attachments':by_record[r['id']]})
for r in apps:
 add('application','association_applications',r,{**{k:v for k,v in r.items() if k not in ('id','created_at','contacted')},'contacted':bool(r['contacted']),'createdAt':time(r['created_at'])})
for r in surveys:
 add('survey','association_surveys',r,{**{k:v for k,v in r.items() if k not in ('id','created_at')},'createdAt':time(r['created_at']),'suggestion':''})
for r in names:add('name-submission','name_submissions',r,{'name':r['name'],'createdAt':time(r['created_at'])})
def normalized(kind,r):
 if kind=='volunteer':return {'name':r['name'],'hours':r['hours'],'event':r['event'] or '', 'note':r['note'] or '', 'status':r['status'],'submittedBy':r['submitted_by'],'createdAt':time(r['created_at']),'reviewedAt':time(r['reviewed_at']),'reviewer':r['reviewer']}
 if kind=='application':return {**{k:v for k,v in r.items() if k not in ('id','created_at','contacted')},'contacted':bool(r['contacted']),'createdAt':time(r['created_at'])}
 if kind=='survey':return {**{k:v for k,v in r.items() if k not in ('id','created_at')},'createdAt':time(r['created_at']),'suggestion':''}
 return {'name':r['name'],'createdAt':time(r['created_at'])}
def untouched(kind,current):
 original=current.get('legacy',{}).get('original');
 if not original:return False
 baseline=normalized(kind,original)
 return all(current.get(k)==v for k,v in baseline.items()) and not any(k not in baseline and k not in ('attachments','legacy') for k in current)
db=sqlite3.connect(root/'workbench.sqlite',timeout=30)
existing={id:(kind,json.loads(data)) for id,kind,data in db.execute('select id,kind,data from entries')};new=[e for e in entries if e[0] not in existing]
updates=[];deletes=[];conflicts=[];incoming_ids={id for id,_,_ in entries};tables={'records','association_applications','association_surveys','name_submissions'}
if args.sync_source:
 for id,kind,data in entries:
  if id not in existing:continue
  current_kind,current=existing[id]
  assert current_kind==kind and current.get('legacy',{}).get('source')==source,'Source ID conflict'
  same=current.get('legacy',{}).get('original')==data['legacy']['original'] and current.get('attachments',[])==data.get('attachments',[])
  if same:continue
  if untouched(kind,current):updates.append((id,kind,data))
  else:conflicts.append({'id':id,'kind':kind,'action':'update'})
 for id,(kind,current) in existing.items():
  legacy=current.get('legacy',{})
  if id.startswith('legacy:association:') and legacy.get('source')==source and legacy.get('table') in tables and id not in incoming_ids:
   if untouched(kind,current):deletes.append((id,kind,current))
   else:conflicts.append({'id':id,'kind':kind,'action':'delete'})
report={'source':archive.name,'counts':dict(collections.Counter(kind for _,kind,_ in entries)),'new':dict(collections.Counter(kind for _,kind,_ in new)),'updates':dict(collections.Counter(kind for _,kind,_ in updates)),'removedFromNewSource':dict(collections.Counter(kind for _,kind,_ in deletes)),'conflicts':conflicts,'skippedExisting':len(entries)-len(new)-len(updates),'approvedRecords':sum(r['status']=='approved' for r in records),'approvedHours':sum(r['hours'] for r in records if r['status']=='approved'),'rejectedRecords':sum(r['status']=='rejected' for r in records),'attachmentLinks':sum(map(len,by_record.values())),'uniqueImageFiles':len(files),'orphanAttachmentIndexesArchived':len(orphans),'blankEventNamesPreserved':sum(not r['event'] for r in records),'applied':False}
if args.apply:
 assert not conflicts,'Resolve local-edit conflicts before applying'
 backup=root/'backups'/('before-legacy-import-'+stamp);backup.mkdir(parents=True)
 target=sqlite3.connect(backup/'workbench.sqlite');db.backup(target);target.close()
 if (root/'photos').exists():shutil.copytree(root/'photos',backup/'photos')
 report['backup']=str(backup)
 # Files are copied first; rollback cannot leave database pointers to missing files.
 folder=root/'photos'/'attachments';folder.mkdir(parents=True,exist_ok=True)
 for key,(body,mime) in files.items():
  file=root/'photos'/key
  if file.exists():assert file.read_bytes()==body,'Existing attachment content conflict'
  else:file.write_bytes(body)
  meta=file.with_name(file.name+'.json');metadata=json.dumps({'contentType':mime})
  if meta.exists():assert json.loads(meta.read_text())['contentType']==mime,'Attachment MIME conflict'
  else:meta.write_text(metadata)
 raw=root/'imports'/('association-'+stamp);raw.mkdir(parents=True)
 for table in ['records','association_applications','association_surveys','name_submissions','record_attachments']:(raw/(table+'.json')).write_bytes(z.read(prefix+json_dir+table+'.json'))
 db.execute('BEGIN IMMEDIATE')
 try:
  for id,kind,data in new:db.execute('insert into entries(id,kind,data) values(?,?,?)',(id,kind,json.dumps(data,ensure_ascii=False)))
  for id,kind,data in updates:db.execute('update entries set data=?,revision=revision+1 where id=?',(json.dumps(data,ensure_ascii=False),id))
  for id,kind,data in deletes:db.execute('delete from entries where id=?',(id,))
  db.execute('insert into entries(id,kind,data) values(?,?,?)',('legacy-import:'+stamp,'audit',json.dumps({'action':'同步协会历史备份','actor':'数据迁移','createdAt':int(now.timestamp()*1000),'before':{'updated':[{"id":id,"data":existing[id][1]} for id,_,_ in updates],'deleted':[{"id":id,"data":data} for id,_,data in deletes]},'after':report},ensure_ascii=False)))
  db.commit()
 except:db.rollback();raise
 # Verify every imported row or previously imported row still exists, preserving user edits on repeat imports.
 for id,kind,data in new+updates:assert json.loads(db.execute('select data from entries where id=?',(id,)).fetchone()[0])==data
 report['applied']=True;(raw/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
db.close();print(json.dumps(report,ensure_ascii=False,indent=2))
