// Owner-only caller. No credentials, user data or D1 requests are sent to GitHub.
const endpoint='https://api.github.com/repos/kourou25/meme-hall-skins/issues?state=open&per_page=100&sort=updated&direction=desc'
const destination='https://github.com/kourou25/meme-hall-skins/'
export function createSkinStatusAlerts({fetcher=(...args)=>fetch(...args),storage,now=()=>Date.now(),cacheMs=300000,timeoutMs=3000}={}){
 if(storage===undefined)try{storage=globalThis.localStorage}catch{storage=null}
 let cached=null,last=0,pending=null
 const read=()=>{try{const value=JSON.parse(storage?.getItem('skinAutomationSeen')||'[]');return Array.isArray(value)?value:[]}catch{return []}}
 const key=n=>String(n.skinKey||'')
 function mark(n){try{const seen=read(),id=key(n);if(id)storage?.setItem('skinAutomationSeen',JSON.stringify([...new Set([...seen,id])].slice(-100)))}catch{}}
 function view(rows){const seen=new Set(read());return rows.map(x=>({...x,unread:!seen.has(key(x))}))}
 async function list(){
  const time=now();if(cached&&time-last<cacheMs)return view(cached);if(pending)return view(await pending)
  pending=(async()=>{const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs)
   try{
    const response=await fetcher(endpoint,{headers:{Accept:'application/vnd.github+json'},signal:controller.signal,credentials:'omit'});if(!response.ok)throw Error('github_unavailable')
    const data=await response.json();if(!Array.isArray(data))throw Error('github_invalid')
    return data.filter(x=>!x.pull_request&&x.user?.login==='github-actions[bot]'&&/^\[装扮自动化\] (检查异常|合并等待|上线等待) #\d+$/.test(x.title)&&Number.isSafeInteger(x.number)&&x.number>0).slice(0,20).map(x=>({kind:'skin_alert',meme_id:x.number,user_id:0,gid:-3,val:x.title.includes('合并等待')?'社区装扮投稿尚未合并，请查看处理记录。':x.title.includes('上线等待')?'社区装扮已合并，但尚无网站上线确认。':'社区装扮自动检查失败或超时，请查看处理记录。',at:Math.floor((Date.parse(x.updated_at)||time)/1000),url:destination+'issues/'+x.number,skinKey:x.number+':'+x.updated_at}))
   }catch{return [] /* 网络读不到 GitHub 时不提醒：只有自动化建了未关闭的异常 Issue 才算需要处理 */}
   finally{clearTimeout(timer)}
  })()
  try{cached=await pending;last=time;return view(cached)}finally{pending=null}
 }
 return {list,mark}
}
