import {useRef,useState} from 'react';
import {Check} from 'lucide-react';
const options=[['auto','恢复自动判断'],['credited','已计时'],['leave','已请假'],['absent','未到岗'],['late','迟到'],['cancelled','已停班']];
export default function AttendanceEditor({data,busy,submit}:{data:Record<string,any>,busy:boolean,submit:(value:Record<string,any>)=>Promise<boolean>}){
 const [status,setStatus]=useState(options.some(([s])=>s===data.status)?data.status:'auto'),[hours,setHours]=useState(String(data.hours||0)),[reason,setReason]=useState(data.reason||''),[error,setError]=useState('');const lock=useRef(false);
 function choose(s:string){setStatus(s);if(['leave','cancelled'].includes(s))setHours('0')}
 return <form className="attendance-editor" onSubmit={async e=>{e.preventDefault();if(lock.current||busy)return;setError('');if(!reason.trim()){setError('请填写本次修改原因');return}const value=Number(hours);if(status!=='auto'&&(!hours.trim()||!Number.isFinite(value)||value<0||value>24)){setError('时长请填写0至24小时');return}lock.current=true;try{await submit({...data,status,hours:value,reason:reason.trim()})}finally{lock.current=false}}}>
 <div className="shift-context"><strong>{data.name}<span className="attendance-context-date">{data.date}</span></strong><span>{data.site} · {data.start}—{data.end}</span></div>
 {data.photo&&<a className="attendance-photo-link" href={'/api/photo/'+encodeURIComponent(data.photo)} target="_blank" rel="noreferrer">查看到场照片 ↗</a>}
 <fieldset className="attendance-status"><legend>处理结果</legend><div>{options.map(([value,label])=><button type="button" key={value} aria-pressed={status===value} disabled={busy} onClick={()=>choose(value)}>{label}</button>)}</div></fieldset>
 {status!=='auto'&&<label className="attendance-hours-field"><span>计入志愿时长</span><div><input aria-label="计入志愿时长" type="number" step="0.01" min="0" max="24" required value={hours} disabled={busy||['leave','cancelled'].includes(status)} onChange={e=>setHours(e.target.value)}/><span>小时</span></div></label>}
 {status==='auto'&&<small className="attendance-hint">取消个人手动处理及本人的排班请假，按打卡和时间重新判断。整班停班仍需在班次调整中恢复。</small>}
 {['leave','cancelled'].includes(status)&&<small className="attendance-hint">请假或停班不计入时长。</small>}
 <label className="attendance-reason"><span>修改原因</span><textarea aria-label="修改原因" placeholder="例如：已核实请假、补记实际值班时长" rows={2} maxLength={1000} required disabled={busy} value={reason} onChange={e=>setReason(e.target.value)}/></label>
 {error&&<p className="shift-error" role="alert">{error}</p>}<button className="primary shift-save" disabled={busy||!reason.trim()}>{busy?'正在保存…':'保存处理结果'}<Check size={16}/></button>
 </form>
}
