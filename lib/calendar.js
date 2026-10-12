// User reference: the week starting Monday 2026-10-05 is semester week 5.
const referenceMonday=Date.UTC(2026,9,5);
export function campusCalendar(date){
 const civil=new Date(date+'T00:00:00Z');
 return {month:civil.getUTCMonth()+1,day:civil.getUTCDate(),weekday:civil.getUTCDay(),semesterWeek:5+Math.floor((civil.getTime()-referenceMonday)/604800000)};
}
