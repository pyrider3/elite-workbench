export function recordTimestamp(value){const time=typeof value==='number'?value:Date.parse(value);return Number.isFinite(time)?time:0}
export function latestFirst(a,b){return recordTimestamp(b.createdAt)-recordTimestamp(a.createdAt)||String(b.id||'').localeCompare(String(a.id||''))}
export function recordTimeLabel(value){const time=recordTimestamp(value);return time?new Date(time).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}):'提交时间未记录'}
