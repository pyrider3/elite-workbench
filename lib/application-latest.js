import {latestFirst} from './record-order.js';
// Use both name and contact to avoid hiding unrelated people who share a name.
export function applicationIdentity(row){const norm=v=>String(v||'').normalize('NFKC').trim().toLowerCase().replace(/\s+/g,'');const name=norm(row.name),contact=norm(row.contact);return name&&contact?JSON.stringify([name,contact]):JSON.stringify(['record',row.id])}
export function latestApplicationIds(rows){const seen=new Set(),ids=new Set();for(const row of [...rows].sort(latestFirst)){const key=applicationIdentity(row);if(!seen.has(key)){seen.add(key);ids.add(row.id)}}return ids}
export function latestApplications(rows){const ids=latestApplicationIds(rows);return rows.filter(row=>row.isLatestSubmission===undefined?ids.has(row.id):row.isLatestSubmission)}
