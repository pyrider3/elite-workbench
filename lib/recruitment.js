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
async function recruitmentInner({path,b,url,s,now,requireP,audit}){
 const response=(x)=>Response.json(x,{headers:{'Cache-Control':'no-store'}});
 const publicMatch=path.match(/^\/forms\/([a-e])$/);
 if(publicMatch){const slot=publicMatch[1],route=await s.get('recruit-route:'+slot);if(!route?.versionId)return response({slot,state:'unpublished'});const version=await s.get(route.versionId);if(!isOpen(route,now))return response({slot,state:!route.enabled?'paused':route.opensAt&&now<route.opensAt?'scheduled':'closed',opensAt:route.opensAt,closesAt:route.closesAt,serverTime:now,title:version?.title});const count=(await s.all('recruit-response')).filter(r=>r.slot===slot&&r.versionId===route.versionId).length;if(route.maxResponses&&count>=route.maxResponses)return response({slot,state:'full',title:version?.title});return response({slot,state:'open',form:version})}
 if(path==='/forms/submit'){
  if(!/^[a-e]$/.test(b.slot))fail('入口无效');const route=await s.get('recruit-route:'+b.slot);if(!isOpen(route,now))fail('当前表单未开放',409);if(b.versionId!==route.versionId)fail('表单已更新，请刷新后重新填写',409);const version=await s.get(route.versionId);const answers=validateAnswers(version,b.answers);if(!/^[a-f0-9-]{36}$/i.test(String(b.submissionId||'')))fail('提交标识无效');const id='recruit-response:'+b.submissionId;const previous=await s.get(id);if(previous){if(previous.versionId!==version.id)fail('提交标识冲突',409);return response({ok:true,id})}if(route.maxResponses&&(await s.all('recruit-response')).filter(r=>r.slot===b.slot&&r.versionId===route.versionId).length>=route.maxResponses)fail('名额已满，当前表单已停止收取',409);await s.insert('recruit-response',{slot:b.slot,formId:version.formId,versionId:version.id,formTitle:version.title,fields:version.fields,answers,createdAt:now},id);return response({ok:true,id});
 }
 if(!path.startsWith('/admin/recruit/'))return null;requireP('recruit');
 if(path==='/admin/recruit/data')return response({forms:await s.all('recruit-form'),routes:await s.all('recruit-route'),versions:await s.all('recruit-version'),responses:await s.all('recruit-response')});
 if(path==='/admin/recruit/save'){const form=validateForm(b),prev=b.id?await s.get(b.id):null;if(b.id&&(!prev||!b.id.startsWith('recruit-form:')))fail('表单不存在');if(prev){await s.save('recruit-form',{...form,_rev:b._rev,updatedAt:now},prev.id);await audit('修改招募表单',prev.id,null,{title:form.title});return response({ok:true,id:prev.id})}const id=await s.insert('recruit-form',{...form,updatedAt:now},'recruit-form:'+crypto.randomUUID());await audit('创建招募表单',id,null,{title:form.title});return response({ok:true,id})}
 if(path==='/admin/recruit/publish'){if(!/^[a-e]$/.test(b.slot))fail('请选择发布入口');const form=await s.get(b.formId);if(!form||!form.id.startsWith('recruit-form:'))fail('请先保存草稿');const payload=validateForm(form);const versionId=await s.insert('recruit-version',{...payload,formId:form.id,publishedAt:now},'recruit-version:'+crypto.randomUUID());const id='recruit-route:'+b.slot,prev=await s.get(id);await s.save('recruit-route',{slot:b.slot,versionId,enabled:true,opensAt:null,closesAt:null,maxResponses:null},id);await audit('发布招募入口',id,prev,{versionId,title:form.title});return response({ok:true,versionId})}
 if(path==='/admin/recruit/route'){if(!/^[a-e]$/.test(b.slot))fail('入口无效');const id='recruit-route:'+b.slot,prev=await s.get(id);if(!prev)fail('请先发布表单');const opensAt=b.opensAt==null||b.opensAt===''?null:Number(b.opensAt),closesAt=b.closesAt==null||b.closesAt===''?null:Number(b.closesAt);if((opensAt!==null&&!Number.isFinite(opensAt))||(closesAt!==null&&!Number.isFinite(closesAt))||(opensAt&&closesAt&&opensAt>=closesAt))fail('开放时间无效');const maxResponses=b.maxResponses==null||b.maxResponses===''?null:Number(b.maxResponses);if(maxResponses!==null&&(!Number.isInteger(maxResponses)||maxResponses<1||maxResponses>100000))fail('收取上限须为1至100000的整数，留空不限');const next={...prev,_rev:b._rev,enabled:!!b.enabled,opensAt,closesAt,maxResponses};await s.save('recruit-route',next,id);await audit('调整招募入口状态',id,prev,next);return response({ok:true})}
 fail('接口不存在',404);
}

// Serialize each entrance's submissions, including overlapping requests at the last place.
const submissionLocks=new Map();
export async function recruitment(options){
 if(options.path!=='/forms/submit')return recruitmentInner(options);
 const slot=options.b.slot;const previous=submissionLocks.get(slot)||Promise.resolve();let release;const done=new Promise(resolve=>{release=resolve});submissionLocks.set(slot,done);await previous;
 try{return await recruitmentInner(options)}finally{release();if(submissionLocks.get(slot)===done)submissionLocks.delete(slot)}
}
