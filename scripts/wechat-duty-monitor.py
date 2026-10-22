#!/usr/bin/env python3
"""Deterministic private Weixin notifications through the installed OpenClaw CLI."""
import argparse,datetime,fcntl,json,os,pathlib,subprocess,time,urllib.request
ROOT=pathlib.Path(__file__).resolve().parents[1]
PRIVATE=ROOT/'work/wechat-monitor'
CLI='/usr/local/bin/openclaw'
TZ=datetime.timezone(datetime.timedelta(hours=8))
def candidates(rows,now,activated,sent):
 result=[]
 for r in rows:
  key=r['id']; start=datetime.datetime.fromisoformat(r['date']+'T'+r['start']+':00+08:00').timestamp()
  if start+900<activated or start+900>now or key in sent:continue
  if r.get('checkin') or r.get('status') not in ('upcoming','waiting','absent'):continue
  result.append(r)
 return result
def checkin_candidates(rows,activated,sent):
 groups={}
 for r in rows:
  stamp=r.get('checkin')
  if not stamp or stamp/1000<activated:continue
  # One photograph/check-in may cover consecutive shifts: notify once.
  key=json.dumps([r['name'],stamp,r.get('photo')],ensure_ascii=False)
  if key in sent:continue
  groups.setdefault(key,[]).append(r)
 return groups
def send(config,message):
 from wechat_delivery import deliver
 deliver(config,message,PRIVATE,CLI)
def main():
 parser=argparse.ArgumentParser();parser.add_argument('--dry-run',action='store_true');args=parser.parse_args()
 PRIVATE.mkdir(parents=True,exist_ok=True);os.chmod(PRIVATE,0o700)
 with (PRIVATE/'lock').open('w') as lock:
  fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
  config=json.loads((PRIVATE/'config.json').read_text());path=PRIVATE/'state.json'
  state=json.loads(path.read_text()) if path.exists() else {'activated':time.time(),'sent':{},'fault':False}
  now=time.time();state.setdefault('checkinActivated',now);state.setdefault('checkins',{});day=datetime.datetime.fromtimestamp(now,TZ).date().isoformat()
  try:
   with urllib.request.urlopen('http://127.0.0.1:3000/api/dashboard?date='+day,timeout=10) as response:data=json.load(response)
  except Exception:
   if not args.dry_run and not state.get('fault'):send(config,'菁英工作台本机服务无法访问。你可以对我说“修复服务器”，我会按网站运维流程排查。');state['fault']=True
  else:
   state['fault']=False
   disabled={s['id'] for s in data.get('shifts',[]) if s.get('enabled') is False}
   rows=candidates([r for r in data.get('attendance',[]) if r.get('shiftId') not in disabled],now,state['activated'],state['sent'])
   checkins=checkin_candidates(data.get('attendance',[]),state['checkinActivated'],state['checkins'])
   if args.dry_run:print(json.dumps({'eligible':len(rows),'newCheckins':len(checkins),'dryRun':True}))
   elif rows:
    groups={}
    for r in rows:groups.setdefault((r['site'],r['start'],r['end']),[]).append(r)
    for (site,start,end),members in groups.items():
     send(config,f'值班未到岗提醒\n{day} {start}—{end}\n{site}\n'+ '、'.join(r['name'] for r in members)+'：开班已满15分钟，尚未打卡。请核实到岗情况。\nhttps://dj.qnjyxh.xyz/')
     for r in members:state['sent'][r['id']]=now
     temp=path.with_suffix('.tmp');temp.write_text(json.dumps(state));os.chmod(temp,0o600);temp.replace(path)
   if not args.dry_run:
    for key,members in checkins.items():
     r=members[0];clock=datetime.datetime.fromtimestamp(r['checkin']/1000,TZ).strftime('%H:%M:%S')
     shifts='\n'.join(dict.fromkeys(f"{m['site']} {m['start']}—{m['end']}" for m in members))
     send(config,f"打卡成功提醒\n{r['name']} 已打卡\n{day} {clock}\n{shifts}\nhttps://dj.qnjyxh.xyz/")
     state['checkins'][key]=now
     temp=path.with_suffix('.tmp');temp.write_text(json.dumps(state));os.chmod(temp,0o600);temp.replace(path)
  if not args.dry_run:
   state['checkins']={k:v for k,v in state['checkins'].items() if now-v<30*86400}
   state['sent']={k:v for k,v in state['sent'].items() if now-v<30*86400}
   temp=path.with_suffix('.tmp');temp.write_text(json.dumps(state));os.chmod(temp,0o600);temp.replace(path)
if __name__=='__main__':
 try:main()
 except BlockingIOError:pass
 except Exception as e:print(type(e).__name__+': '+str(e));raise SystemExit(1)
