import {useEffect,useRef,useState} from 'react';
import {Trophy} from 'lucide-react';
type Player={rank:number,name:string,score:number};
type Run={id:string,moves:number[],score:number,over:boolean,version:number,saved:number,name:string};
async function api(route:string,body?:unknown){const response=await fetch('/api/games/2048/'+route,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(10000)});const data=await response.json();if(!response.ok)throw Error(data.error||'排行榜暂不可用');return data;}
export default function Game2048({name,onChooseName}:{name:string,onChooseName:()=>void}){
 const frame=useRef<HTMLIFrameElement>(null),run=useRef<Run|null>(null),playerName=useRef(name),saving=useRef(false),alive=useRef(true),latestRequest=useRef(0);
 const [players,setPlayers]=useState<Player[]>([]),[mine,setMine]=useState<Player|null>(null),[total,setTotal]=useState(0),[loaded,setLoaded]=useState(false),[message,setMessage]=useState(''),[expanded,setExpanded]=useState(false);
 playerName.current=name;
 async function refresh(){try{const data=await api('leaderboard?name='+encodeURIComponent(playerName.current));if(alive.current){setPlayers(data.players);setMine(data.mine);setTotal(data.total);setLoaded(true)}}catch{if(alive.current)setMessage('排行榜暂未连接，游戏仍可继续。')}}
 async function save(){const current=run.current;if(!current||saving.current||!current.id||!current.score||!playerName.current||current.saved===current.version)return;
  // A run keeps the player name it first used, even if identity changes mid-game.
  current.name ||= playerName.current;saving.current=true;const version=current.version;
  try{await api('score',{id:current.id,moves:current.moves,name:current.name});current.saved=version;if(alive.current){setMessage('最高分已同步');await refresh()}}
  catch(e:any){if(alive.current)setMessage(e.message+'；稍后会自动重试。')}
  finally{saving.current=false}
 }
 useEffect(()=>{alive.current=true;let disposed=false;
  async function receive(event:MessageEvent){const data=event.data;if(event.source!==frame.current?.contentWindow||event.origin!=='null'||data?.channel!=='elite-2048')return;
   if(data.type==='ready'&&Number.isInteger(data.requestId)){
    const request=data.requestId;if(latestRequest.current===request)return;latestRequest.current=request;const previous=run.current;if(previous?.score&&playerName.current){try{await api('score',{id:previous.id,moves:previous.moves,name:previous.name||playerName.current})}catch{await save()}}
    try{const started=await api('start',{});if(disposed||latestRequest.current!==request)return;run.current={id:started.id,moves:[],score:0,over:false,version:0,saved:0,name:''};frame.current?.contentWindow?.postMessage({channel:'elite-2048',type:'start',requestId:request,...started},'*');}
    catch{if(disposed||latestRequest.current!==request)return;run.current=null;setMessage('暂时无法记录排行，本局仍可自由游玩。');frame.current?.contentWindow?.postMessage({channel:'elite-2048',type:'start',requestId:request,id:'offline',seed:crypto.getRandomValues(new Uint32Array(1))[0]},'*');}
   }
   if(data.type==='progress'&&data.id===run.current?.id&&Array.isArray(data.moves)&&data.moves.length<=20000&&data.moves.every((n:unknown)=>Number.isInteger(n)&&Number(n)>=0&&Number(n)<=4)&&Number.isSafeInteger(data.score)){
    const current=run.current!;current.moves=data.moves;current.score=data.score;current.over=!!data.over;current.version++;if(current.over)void save();
   }
  }
  function keydown(event:KeyboardEvent){const direction=['ArrowUp','ArrowRight','ArrowDown','ArrowLeft'].indexOf(event.key);if(direction<0||event.altKey||event.ctrlKey||event.metaKey||event.shiftKey||event.target!==frame.current?.closest('#file-game-panel'))return;event.preventDefault();frame.current?.contentWindow?.postMessage({channel:'elite-2048',type:'move',direction},'*')}
  window.addEventListener('keydown',keydown);window.addEventListener('message',receive);void refresh();const interval=window.setInterval(()=>{void save()},5000),rankingInterval=window.setInterval(()=>{void refresh()},30000);
  return()=>{disposed=true;alive.current=false;latestRequest.current++;window.removeEventListener('keydown',keydown);window.removeEventListener('message',receive);clearInterval(interval);clearInterval(rankingInterval);const current=run.current;if(current?.score&&current.id&&playerName.current&&current.saved!==current.version)void fetch('/api/games/2048/score',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:current.id,moves:current.moves,name:current.name||playerName.current}),keepalive:true}).catch(()=>{})};
 },[]);
 useEffect(()=>{void refresh();void save()},[name]);
 return <><iframe ref={frame} title="2048 等待小游戏" src="/vendor/2048/index.html" sandbox="allow-scripts" loading="eager"/>
 <details className="game-ranking"><summary className="game-ranking-heading"><h3><Trophy size={16}/>2048 排行榜</h3><small>{total} 人上榜</small><span className="game-ranking-toggle"><span className="when-closed">展开</span><span className="when-open">收起</span></span></summary>
 {name?<p className="game-ranking-identity">当前：{name} · 成绩以本局首次记录的姓名上榜</p>:<p className="game-ranking-identity"><button type="button" className="text-btn" onClick={onChooseName}>选择姓名，记录我的成绩</button></p>}
 <p className="game-ranking-note">上榜后，姓名与最高分对所有人可见。仅记录上线后的新游戏。</p>
 {players.length?<ol>{(expanded?players:players.slice(0,5)).map(p=><li key={p.rank} className={p.rank===mine?.rank?'is-me':''}><span className={'game-rank-number rank-'+p.rank}>{p.rank}</span><span className="game-rank-name">{p.name}{p.rank===mine?.rank&&<small>我</small>}</span><strong>{p.score.toLocaleString()}</strong></li>)}</ol>:<p className="game-ranking-empty">{loaded?'还没有成绩，来拿下第一个名次吧。':'正在读取排行…'}</p>}
 {mine&&<p className="game-ranking-mine">我的最高分 <strong>{mine.score.toLocaleString()}</strong><span>第 {mine.rank} 名</span></p>}
 {players.length>5&&<button type="button" className="text-btn game-ranking-more" onClick={()=>setExpanded(v=>!v)}>{expanded?'只看前5名':`查看更多（前 ${players.length} 名）`}</button>}
 {message&&<p className="game-ranking-note" role="status">{message}</p>}</details></>;
}
