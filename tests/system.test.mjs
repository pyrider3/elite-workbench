
process.env.INITIAL_PASSWORD_SUPERADMIN='test-superadmin-only';
process.env.INITIAL_PASSWORD_VIEWER='test-viewer-only';
process.env.INITIAL_PASSWORD_OFFICE='test-office-only';
process.env.INITIAL_PASSWORD_MEDIA='test-media-only';
process.env.INITIAL_PASSWORD_PROJECT='test-project-only';
process.env.INITIAL_PASSWORD_PRACTICE='test-practice-only';
import test from 'node:test';import assert from 'node:assert/strict';import{DatabaseSync}from'node:sqlite';import{readFileSync}from'node:fs';import{handle,store,initialize,materialize,at,attendanceState}from'../lib/core.js';
function fixture(){const sql=new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('../migrations/001_entries.sql',import.meta.url),'utf8'));const DB={prepare(q){let args=[];return{bind(...a){args=a;return this},async first(){return sql.prepare(q).get(...args)||null},async all(){return{results:sql.prepare(q).all(...args)}},async run(){const r=sql.prepare(q).run(...args);return{meta:{changes:Number(r.changes)}}}}}};const objects=new Map(),BUCKET={async put(k,v,o){objects.set(k,{body:v,httpMetadata:o.httpMetadata})},async get(k){return objects.get(k)},async delete(k){objects.delete(k)}};const env={DB,BUCKET},s=store(DB);const devices=new Map();const call=async(path,b,now=at('2026-10-12','08:20'),cookie='',method='POST')=>{if(path==='/checkin'&&b&&!Object.hasOwn(b,'deviceId')){if(!devices.has(b.name))devices.set(b.name,crypto.randomUUID());b={...b,deviceId:devices.get(b.name)}}const r=await handle(new Request('http://localhost/api'+path,b?{method,headers:{'Content-Type':'application/json',cookie},body:JSON.stringify(b)}:{headers:{cookie}}),env,now);return{status:r.status,body:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]}};return{s,call,env,objects}}
const photo='data:image/jpeg;base64,/9j/4AAQSkZJRg==';
test('准时 / 15分钟边界 / 超时 / 缺岗和下班结算',()=>{const shift={id:'s',site:'办公室',date:'2026-10-12',start:'08:20',end:'10:00',threshold:15,enabled:true,leaves:[]};assert.equal(attendanceState(shift,'甲',{checkin:at(shift.date,'08:35')},at(shift.date,'09:00')).status,'present');assert.equal(attendanceState(shift,'甲',{checkin:at(shift.date,'08:35')},at(shift.date,'10:00')).hours,2);assert.equal(attendanceState(shift,'甲',{checkin:at(shift.date,'08:35')+1},at(shift.date,'10:00')).hours,0);assert.equal(attendanceState(shift,'甲',null,at(shift.date,'08:36')).status,'absent');assert.equal(attendanceState({...shift,leaves:['甲']},'甲',null,at(shift.date,'10:00')).status,'leave')});
test('真实持久化打卡 / 重复防护 / 下班自动计时',async()=>{const{call}=fixture();let x=await call('/dashboard?date=2026-10-12');const shift=x.body.shifts.find(s=>s.site==='就业处综合办公室'&&s.start==='08:20'),name=shift.names[0];x=await call('/checkin',{name,shiftId:shift.id,photo});assert.equal(x.status,200);assert.equal((await call('/checkin',{name,shiftId:shift.id,photo})).status,409);const p=await call('/profile?name='+encodeURIComponent(name),null,at('2026-10-12','10:00'));assert.equal(p.body.dutyHours,2);assert.equal((await call('/profile?name='+encodeURIComponent(name),null,at('2026-10-12','11:00'))).body.dutyHours,2)});
test('过早、过晚、未安排、无照片均不能打卡',async()=>{const{call}=fixture();const x=await call('/dashboard?date=2026-10-12'),s=x.body.shifts[0],b={name:s.names[0],shiftId:s.id,photo};assert.equal((await call('/checkin',b,at('2026-10-12','07:00'))).status,400);assert.equal((await call('/checkin',b,at('2026-10-12','20:00'))).status,400);assert.equal((await call('/checkin',{...b,name:'其他人'})).status,400);assert.equal((await call('/checkin',{...b,photo:''})).status,400)});
test('超时禁止打卡且不保存照片，管理员仍可补计并留审计',async()=>{const{call,s:storage,objects}=fixture();const x=await call('/dashboard?date=2026-10-12'),s=x.body.shifts.find(x=>x.site==='就业处综合办公室'&&x.start==='08:20'),name=s.names[0];const denied=await call('/checkin',{name,shiftId:s.id,photo},at('2026-10-12','08:35')+1);assert.equal(denied.status,400);assert.match(denied.body.error,/办公室示例甲丙乙/);assert.equal((await storage.all('attendance')).length,0);assert.equal(objects.size,0);assert.equal((await call('/profile?name='+encodeURIComponent(name),null,at('2026-10-12','10:00'))).body.dutyHours,0);const login=await call('/login',{password:'test-superadmin-only'});assert.equal((await call('/admin/attendance',{name,shiftId:s.id,hours:1,status:'credited',reason:'核实后补计'},undefined,login.cookie)).status,200);assert.equal((await call('/profile?name='+encodeURIComponent(name))).body.dutyHours,1);assert.equal((await call('/admin/data',null,undefined,login.cookie)).body.audit.length,1)});
test('管理员角色隔离与部门报名范围',async()=>{const{call}=fixture();assert.equal((await call('/admin/settings',{threshold:20})).status,403);for(const dept of ['办公室','新媒体'])assert.equal((await call('/applications',{name:'张同学',grade:'大一',college:'管理学院',department:dept,introduction:'希望加入',contact:'微信'})).status,200);const office=await call('/login',{password:'test-office-only'}),o=await call('/admin/data',null,undefined,office.cookie);assert.equal(o.body.applications.length,1);assert.equal(o.body.applications[0].department,'办公室');assert.equal((await call('/admin/settings',{threshold:20},undefined,office.cookie)).status,403);const viewer=await call('/login',{password:'test-viewer-only'}),v=await call('/admin/data',null,undefined,viewer.cookie);assert.equal(v.body.applications.length,2);assert.equal((await call('/admin/application',{id:v.body.applications[0].id,contacted:true},undefined,viewer.cookie)).status,403)});
test('未来排班 / 时间 / 阈值调整，历史保持，删除有效',async()=>{const{call,s}=fixture();let login=await call('/login',{password:'test-superadmin-only'},at('2026-10-11','10:00'));await call('/dashboard?date=2026-10-12',null,at('2026-10-11','10:00'));let t=await s.get('t1');assert.equal((await call('/admin/template',{...t,start:'08:00',end:'09:00'},at('2026-10-11','10:00'),login.cookie)).status,200);assert.equal((await s.get('shift:2026-10-12:t1')).start,'08:00');assert.equal((await call('/admin/settings',{threshold:20},at('2026-10-11','10:00'),login.cookie)).status,200);assert.equal((await s.get('shift:2026-10-12:t1')).threshold,20);login=await call('/login',{password:'test-superadmin-only'},at('2026-10-12','10:00'));t=await s.get('t1');assert.equal((await call('/admin/template',{...t,start:'08:10',end:'09:10'},at('2026-10-12','10:00'),login.cookie)).status,200);assert.equal((await s.get('shift:2026-10-12:t1')).start,'08:00');assert.equal((await call('/admin/template',{id:'t1'},at('2026-10-11','10:00'),login.cookie,'DELETE')).status,200);await call('/me');assert.equal(await s.get('t1'),null)});
test('志愿申请审核与累计时长联动',async()=>{const{call}=fixture();const x=await call('/volunteer',{name:'志愿者',hours:3,event:'活动'}),login=await call('/login',{password:'test-superadmin-only'});assert.equal((await call('/profile?name='+encodeURIComponent('志愿者'))).body.volunteerHours,0);assert.equal((await call('/admin/volunteer',{id:x.body.id,status:'approved',hours:3},undefined,login.cookie)).status,200);assert.equal((await call('/profile?name='+encodeURIComponent('志愿者'))).body.volunteerHours,3)});
test('并发编辑版本防护 / 登出失效 / 来源验证',async()=>{const{call,s}=fixture();await call('/me');const a=await s.get('settings');await s.save('settings',{...a,threshold:20},'settings');await assert.rejects(s.save('settings',{...a,threshold:30},'settings'),/刷新/);const login=await call('/login',{password:'test-superadmin-only'});await call('/logout',{},undefined,login.cookie);assert.equal((await call('/admin/data',null,undefined,login.cookie)).status,401)});
test('值班管理员指定日期套用星期：替换、持久化、快照和重复防护',async()=>{
 const{call,s}=fixture(),now=at('2026-10-11','07:00');
 const root=await call('/login',{password:'test-superadmin-only'},now);await call('/admin/account',{role:'duty',password:'duty-test'},now,root.cookie);
 const duty=await call('/login',{password:'duty-test'},now),date='2026-10-12';
 await call('/dashboard?date='+date,null,now);const source=(await s.all('template')).filter(t=>t.weekday===2&&t.enabled);
 assert.equal((await call('/admin/day-plan',{date,weekday:2,_rev:0},now,duty.cookie)).status,200);
 let view=await call('/dashboard?date='+date,null,now);assert.equal(view.body.shifts.length,source.length);assert.equal(view.body.dayPlan.weekday,2);
 assert.deepEqual(view.body.shifts.map(x=>x.names),source.map(t=>t.names));
 assert.equal((await call('/admin/day-plan',{date,weekday:3,_rev:0},now,duty.cookie)).status,409);
 const t=source[0];assert.equal((await call('/admin/template',{...t,names:['新排班人员']},now,duty.cookie)).status,200);
 view=await call('/dashboard?date='+date,null,now);assert.deepEqual(view.body.shifts[0].names,t.names);
 assert.equal((await call('/admin/data?from='+date,null,now,duty.cookie)).body.shifts.filter(x=>x.date===date).length,source.length);
 const plan=await s.get('day-plan:'+date);assert.equal((await call('/admin/day-plan',{date,weekday:6,_rev:plan._rev},now,duty.cookie)).status,200);
 assert.equal((await call('/dashboard?date='+date,null,now)).body.shifts.length,0);
 const name=source[0].names[0],profile=await call('/profile?name='+encodeURIComponent(name),null,now);assert.equal(profile.body.attendance.filter(x=>x.date===date).length,0);
});
test('覆盖排班：权限日期校验、已开始可覆盖、匹配打卡沿用且不重复计时',async()=>{
 const{call,s}=fixture(),date='2026-10-12',now=at(date,'08:20');
 const login=await call('/login',{password:'test-superadmin-only'},now);
 assert.equal((await call('/admin/day-plan',{date,weekday:2},now)).status,403);
 const dept=await call('/login',{password:'test-office-only'},now);assert.equal((await call('/admin/day-plan',{date,weekday:2},now,dept.cookie)).status,403);
 for(const b of [{date:'2026-02-30',weekday:1},{date,weekday:8}])assert.equal((await call('/admin/day-plan',b,now,login.cookie)).status,400);
 const dashboard=await call('/dashboard?date='+date,null,now),sh=dashboard.body.shifts.find(x=>x.site==='就业处综合办公室'&&x.start==='08:20');
 const name=sh.names[0];await call('/checkin',{name,shiftId:sh.id,photo},now);
 const override=await call('/admin/day-plan',{date,weekday:1,_rev:0},at(date,'08:25'),login.cookie);assert.equal(override.status,200);assert.equal(override.body.carriedRecords,1);
 const view=await call('/dashboard?date='+date,null,at(date,'08:25'));
 const migrated=view.body.attendance.find(x=>x.name===name&&x.start==='08:20');assert.equal(migrated.status,'present');assert.ok(migrated.photo);
 assert.equal((await call('/checkin',{name,shiftId:migrated.shiftId,photo},at(date,'08:25'))).status,409);
 assert.equal((await call('/profile?name='+encodeURIComponent(name),null,at(date,'10:00'))).body.dutyHours,2);
 assert.ok((await s.all('audit')).find(x=>x.action==='覆盖指定日期排班').before.attendance.some(r=>r.photo));
 const clear=await call('/admin/day-plan',{date,weekday:0,_rev:view.body.dayPlan._rev},at(date,'10:00'),login.cookie);assert.equal(clear.status,200);
 assert.equal((await call('/dashboard?date='+date,null,at(date,'10:00'))).body.shifts.length,0);
 assert.ok(await s.get('attendance:'+sh.id+':'+name));
 assert.equal((await call('/profile?name='+encodeURIComponent(name),null,at(date,'10:00'))).body.attendance.filter(r=>r.date===date).length,0);
 const repeat=await call('/admin/day-plan',{date,weekday:1,_rev:view.body.dayPlan._rev},at(date,'10:00'),login.cookie);assert.equal(repeat.status,409);
 assert.equal((await call('/admin/day-plan',{date:'2026-10-11',weekday:1},at(date,'10:00'),login.cookie)).status,200);
});
test('无排班日期套用时，不将源模板已过上班时间误认为已有班次',async()=>{
 const{call}=fixture(),date='2026-10-11',now=at(date,'18:00');
 assert.equal((await call('/dashboard?date='+date,null,now)).body.shifts.length,0);
 const login=await call('/login',{password:'test-superadmin-only'},now);
 const applied=await call('/admin/day-plan',{date,weekday:1,_rev:0},now,login.cookie);
 assert.equal(applied.status,200);assert.equal(applied.body.count,8);
 const dashboard=await call('/dashboard?date='+date,null,now);
 assert.equal(dashboard.body.dayPlan.weekday,1);assert.equal(dashboard.body.shifts.length,8);
 assert.equal((await call('/admin/day-plan',{date,weekday:2,_rev:dashboard.body.dayPlan._rev},now,login.cookie)).status,200);
});
test('个人班次返回未来七天的负责时间和到岗状态，历史次数排除未来',async()=>{
 const{call}=fixture(),now=at('2026-10-12','08:20');
 const dashboard=await call('/dashboard?date=2026-10-12',null,now),sh=dashboard.body.shifts.find(s=>s.site==='就业处综合办公室'&&s.start==='08:20'),name=sh.names[0];
 await call('/checkin',{name,shiftId:sh.id,photo},now);
 const profile=await call('/profile?name='+encodeURIComponent(name),null,now);
 assert.ok(profile.body.upcoming.some(r=>r.shiftId===sh.id&&r.status==='present'&&r.start==='08:20'&&r.end==='10:00'));
 assert.ok(profile.body.upcoming.every(r=>r.name===name&&r.date>='2026-10-12'&&r.date<='2026-10-18'));
 assert.ok(profile.body.attendance.every(r=>r.date<='2026-10-12'));
 const credited=await call('/profile?name='+encodeURIComponent(name),null,at('2026-10-12','10:00'));
 assert.equal(credited.body.upcoming.find(r=>r.shiftId===sh.id).status,'credited');
});
async function continuousFixture(){const f=fixture();await f.call('/me');for(const [id,start,end,site] of [['continuous-1','08:20','10:00','就业处综合办公室'],['continuous-2','10:00','12:00','就业处综合办公室'],['gap-3','14:00','16:00','就业处综合办公室']])await f.s.insert('template',{weekday:1,site,start,end,names:['连班甲'],enabled:true},id);return f}
test('自动匹配提前30分钟边界、连续两班共享一次照片，按班次结算不多计',async()=>{
 const{call}=await continuousFixture(),date='2026-10-12';
 assert.equal((await call('/checkin',{name:'连班甲',photo},at(date,'07:49')+59000)).status,400);
 const checked=await call('/checkin',{name:'连班甲',photo},at(date,'07:50'));assert.equal(checked.status,200);assert.equal(checked.body.count,2);
 assert.equal(new Set(checked.body.attendances.map(r=>r.photo)).size,1);
 assert.equal((await call('/checkin',{name:'连班甲',photo},at(date,'08:21'))).status,409);
 assert.equal((await call('/profile?name='+encodeURIComponent('连班甲'),null,at(date,'10:00'))).body.dutyHours,2);
 assert.equal((await call('/profile?name='+encodeURIComponent('连班甲'),null,at(date,'12:00'))).body.dutyHours,4);
 const next=await call('/checkin',{name:'连班甲',photo},at(date,'13:30'));assert.equal(next.body.count,1);
 assert.equal((await call('/profile?name='+encodeURIComponent('连班甲'),null,at(date,'16:00'))).body.dutyHours,6);
});
test('连续班次超时按第一班禁止，第二班不能重新打卡；阈值边界允许',async()=>{
 const{call,s,objects}=await continuousFixture(),date='2026-10-12';
 for(const now of [at(date,'08:35')+1,at(date,'10:00')]){
  const denied=await call('/checkin',{name:'连班甲',photo},now);assert.equal(denied.status,400);assert.match(denied.body.error,/迟到阈值/);
 }
 assert.equal((await s.all('attendance')).length,0);assert.equal(objects.size,0);
 const checked=await call('/checkin',{name:'连班甲',photo},at(date,'08:35'));assert.equal(checked.status,200);assert.equal(checked.body.count,2);
 assert.equal((await call('/profile?name='+encodeURIComponent('连班甲'),null,at(date,'12:00'))).body.dutyHours,4);
});
test('自动匹配不跨请假、停班或场地；重叠场地拒绝模糊匹配',async()=>{
 const{call,s}=await continuousFixture(),date='2026-10-12';await call('/dashboard?date='+date,null,at(date,'07:00'));
 const second=await s.get('shift:'+date+':continuous-2');await s.save('shift',{...second,leaves:['连班甲']},second.id);
 const checked=await call('/checkin',{name:'连班甲',photo},at(date,'08:20'));assert.equal(checked.body.count,1);
 const other=fixture();await other.call('/me');for(const site of ['就业处综合办公室','就业服务基地'])await other.s.insert('template',{weekday:1,site,start:'08:00',end:'10:00',names:['多场地乙'],enabled:true});
 assert.equal((await other.call('/checkin',{name:'多场地乙',photo},at(date,'08:00'))).status,400);
});
test('成员标签：每班固定2/3小时，标签持久化及自动历史计时更新，人工更正保持',async()=>{
 const{call,s}=fixture(),date='2026-10-12',now=at(date,'08:20');
 const dashboard=await call('/dashboard?date='+date,null,now),sh=dashboard.body.shifts.find(s=>s.site==='就业处综合办公室'&&s.start==='08:20'),name=sh.names[0];
 await call('/checkin',{name,photo},now);
 const ended=at(date,'10:00'),login=await call('/login',{password:'test-superadmin-only'},ended);
 assert.equal((await call('/profile?name='+encodeURIComponent(name),null,ended)).body.volunteerHours,2);
 assert.equal((await call('/admin/member',{name,freshman:true,_rev:0},ended,login.cookie)).status,200);
 const freshman=await call('/profile?name='+encodeURIComponent(name),null,ended);assert.equal(freshman.body.freshman,true);assert.equal(freshman.body.creditPerShift,3);assert.equal(freshman.body.volunteerHours,3);
 assert.equal((await call('/admin/data',null,ended,login.cookie)).body.members.find(m=>m.name===name).freshman,true);
 assert.equal((await s.get('member:'+name)).freshman,true);
 assert.equal((await call('/admin/member',{name,freshman:false,_rev:0},ended,login.cookie)).status,409);
 await call('/admin/attendance',{shiftId:sh.id,name,status:'credited',hours:1.5,reason:'按实际情况更正'},ended,login.cookie);
 const member=await s.get('member:'+name);await call('/admin/member',{name,freshman:false,_rev:member._rev},ended,login.cookie);
 assert.equal((await call('/profile?name='+encodeURIComponent(name),null,ended)).body.volunteerHours,1.5);
 assert.ok((await s.all('audit')).some(r=>r.action==='设置值班成员标签'));
});
test('大一连续两班共6小时，第一班结束只计3小时；迟到与其他志愿申请不受加成',async()=>{
 const{call}=await continuousFixture(),date='2026-10-12',early=at(date,'07:00'),login=await call('/login',{password:'test-superadmin-only'},early);
 await call('/admin/member',{name:'连班甲',freshman:true},early,login.cookie);
 const checked=await call('/checkin',{name:'连班甲',photo},at(date,'07:50'));assert.equal(checked.body.count,2);assert.ok(checked.body.attendances.every(r=>r.freshman&&r.creditPerShift===3&&r.hours===0));
 assert.equal((await call('/profile?name='+encodeURIComponent('连班甲'),null,at(date,'10:00'))).body.volunteerHours,3);
 assert.equal((await call('/profile?name='+encodeURIComponent('连班甲'),null,at(date,'12:00'))).body.volunteerHours,6);
 const application=await call('/volunteer',{name:'连班甲',hours:1,event:'其他活动'},at(date,'12:00'));
 await call('/admin/volunteer',{id:application.body.id,status:'approved',hours:1},at(date,'12:00'),login.cookie);
 assert.equal((await call('/profile?name='+encodeURIComponent('连班甲'),null,at(date,'12:00'))).body.volunteerHours,7);
 const late=await continuousFixture(),lateLogin=await late.call('/login',{password:'test-superadmin-only'},early);await late.call('/admin/member',{name:'连班甲',freshman:true},early,lateLogin.cookie);assert.equal((await late.call('/checkin',{name:'连班甲',photo},at(date,'08:36'))).status,400);
 assert.equal((await late.call('/profile?name='+encodeURIComponent('连班甲'),null,at(date,'12:00'))).body.volunteerHours,0);
});
test('成员标签只允许值班管理权限，拒绝无效姓名和标签',async()=>{
 const{call}=fixture();assert.equal((await call('/admin/member',{name:'甲',freshman:true})).status,403);
 const dept=await call('/login',{password:'test-office-only'});assert.equal((await call('/admin/member',{name:'甲',freshman:true},undefined,dept.cookie)).status,403);
 const root=await call('/login',{password:'test-superadmin-only'});await call('/admin/account',{role:'duty',password:'duty-label-test'},undefined,root.cookie);
 const duty=await call('/login',{password:'duty-label-test'});assert.equal((await call('/admin/member',{name:'甲',freshman:true},undefined,duty.cookie)).status,200);
 assert.equal((await call('/admin/member',{name:'',freshman:true},undefined,duty.cookie)).status,400);assert.equal((await call('/admin/member',{name:'甲',freshman:'true'},undefined,duty.cookie)).status,400);
});
test('单框批量志愿申请：先校验整批再存储，待审核不计排名，审核后与档案一致',async()=>{
 const{call,s,env}=fixture();env.recognizeVolunteer=async text=>({records:[{name:'测试甲',event:'双选会',hours:3,note:text}],engine:'AI 识别'});
 assert.equal((await call('/volunteer/recognize',{text:'测试甲在双选会搬物资，加3小时'})).body.records[0].hours,3);
 const invalid=await call('/volunteer/batch',{records:[{name:'测试甲',event:'活动',hours:3},{name:'测试乙',event:'活动',hours:0}]});assert.equal(invalid.status,400);assert.equal((await s.all('volunteer')).length,0);
 const x=await call('/volunteer/batch',{records:[{name:'测试甲',event:'双选会',hours:3},{name:'测试乙',event:'双选会',hours:3}]});assert.equal(x.status,200);assert.equal(x.body.count,2);
 let ranking=(await call('/rankings')).body.ranking;assert.equal(ranking.some(r=>r.name==='测试甲'),false);assert.equal(ranking.length,0);
 const login=await call('/login',{password:'test-superadmin-only'});for(const id of x.body.ids)await call('/admin/volunteer',{id,status:'approved',hours:3},undefined,login.cookie);
 ranking=(await call('/rankings')).body.ranking;const a=ranking.find(r=>r.name==='测试甲'),b=ranking.find(r=>r.name==='测试乙');assert.equal(a.hours,3);assert.equal(a.rank,b.rank);assert.equal(a.hours,(await call('/profile?name='+encodeURIComponent(a.name))).body.volunteerHours);
 await call('/admin/volunteer',{id:x.body.ids[1],status:'rejected',hours:3},undefined,login.cookie);assert.equal((await call('/rankings')).body.ranking.some(r=>r.name==='测试乙'),false);
});
test('排名计入大一值班奖励及人工更正，使用覆盖后有效班次',async()=>{
 const{call}=fixture(),date='2026-10-12';const login=await call('/login',{password:'test-superadmin-only'});
 const sh=(await call('/dashboard?date='+date)).body.shifts.find(x=>x.start==='08:20'),name=sh.names[0];await call('/checkin',{name,photo});await call('/admin/member',{name,freshman:true},undefined,login.cookie);
 let r=(await call('/rankings',null,at(date,'10:00'))).body.ranking.find(x=>x.name===name);assert.equal(r.hours,3);
 await call('/admin/attendance',{shiftId:sh.id,name,hours:1.5,status:'credited',reason:'调整'},at(date,'10:00'),login.cookie);r=(await call('/rankings',null,at(date,'10:00'))).body.ranking.find(x=>x.name===name);assert.equal(r.hours,1.5);
 await call('/admin/day-plan',{date,weekday:0},at(date,'10:00'),login.cookie);assert.equal((await call('/rankings',null,at(date,'10:00'))).body.ranking.some(x=>x.name===name),false);
});
test('历史志愿附件仅审核管理员可查看，文件类型和内容保留',async()=>{
 const{call,s,env}=fixture(),key='attachments/00000000-0000-0000-0000-000000000001',id='legacy:association:attachment:1';const bytes=new Uint8Array([255,216,255,217]);await env.BUCKET.put(key,bytes,{httpMetadata:{contentType:'image/jpeg'}});
 await s.insert('volunteer',{name:'历史成员',hours:3,event:'',note:'历史活动',status:'approved',createdAt:at('2026-09-14','10:00'),attachments:[{id,key,fileName:'原照片.jpg'}]});
 assert.equal((await handle(new Request('http://localhost/api/photo/'+encodeURIComponent(key)),env,at('2026-10-12','08:20'))).status,403);
 const url='http://localhost/api/volunteer/attachment/'+encodeURIComponent(id);let r=await handle(new Request(url),env,at('2026-10-12','08:20'));assert.equal(r.status,403);
 const viewer=await call('/login',{password:'test-viewer-only'});r=await handle(new Request(url,{headers:{cookie:viewer.cookie}}),env,at('2026-10-12','08:20'));assert.equal(r.status,403);
 const admin=await call('/login',{password:'test-superadmin-only'});r=await handle(new Request(url,{headers:{cookie:admin.cookie}}),env,at('2026-10-12','08:20'));assert.equal(r.status,200);assert.equal(r.headers.get('content-type'),'image/jpeg');assert.deepEqual(new Uint8Array(await r.arrayBuffer()),bytes);
 assert.equal((await handle(new Request(url+'missing',{headers:{cookie:admin.cookie}}),env,at('2026-10-12','08:20'))).status,404);
});

