import {openWealthRank} from '/wealth-rank.js?v=472f7fbf'
const el=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e}
const format=n=>Number(n).toLocaleString('zh-CN',{maximumFractionDigits:2})
const labels={'miss-gift-send':'好久不见 · 送礼','miss-gift-income':'好久不见 · 礼物收入','xian-b16-refund':'旧版云梦仙途 D币退还','huancai-refund':'欢彩下线退款','hb-points-send':'红包站发放','hb-points-receive':'红包站到账','pet-world-b15-refund':'星谷收入补发','huancai-award-supplement':'欢彩奖金补齐','huancai-weekly':'欢彩周保底一等奖','huancai-award-reversal':'欢彩奖金撤回','huancai-award-reissue':'欢彩奖金补发','admin-slime-reward':'史莱姆体验奖励','admin-feedback-reward':'问题反馈奖励','title-upgrade':'称号解锁与升级','title-entry':'称号抽奖','title-refund':'称号退款','farm-import':'原农场金币承接','farm-compensation':'农场改版补偿','farm-action':'农场经营','owner-adjustment':'站长余额调整','packet-send':'发出红包','packet-claim':'领取红包','bottle-draw':'漂流瓶付费捞','bottle-throw':'漂流瓶付费扔','bottle-income':'漂流瓶收入','bottle-reward':'漂流瓶互动奖励','bottle-reward-pay':'漂流瓶奖励支出','packet-refund':'红包退款','guess-tip-send':'猜词打赏支出','guess-tip-receive':'猜词打赏收入','card-pay':'抽卡投入','card-income':'抽卡收入','card-prize':'抽卡奖励','card-prize-pay':'抽卡奖池支出','huancai-buy':'欢彩购票','huancai-scratch':'刮刮乐中奖','huancai-lotto':'大乐透中奖','content-post':'发帖奖励','content-road':'鞭打奖励','farm-rent-pay':'租地支出','farm-rent-income':'租金收入','farm-lease-work':'租地经营','farm-market':'集市交易','farm-farewell-assets':'农场资产结算','farm-farewell-bonus':'农场暂别补偿'}
export function mountWallet(root,{onLeave}){
 if(!document.getElementById('me-wallet-style')){const css=el('link');css.id='me-wallet-style';css.rel='stylesheet';css.href='/me-wallet.css?v=472f7fbf';document.head.append(css)}
 const lifetime=new AbortController(),summary=el('div','me-wallet-summary'),identity=el('div','me-wallet-identity'),coin=el('span','wallet-coin'),figures=el('div','me-wallet-figures'),actions=el('div','me-wallet-actions'),label=el('span','me-wallet-label','D 币余额'),balance=el('strong','','读取中…'),refresh=el('button','btn btn-ghost sm','刷新'),details=el('button','btn btn-ghost sm','收支记录'),note=el('p','me-wallet-note','站内收支 · 实时同步'),message=el('p','me-wallet-message'),list=el('ol','me-wallet-ledger'),more=el('button','btn btn-ghost sm','更早记录')
 for(const b of [refresh,details,more])b.type='button'
 coin.setAttribute('aria-hidden','true');message.setAttribute('role','status');list.hidden=true;more.hidden=true;root.setAttribute('aria-label','D 币钱包');figures.append(label,balance,note);identity.append(coin,figures);actions.append(refresh,details);summary.append(identity,actions);root.replaceChildren(summary,message,list,more)
 const rank=el('button','btn btn-ghost sm wallet-rank-link','财富榜');rank.type='button';rank.onclick=()=>openWealthRank({onLeave});actions.append(rank)
 mountHbKey(root,actions,lifetime.signal)
 let busy=false,opened=false,cursor=null,disposed=false
 onLeave(()=>{disposed=true;lifetime.abort()})
 async function load(append=false){
  if(busy||disposed)return;busy=true;refresh.disabled=details.disabled=more.disabled=true;message.textContent='正在读取…'
  try{
   const query=opened?'?ledger=1'+(append&&cursor?'&before='+cursor:''):''
   const response=await fetch('/api/me/wallet'+query,{credentials:'same-origin',cache:'no-store',signal:lifetime.signal}),data=await response.json()
   if(!response.ok)throw Error(data.error||'钱包暂时无法读取');if(disposed)return
   balance.textContent=format(data.balance)+' D 币';message.textContent=''
   if(opened){
    if(!append)list.replaceChildren()
    for(const row of data.rows){const item=el('li'),left=el('div'),right=el('div','me-wallet-amount'),amount=el('strong',row.delta>0?'me-wallet-income':'',`${row.delta>0?'+':''}${format(row.delta)} D 币`);left.append(el('strong','',labels[row.kind]||'站内收支'),el('small','',new Date(row.created_at*1000).toLocaleString('zh-CN')));right.append(amount,el('small','',`余额 ${format(row.balance_after)}`));item.append(left,right);list.append(item)}
    if(!list.children.length)list.append(el('li','','暂无收支记录'))
    list.hidden=false;cursor=data.next;more.hidden=!cursor
   }
  }catch(e){if(!disposed){message.textContent=e.message||'钱包读取失败，请重试';if(balance.textContent==='读取中…')balance.textContent='暂不可用'}}
  finally{busy=false;if(!disposed)refresh.disabled=details.disabled=more.disabled=false}
 }
 refresh.onclick=()=>void load();details.onclick=()=>{opened=!opened;details.textContent=opened?'收起记录':'收支记录';details.setAttribute('aria-expanded',String(opened));if(opened)void load();else{list.hidden=true;more.hidden=true}};details.setAttribute('aria-expanded','false');more.onclick=()=>void load(true);void load()
}

