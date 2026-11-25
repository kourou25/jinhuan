// Local-only draft preview: no network requests, account changes, or messages.
export function openCommunityPreview(anchor,{h,icon,avatar,user,titleEl,badgeEl,bubbleView}){
 const doc=anchor.ownerDocument,win=doc.defaultView,urls=new Map(),parts=['bubble','title','badge','reply','frame'],labels={bubble:'气泡',title:'称号',badge:'徽章',reply:'回应框',frame:'头像框'};let config={}
 const mock={...user,deco:{...user.deco,sc:'all',bs:'all',badge_mode:'set',community:Object.fromEntries(parts.map(x=>[x,'draft-preview']))}}
 const sample=h('div',{class:'community-draft-sample'}),status=h('p',{class:'muted',role:'status','aria-live':'polite'},'选择本地图片后立即预览；仅自己可见，不会上传或发送。')
 const warning=()=>parts.filter(k=>{const s=config[k]?.slice,img=urls.get(k);return s&&img&&(s[0]+s[2]>=img.height||s[1]+s[3]>=img.width)}).map(k=>labels[k]).join('、')
 const announce=message=>{const bad=warning();status.textContent=bad?bad+'的边框切片超出图片尺寸，暂用默认切片；投稿前请修改配置。':message}
 const draw=()=>{
  const title=titleEl(mock,'chat'),badge=badgeEl(mock,'chat'),bubble=h('div',bubbleView(mock,'cm-text','chat'),h('span',{class:'rt-copy'},'这是一条群聊预览消息，较长文字会自动换行。')),reply=h('div',bubbleView(mock,'rp-form','chat',true),h('input',{class:'rp-input',placeholder:'回应框预览','aria-label':'回应框预览'}))
  if(title)title.textContent='投稿预览'
  for(const [kind,el] of [['title',title],['badge',badge],['bubble',bubble],['reply',reply]]){if(!el||!urls.has(kind))continue;const image=urls.get(kind),src=image.url,configured=config[kind]?.slice,slice=Array.isArray(configured)&&configured.length===4&&configured.every(x=>Number.isInteger(x)&&x>=0&&x<=64)&&configured[0]+configured[2]<image.height&&configured[1]+configured[3]<image.width?configured.join(' '):String(image.slice);if(kind==='badge'){el.style.cssText+=';display:inline-block;width:24px;height:24px;background:center / contain no-repeat url("'+src+'")'}else{el.style.border='6px solid transparent';el.style.borderImageSource='url("'+src+'")';el.style.borderImageSlice=slice;el.style.borderImageWidth='6px';el.style.borderImageRepeat='stretch'}}
  const face=avatar(user.avatar,user.name||user.username,28),frame=urls.get('frame'),framed=frame?h('span',{class:'cskin-frame-wrap'},face,h('img',{src:frame.url,alt:'',style:'position:absolute;inset:-18%;width:136%;height:136%;max-width:none;pointer-events:none;z-index:1'})):face
  sample.replaceChildren(h('div',{class:'community-draft-head cm-head'},framed,h('strong',null,user.name||user.username),title,badge),bubble,reply)
 }
 async function choose(kind,input){
  const file=input.files?.[0];if(!file)return
  if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>4*1024*1024){status.textContent='请选择不超过 4 MiB 的 PNG、JPG 或 WebP 图片。';input.value='';return}
  const url=win.URL.createObjectURL(file)
  try{const img=new Image();img.src=url;await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=reject});if(img.naturalWidth>2048||img.naturalHeight>2048||!img.naturalWidth||!img.naturalHeight)throw Error('图片尺寸不能超过 2048 × 2048')
   if(!dialog.open){win.URL.revokeObjectURL(url);return}const previous=urls.get(kind);if(previous)win.URL.revokeObjectURL(previous.url);urls.set(kind,{url,width:img.naturalWidth,height:img.naturalHeight,slice:Math.max(0,Math.min(6,Math.floor((img.naturalWidth-1)/2),Math.floor((img.naturalHeight-1)/2)))});announce(labels[kind]+'图片已载入，仅在本机预览。'+(kind==='frame'&&(img.naturalWidth!==img.naturalHeight||img.naturalWidth<64||img.naturalWidth>1024)?'注意：头像框投稿需为 64–1024 像素的正方形图片。':''));draw()
  }catch(e){win.URL.revokeObjectURL(url);input.value='';status.textContent=e?.message||'图片无法读取，请更换文件。'}
 }
 async function chooseConfig(input){const file=input.files?.[0];if(!file)return;try{if(file.size>8192)throw Error('配置文件不能超过 8 KiB');const raw=JSON.parse(await file.text());if(!raw.components||typeof raw.components!=='object'||Array.isArray(raw.components))throw Error('配置文件缺少 components');const next=Object.fromEntries(parts.filter(k=>raw.components[k]&&typeof raw.components[k]==='object').map(k=>[k,{slice:raw.components[k].slice}]));for(const [kind,v] of Object.entries(next))if(v.slice!==undefined&&(kind==='badge'||!Array.isArray(v.slice)||v.slice.length!==4||v.slice.some(x=>!Number.isInteger(x)||x<0||x>64)))throw Error(labels[kind]+'的边框切片配置无效');config=next;announce('已载入边框切片配置，仅在本机预览。');draw()}catch(e){input.value='';status.textContent=e?.message||'配置文件无法读取。'}}
 const dialog=h('dialog',{class:'community-draft-dialog','aria-labelledby':'community-draft-title'},h('header',null,h('h2',{id:'community-draft-title'},'群聊装扮预览'),h('button',{type:'button',class:'btn-icon','aria-label':'关闭',onclick:()=>dialog.close()},icon('close'))),h('p',{class:'muted'},'在群聊中查看投稿图片的实际样式，不会改变已佩戴的装扮。可选载入投稿配置，预览其中的边框切片。'),h('div',{class:'community-draft-files'},parts.map(kind=>h('label',null,h('span',null,labels[kind]),h('input',{type:'file',accept:'image/png,image/jpeg,image/webp','aria-label':labels[kind]+'图片',onchange:e=>choose(kind,e.currentTarget)}))),h('label',null,h('span',null,'投稿配置（可选）'),h('input',{type:'file',accept:'.json,application/json','aria-label':'投稿配置',onchange:e=>chooseConfig(e.currentTarget)}))),status,sample)
 dialog.addEventListener('close',()=>{for(const x of urls.values())win.URL.revokeObjectURL(x.url);urls.clear();dialog.remove();if(anchor.isConnected)anchor.focus({preventScroll:true})},{once:true})
 doc.body.append(dialog);draw();dialog.showModal()
}
