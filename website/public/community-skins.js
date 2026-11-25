const origin=location.hostname==='cc.52dmeme.com'?'https://52dmeme.com':''
let entries=[],loading=null,loadedAt=0
const validId=id=>typeof id==='string'&&/^[a-z0-9][a-z0-9-]{2,47}$/.test(id)
const KINDS=['bubble','title','badge','reply','frame']
export function communityClass(id,kind){return validId(id)&&KINDS.includes(kind)?` cskin-${kind} cskin-${kind}-${id}`:''}
export function communityName(id){return entries.find(x=>x.id===id)?.name||(id==='aurora-preset'?'极光流转':'社区装扮')}
export function communityEntries(){return entries}
function renderStyles(){
 const rules=[],cssUrls=new Set()
 for(const skin of entries){if(!validId(skin.id))continue;for(const [kind,part] of Object.entries(skin.components||{})){
  if(!KINDS.includes(kind)||!/^[a-f0-9]{64}$/.test(part.sha256||''))continue
  const cssHash=part.type==='text/css'?part.sha256:part.style?.sha256
  if(/^[a-f0-9]{64}$/.test(cssHash||''))cssUrls.add(`${origin}/api/community-skins/css/${skin.id}/${kind}/${cssHash}`)
  if(part.type==='text/css')continue
  const url=`${origin}/api/community-skins/image/${part.sha256}`,selector=`.cskin-${kind}-${skin.id}`
  // 头像框：正方形透明图，比头像大一圈叠在上面（外扩 18%），不挡点击
  if(kind==='frame'){rules.push(`${selector}::after{content:"";position:absolute;inset:-18%;background:url("${url}") center/contain no-repeat;pointer-events:none;z-index:1}`);continue}
  if(kind==='badge'){rules.push(`${selector}{display:inline-block;vertical-align:middle;width:24px;height:24px;background:url("${url}") center/contain no-repeat}`);continue}
  const fallback=Math.max(0,Math.min(6,Math.floor((part.width-1)/2),Math.floor((part.height-1)/2)))
  const slice=Array.isArray(part.slice)&&part.slice.length===4&&part.slice.every(x=>Number.isInteger(x)&&x>=0&&x<=64)?part.slice:[fallback,fallback,fallback,fallback]
  rules.push(`${selector}{border:6px solid transparent!important;border-image-source:url("${url}")!important;border-image-slice:${slice.join(' ')}!important;border-image-width:6px!important;border-image-repeat:stretch!important}`)
 }}
 let style=document.getElementById('community-skins-style');if(!style){style=document.createElement('style');style.id='community-skins-style';document.head.append(style)}style.textContent=rules.join('\n')
 document.querySelectorAll('link[data-community-css]').forEach(link=>{if(!cssUrls.has(link.getAttribute('href')))link.remove();else cssUrls.delete(link.getAttribute('href'))})
 for(const url of cssUrls){const link=document.createElement('link');link.rel='stylesheet';link.href=url;link.setAttribute('data-community-css','');document.head.append(link)}
 document.querySelectorAll('[data-community-name]').forEach(el=>{el.textContent=communityName(el.getAttribute('data-community-name'))})
}
export function loadCommunitySkins(force=false){
 if(!force&&Date.now()-loadedAt<60000)return Promise.resolve(entries)
 if(loading)return loading
 loading=fetch(origin+'/api/community-skins',{credentials:'omit',signal:AbortSignal.timeout(7000)}).then(r=>{if(!r.ok)throw Error('社区装扮暂时不可用');return r.json()}).then(data=>{if(!Array.isArray(data.entries)||data.entries.length>200||data.archived!==undefined&&!Array.isArray(data.archived))throw Error('社区装扮目录无效');entries=data.entries.filter(x=>validId(x.id)&&typeof x.name==='string');for(const old of data.archived||[]){if(!validId(old?.id)||typeof old.name!=='string'||!old.components?.bubble)continue;const active=entries.find(x=>x.id===old.id);if(active){if(!active.components?.bubble)active.components={...active.components,bubble:old.components.bubble};continue}entries.push({...old,archived:true})}loadedAt=Date.now();renderStyles();return entries}).finally(()=>{loading=null})
 return loading
}
void loadCommunitySkins().catch(()=>{})
