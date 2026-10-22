const value=v=>Array.isArray(v)?v.join('、'):String(v??'');
export function responseSummary(row){
 const fields=row.fields||[],filled=f=>value(row.answers?.[f.id]).trim();
 const name=fields.find(f=>/姓名|名字/.test(f.label)&&filled(f));
 const college=fields.find(f=>/学院|院系|学校|专业/.test(f.label)&&filled(f));
 const contact=fields.find(f=>(f.type==='phone'||/电话|手机|联系方式|微信/.test(f.label))&&filled(f));
 const phone=contact?filled(contact):'';
 const extra=fields.filter(f=>f!==name&&f!==college&&f!==contact&&filled(f)).slice(0,2);
 return {name:name?filled(name):'报名记录',info:[college&&filled(college),phone?(/^1\d{10}$/.test(phone)?phone.slice(0,3)+'****'+phone.slice(-4):phone):'',...(!college&&!contact?extra.map(f=>f.label+'：'+filled(f)):[])].filter(Boolean).join(' · ')};
}
export function resultsTable(rows){
 const columns=new Map();for(const r of rows)for(const f of r.fields){const key=JSON.stringify([f.label,f.type]);if(!columns.has(key))columns.set(key,f.label)}
 const keys=[...columns.keys()],labels=[...columns.values()],seen=new Map();const headers=labels.map(l=>{const n=(seen.get(l)||0)+1;seen.set(l,n);return n===1?l:l+'（'+n+'）'});
 return [['提交时间（北京时间）','入口','表单','版本',...headers],...rows.map(r=>{const answers=new Map(r.fields.map(f=>[JSON.stringify([f.label,f.type]),value(r.answers[f.id])]));return [new Date(r.createdAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}),'/'+r.slot,r.formTitle,r.versionId,...keys.map(k=>answers.get(k)||'')]})];
}
