import {campusCalendar} from './calendar.js';
export const weekRuleLabels={all:'每周',odd:'仅单周',even:'仅双周'};
export function namesForWeek(template,date){const odd=campusCalendar(date).semesterWeek%2!==0;return template.names.filter(name=>{const rule=template.weekRules?.[name]||'all';return rule==='all'||rule==='odd'&&odd||rule==='even'&&!odd})}
export function normalizedWeekRules(names,rules={}){const result={};for(const name of names){const value=rules?.[name]||'all';if(!['all','odd','even'].includes(value))throw Object.assign(Error('值班周次请选择每周、仅单周或仅双周'),{status:400});if(value!=='all')result[name]=value}return result}