test('管理员调整阈值后服务器使用班次阈值，历史迟到记录仍保留',async()=>{
 const{call,s}=fixture(),date='2026-10-12',early=at(date,'07:00');
 const login=await call('/login',{password:'test-superadmin-only'},early);
 await call('/admin/settings',{threshold:20},early,login.cookie);
 const sh=(await call('/dashboard?date='+date,null,early)).body.shifts.find(x=>x.site==='就业处综合办公室'&&x.start==='08:20'),name=sh.names[0];
 assert.equal((await call('/checkin',{name,photo},at(date,'08:40')+1)).status,400);
 assert.equal((await call('/checkin',{name,photo},at(date,'08:40'))).status,200);
 const historicName=sh.names[1],id='attendance:'+sh.id+':'+historicName;
 await s.insert('attendance',{shiftId:sh.id,name:historicName,checkin:at(date,'08:41'),photo:'historic',lateForGroup:true},id);
 const profile=await call('/profile?name='+encodeURIComponent(historicName),null,at(date,'10:00'));
 assert.equal(profile.body.attendance.find(r=>r.shiftId===sh.id).status,'late');assert.equal(profile.body.dutyHours,0);assert.ok(await s.get(id));
});

test('上线前排班不生成缺岗记录或值班时长，历史导入志愿时长保留',async()=>{
 const{call,s}=fixture();await call('/me',null,at('2026-10-03','08:00'));
 await materialize(s,'2026-10-08');const old=(await s.all('shift')).find(sh=>sh.date==='2026-10-08'),name=old.names[0];
 await s.insert('attendance',{shiftId:old.id,name,override:{status:'credited',hours:2,reason:'旧测试'}},'attendance:'+old.id+':'+name);
 await s.insert('volunteer',{name,hours:7,status:'approved',event:'历史导入',createdAt:at('2026-10-03','08:00')});
 const profile=await call('/profile?name='+encodeURIComponent(name),null,at('2026-10-11','09:00'));
 assert.ok(profile.body.attendance.every(r=>r.date>='2026-10-11'));assert.equal(profile.body.dutyHours,0);assert.equal(profile.body.volunteerHours,7);
 const dashboard=await call('/dashboard?date=2026-10-08',null,at('2026-10-11','09:00'));assert.equal(dashboard.body.attendance.length,0);
 const ranks=await call('/rankings',null,at('2026-10-11','09:00'));assert.equal(ranks.body.ranking.find(r=>r.name===name).hours,7);
 const login=await call('/login',{password:'test-superadmin-only'},at('2026-10-11','09:00'));const admin=await call('/admin/data',null,at('2026-10-11','09:00'),login.cookie);assert.ok(admin.body.attendance.every(r=>r.date>='2026-10-11'));
 assert.ok(await s.get('attendance:'+old.id+':'+name));assert.ok(!(await s.all('shift')).some(sh=>sh.date==='2026-10-04'));
});

