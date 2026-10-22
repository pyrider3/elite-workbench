import {useState,useRef,useEffect} from 'react';
import {Download,Image as ImageIcon,X} from 'lucide-react';
import {createPortal} from 'react-dom';
import {posterSections} from '../lib/roster-poster';
type Row=Record<string,any>;
const font='"Noto Sans SC","Microsoft YaHei",system-ui,sans-serif';
function rounded(c:CanvasRenderingContext2D,x:number,y:number,w:number,h:number,r:number,color:string){c.fillStyle=color;c.beginPath();c.roundRect(x,y,w,h,r);c.fill()}
function wrapped(c:CanvasRenderingContext2D,text:string,width:number){const lines:string[]=[];let line='';for(const char of text){if(line&&c.measureText(line+char).width>width){lines.push(line);line=''}line+=char}if(line)lines.push(line);return lines}
export async function renderRosterPoster(templates:Row[]){
 await document.fonts.ready;const sections=posterSections(templates);if(!sections.length)throw Error('当前没有启用的固定班次可导出');
 const canvas=document.createElement('canvas'),c=canvas.getContext('2d');if(!c)throw Error('当前浏览器无法生成图片');const W=2000,margin=76,tableW=W-margin*2,timeW=184,personFont=26;
 c.font=`500 ${personFont}px ${font}`;
 const layout=sections.map(section=>{const cellW=(tableW-timeW)/section.days.length;return {...section,cellW,rows:section.slots.map(slot=>{const cells=slot.cells.map(cell=>({...cell,people:cell.people.map(p=>({...p,lines:wrapped(c,p.name,cellW-48-(p.rule==='all'?0:46))}))}));return {...slot,cells,height:Math.max(108,...cells.map(cell=>28+cell.people.reduce((n,p)=>n+Math.max(1,p.lines.length)*38+12,0)))}})}});
 const H=298+layout.reduce((n,s)=>n+106+70+s.rows.reduce((h,r)=>h+r.height,0)+40,0)+148;if(H>24000)throw Error('排班过长，请选择单个场地分别导出');canvas.width=W;canvas.height=H;
 c.fillStyle='#f1f4fb';c.fillRect(0,0,W,H);c.textBaseline='middle';
 rounded(c,margin,54,8,134,4,'#5364e8');c.fillStyle='#637393';c.font=`600 23px ${font}`;c.fillText('青年菁英 · 值班安排',margin+30,72);c.fillStyle='#182b50';c.font=`700 65px ${font}`;c.fillText('每周固定排班表',margin+26,143);c.fillStyle='#697a99';c.font=`400 25px ${font}`;c.fillText('按星期查看值班人员，单双周按学期周次执行',margin+30,210);
 const stamp=new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());c.font=`400 21px ${font}`;c.textAlign='right';c.fillStyle='#71809b';c.fillText('更新于 '+stamp,W-margin,79);c.textAlign='left';
 let y=286;
 for(const section of layout){
  rounded(c,margin,y,tableW,86,16,'#e5eafa');rounded(c,margin+19,y+20,46,46,12,'#5364e8');c.fillStyle='white';c.font=`700 25px ${font}`;c.textAlign='center';c.fillText(String(layout.indexOf(section)+1).padStart(2,'0'),margin+42,y+44);c.textAlign='left';c.fillStyle='#223858';c.font=`650 32px ${font}`;c.fillText(section.site,margin+84,y+44);y+=106;
  const headerY=y;rounded(c,margin,y,tableW,70,12,'#25395f');c.fillStyle='#fff';c.font=`500 25px ${font}`;c.textAlign='center';c.fillText('班次时间',margin+timeW/2,y+35);section.days.forEach((day,i)=>c.fillText(['周日','周一','周二','周三','周四','周五','周六'][day],margin+timeW+section.cellW*(i+.5),y+35));c.textAlign='left';y+=70;
  for(const [rowIndex,row]of section.rows.entries()){
   c.fillStyle=rowIndex%2?'#f8faff':'#ffffff';c.fillRect(margin,y,tableW,row.height);c.fillStyle='#edf1fa';c.fillRect(margin,y,timeW,row.height);c.fillStyle='#32496d';c.font=`600 27px ${font}`;c.textAlign='center';c.fillText(row.start,margin+timeW/2,y+row.height/2-19);c.fillStyle='#71809a';c.font=`400 24px ${font}`;c.fillText('— '+row.end,margin+timeW/2,y+row.height/2+21);c.textAlign='left';
   row.cells.forEach((cell,i)=>{const x=margin+timeW+i*section.cellW;if(!cell.people.length){c.fillStyle='#adb7c9';c.font=`400 25px ${font}`;c.textAlign='center';c.fillText('—',x+section.cellW/2,y+row.height/2);c.textAlign='left';return}let lineY=y+20;for(const person of cell.people){c.font=`500 ${personFont}px ${font}`;c.fillStyle='#233956';for(const [j,line]of person.lines.entries())c.fillText(line,x+22,lineY+19+j*38);if(person.rule!=='all'){const color=person.rule==='odd'?'#4d5ed2':'#26876c',bg=person.rule==='odd'?'#e9edff':'#e5f4ee';rounded(c,x+section.cellW-55,lineY+3,34,32,7,bg);c.fillStyle=color;c.font=`600 20px ${font}`;c.textAlign='center';c.fillText(person.rule==='odd'?'单':'双',x+section.cellW-38,lineY+19);c.textAlign='left'}lineY+=Math.max(1,person.lines.length)*38+12}});
   c.strokeStyle='#e0e6f0';c.lineWidth=1.5;c.beginPath();c.moveTo(margin,y+row.height);c.lineTo(W-margin,y+row.height);c.stroke();y+=row.height;
  }
  c.strokeStyle='#dbe2ee';c.lineWidth=1.5;for(let i=0;i<=section.days.length;i++){const x=margin+timeW+i*section.cellW;c.beginPath();c.moveTo(x,headerY+70);c.lineTo(x,y);c.stroke()}y+=40;
 }
 c.fillStyle='#61738f';c.font=`400 23px ${font}`;c.fillText('无标记：每周值班     单：仅单周     双：仅双周',margin,y+22);c.fillStyle='#77869e';c.font=`400 21px ${font}`;c.fillText('临时调班、请假及实际到岗状态，以工作台当天排班为准。',margin,y+68);c.textAlign='right';c.fillStyle='#4f60b4';c.fillText('dj.qnjyxh.xyz',W-margin,y+68);
 const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('图片生成失败')),'image/png'));return URL.createObjectURL(blob);
}
export default function RosterImageExport({templates,initialSite='',label='导出排班图片'}:{templates:Row[],initialSite?:string,label?:string}){
 const[open,setOpen]=useState(false),[site,setSite]=useState(''),[url,setUrl]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');const ticket=useRef(0);
 useEffect(()=>()=>{ticket.current++},[]);useEffect(()=>()=>{if(url)URL.revokeObjectURL(url)},[url]);
 useEffect(()=>{if(!open)return;const old=document.body.style.overflow;document.body.style.overflow='hidden';const key=(e:KeyboardEvent)=>{if(e.key==='Escape')close()};document.addEventListener('keydown',key);return()=>{document.body.style.overflow=old;document.removeEventListener('keydown',key)}},[open]);
 function close(){ticket.current++;setOpen(false);setBusy(false);setUrl('')}
 async function generate(selected=''){setOpen(true);setSite(selected);setError('');setBusy(true);const current=++ticket.current;try{const image=await renderRosterPoster(templates.filter(t=>!selected||t.site===selected));if(current===ticket.current)setUrl(image);else URL.revokeObjectURL(image)}catch(e:any){if(current===ticket.current)setError(e.message)}finally{if(current===ticket.current)setBusy(false)}}
 return <><button type="button" className="roster-export-button" onClick={()=>generate(initialSite)}><ImageIcon size={16}/>{label}</button>{open&&createPortal(<div className="roster-export-overlay" onClick={close}><section className="roster-export-dialog" role="dialog" aria-modal="true" aria-label="导出排班图片" onClick={e=>e.stopPropagation()}><header><h2>排班图片预览</h2><button type="button" className="icon" aria-label="关闭图片预览" onClick={close}><X size={18}/></button></header><div className="roster-export-sites" role="group" aria-label="导出场地">{[{value:'',label:'全部场地'},...[...new Set(templates.map(t=>t.site))].map(s=>({value:s,label:s}))].map(s=><button key={s.value} type="button" aria-pressed={site===s.value} disabled={busy} onClick={()=>generate(s.value)}>{s.label}</button>)}</div><div className="roster-export-body">{busy?<p className="compact-empty">正在排版并生成高清图片…</p>:error?<p className="entry-error" role="alert">{error}</p>:url&&<a className="roster-image-preview" href={url} target="_blank" rel="noreferrer"><img src={url} alt="每周固定排班表图片预览"/></a>}</div><footer><p className="roster-image-note">手机可长按图片保存，也可点击下方下载</p><a className={'primary roster-image-download'+(busy||!url?' disabled':'')} href={busy||!url?undefined:url} download={'菁英值班表-'+(site||'全部场地')+'.png'} onClick={e=>{if(busy||!url)e.preventDefault()}}><Download size={16}/>下载{site?'此场地':'全部场地'}图片</a></footer></section></div>,document.body)}</>;
}
