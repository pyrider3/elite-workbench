import test from 'node:test';import assert from 'node:assert/strict';import {parseLocal,validateRecords,createVolunteerRecognizer} from '../lib/volunteer-parser.mjs';
test('本地降级规则：多人、多行、小数时长，不把日期当作时长',()=>{
 const r=parseLocal('张三、李四在10月11日双选会中搬物资，各加3小时\n王五在讲座中搬椅子，加1.5小时');assert.equal(r.length,3);assert.equal(r[0].hours,3);assert.equal(r[2].hours,1.5);assert.equal(r[0].name,'张三');assert.match(r[0].event,/双选会/);
 assert.throws(()=>parseLocal('张三参加活动'),/时长/);assert.throws(()=>validateRecords([{name:'张三',event:'活动',hours:0.001}]));assert.throws(()=>validateRecords(Array(51).fill({name:'张三',event:'活动',hours:3})));
});

test('用户原句及中文时长降级兼容，只保留额外服务备注',()=>{
 const r=parseLocal('李斯在校园中搬东西加三个小时')[0];assert.equal(r.name,'李斯');assert.equal(r.hours,3);assert.equal(r.event,'校园');assert.equal(r.note,'搬东西');
 assert.equal(parseLocal('张三在搬东西，加3小时')[0].note,'');
 for(const [phrase,hours] of [['两小时',2],['十小时',10],['十五小时',15],['二十一个小时',21],['一个小时半',1.5],['一个半小时',1.5],['两小时半',2.5],['半个小时',.5],['三点五小时',3.5]])assert.equal(parseLocal('张三在讲座中搬椅子，加'+phrase)[0].hours,hours);
 assert.throws(()=>parseLocal('张三在讲座中搬物资，加101小时'));
});

const records=[{name:'张三',hours:3,event:'搬东西',note:'今天'}];
const response=(text=JSON.stringify({r:records.map(({name,hours,event,note})=>[name,hours,event,note])}),status='completed')=>Response.json({status,output:[{type:'message',role:'assistant',content:[{type:'output_text',text}]}]});

test('豆包直接API：关闭思考、不保存上下文、同内容并发去重和缓存隔离',async()=>{
 let calls=0;
 const recognize=createVolunteerRecognizer({apiKey:'test-only',fetchImpl:async(url,options)=>{
  calls++;assert.equal(url,'https://ark.cn-beijing.volces.com/api/v3/responses');assert.equal(options.headers.Authorization,'Bearer test-only');
  const body=JSON.parse(options.body);assert.equal(body.model,'doubao-seed-2-0-mini-260428');assert.equal(body.thinking.type,'disabled');assert.equal(body.store,false);assert.equal(body.text.format.type,'json_object');assert.equal(body.input[1].content,'今天张三搬东西加三个小时');assert.equal(body.tools,undefined);
  return response();
 }});
 const [a,b]=await Promise.all([recognize('今天张三搬东西加三个小时'),recognize('今天张三搬东西加三个小时')]);
 assert.equal(a.engine,'豆包 AI 识别');assert.deepEqual(a,b);a.records[0].hours=99;
 assert.equal((await recognize('今天张三搬东西加三个小时')).records[0].hours,3);assert.equal(b.records[0].hours,3);assert.equal(calls,1);
});

test('豆包代码块换行兼容、业务错误和失败后重试',async()=>{
 let answer;const recognize=createVolunteerRecognizer({apiKey:'test-only',fetchImpl:async()=>response(answer)});
 const payload=JSON.stringify({records});
 for(const [i,text] of [payload+'\n','```json\n'+payload+'\n```\n',' \n```JSON\r\n'+payload+'\r\n```\r\n','```\n'+payload+'\n```\n'].entries()){
  answer=text;assert.deepEqual((await recognize('格式验证'+i)).records,records);
 }
 answer='{"error":"请明确每个人的时长"}';await assert.rejects(recognize('需要重试'),e=>e.status===400&&e.message==='请明确每个人的时长');
 answer=payload;assert.deepEqual((await recognize('需要重试')).records,records);
 answer='不是JSON';await assert.rejects(recognize('错误响应'),e=>e.status===503);
 answer=JSON.stringify({records:[{...records[0],hours:101}]});await assert.rejects(recognize('超范围'),e=>e.status===503);
});

