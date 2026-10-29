import http from 'node:http';
import {migrateRecruitRoutes} from './lib/recruitment.js';
import {startHandbookSync} from './lib/handbook-sync.mjs';
import {createGame2048} from './lib/game-2048.mjs';
import {createFileJobs} from './lib/file-jobs.mjs';
import {recognizeVolunteer} from './lib/volunteer-parser.mjs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readFile,stat} from 'node:fs/promises';
import {Readable} from 'node:stream';
import {handle,initialize,store} from './lib/core.js';
import {createStorage} from './lib/storage.mjs';
import {startScheduler} from './lib/scheduler.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.json':'application/json'};
const methods=new Map([
 ['/forms/submit','POST'],['/admin/recruit/data','GET'],['/admin/recruit/save','POST'],['/admin/recruit/publish','POST'],['/admin/recruit/route','POST'],['/admin/recruit/entrance','POST'],['/admin/recruit/archive','POST'],['/rankings','GET'],['/volunteer/recognize','POST'],['/volunteer/batch','POST'],['/dashboard','GET'],['/profile','GET'],['/me','GET'],['/admin/data','GET'],['/admin/volunteer/source','GET'],
 ['/identity','POST'],['/login','POST'],['/logout','POST'],['/checkin','POST'],['/volunteer','POST'],['/applications','POST'],['/surveys','POST'],['/admin/member','POST'],['/admin/settings','POST'],['/admin/template','POST DELETE'],['/admin/shift','POST'],['/admin/day-plan','POST'],['/admin/attendance','POST'],['/admin/volunteer','POST'],['/admin/account','POST'],['/admin/application','POST'],['/admin/sync','POST']
]);
export async function createApp({dataDir=process.env.DATA_DIR||path.join(root,'data'),publicUrl=process.env.PUBLIC_URL||'',dev=false,sync=true,clock=Date.now,fileWorkerToken=process.env.FILE_WORKER_TOKEN||''}={}){
 const storage=await createStorage(path.resolve(dataDir));await initialize(store(storage.DB),clock());await migrateRecruitRoutes(store(storage.DB),clock());
 const fileJobs=createFileJobs({sqlite:storage.sqlite,dataDir:path.resolve(dataDir),clock,workerToken:fileWorkerToken});
 const game2048=createGame2048({sqlite:storage.sqlite,clock});
 const scheduler=sync?startScheduler(storage,{clock}):null;
 const handbookSync=sync?startHandbookSync({sqlite:storage.sqlite,clock}):null;
 const vite=dev?await(await import('vite')).createServer({root,server:{middlewareMode:true},appType:'spa'}):null;
 const error=(res,status,message)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify({error:message}))};
 const server=http.createServer(async(req,res)=>{try{
  const origin=publicUrl?new URL(publicUrl).origin:'http://'+(req.headers.host||'localhost');
  const url=new URL(req.url,origin);
  if(url.pathname==='/health'){res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end('{"ok":true}');return}
  if(url.pathname.startsWith('/api/')){
   const isFileRoute=url.pathname.startsWith('/api/files/'),isGameRoute=url.pathname.startsWith('/api/games/2048/');
   const endpoint=url.pathname.slice(4),allowed=(isFileRoute||isGameRoute)?'GET POST':(/^\/forms\/[^/]+$/.test(endpoint)&&endpoint!=='/forms/submit')?'GET':(endpoint.startsWith('/photo/')||endpoint.startsWith('/volunteer/attachment/'))?'GET':methods.get(endpoint);
   if(!allowed){error(res,404,'接口不存在');return}if(!allowed.split(' ').includes(req.method)){res.setHeader('Allow',allowed.split(' ').join(', '));error(res,405,'请求方法不支持');return}
   let size=0,chunks=[];for await(const chunk of req){size+=chunk.length;if(size>(isGameRoute?100000:isFileRoute?25*1024*1024:10000000)){error(res,413,'上传内容过大');return}chunks.push(chunk)}
   const headers=new Headers();for(const[k,v]of Object.entries(req.headers))if(v!==undefined)headers.set(k,Array.isArray(v)?v.join(', '):v);
   const body=['GET','HEAD'].includes(req.method)?undefined:Buffer.concat(chunks);
   const request=new Request(url,{method:req.method,headers,body});
   const response=isGameRoute?await game2048(request):isFileRoute?await fileJobs(request):await handle(request,{...storage,recognizeVolunteer},clock());res.writeHead(response.status,Object.fromEntries(response.headers));if(response.body)Readable.fromWeb(response.body).pipe(res);else res.end();return;
  }
  if(!['GET','HEAD'].includes(req.method)){error(res,405,'请求方法不支持');return}
  if(url.pathname==='/qing'||url.pathname==='/biao'){res.writeHead(302,{Location:url.pathname==='/qing'?'/signup/qing.html':'/signup/index.html'});res.end();return}
  if(url.pathname==='/favicon.ico'){res.writeHead(302,{Location:'/favicon.svg'});res.end();return}
  if(vite){vite.middlewares(req,res,()=>error(res,404,'页面不存在'));return}
  const base=path.join(root,'dist');let pathname;try{pathname=decodeURIComponent(url.pathname)}catch{error(res,400,'路径格式错误');return}
  const file=path.resolve(base,'.'+pathname);if(file!==base&&!file.startsWith(base+path.sep)){error(res,403,'禁止访问此路径');return}
  let target=file;try{if(!(await stat(target)).isFile())throw Error()}catch{if(!['/','/files','/admin','/wenjuan'].includes(url.pathname)&&!/^\/baoming\/[^/]+\/?$/.test(url.pathname)){error(res,404,'页面不存在');return}target=path.join(base,'index.html')}
  let bytes=await readFile(target);if(/^\/baoming\/[^/]+\/?$/.test(url.pathname)&&path.extname(target)==='.html'){let slug;try{slug=decodeURIComponent(url.pathname.split('/')[2]).normalize('NFKC').toLowerCase()}catch{error(res,400,'入口格式错误');return}const route=(await store(storage.DB).all('recruit-route')).find(r=>r.slug===slug&&!r.archived);if(!route){error(res,404,'入口不存在');return}const version=route.versionId?await store(storage.DB).get(route.versionId):null;const title=String(version?.title||route.name||'报名表').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');bytes=Buffer.from(bytes.toString().replace(/<title>[^<]*<\/title>/,'<title>'+title+'</title>'))}res.writeHead(200,{'Content-Type':types[path.extname(target)]||'application/octet-stream','Cache-Control':url.pathname.startsWith('/assets/')?'public, max-age=31536000, immutable':'no-cache','X-Content-Type-Options':'nosniff'});res.end(req.method==='HEAD'?undefined:bytes);
 }catch(e){console.error('[请求错误]',e.message);if(!res.headersSent)error(res,500,'服务暂时不可用，请稍后重试');else res.end()}});
 return{server,storage,async close(){await new Promise(resolve=>server.close(resolve));server.closeAllConnections();await scheduler?.stop();await handbookSync?.stop();await vite?.close();storage.close()}};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const app=await createApp({dev:process.argv.includes('--dev'),sync:process.env.DISABLE_SYNC!=='1'});
 const host=process.env.HOST||'127.0.0.1',port=Number(process.env.PORT||3000);
 app.server.listen(port,host,()=>console.log(`菁英工作台已启动：http://${host}:${port} （数据保存在 ${path.resolve(process.env.DATA_DIR||path.join(root,'data'))}）`));
 let stopping=false;for(const sig of ['SIGINT','SIGTERM'])process.on(sig,async()=>{if(stopping)return;stopping=true;const timeout=setTimeout(()=>process.exit(1),20000);timeout.unref();await app.close();clearTimeout(timeout);process.exit(0)});
}
