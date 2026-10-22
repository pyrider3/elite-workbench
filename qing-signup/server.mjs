import http from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.join(path.dirname(fileURLToPath(import.meta.url)),'public');
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'};
export function createSignupServer({publicUrl=process.env.PUBLIC_URL||'https://new.qnjyxh.xyz',upstream=process.env.BACKEND_URL||'http://127.0.0.1:3000',backendOrigin=process.env.BACKEND_ORIGIN||'https://dj.qnjyxh.xyz'}={}){
 return http.createServer(async(req,res)=>{
  const json=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
  try{
   const url=new URL(req.url,publicUrl);
   if(url.pathname==='/health'&&req.method==='GET'){json(200,{ok:true});return;}
   if(url.pathname==='/api/applications'){
    if(req.method!=='POST'){res.setHeader('Allow','POST');json(405,{error:'请求方法不支持'});return;}
    if(req.headers.origin&&req.headers.origin!==new URL(publicUrl).origin){json(403,{error:'请求来源不匹配'});return;}
    if(!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']||'')){json(415,{error:'请使用 JSON 提交报名'});return;}
    let size=0;const chunks=[];
    for await(const chunk of req){size+=chunk.length;if(size>32768){json(413,{error:'报名内容过大'});return;}chunks.push(chunk);}
    const response=await fetch(new URL('/api/applications',upstream),{method:'POST',headers:{'Content-Type':'application/json',Origin:backendOrigin},body:Buffer.concat(chunks),signal:AbortSignal.timeout(12000)});
    const bytes=Buffer.from(await response.arrayBuffer());
    res.writeHead(response.ok?201:response.status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(bytes);return;
   }
   if(url.pathname.startsWith('/api/')){json(404,{error:'接口不存在'});return;}
   if(!['GET','HEAD'].includes(req.method)){json(405,{error:'请求方法不支持'});return;}
   let pathname;try{pathname=decodeURIComponent(url.pathname);}catch{json(400,{error:'路径格式错误'});return;}
   const name=['/','/qing','/qing/'].includes(pathname)?'qing.html':['/biao','/biao/'].includes(pathname)?'index.html':pathname.replace(/^\/+/, '');
   const file=path.resolve(root,name);
   if(!file.startsWith(root+path.sep)){json(403,{error:'禁止访问此路径'});return;}
   let info;try{info=await stat(file);}catch{json(404,{error:'页面不存在'});return;}
   if(!info.isFile()){json(404,{error:'页面不存在'});return;}
   const bytes=await readFile(file);
   res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});res.end(req.method==='HEAD'?undefined:bytes);
  }catch(error){console.error('[报名服务]',error.message);if(!res.headersSent)json(502,{error:'报名服务暂时不可用，请稍后重试'});else res.end();}
 });
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const server=createSignupServer();const host=process.env.HOST||'127.0.0.1',port=Number(process.env.PORT||3100);
 server.listen(port,host,()=>console.log(`小菁报名已启动：http://${host}:${port}`));
 for(const sig of ['SIGINT','SIGTERM'])process.on(sig,()=>server.close(()=>process.exit(0)));
}
