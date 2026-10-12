import Select from './Select';
import {copyText} from './clipboard';
import {latestFirst,recordTimeLabel} from '../lib/record-order.js';
import RecordPagination from './RecordPagination';
import {useState,useRef} from 'react';
import {Search,Download,Copy} from 'lucide-react';
type Row=Record<string,any>;
export default function ApplicationsManager({rows,user,busy,onMark,onExport,notify}:{rows:Row[],user:Row,busy:boolean,onMark:(row:Row)=>Promise<boolean>,onExport:(rows:Row[])=>void,notify:(message:string,ok?:boolean)=>void}){
  const [query,setQuery]=useState(''),[grade,setGrade]=useState(''),[department,setDepartment]=useState(''),[interest,setInterest]=useState(''),[status,setStatus]=useState(''),[page,setPage]=useState(1);
  const [optimistic,setOptimistic]=useState<Record<string,boolean>>({});
  const pendingRef=useRef(new Set<string>());
  const displayRows=rows.map(r=>Object.hasOwn(optimistic,r.id)?{...r,contacted:optimistic[r.id]}:r);
  async function mark(row:Row){
    if(pendingRef.current.has(row.id))return;
    pendingRef.current.add(row.id);
    setOptimistic(prev=>({...prev,[row.id]:!row.contacted}));
    try{await onMark(row)}catch{notify('保存失败，请重试',false)}finally{
      pendingRef.current.delete(row.id);
      setOptimistic(prev=>{const next={...prev};delete next[row.id];return next});
    }
  }
  const scoped=user.department;
  const resultsRef=useRef<HTMLDivElement>(null);
  function turnPage(next:number){setPage(next);resultsRef.current?.scrollIntoView({block:'start',behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'})}
  const departments=Array.from(new Set(rows.flatMap(r=>[r.department,r.other_department]).filter(v=>v&&v!=='无'&&v!=='暂不选择'))).sort();
  const grades=Array.from(new Set(rows.map(r=>r.grade).filter(Boolean))).sort();
  const filtered=displayRows.filter(r=>(!query||[r.name,r.college,r.department,r.other_department,r.contact].some(v=>String(v||'').toLowerCase().includes(query.trim().toLowerCase())))&&(!grade||r.grade===grade)&&(!department||r.department===department||r.other_department===department)&&(!interest||(interest==='first'?r.department===scoped:r.other_department===scoped&&r.department!==scoped))&&(!status||(status==='contacted'?r.contacted:!r.contacted)));
  filtered.sort(latestFirst);
  const pages=Math.max(1,Math.ceil(filtered.length/12)),current=Math.min(page,pages),visible=filtered.slice((current-1)*12,current*12);
  function change(setter:(value:string)=>void,value:string){setter(value);setPage(1)}
  async function copy(value:string){try{await copyText(value);notify('联系方式已复制')}catch{notify('复制失败，请长按联系方式复制',false)}}
  return <div className="applications-manager">
    <div className="section-head"><div><h2>{scoped||'协会'}报名管理</h2><p className="muted">{user.role==='viewer'?'可查看报名信息和联系状态':'筛选报名，查看介绍，记录联系进度'}</p></div><button onClick={()=>onExport(filtered)} disabled={!filtered.length}><Download size={16}/>导出筛选结果</button></div>
    <div className="application-counts"><span>报名 <strong>{rows.length}</strong></span><span>待联系 <strong>{displayRows.filter(r=>!r.contacted).length}</strong></span><span>已联系 <strong>{displayRows.filter(r=>r.contacted).length}</strong></span></div>
    <div className="application-filters"><label className="search"><Search size={17}/><input aria-label="搜索报名" placeholder="姓名、学院、部门或联系方式" value={query} onChange={e=>change(setQuery,e.target.value)}/></label><Select aria-label="报名年级" value={grade} onChange={e=>change(setGrade,e.target.value)}><option value="">全部年级</option>{grades.map(g=><option key={g}>{g}</option>)}</Select>{scoped?<Select aria-label="报名意向" value={interest} onChange={e=>change(setInterest,e.target.value)}><option value="">全部相关报名</option><option value="first">第一意向本部门</option><option value="other">其他意向本部门</option></Select>:<Select aria-label="报名部门" value={department} onChange={e=>change(setDepartment,e.target.value)}><option value="">全部部门</option>{departments.map(d=><option key={d}>{d}</option>)}</Select>}<Select aria-label="联系状态" value={status} onChange={e=>change(setStatus,e.target.value)}><option value="">全部联系状态</option><option value="pending">待联系</option><option value="contacted">已联系</option></Select></div>
    <div className="application-results" ref={resultsRef}><span>找到 {filtered.length} / {rows.length} 份报名</span>{(query||grade||department||interest||status)&&<button onClick={()=>{setQuery('');setGrade('');setDepartment('');setInterest('');setStatus('');setPage(1)}}>清除筛选</button>}</div>
    <div className="application-cards">{visible.map(r=><article className={'application-card'+(r.contacted?' is-contacted':'')} key={r.id}><div className="application-card-head"><div><h3>{r.name}<span>{r.grade||'未填年级'}</span></h3><p>{r.college||'未填写学院'}</p><time className="record-submitted">{recordTimeLabel(r.createdAt)}</time></div>{user.role==='viewer'?<span className={'application-status '+(r.contacted?'done':'')}>{r.contacted?'已联系':'待联系'}</span>:<label className="application-contact-toggle"><input type="checkbox" checked={!!r.contacted} disabled={busy||Object.hasOwn(optimistic,r.id)} onChange={()=>mark(r)}/><span>{r.contacted?'已联系':'标记已联系'}{Object.hasOwn(optimistic,r.id)&&' · 保存中…'}</span></label>}</div><div className="application-interests"><span>第一意向 <b>{r.department||'未填写'}</b></span>{r.other_department&&r.other_department!=='无'&&<span>其他意向 <b>{r.other_department}</b></span>}</div><div className="application-contact"><span>{r.contact||'未填写联系方式'}</span>{r.contact&&<button onClick={()=>copy(r.contact)} aria-label={'复制'+r.name+'的联系方式'}><Copy size={14}/>复制</button>}</div><details><summary>自我介绍与备注</summary><div><p>{r.introduction||'未填写自我介绍'}</p>{r.note&&<p><span className="muted">备注：</span>{r.note}</p>}</div></details></article>)}</div>
    {!filtered.length&&<div className="empty"><Search size={28}/><p>{rows.length?'没有符合筛选条件的报名':'还没有收到报名信息'}</p></div>}
    {filtered.length>0&&<RecordPagination current={current} pages={pages} onChange={turnPage}/>}
  </div>
}
