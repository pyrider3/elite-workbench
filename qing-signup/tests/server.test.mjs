
process.env.INITIAL_PASSWORD_SUPERADMIN='test-superadmin-only';
process.env.INITIAL_PASSWORD_VIEWER='test-viewer-only';
process.env.INITIAL_PASSWORD_OFFICE='test-office-only';
process.env.INITIAL_PASSWORD_MEDIA='test-media-only';
process.env.INITIAL_PASSWORD_PROJECT='test-project-only';
process.env.INITIAL_PASSWORD_PRACTICE='test-practice-only';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createApp} from '../../server.mjs';
import {createSignupServer} from '../server.mjs';

test('报名页提交到工作台、字段校验、同源防护和管理员接口隔离',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'qing-signup-test-'));
 const app=await createApp({dataDir:dir,sync:false,publicUrl:'https://dj.qnjyxh.xyz'});
 let signup;
 try{
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
  signup=createSignupServer({upstream:'http://127.0.0.1:'+app.server.address().port});
  await new Promise(r=>signup.listen(0,'127.0.0.1',r));
  const base='http://127.0.0.1:'+signup.address().port;
  const submit=(body,origin='https://new.qnjyxh.xyz')=>fetch(base+'/api/applications',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify(body)});
  assert.match(await(await fetch(base+'/')).text(),/小菁/);
  assert.match(await(await fetch(base+'/biao')).text(),/signup/);
  assert.equal((await fetch(base+'/qing.js')).status,200);
  assert.equal((await fetch(base+'/api/admin/data')).status,404);
  assert.equal((await submit({})).status,400);
  const record={name:'迁移验证',grade:'大一',college:'测试学院',department:'办公室',other_department:'新媒体',introduction:'验证完整报名链路',contact:'test-only',note:'临时库'};
  assert.equal((await submit(record,'https://other.invalid')).status,403);
  const response=await submit(record);assert.equal(response.status,201);
  const result=await response.json();assert.equal(result.ok,true);
  const row=app.storage.sqlite.prepare("SELECT data FROM entries WHERE id=? AND kind='application'").get(result.id);
  assert.equal(JSON.parse(row.data).contact,record.contact);
  assert.equal(JSON.parse(row.data).other_department,'新媒体');
  assert.equal(app.storage.sqlite.prepare("SELECT COUNT(*) AS n FROM entries WHERE kind='application'").get().n,1);
 }finally{
  if(signup)await new Promise(r=>signup.close(r));
  await app.close();await rm(dir,{recursive:true,force:true});
 }
});
