import path from 'node:path';
import crypto from 'node:crypto';
import {mkdir,writeFile,readFile,rm} from 'node:fs/promises';
const MAX_BYTES=20*1024*1024,RETENTION=7*86400000,LEASE=60000;
const INPUT_EXT=new Set(['.docx','.xlsx','.pptx','.pdf','.txt','.md','.csv','.tsv','.json','.png','.jpg','.jpeg','.webp']);
const OUTPUT_EXT=new Set([...INPUT_EXT,'.zip']);
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status})};
const json=(value,status=200,headers={})=>Response.json(value,{status,headers:{'Cache-Control':'no-store',...headers}});
const safeName=name=>path.basename(String(name).replaceAll('\\','/')).replace(/[\x00-\x1f\x7f]/g,'').slice(0,150);
const uuid=s=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s));
export function createFileJobs({sqlite,dataDir,workerToken=process.env.FILE_WORKER_TOKEN||'',clock=Date.now}){
 const root=path.join(dataDir,'file-tasks');let lastCleanup=0;
 const all=kind=>sqlite.prepare('SELECT id,data,revision FROM entries WHERE kind=?').all(kind).map(r=>({...JSON.parse(r.data),id:r.id,revision:r.revision}));
 const get=id=>{const r=sqlite.prepare('SELECT data,revision FROM entries WHERE id=? AND kind=?').get(id,'file-job');return r?{...JSON.parse(r.data),id,revision:r.revision}:null};
 const put=(job,insert=false)=>{const{id,revision,...data}=job;const s=JSON.stringify(data);if(insert)sqlite.prepare('INSERT INTO entries(id,kind,data) VALUES(?,?,?)').run(id,'file-job',s);else if(!sqlite.prepare('UPDATE entries SET data=?,revision=revision+1 WHERE id=? AND revision=?').run(s,id,revision).changes)fail('任务已变化，请刷新后重试',409)};
 const directory=job=>path.join(root,job.id);
 const expireLeases=now=>{for(const j of all('file-job'))if(j.status==='running'&&j.leaseUntil<now){put({...j,status:j.attempts>=2?'failed':'queued',stage:'queued',leaseToken:null,worker:null,updatedAt:now,error:j.attempts>=2?'处理端连接中断，请重试任务':'',message:j.attempts>=2?'处理未完成':'处理端连接中断，等待重新领取'})}};
 const cleanup=async now=>{if(now-lastCleanup<3600000)return;lastCleanup=now;for(const j of all('file-job'))if(now-j.createdAt>30*86400000){sqlite.prepare('DELETE FROM entries WHERE id=? AND kind=?').run(j.id,'file-job');await rm(directory(j),{recursive:true,force:true})}else if(j.expiresAt<now&&j.status!=='expired'){
  put({...j,status:'expired',leaseToken:null,outputs:[],updatedAt:now,message:'文件已到保存期限'});await rm(directory(j),{recursive:true,force:true});
 }};
 const owner=request=>{const value=request.headers.get('cookie')?.match(/(?:^|;\s*)elite_files=([A-Za-z0-9_-]{43})(?:;|$)/)?.[1];return value?digest(value):null};
 const publicJob=j=>({id:j.id,status:j.status,stage:j.stage,createdAt:j.createdAt,updatedAt:j.updatedAt,expiresAt:j.expiresAt,startedAt:j.startedAt,attempts:j.attempts,requirements:j.requirements,message:j.message,error:j.error||'',inputs:j.inputs.map(({id,name,size})=>({id,name,size})),outputs:(j.outputs||[]).map(({id,name,size})=>({id,name,size}))});
 const workerAuth=request=>{if(!workerToken||!crypto.timingSafeEqual(Buffer.from(digest(request.headers.get('authorization')||'')),Buffer.from(digest('Bearer '+workerToken))))fail('处理端认证失败',403)};
 const boundJob=(request,id)=>{const j=get(id);if(!j||j.owner!==owner(request))fail('任务不存在或无权访问',404);return j};
 const current=(id,b)=>{const j=get(id);if(!j||j.status!=='running'||j.leaseToken!==b.leaseToken||j.leaseUntil<clock())fail('任务已取消或领取凭证已过期',409);return j};
 const readJson=async request=>{try{return await request.json()}catch{fail('请求格式错误')}};
 return async function handleFileJobs(request){
  const url=new URL(request.url),route=url.pathname.replace(/^\/api\/files/,'');const now=clock();
  try{
   if(!url.pathname.startsWith('/api/files/'))return null;
   if(!['GET','POST'].includes(request.method))fail('请求方法不支持',405);
   if(request.method==='POST'){const origin=request.headers.get('origin');if(origin&&origin!==url.origin)fail('请求来源不匹配',403)}
   expireLeases(now);await cleanup(now);
   if(route.startsWith('/worker/')){
    workerAuth(request);
    if(request.method!=='POST'&&!route.match(/^\/worker\/input\//))fail('请求方法不支持',405);
    if(route==='/worker/heartbeat'||route==='/worker/claim'){
     const b=await readJson(request);const status={lastSeen:now};sqlite.prepare("INSERT INTO entries(id,kind,data) VALUES('file-worker','file-worker',?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,revision=entries.revision+1").run(JSON.stringify(status));
     if(route==='/worker/heartbeat'){
      if(b.jobId){const j=get(b.jobId);if(!j||j.status!=='running'||j.leaseToken!==b.leaseToken||j.leaseUntil<now)return json({ok:true,stop:true});const stage=['preparing','extracting','processing','recovering','rendering','validating','uploading'].includes(b.stage)?b.stage:j.stage;put({...j,leaseUntil:now+LEASE,updatedAt:now,stage,message:{preparing:'正在准备文件',extracting:'正在读取文件内容',processing:'AI 正在生成修改清单',recovering:'连接中断，正在恢复当前阶段',rendering:'正在生成结果文件',validating:'正在校验结果文件',uploading:'正在回传处理结果'}[stage]||j.message})}
      return json({ok:true,stop:false});
     }
     if(all('file-job').some(j=>j.status==='running'))return json({job:null});
     const j=all('file-job').filter(j=>j.status==='queued').sort((a,b)=>a.createdAt-b.createdAt)[0];if(!j)return json({job:null});
     const next={...j,status:'running',stage:'preparing',message:'正在准备文件',attempts:j.attempts+1,startedAt:now,updatedAt:now,leaseUntil:now+LEASE,leaseToken:crypto.randomBytes(24).toString('hex')};put(next);
     return json({job:{id:j.id,requirements:j.requirements,inputs:j.inputs,leaseToken:next.leaseToken}});
    }
    const input=route.match(/^\/worker\/input\/(file-[0-9a-f]{40})\/([0-9a-f-]+)$/);
    if(input){if(request.method!=='GET')fail('请求方法不支持',405);const j=current(input[1],{leaseToken:request.headers.get('x-file-lease')});const f=j.inputs.find(f=>f.id===input[2]);if(!f)fail('文件不存在',404);return new Response(await readFile(path.join(directory(j),'input',f.disk)),{headers:{'Content-Type':'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}})}
    if(route==='/worker/fail'){
     const b=await readJson(request),j=current(b.jobId,b);put({...j,status:'failed',stage:'failed',leaseToken:null,updatedAt:now,error:({connection:'模型或网络连接中断，已保存的阶段会在重试时复用。',model:'AI未能完成当前阶段，请重试或调整要求。',validation:'结果校验未通过，请调整要求后重试。',internal:'文件处理发生异常，请稍后重试。'})[b.code]||'文件处理未完成，请重试或调整要求。',errorCode:['connection','model','validation','internal'].includes(b.code)?b.code:'unknown',message:'处理失败'});return json({ok:true});
    }
    if(route==='/worker/complete'){
     const form=await request.formData();const existing=get(String(form.get('jobId')));if(existing?.status==='completed'&&existing.completionLeaseDigest===digest(String(form.get('leaseToken'))))return json({ok:true,files:existing.outputs.map(({id,sha256})=>({id,sha256}))});const j=current(String(form.get('jobId')),{leaseToken:form.get('leaseToken')});const files=form.getAll('files');if(!files.length||files.length>10)fail('结果文件数量不正确');
     let total=0;const outputs=[];const out=path.join(directory(j),'output',crypto.randomUUID());await mkdir(out,{recursive:true,mode:0o700});
     try{for(const f of files){if(typeof f==='string')fail('结果文件格式错误');total+=f.size;const name=safeName(f.name);if(!name||!OUTPUT_EXT.has(path.extname(name).toLowerCase())||total>MAX_BYTES||!f.size)fail('结果文件格式或大小不符合要求');const bytes=Buffer.from(await f.arrayBuffer()),id=crypto.randomUUID(),disk=path.join(path.basename(out),id+path.extname(name).toLowerCase());await writeFile(path.join(directory(j),'output',disk),bytes,{flag:'wx',mode:0o600});outputs.push({id,name,disk,size:bytes.length,sha256:digest(bytes)})}
      const latest=current(j.id,{leaseToken:form.get('leaseToken')});put({...latest,status:'completed',stage:'completed',message:'处理完成，可下载结果',outputs,completionLeaseDigest:digest(String(form.get('leaseToken'))),leaseToken:null,updatedAt:clock()});return json({ok:true,files:outputs.map(({id,sha256})=>({id,sha256}))});
     }catch(e){await rm(out,{recursive:true,force:true});throw e}
    }
    fail('接口不存在',404);
   }
   if(route==='/session'&&request.method==='POST'){
    let raw=request.headers.get('cookie')?.match(/(?:^|;\s*)elite_files=([A-Za-z0-9_-]{43})(?:;|$)/)?.[1]||crypto.randomBytes(32).toString('base64url');return json({ok:true},200,{'Set-Cookie':`elite_files=${raw}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${url.protocol==='https:'?'; Secure':''}`});
   }
   const own=owner(request);if(!own)fail('请刷新页面后重试',401);
   if(route==='/jobs'&&request.method==='GET'){
    const list=all('file-job').filter(j=>j.owner===own).sort((a,b)=>b.createdAt-a.createdAt).slice(0,50);const worker=all('file-worker')[0];return json({jobs:list.map(publicJob),workerOnline:!!workerToken&&!!worker&&now-worker.lastSeen<45000,enabled:!!workerToken,maxBytes:MAX_BYTES,maxFiles:5});
   }
   if(route==='/jobs'&&request.method==='POST'){
    if(!workerToken)fail('文件处理服务尚未配置，请稍后再试',503);
    const form=await request.formData();const submission=String(form.get('submissionId'));if(!uuid(submission))fail('提交标识无效，请刷新后重试');const id='file-'+digest(own+submission).slice(0,40);
    const existing=get(id);if(existing)return json({job:publicJob(existing)},200);
    const requirements=String(form.get('requirements')||'').trim();if(requirements.length<2||requirements.length>4000)fail('请填写2至4000字的处理要求');const files=form.getAll('files');if(!files.length||files.length>5)fail('请上传1至5个文件');
    const jobs=all('file-job'),mine=jobs.filter(j=>j.owner===own);if(mine.filter(j=>['queued','running'].includes(j.status)).length>=3)fail('你已有3个待处理任务，请等待完成后再提交',429);
    if(mine.filter(j=>now-j.createdAt<86400000).length>=5)fail('每个浏览器24小时内可提交5个任务，请稍后再试',429);
    const ip=digest(request.headers.get('x-real-ip')||'local');if(jobs.filter(j=>j.ip===ip&&now-j.createdAt<86400000).length>=20)fail('当前网络提交较多，请稍后再试',429);
    if(jobs.filter(j=>['queued','running'].includes(j.status)).length>=30)fail('当前任务较多，请稍后再提交',429);
    let total=0;const inputs=[];for(const f of files){if(typeof f==='string')fail('文件格式错误');const name=safeName(f.name),ext=path.extname(name).toLowerCase();if(!name||!INPUT_EXT.has(ext)||!f.size)fail('请上传支持的非空文件');total+=f.size;if(total>MAX_BYTES)fail('每个任务文件合计不能超过20 MB');inputs.push({id:crypto.randomUUID(),name,size:f.size,ext,file:f})}
    const dir=path.join(root,id,'input');await mkdir(dir,{recursive:true,mode:0o700});const stored=[];
    try{for(const input of inputs){const{file,ext,...meta}=input;const bytes=Buffer.from(await file.arrayBuffer()),disk=meta.id+ext;await writeFile(path.join(dir,disk),bytes,{flag:'wx',mode:0o600});stored.push({...meta,disk,sha256:digest(bytes)})}
     // Re-check after file I/O, so concurrent submissions cannot bypass quotas or overwrite the same task.
     const duplicate=get(id);if(duplicate)return json({job:publicJob(duplicate)});
     if(all('file-job').filter(j=>j.owner===own&&['queued','running'].includes(j.status)).length>=3)fail('你已有3个待处理任务，请等待完成后再提交',429);
     const fresh=all('file-job');if(fresh.filter(j=>j.owner===own&&now-j.createdAt<86400000).length>=5)fail('每个浏览器24小时内可提交5个任务，请稍后再试',429);if(fresh.filter(j=>j.ip===ip&&now-j.createdAt<86400000).length>=20)fail('当前网络提交较多，请稍后再试',429);if(fresh.filter(j=>['queued','running'].includes(j.status)).length>=30)fail('当前任务较多，请稍后再提交',429);
     const j={id,owner:own,ip,requirements,inputs:stored,outputs:[],status:'queued',stage:'queued',message:'等待处理',createdAt:now,updatedAt:now,expiresAt:now+RETENTION,attempts:0};put(j,true);return json({job:publicJob(j)},201);
    }catch(e){if(!get(id))await rm(path.join(root,id),{recursive:true,force:true});throw e}
   }
   const match=route.match(/^\/jobs\/(file-[0-9a-f]{40})(?:\/(cancel|retry|download)(?:\/([0-9a-f-]+))?)?$/);
   if(match){const j=boundJob(request,match[1]),action=match[2];
    if(!action&&request.method==='GET')return json({job:publicJob(j)});
    if(action==='cancel'&&request.method==='POST'){if(['queued','running'].includes(j.status))put({...j,status:'cancelled',stage:'cancelled',leaseToken:null,updatedAt:now,message:'任务已取消'});return json({ok:true})}
    if(action==='retry'&&request.method==='POST'){if(!['failed','cancelled'].includes(j.status)||j.expiresAt<now)fail('当前任务不可重试');if(all('file-job').filter(x=>x.owner===own&&['queued','running'].includes(x.status)).length>=3)fail('请等待其他任务完成后重试',429);if(j.attempts>=4)fail('该任务已多次处理失败，请调整要求后新建任务');put({...j,status:'queued',stage:'queued',leaseToken:null,updatedAt:now,error:'',message:'等待重新处理'});return json({ok:true})}
    if(action==='download'&&request.method==='GET'){if(j.status!=='completed')fail('任务尚未完成或文件已过期',410);const f=j.outputs.find(f=>f.id===match[3]);if(!f)fail('文件不存在',404);return new Response(await readFile(path.join(directory(j),'output',f.disk)),{headers:{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="result${path.extname(f.name)}"; filename*=UTF-8''${encodeURIComponent(f.name)}`,'X-Content-Type-Options':'nosniff','Cache-Control':'private, no-store','Content-Security-Policy':"sandbox; default-src 'none'"}})}
   }
   fail('接口不存在',404);
  }catch(e){if(e.status)return json({error:e.message},e.status);console.error('[文件任务]',e.code||e.name);return json({error:'文件服务暂时不可用，请稍后重试'},500)}
 };
}
