import test from 'node:test';import assert from 'node:assert/strict';
import {synchronizedShift} from '../lib/shift-sync.js';
const now=Date.parse('2026-10-19T18:00:00+08:00');
const sh={id:'shift:2026-10-20:t37',templateId:'t37',date:'2026-10-20',site:'基地',start:'16:30',end:'18:30',names:['甲','乙'],leaves:[],enabled:true,_rev:3};
const template={id:'t37',_rev:9,site:'基地',weekday:2,start:'16:30',end:'18:30',names:['甲','乙','丙'],enabled:true};
const records=[{shiftId:sh.id,name:'乙',override:{status:'leave',hours:0}}];
test('未来班次已有个人请假仍同步新增人员，保留记录及班次版本',()=>{const next=synchronizedShift(sh,template,records,now);assert.deepEqual(next.names,['甲','乙','丙']);assert.equal(next._rev,3);assert.equal(next.id,sh.id);assert.equal(records[0].override.status,'leave')});
test('保护已打卡或已处理人员的身份时间，保护单日调整和历史',()=>{for(const t of [{...template,names:['甲','丙']},{...template,start:'17:00'},{...template,enabled:false}])assert.equal(synchronizedShift(sh,t,records,now),null);assert.equal(synchronizedShift({...sh,customized:true},template,[],now),null);assert.equal(synchronizedShift(sh,template,[],Date.parse('2026-10-21T00:00:00+08:00')),null)});
test('同步按学期单双周过滤且重复读取不重复写入',()=>{const t={...template,weekRules:{丙:'even'}};const next=synchronizedShift(sh,t,records,now);assert.deepEqual(next.names,['甲','乙']);assert.equal(synchronizedShift(next,t,records,now),null)});