test('豆包不完整输出、限流、授权和超时不泄漏上游信息',async()=>{
 for(const status of ['incomplete','failed']){
  const recognize=createVolunteerRecognizer({apiKey:'test-only',fetchImpl:async()=>response(undefined,status)});
  await assert.rejects(recognize('不完整结果'),e=>e.status===503);
 }
 for(const status of [401,403,429,500]){
  const recognize=createVolunteerRecognizer({apiKey:'test-only',fetchImpl:async()=>Response.json({error:{message:'private upstream details'}},{status})});
  await assert.rejects(recognize('API异常'),e=>e.status===(status===429?429:503)&&!e.message.includes('private'));
 }
 let calls=0;const recognize=createVolunteerRecognizer({apiKey:'test-only',fetchImpl:async()=>{if(++calls===1)throw new DOMException('upstream timeout','TimeoutError');return response()}});
 await assert.rejects(recognize('超时重试'),e=>e.status===503&&e.message.includes('超时'));
 assert.deepEqual((await recognize('超时重试')).records,records);
 const missing=createVolunteerRecognizer({apiKey:'',fetchImpl:async()=>{throw Error('should not call')}});
 await assert.rejects(missing('未配置'),e=>e.status===503);
});

test('豆包并发限制及完成后释放，不合并不同内容',async()=>{
 const pending=[];const recognize=createVolunteerRecognizer({apiKey:'test-only',fetchImpl:()=>new Promise(resolve=>pending.push(resolve))});
 const a=recognize('并发甲'),b=recognize('并发乙');
 await assert.rejects(recognize('并发丙'),e=>e.status===429);
 assert.equal(pending.length,2);pending.shift()(response());pending.shift()(response());await Promise.all([a,b]);
 const c=recognize('并发丙');assert.equal(pending.length,1);pending.shift()(response());await c;
});


test('精简数组保持姓名时长顺序及逗号引号换行，兼容旧对象格式',async()=>{
 const expected=[{name:'张三',hours:.5,event:'整理资料、登记名单',note:'10月11日\n地点："活动室",二楼'},{name:'李四',hours:2.5,event:'搬物资',note:''}];
 let answer=JSON.stringify({r:expected.map(({name,hours,event,note})=>[name,hours,event,note])});
 const recognize=createVolunteerRecognizer({apiKey:'test-only',fetchImpl:async(_,o)=>{assert.match(JSON.parse(o.body).input[0].content,/"r"/);return response(answer)}});
 assert.deepEqual((await recognize('数组格式')).records,expected);
 answer=JSON.stringify({records:expected});assert.deepEqual((await recognize('旧格式')).records,expected);
});

test('精简数组拒绝缺列、错位、额外列、超范围、空记录及超过50人',async()=>{
 let answer;const recognize=createVolunteerRecognizer({apiKey:'test-only',fetchImpl:async()=>response(answer)});
 const invalid=[{r:null},{r:[]},{r:[['张三',3,'搬物资']]},{r:[['张三','搬物资',3,'']]},{r:[['张三',3,'搬物资','',99]]},{r:[['张三',101,'搬物资','']]},{r:[['张三',0,'搬物资','']]},{r:[['张三',3,'','']]},{r:[['张三',3,'搬物资',null]]},{r:Array(51).fill(['张三',3,'搬物资',''])}];
 for(const [i,data] of invalid.entries()){answer=JSON.stringify(data);await assert.rejects(recognize('非法数组'+i),e=>e.status===503);}
 answer=JSON.stringify({r:Array(50).fill(['张三',3,'搬物资',''])});assert.equal((await recognize('50条完整记录')).records.length,50);
});
