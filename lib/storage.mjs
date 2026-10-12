import {DatabaseSync} from 'node:sqlite';
import {mkdir,readFile,writeFile,rename,unlink} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
export async function createStorage(dataDir){
 await mkdir(dataDir,{recursive:true});await mkdir(path.join(dataDir,'photos','checkins'),{recursive:true});await mkdir(path.join(dataDir,'photos','attachments'),{recursive:true});
 const sqlite=new DatabaseSync(path.join(dataDir,'workbench.sqlite'));
 sqlite.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
 sqlite.exec('CREATE TABLE IF NOT EXISTS migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL);');
 if(!sqlite.prepare('SELECT id FROM migrations WHERE id=?').get('001_entries')){
  sqlite.exec('BEGIN');try{sqlite.exec(readFileSync(new URL('../migrations/001_entries.sql',import.meta.url),'utf8'));sqlite.exec('CREATE INDEX IF NOT EXISTS entries_kind ON entries(kind);');sqlite.prepare('INSERT INTO migrations(id,applied_at) VALUES(?,?)').run('001_entries',new Date().toISOString());sqlite.exec('COMMIT')}catch(e){sqlite.exec('ROLLBACK');throw e}
 }
 const DB={prepare(query){let args=[];return{bind(...values){args=values;return this},async first(){return sqlite.prepare(query).get(...args)||null},async all(){return{results:sqlite.prepare(query).all(...args)}},async run(){const result=sqlite.prepare(query).run(...args);return{meta:{changes:Number(result.changes)}}}}}};
 const fileFor=key=>{if(!/^(?:checkins|attachments)\/[a-f0-9-]{36}$/.test(key))throw Error('Invalid photo key');return path.join(dataDir,'photos',key)};
 const BUCKET={
  async put(key,bytes,options){const file=fileFor(key),temp=file+'.'+crypto.randomUUID()+'.tmp';await writeFile(temp,bytes,{flag:'wx'});await rename(temp,file);await writeFile(file+'.json',JSON.stringify(options.httpMetadata),{flag:'wx'})},
  async get(key){const file=fileFor(key);try{const[body,httpMetadata]=await Promise.all([readFile(file),readFile(file+'.json','utf8').then(JSON.parse)]);return{body,httpMetadata}}catch(e){if(e.code==='ENOENT')return null;throw e}},
  async delete(key){const file=fileFor(key);await Promise.all([unlink(file).catch(e=>{if(e.code!=='ENOENT')throw e}),unlink(file+'.json').catch(e=>{if(e.code!=='ENOENT')throw e})])}
 };
 return{DB,BUCKET,sqlite,close:()=>sqlite.close()};
}