test('12月26日起不排班、不生成缺岗，保留此前已完成记录和时长',async()=>{
 const{call,s}=fixture();const date='2026-12-25';
 const dashboard=await call('/dashboard?date='+date,null,at(date,'08:00'));const sh=dashboard.body.shifts[0],name=sh.names[0];
 await s.insert('attendance',{shiftId:sh.id,name,checkin:at(date,sh.start)},'attendance:'+sh.id+':'+name);
 await s.insert('shift',{date:'2026-12-26',site:'旧测试排班',start:'08:00',end:'10:00',names:[name],enabled:true,leaves:[],threshold:15},'shift:stale-after-end');
 const now=at('2026-12-26','11:00');
 for(const day of ['2026-12-26','2026-12-28']){const d=await call('/dashboard?date='+day,null,now);assert.equal(d.body.shifts.length,0);assert.equal(d.body.attendance.length,0)}
 const profile=await call('/profile?name='+encodeURIComponent(name),null,now);assert.equal(profile.body.upcoming.length,0);assert.ok(profile.body.attendance.some(r=>r.shiftId===sh.id&&r.hours===2));assert.ok(profile.body.attendance.every(r=>r.date<'2026-12-26'));assert.equal(profile.body.dutyHours,2);
 assert.equal((await call('/checkin',{name,photo},now)).status,400);
 const login=await call('/login',{password:'test-superadmin-only'},now);assert.equal((await call('/admin/day-plan',{date:'2026-12-26',weekday:1},now,login.cookie)).status,400);
 assert.ok(!(await s.all('shift')).some(sh=>sh.date==='2026-12-28'));
});

