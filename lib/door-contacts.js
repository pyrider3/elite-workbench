const contacts=[
 {name:'示例成员42',phone:'13000000000',wechat:'example-wechat-7'},
 {name:'示例成员27',phone:'13000000000',wechat:'example-wechat-2'},
 {name:'示例成员37',phone:'13000000000',wechat:'example-wechat-3'},
 {name:'示例成员62',phone:'13000000000',wechat:'13000000000'},
 {name:'示例成员38',phone:'13000000000',wechat:'example-wechat-5'},
 {name:'示例成员25',phone:'13000000000',wechat:'example-wechat-6'},
 {name:'示例成员42',phone:'13000000000',wechat:'example-wechat-7'}
];
export function doorContact(date){return {...contacts[new Date(date+'T00:00:00Z').getUTCDay()]};}
