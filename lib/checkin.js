// Same-site shifts separated by at most a 10-minute class break share one check-in.
const minutes=time=>Number(time.slice(0,2))*60+Number(time.slice(3));
export function groupCheckinShifts(shifts,name){
 const groups=[];
 for(const sh of shifts.filter(s=>s.names.includes(name)&&s.enabled&&!s.leaves?.includes(name)).sort((a,b)=>a.site.localeCompare(b.site)||a.start.localeCompare(b.start))){
  const last=groups.at(-1);
  if(last&&last[0].site===sh.site&&last[0].date===sh.date&&minutes(sh.start)>=minutes(last.at(-1).end)&&minutes(sh.start)-minutes(last.at(-1).end)<=10)last.push(sh);else groups.push([sh]);
 }
 return groups;
}
export function matchCheckinGroup(shifts,name,now,shiftId){
 const at=(s,t)=>Date.parse(s.date+'T'+t+':00+08:00');
 const groups=groupCheckinShifts(shifts,name).filter(g=>now>=at(g[0],g[0].start)-1800000&&now<at(g.at(-1),g.at(-1).end)&&(!shiftId||g.some(s=>s.id===shiftId)));
 const active=groups.filter(g=>now>=at(g[0],g[0].start));
 const candidates=active.length?active:groups;
 if(candidates.length!==1)return {shifts:[],ambiguous:candidates.length>1};
 return {shifts:candidates[0],ambiguous:false};
}

// The first shift sets the deadline for the whole continuous block.
export function isCheckinExpired(group,now){
 if(!group.length)return false;
 const first=group[0];
 return now>Date.parse(first.date+'T'+first.start+':00+08:00')+Number(first.threshold??15)*60000;
}

// Explain unavailable check-in using the same deadline as the server.
export function checkinAvailability(shifts,attendance,name,now,loaded=true){
 if(!name)return {label:'选择姓名打卡',reason:'先选择姓名，再查看今日打卡安排。'};
 if(!loaded)return {label:'读取班次中',reason:'正在读取今天的排班，请稍候。'};
 const mine=shifts.filter(s=>s.names.includes(name));
 if(!mine.length)return {label:'今天没有班次',reason:'今天没有安排你的值班。'};
 const eligible=mine.filter(s=>s.enabled&&!s.leaves?.includes(name));
 if(!eligible.length)return mine.every(s=>s.leaves?.includes(name))?{label:'今日已请假',reason:'今天的班次已登记请假，无需打卡。'}:{label:'今日无需打卡',reason:'今天的班次已停班或请假，无需打卡。'};
 const match=matchCheckinGroup(shifts,name,now);
 if(match.ambiguous)return {label:'排班需要核对',reason:'当前安排了多个场地，请联系管理员核对。'};
 const checked=s=>attendance.some(r=>r.shiftId===s.id&&r.name===name&&r.checkin);
 if(match.shifts.length)return match.shifts.every(checked)?{label:'本班已打卡',reason:'当前班次已完成打卡，无需重复提交。'}:isCheckinExpired(match.shifts,now)?{label:'已超过打卡时限',reason:'已超过迟到阈值，无法打卡。特殊情况请联系办公室示例甲丙丁。'}:{label:'拍照打卡',reason:''};
 const groups=groupCheckinShifts(shifts,name),remaining=groups.filter(g=>!g.every(checked));
 if(!remaining.length)return {label:'今日打卡已完成',reason:'今天需要打卡的班次都已完成打卡。'};
 const next=remaining.filter(g=>now<Date.parse(g[0].date+'T'+g[0].start+':00+08:00')-1800000).sort((a,b)=>a[0].start.localeCompare(b[0].start))[0];
 if(next)return {label:'尚未到打卡时间',reason:`下一班 ${next[0].start} 开始，当前尚未开放打卡。`};
 return {label:'打卡时段已结束',reason:'今天剩余班次的打卡时段已结束，特殊原因请联系办公室示例甲丙丁。'};
}
