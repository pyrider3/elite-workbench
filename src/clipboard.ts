// HTTP LAN previews do not expose the modern Clipboard API on many phones.
export async function copyText(text:string):Promise<void>{
 if(window.isSecureContext&&navigator.clipboard?.writeText){try{await navigator.clipboard.writeText(text);return}catch{/* Fall back when clipboard permissions are denied. */}}
 const previous=document.activeElement as HTMLElement|null,selection=window.getSelection(),ranges:Range[]=[];
 if(selection)for(let i=0;i<selection.rangeCount;i++)ranges.push(selection.getRangeAt(i).cloneRange());
 const field=document.createElement('textarea');field.value=text;field.readOnly=true;field.style.cssText='position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;font-size:16px;pointer-events:none;';
 document.body.appendChild(field);
 try{field.focus({preventScroll:true});field.select();field.setSelectionRange(0,text.length);if(!document.execCommand('copy'))throw Error('复制失败，请长按微信号复制')}
 finally{field.remove();previous?.focus({preventScroll:true});if(selection){selection.removeAllRanges();ranges.forEach(range=>selection.addRange(range))}}
}
