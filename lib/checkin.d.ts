export function groupCheckinShifts(shifts:any[],name:string):any[][];
export function matchCheckinGroup(shifts:any[],name:string,now:number,shiftId?:string):{shifts:any[],ambiguous:boolean};
export function checkinAvailability(shifts:any[],attendance:any[],name:string,now:number,loaded?:boolean):{label:string,reason:string};
export function isCheckinExpired(group:any[],now:number):boolean;