test('重复相同审核不重复记审计或刷新审核时间，修改时长仍可保存',async()=>{
 const {call,s}=fixture();const created=await call('/volunteer',{name:'审核测试',hours:3,event:'搬物资'}),login=await call('/login',{password:'test-superadmin-only'});
 const first=await call('/admin/volunteer',{id:created.body.id,status:'approved',hours:3,reviewNote:''},at('2026-10-12','09:00'),login.cookie);
 assert.equal(first.status,200);assert.equal(first.body.record.status,'approved');const count=(await s.all('audit')).length;
 const repeated=await call('/admin/volunteer',{id:created.body.id,status:'approved',hours:3,reviewNote:'',_rev:0},at('2026-10-12','09:01'),login.cookie);
 assert.equal(repeated.status,200);assert.equal(repeated.body.unchanged,true);assert.equal(repeated.body.record.reviewedAt,first.body.record.reviewedAt);assert.equal((await s.all('audit')).length,count);
 const changed=await call('/admin/volunteer',{...first.body.record,hours:2,reviewNote:'更正时长'},at('2026-10-12','09:02'),login.cookie);
 assert.equal(changed.status,200);assert.equal(changed.body.record.hours,2);assert.equal((await s.all('audit')).length,count+1);
 assert.equal((await call('/profile?name='+encodeURIComponent('审核测试'))).body.volunteerHours,2);
});
test('调整班次省略请假字段保留原有请假，并保留个人请假处理',async()=>{const{call}=fixture();const x=await call('/dashboard?date=2026-10-12'),sh=x.body.shifts[0],name=sh.names[0];const login=await call('/login',{password:'test-superadmin-only'});assert.equal((await call('/admin/shift',{...sh,leaves:[name]},undefined,login.cookie)).status,200);const current=(await call('/admin/data',null,undefined,login.cookie)).body.shifts.find(s=>s.id===sh.id);const {leaves,...edit}=current;assert.equal((await call('/admin/shift',{...edit,end:'12:30'},undefined,login.cookie)).status,200);let dash=(await call('/dashboard?date=2026-10-12')).body;assert.deepEqual(dash.shifts.find(s=>s.id===sh.id).leaves,[name]);await call('/admin/attendance',{shiftId:sh.id,name,hours:0,status:'leave',reason:'确认请假'},undefined,login.cookie);const again=(await call('/admin/data',null,undefined,login.cookie)).body.shifts.find(s=>s.id===sh.id);const {leaves:unused,...body}=again;assert.equal((await call('/admin/shift',{...body,end:'13:00'},undefined,login.cookie)).status,200);dash=(await call('/dashboard?date=2026-10-12')).body;assert.equal(dash.attendance.find(r=>r.shiftId===sh.id&&r.name===name).status,'leave')});
test('取消请假恢复自动判断，保留打卡照片、其他人员请假和整班停班',async()=>{const{call,s}=fixture();const dash=(await call('/dashboard?date=2026-10-12')).body,sh=dash.shifts.find(x=>x.names.length>=2),[name,other]=sh.names;const login=await call('/login',{password:'test-superadmin-only'});await call('/checkin',{name,shiftId:sh.id,photo},at(sh.date,sh.start),login.cookie);const id='attendance:'+sh.id+':'+name,before=await s.get(id);await call('/admin/shift',{...sh,leaves:[name,other]},at(sh.date,sh.start),login.cookie);await call('/admin/attendance',{shiftId:sh.id,name,status:'leave',hours:0,reason:'请假'},undefined,login.cookie);assert.equal((await call('/admin/attendance',{shiftId:sh.id,name,status:'auto',reason:'取消请假'},at(sh.date,sh.start),login.cookie)).status,200);const record=await s.get(id),shift=await s.get(sh.id);assert.equal(record.override,null);assert.equal(record.checkin,before.checkin);assert.equal(record.photo,before.photo);assert.deepEqual(shift.leaves,[other]);assert.equal(attendanceState(shift,name,record,at(sh.date,sh.start)).status,'present');assert.equal(attendanceState(shift,name,record,at(sh.date,sh.end)).status,'credited');await call('/admin/shift',{...shift,enabled:false},at(sh.date,sh.start),login.cookie);await call('/admin/attendance',{shiftId:sh.id,name,status:'auto',reason:'恢复'},at(sh.date,sh.start),login.cookie);assert.equal((await s.get(sh.id)).enabled,false);assert.equal(attendanceState(await s.get(sh.id),name,await s.get(id),at(sh.date,sh.start)).status,'cancelled')});
test('未打卡取消手动请假，回归待开始及未到岗而不提前计时',async()=>{const{call,s}=fixture();const sh=(await call('/dashboard?date=2026-10-12')).body.shifts[0],name=sh.names[0],login=await call('/login',{password:'test-superadmin-only'});await call('/admin/attendance',{shiftId:sh.id,name,status:'leave',hours:0,reason:'请假'},undefined,login.cookie);const restored=await call('/admin/attendance',{shiftId:sh.id,name,status:'auto',reason:'取消请假'},at(sh.date,'07:00'),login.cookie);assert.equal(restored.status,200);const record=await s.get('attendance:'+sh.id+':'+name);assert.equal(attendanceState(sh,name,record,at(sh.date,'07:00')).status,'upcoming');assert.equal(attendanceState(sh,name,record,at(sh.date,sh.end)).status,'absent');assert.equal(attendanceState(sh,name,record,at(sh.date,sh.end)).hours,0)});
test('首页隐藏删除固定模板后的空快照，保留有效空班及历史打卡',async()=>{const{call,s}=fixture();await call('/dashboard?date=2026-10-12');const date='2026-10-12';await s.insert('template',{site:'就业处综合办公室',weekday:1,start:'18:10',end:'20:00',names:[],enabled:true},'active-empty');await s.insert('shift',{date,site:'就业处综合办公室',start:'18:10',end:'20:00',names:[],enabled:true,templateId:'deleted-test',threshold:15},'shift:deleted-test');await s.insert('attendance',{shiftId:'shift:deleted-test',name:'测试成员',checkin:at(date,'18:10'),photo:'keep-photo'},'attendance:test-history');const data=(await call('/dashboard?date='+date)).body;assert.ok(!data.shifts.some(sh=>sh.id==='shift:deleted-test'));assert.ok(data.shifts.some(sh=>sh.templateId==='active-empty'&&sh.names.length===0));assert.ok(await s.get('shift:deleted-test'));assert.equal((await s.get('attendance:test-history')).photo,'keep-photo')});
test('超级管理员备用密码与主密码共存，普通角色不能使用备用密码字段',async()=>{const{call,s}=fixture();await call('/dashboard');const account=await s.get('account:superadmin');const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode('test-extra-admin-password')))).map(x=>x.toString(16).padStart(2,'0')).join('');await s.save('account',{...account,additionalHashes:[digest]},account.id);assert.equal((await call('/login',{password:'test-extra-admin-password'})).body.user.role,'superadmin');assert.equal((await call('/login',{password:'test-superadmin-only'})).body.user.role,'superadmin');assert.equal((await call('/login',{password:'incorrect-extra'})).status,403);await s.save('account',{...await s.get(account.id),additionalHashes:[]},account.id);const viewer=await s.get('account:viewer');await s.save('account',{...viewer,additionalHashes:[digest]},viewer.id);assert.equal((await call('/login',{password:'test-extra-admin-password'})).status,403)});
test('同设备同场地重叠班次换姓名拦截，其他设备允许，照片不增加',async()=>{const{call,objects}=fixture();const sh=(await call('/dashboard?date=2026-10-12')).body.shifts.find(s=>s.names.length>=2),[a,b]=sh.names,deviceId=crypto.randomUUID();const results=await Promise.all([call('/checkin',{name:a,shiftId:sh.id,photo,deviceId},at(sh.date,sh.start)),call('/checkin',{name:b,shiftId:sh.id,photo,deviceId},at(sh.date,sh.start))]);assert.deepEqual(results.map(r=>r.status),[200,409]);assert.match(results[1].body.error,/本设备/);assert.equal(objects.size,1);assert.equal((await call('/checkin',{name:b,shiftId:sh.id,photo,deviceId:crypto.randomUUID()},at(sh.date,sh.start))).status,200)});
test('同设备不同时间或不同场地允许，不接受缺失设备标识',async()=>{const{call,s}=fixture();await call('/dashboard?date=2026-10-12');const date='2026-10-12',deviceId=crypto.randomUUID();for(const [id,site,start,end,name]of [['dev-a','就业处综合办公室','08:20','10:00','设备甲'],['dev-b','就业处综合办公室','10:00','12:00','设备乙'],['dev-c','就业服务基地','08:20','10:00','设备丙']])await s.insert('shift',{date,site,start,end,names:[name],enabled:true,leaves:[],threshold:15},'shift:'+id);assert.equal((await call('/checkin',{name:'设备甲',shiftId:'shift:dev-a',photo,deviceId:''},at(date,'08:20'))).status,400);assert.equal((await call('/checkin',{name:'设备甲',shiftId:'shift:dev-a',photo,deviceId},at(date,'08:20'))).status,200);assert.equal((await call('/checkin',{name:'设备丙',shiftId:'shift:dev-c',photo,deviceId},at(date,'08:20'))).status,200);assert.equal((await call('/checkin',{name:'设备乙',shiftId:'shift:dev-b',photo,deviceId},at(date,'10:00'))).status,200)});
test('删除固定班次后隐藏未开始无记录快照，历史与单日独立调整保留',async()=>{const{call,s}=fixture();await call('/dashboard?date=2026-10-12');const now=at('2026-10-12','08:00'),base={site:'就业处综合办公室',start:'18:10',end:'20:00',names:['删除测试'],enabled:false,templateId:'removed-template',threshold:15};await s.insert('shift',{...base,date:'2026-10-13'},'shift:removed-future');await s.insert('shift',{...base,date:'2026-10-11'},'shift:removed-history');await s.insert('shift',{...base,date:'2026-10-13',customized:true},'shift:custom-future');const login=await call('/login',{password:'test-superadmin-only'},now);const admin=(await call('/admin/data?from=2026-10-13',null,now,login.cookie)).body;assert.ok(!admin.shifts.some(s=>s.id==='shift:removed-future'));assert.ok(!admin.attendance.some(r=>r.shiftId==='shift:removed-future'));assert.ok(admin.shifts.some(s=>s.id==='shift:removed-history'));assert.ok(admin.shifts.some(s=>s.id==='shift:custom-future'));assert.ok((await s.get('shift:removed-future')).names.includes('删除测试'));const dash=(await call('/dashboard?date=2026-10-13',null,now)).body;assert.ok(!dash.shifts.some(s=>s.id==='shift:removed-future'));assert.ok(!(await call('/profile?name='+encodeURIComponent('删除测试'),null,now)).body.upcoming.some(r=>r.shiftId==='shift:removed-future'))});
test('招募表单独立权限、五入口发布、暂停、版本隔离、必填及提交去重',async()=>{const{call,s}=fixture();await call('/dashboard');const password='recruit-test-password',digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(password)))).map(x=>x.toString(16).padStart(2,'0')).join('');await s.insert('account',{role:'recruit',label:'招募管理员',department:null,hash:digest},'account:recruit');const login=await call('/login',{password});assert.equal(login.body.permissions.recruit,true);assert.equal(login.body.permissions.duty,false);assert.equal((await call('/admin/recruit/data')).status,403);assert.equal((await call('/admin/settings',{threshold:15},undefined,login.cookie)).status,403);const viewer=await call('/login',{password:'test-viewer-only'});assert.equal((await call('/admin/recruit/data',null,undefined,viewer.cookie)).status,403);const fields=[{id:'name',label:'姓名',type:'text',required:true},{id:'choice',label:'意向',type:'checkbox',required:true,options:['办公室','实践部']}];const saved=await call('/admin/recruit/save',{title:'招募测试',description:'测试说明',fields},undefined,login.cookie);assert.equal(saved.status,200);const id=saved.body.id;assert.equal((await call('/forms/a')).body.state,'unpublished');for(const slot of 'abcde'){const publish=await call('/admin/recruit/publish',{slot,formId:id},undefined,login.cookie);assert.equal(publish.status,200);assert.equal((await call('/forms/'+slot)).body.form.title,'招募测试')}const form=(await call('/forms/a')).body.form,submissionId=crypto.randomUUID();assert.equal((await call('/forms/submit',{slot:'a',versionId:form.id,submissionId,answers:{name:'',choice:[]}})).status,400);const payload={slot:'a',versionId:form.id,submissionId,answers:{name:'测试甲',choice:['办公室']}};assert.equal((await call('/forms/submit',payload)).status,200);assert.equal((await call('/forms/submit',payload)).status,200);assert.equal((await s.all('recruit-response')).length,1);let draft=await s.get(id);assert.equal((await call('/admin/recruit/save',{...draft,title:'第二版',fields:[{id:'new',label:'新字段',type:'text',required:true}]},undefined,login.cookie)).status,200);assert.equal((await call('/forms/a')).body.form.title,'招募测试');await call('/admin/recruit/publish',{slot:'a',formId:id},undefined,login.cookie);assert.equal((await call('/forms/submit',{...payload,submissionId:crypto.randomUUID()})).status,409);const results=(await call('/admin/recruit/data',null,undefined,login.cookie)).body.responses;assert.equal(results[0].fields[0].label,'姓名');assert.equal(results[0].answers.name,'测试甲');const route=await s.get('recruit-route:a');await call('/admin/recruit/route',{slot:'a',_rev:route._rev,enabled:false},undefined,login.cookie);assert.equal((await call('/forms/a')).body.state,'paused');assert.equal((await call('/forms/submit',{slot:'a',versionId:route.versionId,submissionId:crypto.randomUUID(),answers:{new:'测试'}})).status,409);assert.equal((await s.all('recruit-response')).length,1)});
test('招募入口限额并发不超收，重复请求不占名额，扩容恢复开放',async()=>{const{call,s}=fixture();await call('/dashboard');const login=await call('/login',{password:'test-superadmin-only'});const form=(await call('/admin/recruit/save',{title:'限额测试',fields:[{id:'name',label:'姓名',type:'text',required:true}]},undefined,login.cookie)).body;await call('/admin/recruit/publish',{slot:'a',formId:form.id},undefined,login.cookie);let route=await s.get('recruit-route:a');assert.equal((await call('/admin/recruit/route',{slot:'a',_rev:route._rev,enabled:true,maxResponses:1},undefined,login.cookie)).status,200);const payload={slot:'a',versionId:route.versionId,submissionId:crypto.randomUUID(),answers:{name:'甲'}};const results=await Promise.all([call('/forms/submit',payload),call('/forms/submit',{...payload,submissionId:crypto.randomUUID(),answers:{name:'乙'}})]);assert.deepEqual(results.map(r=>r.status),[200,409]);assert.equal((await s.all('recruit-response')).length,1);assert.equal((await call('/forms/submit',payload)).status,200);assert.equal((await call('/forms/a')).body.state,'full');route=await s.get('recruit-route:a');await call('/admin/recruit/route',{slot:'a',_rev:route._rev,enabled:true,maxResponses:2},undefined,login.cookie);assert.equal((await call('/forms/a')).body.state,'open');route=await s.get('recruit-route:a');assert.equal((await call('/admin/recruit/route',{slot:'a',_rev:route._rev,enabled:true,maxResponses:1.5},undefined,login.cookie)).status,400)});
test('报名未开始向填写者显示开始时间，到点自动开放',async()=>{const{call,s}=fixture();await call('/dashboard');const login=await call('/login',{password:'test-superadmin-only'}),form=(await call('/admin/recruit/save',{title:'定时测试',fields:[{id:'name',label:'姓名',type:'text'}]},undefined,login.cookie)).body;await call('/admin/recruit/publish',{slot:'a',formId:form.id},undefined,login.cookie);const route=await s.get('recruit-route:a'),opensAt=at('2026-10-12','09:00');await call('/admin/recruit/route',{slot:'a',_rev:route._rev,enabled:true,opensAt},undefined,login.cookie);const waiting=(await call('/forms/a',null,opensAt-1)).body;assert.equal(waiting.state,'scheduled');assert.equal(waiting.title,'定时测试');assert.equal(waiting.opensAt,opensAt);assert.equal(waiting.serverTime,opensAt-1);assert.equal((await call('/forms/a',null,opensAt)).body.state,'open')});
test('单双周排班生成、未来快照同步，历史和单日调整保留',async()=>{const{call,s}=fixture(),now=at('2026-10-12','07:00');await call('/dashboard?date=2026-10-12',null,now);const login=await call('/login',{password:'test-superadmin-only'},now);const created=await call('/admin/template',{site:'就业处综合办公室',weekday:1,start:'18:10',end:'20:00',names:['单双每周','单双甲','单双乙'],enabled:true},now,login.cookie);assert.equal(created.status,200);const id=created.body.id;await call('/dashboard?date=2026-10-19',null,now);await call('/dashboard?date=2026-10-26',null,now);await call('/dashboard?date=2026-10-12',null,now);const sh12=await s.get('shift:2026-10-12:'+id),sh19=await s.get('shift:2026-10-19:'+id);await s.save('shift',{...sh12,start:'06:00',end:'07:00'},sh12.id);const customDate='2026-11-02';await call('/dashboard?date='+customDate,null,now);const custom=await s.get('shift:'+customDate+':'+id);await s.save('shift',{...custom,names:['独立调整'],customized:true},custom.id);let t=await s.get(id);assert.equal((await call('/admin/template',{...t,weekRules:{单双甲:'odd',单双乙:'even'}},now,login.cookie)).status,200);assert.deepEqual((await s.get(sh19.id)).names,['单双每周','单双甲']);assert.deepEqual((await s.get('shift:2026-10-26:'+id)).names,['单双每周','单双乙']);assert.deepEqual((await s.get(sh12.id)).names,['单双每周','单双甲','单双乙']);assert.deepEqual((await s.get(custom.id)).names,['独立调整']);const plan=await call('/admin/day-plan',{date:'2026-10-21',weekday:1,_rev:0},now,login.cookie);assert.equal(plan.status,200);const planned=(await call('/dashboard?date=2026-10-21',null,now)).body.shifts.find(x=>x.sourceTemplateId===id);assert.deepEqual(planned.names,['单双每周','单双甲']);assert.equal((await call('/admin/template',{...await s.get(id),weekRules:{单双甲:'invalid'}},now,login.cookie)).status,400)});

