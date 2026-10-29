const contacts=[
 {name:'示例甲巳癸',phone:'13000000000',wechat:'example-wechat-7'},
 {name:'示例甲子庚',phone:'13000000000',wechat:'example-wechat-2'},
 {name:'示例甲卯寅',phone:'13000000000',wechat:'example-wechat-3'},
 {name:'示例甲亥庚',phone:'example-wechat-4',wechat:'example-wechat-4'},
 {name:'示例甲卯午',phone:'13000000000',wechat:'example-wechat-5'},
 {name:'示例甲子丙',phone:'13000000000',wechat:'example-wechat-6'},
 {name:'示例甲巳癸',phone:'13000000000',wechat:'example-wechat-7'}
];
export function doorContact(date){return {...contacts[new Date(date+'T00:00:00Z').getUTCDay()]};}
