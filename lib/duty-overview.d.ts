export function filterDutyRows(rows:any[],options:{date:string,site?:string,query?:string,mode?:string,status?:string,hideEnded?:boolean,now?:number}):any[];
export function groupDutyRows(rows:any[]):{shiftId?:string,site:string,start:string,end:string,rows:any[]}[];