test('个人请假不冻结未来整班名单：保存模板及旧快照读取均同步新人',async()=>{
 const {s,call}=fixture(),now=at('2026-10-19','18:00');
 const login=await call('/login',{password:'test-superadmin-only'},now);
 await call('/dashboard?date=2026-10-20',null,now);
 const shift=await s.get('shift:2026-10-20:t37'),name=shift.names[0];
 assert.equal((await call('/admin/attendance',{shiftId:shift.id,name,status:'leave',hours:0,reason:'请假'},now,login.cookie)).status,200);
 const record=await s.get('attendance:'+shift.id+':'+name),t=await s.get('t37');
 assert.equal((await call('/admin/template',{...t,names:[...t.names,'新同学']},now,login.cookie)).status,200);
 assert.ok((await s.get(shift.id)).names.includes('新同学'));
 assert.deepEqual(await s.get(record.id),record);
 // Simulate an old snapshot left behind by the previous all-or-nothing protection.
 await s.save('shift',{...await s.get(shift.id),names:shift.names},shift.id);
 const dashboard=await call('/dashboard?date=2026-10-20',null,now);
 assert.equal(dashboard.status,200);
 assert.ok(dashboard.body.shifts.find(x=>x.id===shift.id).names.includes('新同学'));
 assert.equal(dashboard.body.attendance.find(x=>x.shiftId===shift.id&&x.name===name).status,'leave');
 assert.deepEqual(await s.get(record.id),record);
});

