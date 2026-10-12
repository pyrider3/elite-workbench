import test from 'node:test';
import assert from 'node:assert/strict';
import {campusCalendar} from '../lib/calendar.js';
test('学期周从周一开始，以2026年10月11日第5周为基准',()=>{
 assert.deepEqual(campusCalendar('2026-10-11'),{month:10,day:11,weekday:0,semesterWeek:5});
 assert.equal(campusCalendar('2026-10-05').semesterWeek,5);
 assert.equal(campusCalendar('2026-10-12').semesterWeek,6);
 assert.equal(campusCalendar('2026-10-18').semesterWeek,6);
 assert.equal(campusCalendar('2026-10-19').semesterWeek,7);
 assert.equal(campusCalendar('2026-11-02').semesterWeek,9);
 assert.equal(campusCalendar('2027-01-04').semesterWeek,18);
});
