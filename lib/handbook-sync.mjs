import crypto from 'node:crypto';
const ORIGIN='https://zbsc.qnjyxh.xyz';
const text=value=>String(value??'');
const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
export function readableContent(html){
 const source=text(html),images=[...source.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)].map(m=>{try{const url=new URL(m[1],ORIGIN);return url.origin===ORIGIN&&/^\/media\/[a-zA-Z0-9._-]+$/.test(url.pathname)?url.href:null}catch{return null}}).filter(Boolean);
 const plain=source.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,'').replace(/<\/(?:p|div|h[1-6]|li|tr|blockquote|section)>|<br\s*\/?\s*>/gi,'\n').replace(/<[^>]*>/g,'').replace(/&(?:nbsp|amp|lt|gt|quot|apos|#39);/g,v=>({'&nbsp;':' ','&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'",'&#39;':"'"}[v])).replace(/&#(x[0-9a-f]+|\d+);/gi,(all,n)=>{const code=n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):Number(n);return code>0&&code<=0x10ffff?String.fromCodePoint(code):all}).replace(/[ \t]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
 return {text:plain,images:[...new Set(images)]};
}
export function importHandbook({sqlite,ledger,completions,history,clock=Date.now}){
 if(![ledger,completions,history].every(Array.isArray))throw Error('手册数据格式无效');
 const completionMap=new Map(completions.map(c=>[c.id,c])),historyMap=new Map(history.map(h=>[h.id,h]));let imported=0,existing=0,skipped=0;
 for(const item of ledger){
  if(item.status!=='recognized'){skipped++;continue}
  const name=text(item.name).trim(),hours=Number(item.hours),ledgerId=text(item.id),completion=completionMap.get(item.completionId||item.taskId);
  if(!ledgerId||ledgerId.length>120||!name||name.length>40||!Number.isFinite(hours)||hours<0.01||hours>1||!Number.isFinite(Date.parse(item.recognizedAt))){skipped++;continue}
  const id='volunteer:handbook:'+digest(ledgerId),proofId='handbook-proof:'+digest(ledgerId);
  if(sqlite.prepare("SELECT id FROM entries WHERE id=?").get(id)){existing++;continue}
  const revisions=(completion?.revisionIds||[]).map(r=>historyMap.get(r)).filter(r=>r&&r.pageKey===item.pageKey).map(r=>({id:r.id,name:text(r.name),at:r.at,summary:text(r.summary),version:r.version,before:readableContent(r.before),after:readableContent(r.after)}));
  const title=text(item.pageTitle||item.taskTitle||'手册完善'),url=ORIGIN+'/guide/'+encodeURIComponent(text(item.pageKey));
  const proof={ledgerId,completionId:item.completionId||item.taskId||null,pageKey:item.pageKey,title,url,name,hours,verifiedBy:text(item.reviewer),verifiedAt:item.recognizedAt,summary:text(completion?.summary),revisions,importedAt:clock()};
  const record={name,hours,event:'基地值班手册完善 · '+title,note:'手册已核实，待工作台审核。'+(proof.summary?'\n贡献说明：'+proof.summary:'')+'\n核实人：'+proof.verifiedBy+'；核实时间：'+item.recognizedAt,status:'pending',createdAt:clock(),source:{type:'handbook',ledgerId,proofId,url,verifiedAt:item.recognizedAt}};
  sqlite.exec('BEGIN IMMEDIATE');try{sqlite.prepare('INSERT INTO entries(id,kind,data) VALUES(?,?,?)').run(proofId,'handbook-proof',JSON.stringify(proof));sqlite.prepare('INSERT INTO entries(id,kind,data) VALUES(?,?,?)').run(id,'volunteer',JSON.stringify(record));sqlite.exec('COMMIT');imported++}catch(e){sqlite.exec('ROLLBACK');throw e}
 }
 return {imported,existing,skipped};
}
export function startHandbookSync({sqlite,clock=Date.now,fetcher=fetch,intervalMs=60000,logger=console}){
 let active=null,stopped=false;
 async function read(name){const response=await fetcher(ORIGIN+'/handbook/api/'+name,{signal:AbortSignal.timeout(15000),redirect:'error'});if(!response.ok)throw Error('手册接口暂不可用：'+response.status);const bytes=await response.text();if(bytes.length>20*1024*1024)throw Error('手册数据超出同步上限');const data=JSON.parse(bytes);if(!Array.isArray(data))throw Error('手册数据格式无效');return data}
 function tick(){if(stopped)return Promise.resolve();if(active)return active;active=(async()=>{try{const [ledger,completions,history]=await Promise.all([read('ledger'),read('completions'),read('history')]);const result=importHandbook({sqlite,clock,ledger,completions,history});if(result.imported)logger.info('[手册同步] 新增待审核记录：'+result.imported);return result}catch(e){logger.error('[手册同步] 将自动重试：'+e.message);return {error:true}}})().finally(()=>{active=null});return active}
 const timer=setInterval(tick,intervalMs);timer.unref();void tick();return {tick,async stop(){stopped=true;clearInterval(timer);await active}};
}
