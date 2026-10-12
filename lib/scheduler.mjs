import {dateAt,at,store,initialize,materialize,syncCareers} from './core.js';
export function latestSlot(now){const d=dateAt(now);if(now>=at(d,'11:00'))return d+'T11:00';if(now>=at(d,'05:00'))return d+'T05:00';const yesterday=dateAt(at(d,'00:00')-86400000);return yesterday+'T11:00';}
export function startScheduler(env,{clock=Date.now,intervalMs=30000,sync=syncCareers,logger=console}={}){
 const s=store(env.DB);let active=null,stopped=false,nextRetry=0,failures=0,startup=true;
 async function tick(){if(stopped||active)return active;active=(async()=>{const now=clock();try{
  await initialize(s,now);await materialize(s,dateAt(now));
  const slot=latestSlot(now),state=await s.get('career_schedule');
  if((startup||state?.lastSuccessSlot!==slot)&&now>=nextRetry){
   try{await sync(s,now);await s.save('scheduler',{lastSuccessSlot:slot,lastSuccessAt:now},'career_schedule');startup=false;failures=0;nextRetry=0;logger.info('[宣讲会] 同步成功，北京时间 '+slot)}
   catch(e){failures++;nextRetry=now+Math.min(300000*2**(failures-1),1800000);const previous=await s.get('careers');await s.save('cache',{...(previous||{items:[]}),error:'同步失败，保留上次成功数据',lastAttemptAt:now},'careers');logger.error('[宣讲会] 同步失败，将自动重试：',e.message)}
  }
 }catch(e){logger.error('[定时任务]',e.message)}})().finally(()=>{active=null});return active;}
 const timer=setInterval(tick,intervalMs);timer.unref();void tick();
 return{tick,async stop(){stopped=true;clearInterval(timer);await active}};
}
