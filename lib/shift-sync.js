import {namesForWeek} from './duty-weeks.js';
// A personal leave/override must not freeze everyone else's future roster.
// Preserve recorded identities and timing; customized or started shifts stay archived.
export function synchronizedShift(shift,template,records,now){
 if(shift.customized||Date.parse(`${shift.date}T${shift.start}:00+08:00`)<=now)return null;
 const names=namesForWeek(template,shift.date),enabled=template.enabled&&new Date(shift.date+'T12:00:00+08:00').getUTCDay()===template.weekday;
 const protectedRecords=records.filter(r=>r.shiftId===shift.id&&(r.checkin||r.override));
 if(protectedRecords.length&&(!enabled||shift.site!==template.site||shift.start!==template.start||shift.end!==template.end||protectedRecords.some(r=>!names.includes(r.name))))return null;
 const {id:templateId,_rev:templateRev,...fields}=template;
 const next={...shift,...fields,id:shift.id,_rev:shift._rev,names,leaves:(shift.leaves||[]).filter(n=>names.includes(n)),weekSkipped:template.names.length>0&&!names.length,enabled};
 // Template revisions must never replace the daily shift's revision.
 return JSON.stringify(next)===JSON.stringify(shift)?null:next;
}
