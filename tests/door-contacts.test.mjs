import test from 'node:test';import assert from 'node:assert/strict';import {doorContact} from '../lib/door-contacts.js';
test('开门责任人按北京时间日期星期轮换，周末同一人且联系方式准确',()=>{
 const names=['示例甲辰戌','示例甲子乙','示例甲卯己','示例甲戌午','示例甲卯癸','示例甲癸酉','示例甲辰戌'];for(let i=0;i<7;i++)assert.equal(doorContact('2026-10-'+String(11+i)).name,names[i]);
 assert.deepEqual(doorContact('2026-10-12'),{name:'示例甲子乙',phone:'13000000000',wechat:'example-wechat-2'});assert.deepEqual(doorContact('2026-10-18'),{name:'示例甲辰戌',phone:'13000000000',wechat:'example-wechat-7'});
 assert.equal(doorContact('2026-10-13').wechat,'example-wechat-3');assert.equal(doorContact('2026-10-14').phone,'example-wechat-4');assert.equal(doorContact('2026-10-15').phone,'13000000000');assert.equal(doorContact('2026-10-16').wechat,'example-wechat-6');
});
