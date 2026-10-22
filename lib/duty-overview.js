const instant=(date,time)=>Date.parse(`${date}T${time}:00+08:00`);
export function filterDutyRows(rows,{date,site='',query='',mode='all',status='all',hideEnded=false,now=Date.now()}){
 const search=query.trim();return rows.filter(r=>r.date===date&&(!site||r.site===site)&&(!search||r.name.includes(search))&&(status==='all'||r.status===status)&&(!hideEnded||now<instant(r.date,r.end))&&(mode==='all'||mode==='abnormal'&&['late','absent'].includes(r.status)||mode==='current'&&now>=instant(r.date,r.start)&&now<instant(r.date,r.end)));
}
export function groupDutyRows(rows){
 const groups=new Map();for(const r of rows){const key=r.shiftId||JSON.stringify([r.site,r.start,r.end]);if(!groups.has(key))groups.set(key,{shiftId:r.shiftId,site:r.site,start:r.start,end:r.end,rows:[]});groups.get(key).rows.push(r)}
 return [...groups.values()].sort((a,b)=>a.site.localeCompare(b.site,'zh-CN')||a.start.localeCompare(b.start)||a.end.localeCompare(b.end));
}
