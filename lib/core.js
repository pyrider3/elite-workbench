import {latestApplicationIds} from './application-latest.js';
import {synchronizedShift} from './shift-sync.js';
import {namesForWeek,normalizedWeekRules} from './duty-weeks.js';
import {recruitment} from './recruitment.js';
import {validateRecords} from './volunteer-parser.mjs';
import {matchCheckinGroup,isCheckinExpired} from './checkin.js';
import seeds from './seed.json' with {type:'json'};
export const DUTY_START_DATE='2026-10-11';
export const DUTY_END_DATE='2026-12-26'; // Exclusive: no duty starting December 26.
export const SOURCE='https://sxufe.bysjy.com.cn/module/careers?menu_id=13369';
export const dateAt=(now=Date.now())=>new Date(now+28800000).toISOString().slice(0,10);
export const at=(d,t)=>Date.parse(`${d}T${t}:00+08:00`);
const dayAdd=(d,n)=>dateAt(at(d,'00:00')+n*86400000);
const j=(x,status=200,headers={})=>Response.json(x,{status,headers:{'Cache-Control':'no-store',...headers}});
const fail=(m,c=400)=>{throw Object.assign(Error(m),{status:c})};
const clean=(v,max=100)=>String(v??'').trim().slice(0,max);
const uid=()=>crypto.randomUUID();
export function store(db){return {
 async get(id){const r=await db.prepare('SELECT * FROM entries WHERE id=?').bind(id).first();return r?{...JSON.parse(r.data),id:r.id,_rev:r.revision}:null},
 async all(kind){const r=await db.prepare('SELECT * FROM entries WHERE kind=?').bind(kind).all();return r.results.map(x=>({...JSON.parse(x.data),id:x.id,_rev:x.revision}))},
 async insert(kind,data,id=uid()){await db.prepare('INSERT OR IGNORE INTO entries(id,kind,data) VALUES(?,?,?)').bind(id,kind,JSON.stringify(data)).run();return id},
 async save(kind,data,id){const prev=await this.get(id); if(!prev)return this.insert(kind,data,id); const rev=data._rev??prev._rev;const {id:_,_rev:__,...payload}=data; const r=await db.prepare('UPDATE entries SET data=?,revision=revision+1 WHERE id=? AND revision=?').bind(JSON.stringify(payload),id,rev).run();if(!r.meta.changes)fail('数据已被其他操作修改，请刷新后重试',409);return id},
 async remove(id){await db.prepare('DELETE FROM entries WHERE id=?').bind(id).run()}
}}
export async function initialize(s,now){if(await s.get("initialized"))return;if(!process.env.INITIAL_PASSWORD_SUPERADMIN)throw Error("首次启动请设置 INITIAL_PASSWORD_SUPERADMIN");for(const t of seeds)await s.insert('template',t,t.id);await s.insert('settings',{threshold:15,launched:dateAt(now)},'settings');const roles=[['superadmin','超级管理员',null,process.env.INITIAL_PASSWORD_SUPERADMIN||crypto.randomUUID()],['viewer','一般管理员',null,process.env.INITIAL_PASSWORD_VIEWER||crypto.randomUUID()],['office','办公室管理员','办公室',process.env.INITIAL_PASSWORD_OFFICE||crypto.randomUUID()],['media','新媒体管理员','新媒体',process.env.INITIAL_PASSWORD_MEDIA||crypto.randomUUID()],['project','项目部管理员','项目部',process.env.INITIAL_PASSWORD_PROJECT||crypto.randomUUID()],['practice','实践部管理员','实践部',process.env.INITIAL_PASSWORD_PRACTICE||crypto.randomUUID()]];if(process.env.INITIAL_PASSWORD_RECRUIT)roles.push(['recruit','招募管理员',null,process.env.INITIAL_PASSWORD_RECRUIT]);for(const [role,label,department,password]of roles)await s.insert('account',{role,label,department,hash:await hash(password)},'account:'+role);await s.insert('meta',{ready:true},'initialized');}
async function hash(text){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))).map(x=>x.toString(16).padStart(2,'0')).join('')}
async function allShifts(s,now=Date.now()){const deletedAt=new Map();for(const a of await s.all('audit'))if(a.action==='删除固定班次')deletedAt.set(a.target,Math.min(deletedAt.get(a.target)??Infinity,a.createdAt));const plans=new Map((await s.all('day-plan')).map(p=>[p.date,new Set(p.shiftIds)])),templates=new Set((await s.all('template')).map(t=>t.id)),recorded=new Set((await s.all('attendance')).filter(r=>r.checkin||r.override).map(r=>r.shiftId));return (await s.all('shift')).filter(sh=>sh.date<DUTY_END_DATE&&(plans.has(sh.date)?plans.get(sh.date).has(sh.id):!sh.sourceTemplateId)&&!(sh.templateId&&!templates.has(sh.templateId)&&!sh.enabled&&!sh.customized&&(sh.retiredByTemplateDeletion||at(sh.date,sh.start)>now||(deletedAt.get(sh.templateId)??Infinity)<at(sh.date,sh.start))&&!recorded.has(sh.id)))}
export async function materialize(s,day,now=Date.now()){if(day>=DUTY_END_DATE)return [];if(await s.get('day-plan:'+day))return (await allShifts(s,now)).filter(x=>x.date===day);const templates=await s.all('template'),records=await s.all('attendance'),weekday=new Date(day+'T12:00:00+08:00').getUTCDay();for(const t of templates.filter(t=>t.weekday===weekday&&t.enabled)){const id='shift:'+day+':'+t.id,existing=await s.get(id);if(existing){const synced=synchronizedShift(existing,t,records,now);if(synced)await s.save('shift',synced,id)}else await s.insert('shift',{date:day,templateId:t.id,site:t.site,start:t.start,end:t.end,names:namesForWeek(t,day),weekSkipped:t.names.length>0&&!namesForWeek(t,day).length,enabled:true,leaves:[],threshold:(await s.get('settings')).threshold},id)}return (await s.all('shift')).filter(x=>x.date===day)}
export function attendanceState(shift,name,record,now,freshman=false){const start=at(shift.date,shift.start),end=at(shift.date,shift.end);let status=shift.leaves?.includes(name)?'leave':!shift.enabled?'cancelled':record?.checkin?(record.lateForGroup??(record.checkin>start+shift.threshold*60000))?'late':now>=end?'credited':'present':now>start+shift.threshold*60000?'absent':now>=start?'waiting':'upcoming';const creditPerShift=freshman?3:2;let hours=status==='credited'?creditPerShift:0; if(record?.override){status=record.override.status;hours=Number(record.override.hours)||0;}return {id:'attendance:'+shift.id+':'+name,shiftId:shift.id,name,site:shift.site,date:shift.date,start:shift.start,end:shift.end,threshold:shift.threshold,status,freshman,creditPerShift,hours:Math.round(hours*100)/100,checkin:record?.checkin||null,photo:record?.photo||null,reason:record?.override?.reason||'',_rev:record?._rev}}
async function catchup(s,now){const config=await s.get('settings'),today=dateAt(now);let d=[config.lastMaterialized||config.launched,DUTY_START_DATE].sort().at(-1);let count=0;while(d<=today&&d<DUTY_END_DATE&&count++<370){await materialize(s,d,now);d=dayAdd(d,1)}if(config.lastMaterialized!==today)try{await s.save('settings',{...config,lastMaterialized:today},'settings')}catch(e){if(e.status!==409)throw e}}
async function rows(s,now){await catchup(s,now);const shifts=(await allShifts(s,now)).filter(sh=>sh.date>=DUTY_START_DATE),records=await s.all('attendance'),map=new Map(records.map(x=>[x.id,x])),members=new Map((await s.all('member')).map(m=>[m.name,m.freshman]));return shifts.flatMap(sh=>sh.names.map(name=>attendanceState(sh,name,map.get('attendance:'+sh.id+':'+name),now,members.get(name)===true)))}
async function memberList(s){const members=new Map((await s.all('member')).map(m=>[m.name,m]));for(const sh of [...await s.all('template'),...await s.all('shift')])for(const name of sh.names)if(!members.has(name))members.set(name,{name,freshman:false,_rev:0});return [...members.values()].sort((a,b)=>a.name.localeCompare(b.name,'zh-CN'))}
export async function syncCareers(s,now){const list=[];for(let i=0;i<7;i++){const day=dayAdd(dateAt(now),i);let offset=0;for(let page=0;page<10;page++){const r=await fetch(`https://sxufe.bysjy.com.cn/module/getcareers?start=${offset}&count=100&type=inner&day=${day}`,{signal:AbortSignal.timeout(15000)});if(!r.ok)fail('学校宣讲会数据暂时无法访问',502);const b=await r.json();if(Number(b.code)!==1||!Array.isArray(b.data))fail('学校数据格式发生变化',502);for(const x of b.data)if(x.meet_day===day)list.push({id:String(x.career_talk_id),date:x.meet_day,time:x.meet_time,title:x.meet_name||x.company_name,company:x.company_name,location:[x.address,x.room].filter(Boolean).join(' · '),state:String(x.career_state),url:'https://sxufe.bysjy.com.cn/detail/career?id='+encodeURIComponent(x.career_talk_id)});if(b.data.length<100)break;offset+=100;}}
 await s.save('cache',{items:list,updatedAt:now,error:null},'careers');return list;}
