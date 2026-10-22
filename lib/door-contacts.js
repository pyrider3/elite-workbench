const contacts=[
 {name:'示例甲辰戌',phone:'13000000000',wechat:'example-wechat-7'},
 {name:'示例甲子乙',phone:'13000000000',wechat:'example-wechat-2'},
 {name:'示例甲卯己',phone:'13000000000',wechat:'example-wechat-3'},
 {name:'示例甲戌午',phone:'example-wechat-4',wechat:'example-wechat-4'},
 {name:'示例甲卯癸',phone:'13000000000',wechat:'example-wechat-5'},
 {name:'示例甲癸酉',phone:'13000000000',wechat:'example-wechat-6'},
 {name:'示例甲辰戌',phone:'13000000000',wechat:'example-wechat-7'}
];
export function doorContact(date){return {...contacts[new Date(date+'T00:00:00Z').getUTCDay()]};}