test('已删除未来班次过了上班和下班时间也不复现，旧删除审计兼容且真实记录保留',async()=>{
 const {call,s}=fixture(),deleted=at('2026-10-12','12:00'),later=at('2026-10-20','20:02');
 await call('/dashboard?date=2026-10-20',null,deleted);
 const base={date:'2026-10-20',site:'就业处综合办公室',start:'18:10',end:'20:00',names:['测试'],enabled:false,templateId:'removed',threshold:15};
 await s.insert('shift',base,'shift:old-removed');
 await s.insert('audit',{action:'删除固定班次',target:'removed',createdAt:deleted},'audit:removed');
 await s.insert('shift',{...base,customized:true},'shift:custom-retained');
 await s.insert('shift',base,'shift:record-retained');
 await s.insert('attendance',{shiftId:'shift:record-retained',name:'测试',checkin:at(base.date,'18:10')},'attendance:record-retained');
 for(const now of [deleted,at(base.date,'18:15'),later]){
  const d=(await call('/dashboard?date='+base.date,null,now)).body;
  assert.ok(!d.shifts.some(x=>x.id==='shift:old-removed'));
  assert.ok(!d.attendance.some(x=>x.shiftId==='shift:old-removed'));
  assert.ok(d.shifts.some(x=>x.id==='shift:custom-retained'));
  assert.ok(d.shifts.some(x=>x.id==='shift:record-retained'));
 }
 assert.ok(await s.get('shift:old-removed'));
});