function permissions(user){return {recruit:['superadmin','recruit'].includes(user?.role),duty:['superadmin','duty'].includes(user?.role),audit:user?.role==='superadmin',applications:['superadmin','viewer','office','media','project','practice'].includes(user?.role),surveys:['superadmin','office','media','project','practice'].includes(user?.role)}}
async function handleInner(request,env,now=Date.now()) {try{
 const s=store(env.DB),url=new URL(request.url),path=url.pathname.replace(/^\/api/,'');await initialize(s,now);
 const cookie=request.headers.get('cookie')?.match(/(?:^|;\s*)elite_session=([^;]+)/)?.[1];let session=cookie?await s.get('session:'+cookie):null; if(session?.expires<now)session=null;const account=session?await s.get('account:'+session.role):null;const user=account?{role:account.role,label:account.label,department:account.department}:null;const perms=permissions(user);
 const requireP=k=>{if(!perms[k])fail('当前身份没有此操作权限',403)};
 let b={};if(['POST','PATCH','PUT','DELETE'].includes(request.method)){if(Number(request.headers.get('content-length')||0)>10000000)fail('上传内容过大',413);const origin=request.headers.get('origin');if(origin&&origin!==url.origin)fail('请求来源不匹配',403);try{b=await request.json()}catch{fail('请求格式错误')}}
 const audit=async(action,target,before,after)=>s.insert('audit',{actor:user?.label,action,target,before,after,createdAt:now});
 const recruitResponse=await recruitment({path,b,url,s,now,requireP,audit});if(recruitResponse)return recruitResponse;
 if(path==='/login'||path==='/identity'){const accounts=await s.all('account'),h=await hash(String(path==='/identity'?b.value||'':b.password||'')),a=accounts.find(x=>x.hash===h||(x.role==='superadmin'&&Array.isArray(x.additionalHashes)&&x.additionalHashes.includes(h)));if(!a){if(path==='/identity')return j({recognized:false});fail('管理员密码不正确',403);}const token=uid();await s.insert('session',{role:a.role,expires:now+43200000},'session:'+token);return j({user:{role:a.role,label:a.label,department:a.department},permissions:permissions(a) },200,{'Set-Cookie':`elite_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=43200${url.protocol==='https:'?'; Secure':''}`})}
 if(path==='/logout'){if(cookie)await s.remove('session:'+cookie);return j({ok:true},200,{'Set-Cookie':'elite_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'})}
 if(path==='/me')return j({user,permissions:perms});
 if(path==='/dashboard'){const date=url.searchParams.get('date')||dateAt(now);if(!/^\d{4}-\d{2}-\d{2}$/.test(date))fail('日期无效');await materialize(s,date,now);const todayRows=(await rows(s,now)).filter(x=>x.date===date);const c=await s.get('careers'),templateIds=new Set((await s.all('template')).map(t=>t.id));return j({date,serverTime:now,shifts:(await allShifts(s,now)).filter(x=>x.date===date&&(x.names.length||!x.templateId||templateIds.has(x.templateId))),dayPlan:await s.get('day-plan:'+date),attendance:todayRows,settings:await s.get('settings'),careers:c||{items:[],error:'尚未同步'},source:SOURCE})}
 if(path==='/profile'){const name=clean(url.searchParams.get('name'),30);if(!name)fail('请输入姓名');for(let i=0;i<7;i++)await materialize(s,dayAdd(dateAt(now),i),now);const personal=(await rows(s,now)).filter(x=>x.name===name);const upcoming=personal.filter(x=>x.date>=dateAt(now)&&x.date<=dayAdd(dateAt(now),6)).sort((a,b)=>a.date.localeCompare(b.date)||a.start.localeCompare(b.start));const attendance=personal.filter(x=>x.date<=dateAt(now)).sort((a,b)=>b.date.localeCompare(a.date));const records=(await s.all('volunteer')).filter(x=>x.name===name);return j({name,freshman:(await s.get('member:'+name))?.freshman===true,creditPerShift:(await s.get('member:'+name))?.freshman?3:2,attendance,upcoming,records,dutyHours:attendance.reduce((a,x)=>a+x.hours,0),volunteerHours:attendance.reduce((a,x)=>a+x.hours,0)+records.filter(x=>x.status==='approved').reduce((a,x)=>a+x.hours,0)})}
 if(path==='/checkin'){
 const name=clean(b.name,30),today=dateAt(now);if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(String(b.deviceId||'')))fail('无法识别本设备，请刷新页面后重试');const deviceHash=await hash(b.deviceId.toLowerCase());await materialize(s,today,now);
 const shifts=(await allShifts(s,now)).filter(sh=>sh.date===today);
 if(b.shiftId&&!shifts.some(sh=>sh.id===b.shiftId&&sh.names.includes(name)))fail('此班次没有安排该姓名');
 const match=matchCheckinGroup(shifts,name,now,b.shiftId),group=match.shifts;
 if(match.ambiguous)fail('同一时间安排了多个值班场地，请联系管理员核对排班');
 if(!group.length)fail('当前没有可打卡班次，可提前30分钟打卡，停班或请假班次不可打卡');
 const existing=await Promise.all(group.map(sh=>s.get('attendance:'+sh.id+':'+name)));
 if(existing.every(r=>r?.checkin))fail('该连续班次已打卡，请勿重复提交',409);
 if(isCheckinExpired(group,now))fail('已超过迟到阈值，无法打卡。特殊情况请联系办公室示例甲丙丁。');
 const deviceRecords=(await s.all('attendance')).filter(r=>r.checkin&&r.deviceHash===deviceHash&&r.name!==name);
 if(deviceRecords.some(r=>{const original=shifts.find(sh=>sh.id===r.shiftId),date=r.deviceDate||original?.date,site=r.deviceSite||original?.site,start=r.deviceStart||original?.start,end=r.deviceEnd||original?.end;return date===today&&group.some(sh=>sh.site===site&&sh.start<end&&sh.end>start)}))fail('本设备已为其他人员打卡，本场地同一时段仅允许一个姓名。特殊情况请联系管理员补录。',409);
 let source=existing.find(r=>r?.checkin),uploadedKey=null;
 if(!source){
 const photo=String(b.photo||''),m=photo.match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/);if(!m)fail('请拍摄到场照片');
 const bytes=Uint8Array.from(atob(m[2]),x=>x.charCodeAt(0));if(!bytes.length||bytes.length>5000000)fail('照片需小于 5 MB');
 if(!((bytes[0]===255&&bytes[1]===216)||(bytes[0]===137&&bytes[1]===80)||(bytes[0]===82&&bytes[1]===73)))fail('图片内容无效');
 uploadedKey='checkins/'+uid();await env.BUCKET.put(uploadedKey,bytes,{httpMetadata:{contentType:'image/'+m[1]}});
 source={checkin:now,photo:uploadedKey,lateForGroup:now>at(today,group[0].start)+group[0].threshold*60000,checkinGroupStart:group[0].start};
 }
 const lateForGroup=source.lateForGroup??(source.checkin>at(today,group[0].start)+group[0].threshold*60000);
 const saved=[],freshman=(await s.get('member:'+name))?.freshman===true;
 for(let i=0;i<group.length;i++){
 const sh=group[i],id='attendance:'+sh.id+':'+name;
 if(!existing[i]?.checkin){const payload={...existing[i],shiftId:sh.id,name,checkin:source.checkin,photo:source.photo,lateForGroup,checkinGroupStart:group[0].start,deviceHash,deviceDate:today,deviceSite:sh.site,deviceStart:sh.start,deviceEnd:sh.end};if(existing[i])await s.save('attendance',payload,id);else await s.insert('attendance',payload,id)}
 const r=await s.get(id);saved.push(attendanceState(sh,name,r,now,freshman));if(i===0)source=r;
 }
 if(uploadedKey&&!saved.some(r=>r.photo===uploadedKey))await env.BUCKET.delete(uploadedKey);
 return j({ok:true,attendance:saved[0],attendances:saved,count:saved.length});
 }
 if(path.startsWith('/photo/')){const key=decodeURIComponent(path.slice(7));if(key.startsWith('attachments/'))requireP('audit');const item=await env.BUCKET.get(key);if(!item)fail('照片不存在',404);return new Response(item.body,{headers:{'Content-Type':item.httpMetadata.contentType,'Cache-Control':'private, max-age=3600','X-Content-Type-Options':'nosniff'}})}
 if(path.startsWith('/volunteer/attachment/')){
 requireP('audit');const id=decodeURIComponent(path.slice('/volunteer/attachment/'.length));const records=await s.all('volunteer'),attachment=records.flatMap(r=>r.attachments||[]).find(a=>a.id===id);if(!attachment)fail('附件不存在',404);
 const item=await env.BUCKET.get(attachment.key);if(!item)fail('附件文件不存在',404);return new Response(item.body,{headers:{'Content-Type':item.httpMetadata.contentType,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
 }
 if(path==='/volunteer/recognize')return j(await env.recognizeVolunteer(b.text));
 if(path==='/volunteer/batch'){
 let records;try{records=validateRecords(b.records)}catch(e){fail(e.message)}
 const ids=[];for(const r of records)ids.push(await s.insert('volunteer',{...r,status:'pending',createdAt:now}));return j({ok:true,count:ids.length,ids});
 }
 if(path==='/rankings'){
 const totals=new Map((await memberList(s)).map(m=>[m.name,{name:m.name,dutyHours:0,activityHours:0}]));
 const member=name=>{if(!totals.has(name))totals.set(name,{name,dutyHours:0,activityHours:0});return totals.get(name)};
 for(const r of await rows(s,now))if(r.date<=dateAt(now))member(r.name).dutyHours+=r.hours;
 for(const r of await s.all('volunteer')){const t=member(r.name);if(r.status==='approved')t.activityHours+=r.hours;}
 const rounded=v=>Math.round(v*100)/100;
 const ranking=[...totals.values()].map(r=>({...r,dutyHours:rounded(r.dutyHours),activityHours:rounded(r.activityHours),hours:rounded(r.dutyHours+r.activityHours)})).filter(r=>r.hours>0).sort((a,b)=>b.hours-a.hours||a.name.localeCompare(b.name,'zh-CN'));
 let rank=0;ranking.forEach((r,i)=>{if(!i||r.hours!==ranking[i-1].hours)rank=i+1;r.rank=rank});return j({ranking,updatedAt:now});
 }
 if(path==='/volunteer'&&request.method==='POST'){const name=clean(b.name,30),hours=Number(b.hours),event=clean(b.event);if(!name||!event||!Number.isFinite(hours)||hours<=0||hours>100)fail('请填写姓名、活动及 0 至 100 小时的时长');return j({ok:true,id:await s.insert('volunteer',{name,hours,event,note:clean(b.note,1000),status:'pending',createdAt:now})})}
 if(path==='/applications'&&request.method==='POST'){for(const k of ['name','grade','college','department','introduction','contact'])if(!clean(b[k],1000))fail('请完整填写报名信息');if(!['办公室','新媒体','项目部','实践部'].includes(b.department)||!['大一','大二'].includes(b.grade))fail('请选择有效年级和部门');const data=Object.fromEntries(['name','grade','college','department','other_department','introduction','contact','note'].map(k=>[k,clean(b[k],k==='introduction'?2000:150)]));return j({ok:true,id:await s.insert('application',{...data,contacted:false,joined:false,createdAt:now})})}
 if(path==='/surveys'&&request.method==='POST'){for(const k of ['name','department','college','class_name','student_id','phone'])if(!clean(b[k]))fail('请完整填写问卷');if(!['办公室','新媒体','项目部','实践部'].includes(b.department))fail('部门无效');return j({ok:true,id:await s.insert('survey',{...Object.fromEntries(['name','department','college','class_name','student_id','phone','suggestion'].map(k=>[k,clean(b[k],1000)])),createdAt:now})})}
 if(path==='/admin/data'){const applications=perms.applications?await s.all('application'):[],latestIds=latestApplicationIds(applications);if(!user)fail('请先登录',401);const from=url.searchParams.get('from')||dateAt(now);if(perms.duty){for(let i=0;i<7;i++)await materialize(s,dayAdd(from,i),now);}return j({serverTime:now,user,permissions:perms,members:perms.duty?await memberList(s):[],templates:perms.duty?await s.all('template'):[],dayPlans:perms.duty?await s.all('day-plan'):[],shifts:perms.duty?await allShifts(s,now):[],attendance:perms.duty?await rows(s,now):[],settings:perms.duty?await s.get('settings'):null,volunteers:perms.audit?await s.all('volunteer'):[],applications:perms.applications?applications.filter(x=>!user.department||x.department===user.department||x.other_department===user.department).map(x=>({...x,isLatestSubmission:latestIds.has(x.id)})):[],surveys:perms.surveys?(await s.all('survey')).filter(x=>!user.department||x.department===user.department):[],audit:perms.duty?(await s.all('audit')).sort((a,b)=>b.createdAt-a.createdAt).slice(0,100):[],accounts:perms.audit?(await s.all('account')).map(({role,label})=>({role,label})):[]})}
 if(path==='/admin/member'){
 requireP('duty');const name=clean(b.name,30);if(!name||typeof b.freshman!=='boolean')fail('请填写姓名并选择成员标签');
 const id='member:'+name,prev=await s.get(id);if(b._rev!==undefined&&b._rev!==(prev?._rev??0))fail('成员标签已被修改，请刷新后重试',409);
 const data={name,freshman:b.freshman,updatedAt:now,actor:user.label};await s.save('member',{...data,_rev:prev?._rev??0},id);
 if((await s.get(id)).freshman!==data.freshman)fail('成员标签已被修改，请刷新后重试',409);
 await audit('设置值班成员标签',id,prev,data);return j({ok:true});
 }
 if(path==='/admin/settings'){requireP('duty');const threshold=Number(b.threshold);if(!Number.isInteger(threshold)||threshold<0||threshold>180)fail('迟到阈值需为 0 至 180 分钟');const prev=await s.get('settings');await s.save('settings',{...prev,threshold},'settings');for(const sh of await s.all('shift'))if(at(sh.date,sh.start)>now)await s.save('shift',{...sh,threshold},sh.id);await audit('调整迟到阈值','settings',prev,{threshold});return j({ok:true})}
 if(path==='/admin/template'){requireP('duty');const prev=b.id?await s.get(b.id):null;if(request.method==='DELETE'){if(!prev)fail('班次不存在');await s.remove(prev.id);for(const sh of await s.all('shift'))if(sh.templateId===prev.id&&at(sh.date,sh.start)>now)await s.save('shift',{...sh,enabled:false,retiredByTemplateDeletion:true},sh.id);await audit('删除固定班次',prev.id,prev,null);return j({ok:true})}const names=Array.isArray(b.names)?[...new Set(b.names.map(x=>clean(x,30)).filter(Boolean))]:[];if(!['就业处综合办公室','就业服务基地'].includes(b.site)||!Number.isInteger(Number(b.weekday))||b.weekday<0||b.weekday>6||!/^\d{2}:\d{2}$/.test(b.start)||!/^\d{2}:\d{2}$/.test(b.end)||!(at(dateAt(now),b.end)>at(dateAt(now),b.start))||names.length>20)fail('班次信息无效，结束时间应晚于开始时间');const data={site:b.site,weekday:Number(b.weekday),start:b.start,end:b.end,names,weekRules:normalizedWeekRules(names,b.weekRules??prev?.weekRules),enabled:b.enabled!==false};const id=prev?await s.save('template',{...data,_rev:b._rev},prev.id):await s.insert('template',data);const records=await s.all('attendance');for(const sh of await s.all('shift'))if(sh.templateId===id){const synced=synchronizedShift(sh,data,records,now);if(synced)await s.save('shift',synced,sh.id);}await audit('保存固定班次',id,prev,data);return j({ok:true,id})}
 if(path==='/admin/day-plan'){
 requireP('duty');const date=String(b.date||''),weekday=Number(b.weekday);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(at(date,'00:00'))||dateAt(at(date,'00:00'))!==date||!Number.isInteger(weekday)||weekday<0||weekday>6)fail('请选择有效日期和星期');
 if(date>=DUTY_END_DATE)fail('本学期值班已结束，12月26日起不再安排值班');
 const current=await materialize(s,date),templates=(await s.all('template')).filter(t=>t.weekday===weekday&&t.enabled),records=await s.all('attendance');
 const previous=await s.get('day-plan:'+date);if(b._rev!==undefined&&b._rev!==(previous?._rev??0))fail('日期排班已被修改，请刷新后重试',409);
 const generation=uid(),shiftIds=[],carriedRecords=[],threshold=(await s.get('settings')).threshold;
 for(const t of templates){
 const id='shift:'+date+':plan:'+generation+':'+t.id;
 await s.insert('shift',{date,templateId:null,sourceTemplateId:t.id,sourceWeekday:weekday,site:t.site,start:t.start,end:t.end,names:namesForWeek(t,date),weekSkipped:t.names.length>0&&!namesForWeek(t,date).length,enabled:true,leaves:[],threshold,customized:true},id);shiftIds.push(id);
 for(const name of t.names){
 const matched=current.filter(sh=>sh.site===t.site&&sh.start===t.start&&sh.end===t.end&&sh.names.includes(name));
 const record=records.find(r=>r.name===name&&matched.some(sh=>sh.id===r.shiftId));
 if(record){const {id:oldId,_rev,...payload}=record,newId='attendance:'+id+':'+name;await s.insert('attendance',{...payload,shiftId:id,sourceAttendanceId:oldId},newId);carriedRecords.push({from:oldId,to:newId})}
 }
 }
 const plan={date,weekday,shiftIds,createdAt:now,actor:user.label};await s.save('day-plan',{...plan,_rev:previous?._rev??0},'day-plan:'+date);
 if(JSON.stringify((await s.get('day-plan:'+date)).shiftIds)!==JSON.stringify(shiftIds))fail('日期排班已被修改，请刷新后重试',409);
 await audit('覆盖指定日期排班','day-plan:'+date,{plan:previous,shifts:current,attendance:records.filter(r=>current.some(sh=>sh.id===r.shiftId))},{...plan,carriedRecords});return j({ok:true,count:shiftIds.length,carriedRecords:carriedRecords.length});
 }
 if(path==='/admin/shift'){requireP('duty');const sh=await s.get(b.id);if(!sh||!(await allShifts(s,now)).some(x=>x.id===sh.id)||!sh.id.startsWith('shift:'))fail('班次不存在');const data={...sh,weekSkipped:false,start:b.start,end:b.end,names:Array.isArray(b.names)?[...new Set(b.names.map(x=>clean(x,30)).filter(Boolean))]:sh.names,enabled:b.enabled!==false,leaves:(Array.isArray(b.leaves)?b.leaves:sh.leaves||[]).filter(x=>(Array.isArray(b.names)?b.names:sh.names).includes(x)),customized:true};if(!/^\d{2}:\d{2}$/.test(data.start)||!/^\d{2}:\d{2}$/.test(data.end)||at(sh.date,data.end)<=at(sh.date,data.start))fail('请填写有效时间');if(at(sh.date,sh.end)<=now&&(data.start!==sh.start||data.end!==sh.end||JSON.stringify(data.names)!==JSON.stringify(sh.names)))fail('历史班次时间与名单已归档，请通过异常处理更正时长');await s.save('shift',{...data,_rev:b._rev},sh.id);await audit('调整单日班次',sh.id,sh,data);return j({ok:true})}
 if(path==='/admin/attendance'){requireP('duty');const sh=await s.get(b.shiftId);if(!sh||!(await allShifts(s,now)).some(x=>x.id===sh.id)||!sh.names.includes(b.name))fail('值班记录不存在');const restoreReason=clean(b.reason,1000);if(b.status==='auto'){if(!restoreReason)fail('请填写恢复原因');const id='attendance:'+sh.id+':'+b.name,prev=await s.get(id);const updatedShift={...sh,leaves:(sh.leaves||[]).filter(n=>n!==b.name)};if(updatedShift.leaves.length!==(sh.leaves||[]).length)await s.save('shift',updatedShift,sh.id);if(prev?.override)await s.save('attendance',{...prev,override:null},id);await audit('恢复自动值班状态',id,{shift:sh,record:prev},{shift:updatedShift,record:prev?{...prev,override:null}:null,reason:restoreReason});return j({ok:true})}const hours=Number(b.hours),reason=restoreReason;if(!Number.isFinite(hours)||hours<0||hours>24||!reason||!['credited','late','absent','leave','cancelled'].includes(b.status))fail('请填写有效处理结果、时长和修改原因');const id='attendance:'+sh.id+':'+b.name,prev=await s.get(id);const data={...prev,shiftId:sh.id,name:b.name,override:{hours,status:b.status,reason,actor:user.label,updatedAt:now}};await s.save('attendance',data,id);await audit('更正值班时长',id,prev,data);return j({ok:true})}
 if(path==='/admin/volunteer/source'){requireP('audit');const row=await s.get(url.searchParams.get('id'));if(!row||row.source?.type!=='handbook')fail('补充内容不存在',404);const proof=await s.get(row.source.proofId);if(!proof||proof.ledgerId!==row.source.ledgerId)fail('补充内容不存在',404);return j(proof)}
 if(path==='/admin/volunteer'){requireP('audit');const prev=await s.get(b.id);if(!prev||!['pending','approved','rejected'].includes(b.status))fail('记录无效');const hours=Number(b.hours);if(!Number.isFinite(hours)||hours<=0||hours>100)fail('时长无效');const reviewNote=clean(b.reviewNote,1000);if(prev.status===b.status&&Number(prev.hours)===hours&&(prev.reviewNote||'')===reviewNote)return j({ok:true,unchanged:true,record:prev});const data={...prev,hours,status:b.status,reviewer:user.label,reviewedAt:now,reviewNote};await s.save('volunteer',{...data,_rev:b._rev},prev.id);await audit('审核志愿时长',prev.id,prev,data);return j({ok:true,record:await s.get(prev.id)})}
 if(path==='/admin/account'){requireP('audit');if(!/^[\s\S]{4,100}$/.test(String(b.password||'')))fail('密码至少 4 位');const role=clean(b.role),prev=await s.get('account:'+role);if(!prev&&role!=='duty')fail('角色不存在');await s.save('account',{role,label:prev?.label||'值班管理员',department:prev?.department||null,hash:await hash(b.password)},'account:'+role);await audit('设置管理员密码',role,null,{role});return j({ok:true})}
 if(path==='/admin/application'){requireP('applications');const prev=(await s.all('application')).find(x=>x.id===b.id);if(!prev||user.department&&prev.department!==user.department&&prev.other_department!==user.department)fail('没有此记录权限',403);const updates={};for(const key of ['contacted','joined'])if(Object.hasOwn(b,key)){if(typeof b[key]!=='boolean')fail('勾选状态无效');updates[key]=b[key]}if(!Object.keys(updates).length)fail('请选择要修改的状态');await s.save('application',{...prev,...updates},prev.id);return j({ok:true})}
 if(path==='/admin/sync'){requireP('duty');const items=await syncCareers(s,now);return j({ok:true,count:items.length})}
 fail('接口不存在',404);
 }catch(e){return j({error:e.status?e.message:'服务暂时不可用，请稍后重试'},e.status||500)}}

// Serialize check-ins from one device to prevent concurrent name switching.
const deviceLocks=new Map();
export async function handle(request,env,now=Date.now()){
 if(new URL(request.url).pathname!=='/api/checkin')return handleInner(request,env,now);
 let key;try{key=String((await request.clone().json()).deviceId||'').toLowerCase()}catch{return handleInner(request,env,now)}
 const previous=deviceLocks.get(key)||Promise.resolve();let release;const done=new Promise(resolve=>{release=resolve});deviceLocks.set(key,done);await previous;
 try{return await handleInner(request,env,now)}finally{release();if(deviceLocks.get(key)===done)deviceLocks.delete(key)}
}
