import {useState,useEffect} from 'react';
import {ChevronLeft,ChevronRight} from 'lucide-react';
export default function RecordPagination({current,pages,onChange}:{current:number,pages:number,onChange:(page:number)=>void}){
 const [target,setTarget]=useState(String(current));
 useEffect(()=>setTarget(String(current)),[current]);
 return <nav className="application-pagination" aria-label="结果分页"><span>第 {current} / {pages} 页 · 每页 12 份</span><div><button aria-label="上一页结果" disabled={current===1} onClick={()=>onChange(current-1)}><ChevronLeft size={16}/>上一页</button><button aria-label="下一页结果" disabled={current===pages} onClick={()=>onChange(current+1)}>下一页<ChevronRight size={16}/></button></div><form className="page-jump" onSubmit={e=>{e.preventDefault();const n=Number(target);if(Number.isInteger(n)&&n>=1&&n<=pages)onChange(n)}}><label>跳至<input aria-label="跳转页码" type="number" min="1" max={pages} step="1" required value={target} onChange={e=>setTarget(e.target.value)}/>页</label><button type="submit">跳转</button></form></nav>
}
