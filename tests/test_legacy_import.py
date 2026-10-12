import unittest,tempfile,pathlib,sqlite3,json,zipfile,subprocess,sys
SCRIPT=pathlib.Path(__file__).resolve().parents[1]/'scripts/import-legacy.py'
class SyncTest(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.root=pathlib.Path(self.tmp.name);self.data=self.root/'data';self.data.mkdir();db=sqlite3.connect(self.data/'workbench.sqlite');db.execute('create table entries(id text primary key,kind text,data text,revision integer default 1)');db.execute('insert into entries(id,kind,data) values(?,?,?)',('native','volunteer',json.dumps({'name':'当前成员','hours':5})));db.commit();db.close()
 def tearDown(self):self.tmp.cleanup()
 def archive(self,filename,ids,contacted=0,prefix=''):
  rows=[{'id':id,'name':'历史成员','hours':hours,'note':'服务','event':'活动','status':'approved','submitted_by':'','created_at':'2026-09-14T10:00:00Z','reviewed_at':None,'reviewer':None} for id,hours in ids]
  tables={'records':rows,'association_applications':[{'id':1,'name':'报名者','contacted':contacted,'created_at':'2026-09-14T10:00:00Z'}],'association_surveys':[],'name_submissions':[],'record_attachments':[]}
  source=self.root/(filename+'.db');db=sqlite3.connect(source)
  for table,values in tables.items():
   if values:
    columns=list(values[0]);db.execute('create table '+table+'('+','.join('"'+k+'"' for k in columns)+')');db.executemany('insert into '+table+' values('+','.join('?' for _ in columns)+')',[[r[k] for k in columns] for r in values])
   else:db.execute('create table '+table+'(id integer)')
  db.commit();db.close();file=self.root/(filename+'.zip')
  with zipfile.ZipFile(file,'w') as z:
   z.write(source,prefix+'data/volunteer-hours.db')
   for table,values in tables.items():z.writestr(prefix+('records-json/' if prefix else 'raw-json/')+table+'.json',json.dumps(values))
  return file
 def run_import(self,file,*flags):return subprocess.run([sys.executable,str(SCRIPT),str(file),'--data-dir',str(self.data),*flags],capture_output=True,text=True)
 def rows(self):
  db=sqlite3.connect(self.data/'workbench.sqlite');rows={id:json.loads(data) for id,data in db.execute('select id,data from entries')};db.close();return rows
 def test_authoritative_update_remove_and_repeat(self):
  old=self.archive('old',[(1,3),(2,2)]);new=self.archive('new',[(1,4),(3,6)],1,'nested/')
  self.assertEqual(self.run_import(old,'--apply').returncode,0)
  r=self.run_import(new,'--sync-source','--apply');self.assertEqual(r.returncode,0,r.stderr);report=json.loads(r.stdout);self.assertEqual(report['new']['volunteer'],1);self.assertEqual(report['updates']['volunteer'],1);self.assertEqual(report['updates']['application'],1);self.assertEqual(report['removedFromNewSource']['volunteer'],1)
  rows=self.rows();self.assertEqual(rows['native']['hours'],5);self.assertEqual(rows['legacy:association:records:1']['hours'],4);self.assertNotIn('legacy:association:records:2',rows)
  repeat=json.loads(self.run_import(new,'--sync-source').stdout);self.assertEqual(repeat['new'],{});self.assertEqual(repeat['updates'],{});self.assertEqual(repeat['removedFromNewSource'],{})
 def test_local_edits_block_changed_source_and_deletion(self):
  old=self.archive('old',[(1,3),(2,2)]);new=self.archive('new',[(1,4)])
  self.assertEqual(self.run_import(old,'--apply').returncode,0)
  db=sqlite3.connect(self.data/'workbench.sqlite')
  for id in [1,2]:
   key='legacy:association:records:'+str(id);row=json.loads(db.execute('select data from entries where id=?',(key,)).fetchone()[0]);row['hours']=9;db.execute('update entries set data=? where id=?',(json.dumps(row),key))
  db.commit();db.close();before=self.rows();dry=json.loads(self.run_import(new,'--sync-source').stdout);self.assertEqual(len(dry['conflicts']),2);r=self.run_import(new,'--sync-source','--apply');self.assertNotEqual(r.returncode,0);self.assertEqual(before,self.rows())
if __name__=='__main__':unittest.main()
