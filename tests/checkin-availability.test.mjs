import test from 'node:test';import assert from 'node:assert/strict';import {checkinAvailability} from '../lib/checkin.js';
const at=t=>Date.parse('2026-10-12T'+t+':00+08:00'),shift={id:'a',date:'2026-10-12',site:'办公室',start:'08:20',end:'10:00',enabled:true,names:['测试甲'],leaves:[]};
test('打卡原因覆盖未选择、加载、无班、未开放、开放边界、已打卡、结束、请假与多场地',()=>{
 const state=(shifts,records=[],now=at('08:20'))=>checkinAvailability(shifts,records,'测试甲',now);
 assert.equal(checkinAvailability([],[],'',at('08:20')).label,'选择姓名打卡');
 assert.equal(checkinAvailability([],[],'测试甲',at('08:20'),false).label,'读取班次中');
 assert.equal(state([]).label,'今天没有班次');
 assert.equal(state([shift],[],at('07:49')).label,'尚未到打卡时间');
 assert.equal(state([shift],[],at('07:50')).label,'拍照打卡');
 assert.equal(state([shift],[],at('08:35')).label,'拍照打卡');
 assert.equal(state([shift],[],at('08:35')+1).label,'已超过打卡时限');
 assert.match(state([shift],[],at('08:36')).reason,/办公室示例甲丙乙/);
 assert.equal(state([{...shift,threshold:20}],[],at('08:40')).label,'拍照打卡');
 assert.equal(state([{...shift,threshold:0}],[],at('08:20')+1).label,'已超过打卡时限');
 assert.equal(state([shift],[{shiftId:'a',name:'测试甲',checkin:at('08:20')}]).label,'本班已打卡');
 assert.equal(state([shift],[],at('10:00')).label,'打卡时段已结束');
 assert.equal(state([{...shift,leaves:['测试甲']}]).label,'今日已请假');
 assert.equal(state([{...shift,enabled:false}]).label,'今日无需打卡');
 assert.equal(state([shift,{...shift,id:'b',site:'另一场地'}]).label,'排班需要核对');
});
test('连续班次共享一次打卡提示，但下午新班次仍正常开放',()=>{
 const second={...shift,id:'b',start:'10:00',end:'12:00'},third={...shift,id:'c',start:'14:00',end:'16:00'},records=['a','b'].map(shiftId=>({shiftId,name:'测试甲',checkin:at('08:00')}));
 assert.equal(checkinAvailability([shift,second,third],records,'测试甲',at('10:30')).label,'本班已打卡');
 assert.equal(checkinAvailability([shift,second,third],[],'测试甲',at('10:00')).label,'已超过打卡时限');
 assert.equal(checkinAvailability([shift,second,third],records,'测试甲',at('13:00')).label,'尚未到打卡时间');
 assert.equal(checkinAvailability([shift,second,third],records,'测试甲',at('13:30')).label,'拍照打卡');
});
