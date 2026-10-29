import crypto from 'node:crypto';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=['grid','tile','game_manager'].map(n=>readFileSync(new URL(`../public/vendor/2048/js/${n}.js`,import.meta.url),'utf8')).join('\n');
const replayScript=new vm.Script(source+`
var rng=seed>>>0; Math.random=function(){rng=(Math.imul(rng,1664525)+1013904223)>>>0;return rng/4294967296};
function Input(){this.on=function(){}};
function Actuator(){this.actuate=function(){};this.continueGame=function(){}};
function Storage(){this.getGameState=function(){return null};this.getBestScore=function(){return 0};this.setBestScore=this.clearGameState=this.setGameState=function(){}};
var game=new GameManager(4,Input,Actuator,Storage);
for(var i=0;i<moves.length;i++){if(moves[i]===4){if(game.won)game.keepPlaying=true}else game.move(moves[i])};
var result={score:game.score,over:game.over};`);
export function replay2048(seed,moves){const context=vm.createContext({seed,moves});replayScript.runInContext(context,{timeout:250});return {score:context.result.score,over:context.result.over};}
const json=(b,status=200)=>Response.json(b,{status,headers:{'Cache-Control':'no-store'}});
const nameOf=n=>typeof n==='string'?n.normalize('NFKC').trim().replace(/\s+/g,' ').slice(0,30):'';
const keyOf=n=>n.replace(/\s/g,'').toLowerCase();
export function createGame2048({sqlite,clock=Date.now}){
 let cleanupAt=0;const starts=new Map(),writes=new Map();
 return async(request)=>{try{
  const url=new URL(request.url),route=url.pathname.replace('/api/games/2048',''),now=clock();
  if(request.method==='POST'&&request.headers.get('origin')&&request.headers.get('origin')!==url.origin)return json({error:'请求来源不匹配'},403);
  if(now-cleanupAt>60000){cleanupAt=now;sqlite.prepare("DELETE FROM entries WHERE kind='2048-session' AND json_extract(data,'$.expiresAt')<?").run(now);for(const[k,v]of starts)if(now-v.since>3600000)starts.delete(k);for(const[k,v]of writes)if(now-v>60000)writes.delete(k)}
  const leaders=()=>sqlite.prepare("SELECT data FROM entries WHERE kind='2048-score'").all().map(r=>JSON.parse(r.data)).sort((a,b)=>b.score-a.score||a.achievedAt-b.achievedAt).map((r,i)=>({rank:i+1,name:r.name,score:r.score}));
  if(route==='/leaderboard'&&request.method==='GET'){const rows=leaders(),key=keyOf(nameOf(url.searchParams.get('name')));return json({players:rows.slice(0,50),total:rows.length,mine:rows.find(r=>keyOf(r.name)===key)||null})}
  if(request.method!=='POST')return json({error:'请求方法不支持'},405);
  let b;try{b=await request.json()}catch{return json({error:'请求格式错误'},400)}
  if(!b||typeof b!=='object'||Array.isArray(b))return json({error:'请求格式错误'},400);
  if(route==='/start'){
   const ip=request.headers.get('x-real-ip')||'local',rate=starts.get(ip)||{since:now,count:0};
   if(rate.count>=120)return json({error:'新游戏太频繁，请稍后再试'},429);rate.count++;starts.set(ip,rate);
   const id=crypto.randomBytes(24).toString('hex'),seed=crypto.randomBytes(4).readUInt32LE();
   sqlite.prepare('INSERT INTO entries(id,kind,data) VALUES(?,?,?)').run('2048-session:'+id,'2048-session',JSON.stringify({seed,expiresAt:now+86400000,name:'',moves:'',score:0}));return json({id,seed},201);
  }
  if(route==='/score'){
   if(!/^[a-f0-9]{48}$/.test(b.id||'')||!Array.isArray(b.moves)||b.moves.length>20000||b.moves.some(n=>!Number.isInteger(n)||n<0||n>4))return json({error:'游戏记录格式错误'},400);
   const id='2048-session:'+b.id,row=sqlite.prepare("SELECT data FROM entries WHERE id=? AND kind='2048-session'").get(id);if(!row)return json({error:'本局已过期，新游戏可继续上榜'},410);
   const game=JSON.parse(row.data);if(game.expiresAt<now)return json({error:'本局已过期，新游戏可继续上榜'},410);
   const name=nameOf(b.name);if(!name||/^\d+$/.test(name)||/[\x00-\x1f\x7f]/.test(name))return json({error:'请先填写有效姓名再上榜'},400);
   if(game.name&&keyOf(game.name)!==keyOf(name))return json({error:'本局已记录为原玩家，请开始新游戏后切换姓名'},409);
   const moves=b.moves.join('');if(!moves.startsWith(game.moves))return json({error:'游戏记录不连续，请开始新游戏'},409);
   if(moves===game.moves&&game.name)return json({ok:true,score:game.score});
   if(now-(writes.get(b.id)||0)<1000)return json({error:'正在同步，请稍后再试'},429);writes.set(b.id,now);
   const result=replay2048(game.seed,b.moves);game.name=name;game.moves=moves;game.score=result.score;
   sqlite.prepare('UPDATE entries SET data=?,revision=revision+1 WHERE id=?').run(JSON.stringify(game),id);
   if(result.score>0){const scoreId='2048-score:'+crypto.createHash('sha256').update(keyOf(name)).digest('hex'),old=sqlite.prepare("SELECT data FROM entries WHERE id=? AND kind='2048-score'").get(scoreId);if(!old||JSON.parse(old.data).score<result.score)sqlite.prepare('INSERT INTO entries(id,kind,data) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,revision=entries.revision+1').run(scoreId,'2048-score',JSON.stringify({name,score:result.score,achievedAt:now}))}
   return json({ok:true,score:result.score});
  }
  return json({error:'接口不存在'},404);
 }catch(e){console.error('[2048]',e.message);return json({error:'排行榜暂时无法同步，请稍后再试'},503)}};
}
