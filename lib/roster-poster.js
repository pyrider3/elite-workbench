const dayLabels=['周日','周一','周二','周三','周四','周五','周六'];
export function posterSections(templates){
 const days=[1,2,3,4,5,...[6,0].filter(d=>templates.some(t=>t.enabled&&Number(t.weekday)===d))];
 return [...new Set(templates.map(t=>t.site))].sort((a,b)=>a.localeCompare(b,'zh-CN')).map(site=>({site,days,slots:[...new Set(templates.filter(t=>t.site===site&&t.enabled).map(t=>t.start+'|'+t.end))].sort().map(slot=>({start:slot.split('|')[0],end:slot.split('|')[1],cells:days.map(day=>({day,label:dayLabels[day],people:templates.filter(t=>t.site===site&&t.enabled&&Number(t.weekday)===day&&t.start+'|'+t.end===slot).flatMap(t=>t.names.map(name=>({name,rule:t.weekRules?.[name]||'all'})))}))}))})).filter(s=>s.slots.length);
}
