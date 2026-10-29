const TYPES=['text','textarea','number','phone','email','radio','checkbox','select'];
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status})};
const text=(v,max)=>String(v??'').trim().slice(0,max);
export function validateForm(value){
 const title=text(value.title,100),description=text(value.description,2000);if(!title)fail('请填写表单标题');
 if(!Array.isArray(value.fields)||!value.fields.length||value.fields.length>40)fail('请添加1至40个字段');const ids=new Set();
 const fields=value.fields.map(f=>{const id=text(f.id,80),label=text(f.label,100),type=f.type;if(!/^[a-zA-Z0-9_-]+$/.test(id)||ids.has(id)||!label||!TYPES.includes(type))fail('字段名称、类型或标识无效');ids.add(id);const options=Array.isArray(f.options)?[...new Set(f.options.map(x=>text(x,100)).filter(Boolean))]:[];if(['radio','checkbox','select'].includes(type)&&(!options.length||options.length>40))fail('选择题请填写1至40个选项');return{id,label,type,required:!!f.required,options:['radio','checkbox','select'].includes(type)?options:[]}});return{title,description,fields};
}
export function validateAnswers(form,answers){
 if(!answers||typeof answers!=='object'||Array.isArray(answers))fail('填写内容无效');const out={};
 for(const f of form.fields){let v=answers[f.id];if(f.type==='checkbox'){if(v==null)v=[];if(!Array.isArray(v)||v.some(x=>!f.options.includes(x)))fail(f.label+'选项无效');v=[...new Set(v)];if(f.required&&!v.length)fail('请填写'+f.label)}else{if(v==null)v='';if(typeof v!=='string'||v.length>2000)fail(f.label+'内容无效或超过2000字');v=v.trim();if(f.required&&!v)fail('请填写'+f.label);if(v&&['radio','select'].includes(f.type)&&!f.options.includes(v))fail(f.label+'选项无效');if(v&&f.type==='number'&&!Number.isFinite(Number(v)))fail(f.label+'请填写数字');if(v&&f.type==='email'&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))fail(f.label+'邮箱无效');if(v&&f.type==='phone'&&!/^\+?[\d ()-]{6,25}$/.test(v))fail(f.label+'电话号码无效')}out[f.id]=v;
 }return out;
}
export const isOpen=(route,now)=>route?.enabled&&(!route.opensAt||now>=route.opensAt)&&(!route.closesAt||now<route.closesAt);
export function entranceSlug(value){const slug=String(value??'').normalize('NFKC').trim().toLowerCase();if(!/^[\p{L}\p{N}][\p{L}\p{N}_-]{0,59}$/u.test(slug)||slug==='submit')fail('链接后缀须为1至60个文字、字母、数字、短横线或下划线，且不能使用 submit');return slug}
const randomSlug=()=>crypto.randomUUID().replaceAll('-','').slice(0,16);
export async function migrateRecruitRoutes(s,now=Date.now()){
 if(await s.get('recruit-dynamic-entrances-v1'))return;
 for(const route of await s.all('recruit-route'))if(!route.slug){const version=route.versionId?await s.get(route.versionId):null;await s.save('recruit-route',{...route,name:version?.title||'报名入口',slug:randomSlug(),createdAt:route.createdAt||now},route.id)}
 await s.insert('meta',{migratedAt:now},'recruit-dynamic-entrances-v1');
}
async function recruitmentInner({path,b,url,s,now,requireP,audit}){
 const response=(x)=>Response.json(x,{headers:{'Cache-Control':'no-store'}});
 if(path.startsWith('/forms/')||path.startsWith('/admin/recruit/'))await migrateRecruitRoutes(s,now);
 const publicMatch=path!=='/forms/submit'&&path.match(/^\/forms\/([^/]+)$/);
 if(publicMatch){let slug;try{slug=entranceSlug(decodeURIComponent(publicMatch[1]))}catch{fail('入口不存在',404)}const route=(await s.all('recruit-route')).find(r=>r.slug===slug&&!r.archived);if(!route)fail('入口不存在',404);const slot=route.slot;if(!route.versionId)return response({slot,state:'unpublished',title:route.name});const version=await s.get(route.versionId);if(!isOpen(route,now))return response({slot,state:!route.enabled?'paused':route.opensAt&&now<route.opensAt?'scheduled':'closed',opensAt:route.opensAt,closesAt:route.closesAt,serverTime:now,title:version?.title});const count=(await s.all('recruit-response')).filter(r=>r.slot===slot&&r.versionId===route.versionId).length;if(route.maxResponses&&count>=route.maxResponses)return response({slot,state:'full',title:version?.title});return response({slot,state:'open',entryName:route.name,form:version})}
 if(path==='/forms/submit'){
  if(!/^[a-zA-Z0-9_-]{1,80}$/.test(String(b.slot||'')))fail('入口无效');const route=await s.get('recruit-route:'+b.slot);if(!route?.versionId||route.archived||!isOpen(route,now))fail('当前表单未开放',409);if(b.versionId!==route.versionId)fail('表单已更新，请刷新后重新填写',409);const version=await s.get(route.versionId);const answers=validateAnswers(version,b.answers);if(!/^[a-f0-9-]{36}$/i.test(String(b.submissionId||'')))fail('提交标识无效');const id='recruit-response:'+b.submissionId;const previous=await s.get(id);if(previous){if(previous.versionId!==version.id)fail('提交标识冲突',409);return response({ok:true,id})}if(route.maxResponses&&(await s.all('recruit-response')).filter(r=>r.slot===b.slot&&r.versionId===route.versionId).length>=route.maxResponses)fail('名额已满，当前表单已停止收取',409);await s.insert('recruit-response',{slot:b.slot,entryName:route.name,entryPath:'/baoming/'+encodeURIComponent(route.slug),formId:version.formId,versionId:version.id,formTitle:version.title,fields:version.fields,answers,createdAt:now},id);return response({ok:true,id});
 }
 if(!path.startsWith('/admin/recruit/'))return null;requireP('recruit');
 if(path==='/admin/recruit/data')return response({forms:await s.all('recruit-form'),routes:(await s.all('recruit-route')).filter(r=>!r.archived),versions:await s.all('recruit-version'),responses:await s.all('recruit-response')});
 if(path==='/admin/recruit/save'){const form=validateForm(b),prev=b.id?await s.get(b.id):null;if(b.id&&(!prev||!b.id.startsWith('recruit-form:')))fail('表单不存在');if(prev){await s.save('recruit-form',{...form,_rev:b._rev,updatedAt:now},prev.id);await audit('修改招募表单',prev.id,null,{title:form.title});return response({ok:true,id:prev.id})}const id=await s.insert('recruit-form',{...form,updatedAt:now},'recruit-form:'+crypto.randomUUID());await audit('创建招募表单',id,null,{title:form.title});return response({ok:true,id})}
 if(path==='/admin/recruit/entrance'){
  const name=text(b.name,80);if(!name)fail('请填写入口名称');const slug=b.slug?entranceSlug(b.slug):randomSlug();
  if((await s.all('recruit-route')).some(r=>r.slug===slug))fail('这个链接已被使用，请换一个',409);
  const slot=crypto.randomUUID(),id='recruit-route:'+slot;await s.insert('recruit-route',{slot,name,slug,versionId:null,enabled:true,opensAt:null,closesAt:null,maxResponses:null,createdAt:now},id);await audit('新增招募入口',id,null,{name,slug});return response({ok:true,slot,slug});
 }
 if(path==='/admin/recruit/publish'){
  const id='recruit-route:'+String(b.slot||''),prev=await s.get(id);if(!prev||prev.archived)fail('请先新增并选择发布入口');const form=await s.get(b.formId);if(!form||!form.id.startsWith('recruit-form:'))fail('请先保存草稿');const payload=validateForm(form);const versionId=await s.insert('recruit-version',{...payload,formId:form.id,publishedAt:now},'recruit-version:'+crypto.randomUUID());await s.save('recruit-route',{...prev,versionId},id);await audit('发布招募入口',id,prev,{versionId,title:form.title});return response({ok:true,versionId});
 }
 if(path==='/admin/recruit/archive'){
  const id='recruit-route:'+String(b.slot||''),prev=await s.get(id);if(!prev||prev.archived)fail('入口不存在',404);await s.save('recruit-route',{...prev,_rev:b._rev,archived:true,enabled:false,archivedAt:now},id);await audit('归档招募入口',id,prev,{name:prev.name,slug:prev.slug});return response({ok:true});
 }
 if(path==='/admin/recruit/route'){
  const id='recruit-route:'+String(b.slot||''),prev=await s.get(id);if(!prev||prev.archived)fail('入口不存在',404);
  const name=b.name===undefined?prev.name:text(b.name,80),slug=b.slug===undefined?prev.slug:entranceSlug(b.slug);if(!name)fail('请填写入口名称');if((await s.all('recruit-route')).some(r=>r.id!==id&&r.slug===slug))fail('这个链接已被使用，请换一个',409);
  const opensAt=b.opensAt==null||b.opensAt===''?null:Number(b.opensAt),closesAt=b.closesAt==null||b.closesAt===''?null:Number(b.closesAt);if((opensAt!==null&&!Number.isFinite(opensAt))||(closesAt!==null&&!Number.isFinite(closesAt))||(opensAt&&closesAt&&opensAt>=closesAt))fail('开放时间无效');const maxResponses=b.maxResponses==null||b.maxResponses===''?null:Number(b.maxResponses);if(maxResponses!==null&&(!Number.isInteger(maxResponses)||maxResponses<1||maxResponses>100000))fail('收取上限须为1至100000的整数，留空不限');const next={...prev,_rev:b._rev,name,slug,enabled:!!b.enabled,opensAt,closesAt,maxResponses};await s.save('recruit-route',next,id);await audit('调整招募入口状态',id,prev,next);return response({ok:true});
 }
 fail('接口不存在',404);
}

// Serialize each entrance's submissions, including overlapping requests at the last place.
const submissionLocks=new Map();
let routeMutation=Promise.resolve();
export async function recruitment(options){
 if(options.path.startsWith('/admin/recruit/')&&options.path!=='/admin/recruit/data'){const previous=routeMutation;let release;routeMutation=new Promise(resolve=>{release=resolve});await previous;try{return await recruitmentInner(options)}finally{release()}}
 if(options.path!=='/forms/submit')return recruitmentInner(options);
 const slot=options.b.slot;const previous=submissionLocks.get(slot)||Promise.resolve();let release;const done=new Promise(resolve=>{release=resolve});submissionLocks.set(slot,done);await previous;
 try{return await recruitmentInner(options)}finally{release();if(submissionLocks.get(slot)===done)submissionLocks.delete(slot)}
}