function mountHbKey(root, actions, signal) {
  const button = (text, run) => {
    const node = el('button','btn btn-ghost sm',text);
    node.type = 'button';
    node.onclick = run;
    return node;
  };
  const panel = el('section','hb-key-panel');
  const status = el('p','me-wallet-message');
  const controls = el('div','me-wallet-actions');
  const value = el('input','hb-key-value');
  const bind = el('a','','前往账号安全');
  bind.href = '/me/account';
  panel.id = 'hb-points-key';
  panel.setAttribute('aria-label','红包站密钥');
  status.setAttribute('role','status');
  value.readOnly = true;
  value.type = 'text';
  value.autocomplete = 'off';
  value.spellcheck = false;
  value.setAttribute('aria-label','红包站密钥明文');
  value.hidden = true;

  let current = null, busy = false, bound = false;
  const toggle = button('红包站密钥', async () => {
    panel.hidden = !panel.hidden;
    toggle.setAttribute('aria-expanded', String(!panel.hidden));
    hideKey();
    if (!panel.hidden) await perform(load);
  });
  toggle.setAttribute('aria-controls', panel.id);
  toggle.setAttribute('aria-expanded','false');
  panel.hidden = true;
  actions.append(toggle);
  panel.append(el('h3','','红包站密钥'),
    el('p','','把密钥填入 lafish 的红包站，即可用钱包里的 D 币发红包。有人领到时，从你的钱包扣款。'),
    status, controls, value);
  root.append(panel);

  const issue = button('生成密钥', () => perform(async () => {
    const data = await api({action:'issue'});
    await load();
    status.textContent = '密钥已生成，可查看或复制。';
    if (current?.id === data.id && !panel.hidden) showKey(data.key);
  }));
  const reveal = button('查看密钥', () => {
    if (!value.hidden) {
      hideKey();
      render();
      return;
    }
    return perform(async () => {
      const data = await api({action:'reveal'});
      if (current?.id === data.id && !panel.hidden) showKey(data.key);
    });
  });
  const copy = button('复制密钥', () => perform(async () => {
    if (value.hidden) return;
    try {
      await navigator.clipboard.writeText(value.value);
      status.textContent = '密钥已复制。';
    } catch {
      value.focus();
      value.select();
      status.textContent = '请手动复制选中的密钥。';
    }
  }));
  const revoke = button('收回密钥', () => perform(async () => {
    if (!await window.siteConfirm('收回这把密钥？使用它发出的红包将无法继续发放。')) return;
    await api({action:'revoke',id:current.id});
    hideKey();
    await load();
    status.textContent = '密钥已收回。';
  }));
  const refresh = button('重新读取', () => perform(load));

  function render() {
    reveal.textContent = value.hidden ? '查看密钥' : '隐藏密钥';
    controls.replaceChildren(...(current ? [reveal, ...(value.hidden ? [] : [copy]), revoke] : bound ? [issue] : [bind]));
    for (const item of controls.querySelectorAll('button')) item.disabled = busy;
  }

  function hideKey() {
    value.value = '';
    value.hidden = true;
  }
  function showKey(key) {
    value.value = key;
    value.hidden = false;
  }
  async function api(body) {
    const response = await fetch('/api/me/hb-key',{
      credentials:'same-origin',cache:'no-store',signal,
      ...(body ? {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)} : {})
    });
    const data = await response.json();
    if (!response.ok) throw Error(data.error || '密钥操作失败，请重试。');
    return data;
  }
  async function load() {
    const data = await api();
    current = data.key;
    bound = data.bound;
    status.textContent = !bound ? '请先在账号安全绑定 LINUX DO。' : current ? '' : '当前没有可用密钥。';
  }
  async function perform(task) {
    if (busy || signal.aborted) return;
    busy = true;
    toggle.disabled = true;
    render();
    let failed = false;
    try { await task(); }
    catch (error) {
      if (!signal.aborted) {
        failed = true;
        hideKey();
        status.textContent = error.message || '密钥操作失败，请重试。';
      }
    } finally {
      busy = false;
      toggle.disabled = false;
      render();
      if (failed) controls.append(refresh);
    }
  }
  signal.addEventListener('abort',hideKey,{once:true});
  if (new URLSearchParams(location.search).get('wallet') === 'hb') void toggle.onclick();
}
