export function applicationIdentity(row:Record<string,any>):string;
export function latestApplicationIds<T extends Record<string,any>>(rows:T[]):Set<string>;
export function latestApplications<T extends Record<string,any>>(rows:T[]):T[];
