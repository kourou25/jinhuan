import type { Env } from '../env'
import { hmacHex } from '../lib/crypto'
import { now } from '../lib/time'
import { CHAT_HISTORY_FLOOR } from './chat-access'
import { isAnonGroup, messagePeople, publicCtx } from './anon-identity'

const MAX_ATTEMPTS = 5
const RETENTION = 7 * 86400

// 回调地址不再限定域名（社区 PR #13），所以要防止被用来访问服务器所在的内网：
// 拒绝 IP 直连的内网 / 本机 / 保留地址、本站自己的域名、非 443 端口；投递前再解析一次域名，解析到内网地址就不发
const PRIVATE_V4 = [/^0\./, /^10\./, /^127\./, /^169\.254\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, /^19[89]\.1[89]\./, /^2(2[4-9]|[3-5]\d)\./]
export function privateAddress(ip: string) {
  const v = ip.replace(/^\[|\]$/g, '').toLowerCase()
  if (/^\d+\.\d+\.\d+\.\d+$/.test(v)) return PRIVATE_V4.some((re) => re.test(v))
  if (v.includes(':')) {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v)
    if (mapped) return privateAddress(mapped[1])
    return v === '::' || v === '::1' || /^f[cd]/.test(v) || /^fe[89ab]/.test(v) || v.startsWith('ff')
  }
  return false
}
const OWN_HOSTS = /(^|\.)52dmeme\.com$|^localhost$|\.localhost$|\.local$|\.internal$/i
export function botCallbackUrl(env: Env, value: string) {
  try {
    const url = new URL(value)
    const local = env.DEV_LOGIN_KEY && url.protocol === 'http:' && url.hostname === '127.0.0.1'
    if ((!local && url.protocol !== 'https:') || url.username || url.password || url.hash || url.search) return null
    if (!local && (url.port && url.port !== '443' || OWN_HOSTS.test(url.hostname.replace(/\.$/,'')) || privateAddress(url.hostname) || /^\d+$/.test(url.hostname))) return null
    return url.href
  } catch { return null }
}
// 投递前解析域名：任何一个地址落在内网就不发（服务器上运行时才有 DNS 模块；Cloudflare 上跳过，那里本来就访问不到内网）
async function resolvesPrivate(host: string) {
  let dns: { lookup(h: string, o: { all: true }): Promise<{ address: string }[]> }
  try { dns = await import('node:dns/promises' as string) } catch { return false }
  try {
    const list = await dns.lookup(host, { all: true })
    return !list.length || list.some((x) => privateAddress(x.address))
  } catch { return true } // 解析失败也不发
}

export function botSigningSecret(key: string, id: string, version: string) {
  return hmacHex(key, 'jinhuan-chat-bot:' + id + ':' + version)
}

export const BOT_GROUP_LIMIT = 10
export const BOT_TEXT_LIMIT = 2000
export const BOT_COMMAND = /^[a-z\p{Script=Han}][a-z0-9_\p{Script=Han}-]{0,31}$/u
export const botMaintainerActive = `EXISTS(SELECT 1 FROM chat_members cm JOIN users owner ON owner.id=cm.user_id
  WHERE cm.group_id=i.group_id AND owner.id=i.created_by AND owner.kind='user' AND owner.disabled=0 AND owner.silenced=0)
  AND NOT EXISTS(SELECT 1 FROM chat_bans ban WHERE ban.group_id=i.group_id AND ban.user_id=i.created_by)`

const chatPersona = `(i.chat_name IS NOT NULL OR EXISTS(SELECT 1 FROM json_each(i.commands) WHERE value='chat'))`

export const CHAT_REPLY_WINDOW = 600

function chatPersonaStatements(db:D1Database, groupId:number, at:number, target:string|null, text:string) {
  const requested = /^选择[ \t]+([^\r\n]+)$/.exec(text)?.[1].normalize('NFKC').trim()
  const intent = requested ? 'choose' : !text || text === '切换身份' ? 'menu' : 'turn'
  const id = crypto.randomUUID()
  const routing = `WITH source AS MATERIALIZED (
    SELECT m.id,m.user_id,m.body,identity.bot_id,identity.chat_round_limit,identity.chat_end_mode,identity.chat_end_text,
      CASE WHEN ?3='turn' AND ?4=identity.chat_end_marker THEN 'end' ELSE ?3 END AS action
    FROM chat_messages m JOIN chat_group_bot_identity identity ON identity.group_id=m.group_id
    JOIN users shared ON shared.id=identity.bot_id AND shared.kind='bot' AND shared.disabled=0
    WHERE m.id=last_insert_rowid() AND m.group_id=?1 AND (?2 IS NULL OR shared.username=?2)
  ), available AS MATERIALIZED (
    SELECT i.id,COALESCE(i.chat_name,b.username) AS name FROM chat_bot_installations i
    JOIN users b ON b.id=i.bot_id AND b.kind='bot' AND b.disabled=0
    WHERE i.group_id=?1 AND i.enabled=1 AND i.callback_url IS NOT NULL AND ${chatPersona} AND ${botMaintainerActive}
  ), preference AS MATERIALIZED (
    SELECT p.* FROM chat_bot_persona_choices p JOIN source s ON s.user_id=p.user_id WHERE p.group_id=?1
  ), picked AS MATERIALIZED (
    SELECT a.id,a.name FROM available a CROSS JOIN source s LEFT JOIN preference previous ON 1
    WHERE (s.action='choose' AND a.name=?4 COLLATE NOCASE)
      OR (s.action='end' AND s.chat_end_mode='callback' AND a.id=previous.installation_id)
      OR (s.action='turn' AND (a.id=previous.installation_id
        OR (previous.installation_id IS NULL AND COALESCE(previous.needs_selection,0)=0 AND (SELECT COUNT(*) FROM available)=1)))
  ), waiting AS (
    SELECT 1 FROM chat_bot_events e JOIN preference p ON p.session_id=e.chat_session_id CROSS JOIN source s
    JOIN chat_messages original ON original.id=e.message_id AND original.deleted=0
    WHERE e.chat_replied_at IS NULL AND e.created_at>?5-${CHAT_REPLY_WINDOW}
      AND e.state IN('pending','delivering','delivered')
      AND (e.chat_end_requested=1 OR (s.action='turn' AND s.chat_round_limit>0))
    LIMIT 1
  )`
  const bind = (sql:string) => db.prepare(routing + sql).bind(groupId,target,intent,requested ?? text,at,id)

  const event = bind(`INSERT OR IGNORE INTO chat_bot_events(id,installation_id,message_id,command,args,source_body,next_at,created_at,chat_session_id,chat_end_requested)
    SELECT ?6,p.id,CASE WHEN s.action='choose' THEN original.id ELSE s.id END,'chat',
      CASE WHEN s.action='choose' THEN previous.pending_text ELSE ?4 END,
      CASE WHEN s.action='choose' THEN original.body ELSE s.body END,?5,?5,
      CASE WHEN s.action='choose' THEN ?6 ELSE COALESCE(previous.session_id,?6) END,s.action='end'
    FROM source s CROSS JOIN picked p LEFT JOIN preference previous ON 1
    LEFT JOIN chat_messages original ON original.id=previous.pending_message_id AND original.group_id=?1
      AND original.user_id=s.user_id AND original.deleted=0 AND original.edited_at IS NULL AND original.created_at>=?5-${CHAT_REPLY_WINDOW}
    WHERE (s.action IN('turn','end') OR (s.action='choose' AND original.id IS NOT NULL AND previous.pending_text IS NOT NULL))
      AND (s.action='choose' OR NOT EXISTS(SELECT 1 FROM waiting))
      AND (SELECT COUNT(*) FROM chat_bot_events e WHERE e.installation_id=p.id AND e.created_at>?5-60)<30
    RETURNING id`)

  // WITHOUT ROWID keeps the source message ID available for the following prompt.
  const preference = bind(`INSERT INTO chat_bot_persona_choices(group_id,user_id,installation_id,pending_message_id,pending_text,session_id,completed_rounds,needs_selection)
    SELECT ?1,s.user_id,p.id,
      CASE WHEN s.action='turn' AND p.id IS NULL AND EXISTS(SELECT 1 FROM available) THEN s.id END,
      CASE WHEN s.action='turn' AND p.id IS NULL AND EXISTS(SELECT 1 FROM available) THEN ?4 END,
      CASE WHEN p.id IS NOT NULL THEN CASE WHEN s.action='choose' THEN ?6 ELSE COALESCE(previous.session_id,?6) END END,
      CASE WHEN s.action IN('turn','end') AND p.id=previous.installation_id THEN previous.completed_rounds ELSE 0 END,
      CASE WHEN s.action IN('end','menu') AND p.id IS NULL THEN 1
        WHEN p.id IS NULL THEN COALESCE(previous.needs_selection,0) ELSE 0 END
    FROM source s LEFT JOIN picked p ON 1 LEFT JOIN preference previous ON 1
    WHERE (s.action!='choose' OR p.id IS NOT NULL) AND (?5>0)
    ON CONFLICT(group_id,user_id) DO UPDATE SET installation_id=excluded.installation_id,
      pending_message_id=excluded.pending_message_id,pending_text=excluded.pending_text,session_id=excluded.session_id,
      completed_rounds=excluded.completed_rounds,needs_selection=excluded.needs_selection`)

  const prompt = bind(`INSERT OR IGNORE INTO chat_messages(group_id,user_id,body,reply_to,created_at,updated_at,system_kind,system_ref)
    SELECT ?1,s.bot_id,CASE
      WHEN s.action='end' AND p.id IS NULL THEN s.chat_end_text
      WHEN s.action='end' THEN '结束请求处理中，请稍后再试。'
      WHEN s.action='choose' AND p.id IS NOT NULL THEN '已切换到「'||p.name||'」。'
      WHEN s.action='turn' AND p.id IS NOT NULL AND (SELECT pending_message_id FROM preference) IS NOT s.id
        THEN '请等机器人回复后再继续。'
      WHEN NOT EXISTS(SELECT 1 FROM available) THEN '本群还没有启用聊天身份。发送 /help 查看命令。'
      ELSE '请选择聊天身份：'||char(10)||(SELECT group_concat(line,char(10)) FROM (
        SELECT '/chat 选择 '||name AS line FROM available ORDER BY name COLLATE NOCASE
      )) END,s.id,?5,?5,'chat_bot',
      CASE WHEN EXISTS(SELECT 1 FROM available) AND (s.action='menu' OR (s.action='choose' AND p.id IS NULL)
        OR (s.action='turn' AND ((SELECT pending_message_id FROM preference)=s.id OR p.id IS NULL)))
        THEN 'persona-menu:' ELSE 'persona-status:' END||s.id
    FROM source s LEFT JOIN picked p ON 1
    WHERE (s.action IN('menu','choose') OR NOT EXISTS(SELECT 1 FROM chat_bot_events WHERE id=?6))
      AND (SELECT COUNT(*) FROM chat_messages q WHERE q.user_id=s.bot_id AND q.created_at>?5-60)<30`)
  return {id,statements:[event,preference,prompt]}
}

// e is the webhook event, m its original message, identity the group's bot settings.
export function chatReplyCurrent(at: string) {
  return `(e.chat_session_id IS NULL OR EXISTS(SELECT 1 FROM chat_bot_persona_choices session
    WHERE session.group_id=m.group_id AND session.user_id=m.user_id AND session.installation_id=e.installation_id
      AND session.session_id=e.chat_session_id AND e.chat_replied_at IS NULL
      AND (identity.chat_round_limit=0 OR e.chat_end_requested=1 OR
        (session.completed_rounds<identity.chat_round_limit AND e.created_at>${at}-${CHAT_REPLY_WINDOW}))))`
}

export function chatReplyStatements(db: D1Database, eventId: string, end: boolean, at: number) {
  const session = `SELECT p.group_id,p.user_id,i.chat_round_limit AS round_limit,i.bot_id,i.chat_end_text,e.message_id,e.chat_end_requested
    FROM chat_bot_events e JOIN chat_messages m ON m.id=e.message_id
    JOIN chat_bot_persona_choices p ON p.group_id=m.group_id AND p.user_id=m.user_id AND p.session_id=e.chat_session_id
    JOIN chat_group_bot_identity i ON i.group_id=p.group_id
    WHERE e.id=?1 AND e.chat_replied_at IS NULL`
  const increment = db.prepare(`WITH current AS (${session})
    UPDATE chat_bot_persona_choices SET completed_rounds=completed_rounds+1
    WHERE (group_id,user_id) IN (SELECT group_id,user_id FROM current WHERE chat_end_requested=0)`).bind(eventId)
  const limitReached = `current.round_limit>0 AND p.completed_rounds>=current.round_limit`
  const notice = db.prepare(`WITH current AS (${session})
    INSERT OR IGNORE INTO chat_messages(group_id,user_id,body,reply_to,created_at,updated_at,system_kind,system_ref)
    SELECT current.group_id,bot_id,'本次会话已达到 '||round_limit||' 轮。'||char(10)||chat_end_text,message_id,?2,?2,'chat_bot','persona-ended:'||?1
    FROM current JOIN chat_bot_persona_choices p USING(group_id,user_id)
    WHERE ${limitReached} AND current.chat_end_requested=0 AND ?3=0`).bind(eventId,at,end?1:0)
  const close = db.prepare(`WITH current AS MATERIALIZED (${session})
    UPDATE chat_bot_persona_choices SET installation_id=NULL,session_id=NULL,completed_rounds=0,
      pending_message_id=NULL,pending_text=NULL,needs_selection=1 WHERE (group_id,user_id) IN (
        SELECT current.group_id,current.user_id FROM current JOIN chat_bot_persona_choices p USING(group_id,user_id)
        WHERE ?2=1 OR current.chat_end_requested=1 OR (${limitReached})
      )`).bind(eventId,end?1:0)
  const mark = db.prepare('UPDATE chat_bot_events SET chat_replied_at=? WHERE id=? AND chat_session_id IS NOT NULL').bind(at,eventId)
  return [increment,notice,close,mark]
}

function groupHelpInsert(db: D1Database, groupId: number, at: number, doc: boolean, origin: string) {
  return db.prepare(`INSERT OR IGNORE INTO chat_messages(group_id,user_id,body,reply_to,created_at,updated_at,system_kind,system_ref)
    SELECT identity.group_id,identity.bot_id,
      CASE WHEN ?3=1 THEN COALESCE((SELECT '接入说明 '||?4||'/m/'||post.id
        FROM memes post WHERE post.id=identity.doc_post_id AND post.hidden=0),'本群还没有设置对接说明帖子。')
      ELSE '本群机器人命令'||char(10)||'/help · 查看命令列表'||char(10)||'/doc · 对接说明'||char(10)||
      CASE WHEN EXISTS(SELECT 1 FROM chat_bot_installations i JOIN users receiver ON receiver.id=i.bot_id AND receiver.disabled=0
        WHERE i.group_id=?1 AND i.enabled=1 AND i.callback_url IS NOT NULL AND ${chatPersona} AND ${botMaintainerActive})
        THEN '/chat · 和机器人对话或切换聊天身份'||char(10) ELSE '' END||COALESCE((SELECT group_concat(line,char(10)) FROM (
        SELECT '/'||commands.value||COALESCE(' · '||group_concat(DISTINCT NULLIF(descriptions.value,'')),'') AS line
        FROM chat_bot_installations i JOIN users receiver ON receiver.id=i.bot_id AND receiver.disabled=0
        JOIN json_each(i.commands) commands
        LEFT JOIN json_each(i.command_descriptions) descriptions ON descriptions.key=commands.value
        WHERE i.group_id=?1 AND i.enabled=1 AND i.callback_url IS NOT NULL AND commands.value NOT IN('help','doc','chat') AND ${botMaintainerActive}
        GROUP BY commands.value ORDER BY commands.value
      )), '暂无已启用的回调命令') END,m.id,?2,?2,'chat_bot','group-help:'||m.id
    FROM chat_group_bot_identity identity
    JOIN users b ON b.id=identity.bot_id AND b.disabled=0
    JOIN chat_messages m ON m.id=last_insert_rowid() AND m.group_id=identity.group_id
    WHERE identity.group_id=?1 AND (identity.doc_post_id IS NOT NULL OR EXISTS(SELECT 1 FROM chat_bot_installations i
      JOIN users receiver ON receiver.id=i.bot_id AND receiver.disabled=0 WHERE i.group_id=?1 AND i.enabled=1 AND ${botMaintainerActive}))
      AND (SELECT COUNT(*) FROM chat_messages q WHERE q.user_id=identity.bot_id AND q.created_at>?2-60)<30
    RETURNING id`).bind(groupId, at, doc ? 1 : 0, origin)
}

// Bare commands require a unique enabled receiver. The old explicit address still works.
export function botCommandInsert(db: D1Database, groupId: number, body: string, at: number, webhookReady: boolean, origin: string) {
  const command = /^(?:@(bot_[a-f0-9]{12})[ \t]+)?\/([^\s/]+)(?:[ \t]+([^\r\n]*))?$/i.exec(body)
  let name = '', target: string|null, args: string
  if (command && command[0] === body && BOT_COMMAND.test(command[2].toLowerCase()) && (command[3]?.length ?? 0) <= 1000) {
    name = command[2].toLowerCase()
    target = command[1]?.toLowerCase() ?? null
    args = command[3]?.trim() ?? ''
  } else {
    const mention = /^@(bot_[a-f0-9]{12})[ \t]+([\s\S]+)$/i.exec(body)
    if (!mention) return null
    target = mention[1].toLowerCase()
    args = mention[2].trim()
    if (!args || args.startsWith('/') || args.length > BOT_TEXT_LIMIT) return null
    name = 'chat'
  }
  if (!target && (name === 'help' || name === 'doc') && !args) {
    return { id: null, statements: [groupHelpInsert(db, groupId, at, name === 'doc', origin)] }
  }
  if (!webhookReady) return null
  if (name === 'chat') return chatPersonaStatements(db,groupId,at,target,args)
  const id = crypto.randomUUID()
  const statement = db.prepare(`WITH receivers AS MATERIALIZED (
    SELECT i.id FROM chat_bot_installations i JOIN users b ON b.id=i.bot_id AND b.kind='bot' AND b.disabled=0
    LEFT JOIN chat_group_bot_identity identity ON identity.group_id=i.group_id
    LEFT JOIN users shared ON shared.id=identity.bot_id
    WHERE i.group_id=?5
      AND i.enabled=1 AND i.callback_url IS NOT NULL
      AND ${botMaintainerActive}
      AND (?6 IS NULL OR b.username=?6 OR shared.username=?6)
      AND EXISTS(SELECT 1 FROM json_each(i.commands) WHERE value=?2)
  ) INSERT INTO chat_bot_events(id,installation_id,message_id,command,args,source_body,next_at,created_at)
    SELECT ?1,r.id,m.id,?2,?3,m.body,?4,?4 FROM receivers r
    JOIN chat_messages m ON m.id=last_insert_rowid() AND m.group_id=?5
    WHERE (SELECT COUNT(*) FROM receivers)=1
      AND (SELECT COUNT(*) FROM chat_bot_events e WHERE e.installation_id=r.id AND e.created_at>?4-60)<30
    RETURNING id`).bind(id, name, args, at, groupId, target)
  return { id, statements:[statement] }
}

type Delivery = {
  installation_id: string; message_id: number; command: string; args: string; created_at: number
  group_id: number; callback_url: string; key_version: string; username: string
  sender_id: number; sender_username: string; chat_name:string; chat_session_id:string|null; chat_end_requested:number
  round_limit:number; completed_rounds:number|null; chat_end_mode:'system'|'callback'
}

export async function deliverBotEvent(env: Env, id: string) {
  const { DB: db, CHAT_BOT_WEBHOOK_KEY: key } = env
  if (!key) return
  const lease = crypto.randomUUID(), at = now()
  const claimed = await db.prepare(`UPDATE chat_bot_events SET state='delivering',lease=?2,next_at=?3+30,attempts=attempts+1
    WHERE id=?1 AND state IN('pending','delivering') AND next_at<=?3 AND attempts<?4
    RETURNING attempts`).bind(id, lease, at, MAX_ATTEMPTS).first<{ attempts: number }>()
  if (!claimed) return

  const event = await db.prepare(`SELECT e.installation_id,e.message_id,e.command,e.args,e.created_at,
      i.group_id,i.callback_url,i.key_version,COALESCE(shared.username,b.username) AS username,u.id sender_id,u.username sender_username,COALESCE(i.chat_name,b.username) AS chat_name,
      e.chat_session_id,e.chat_end_requested,COALESCE(identity.chat_round_limit,0) AS round_limit,
      persona.completed_rounds,identity.chat_end_mode
    FROM chat_bot_events e JOIN chat_bot_installations i ON i.id=e.installation_id AND i.enabled=1
    JOIN users b ON b.id=i.bot_id AND b.kind='bot' AND b.disabled=0
    LEFT JOIN chat_group_bot_identity identity ON identity.group_id=i.group_id
    LEFT JOIN users shared ON shared.id=identity.bot_id
    JOIN chat_messages m ON m.id=e.message_id AND m.group_id=i.group_id AND m.deleted=0 AND m.body=e.source_body
    LEFT JOIN chat_bot_persona_choices persona ON persona.group_id=m.group_id AND persona.user_id=m.user_id
      AND persona.session_id=e.chat_session_id AND persona.installation_id=i.id
    JOIN users u ON u.id=m.user_id AND u.kind='user' AND u.disabled=0 AND u.silenced=0
    JOIN chat_members cm ON cm.group_id=m.group_id AND cm.user_id=u.id
    WHERE e.id=? AND e.lease=? AND i.callback_url IS NOT NULL
      AND ${botMaintainerActive}
      AND (e.command!='chat' OR ${chatPersona}) AND ${chatReplyCurrent('unixepoch()')}
      AND m.created_at>=cm.joined_at AND m.id>=${CHAT_HISTORY_FLOOR}
      AND NOT EXISTS(SELECT 1 FROM chat_bans WHERE group_id=m.group_id AND user_id=u.id)
      AND NOT EXISTS(SELECT 1 FROM user_limits WHERE user_id=u.id AND u.is_admin=0 AND kind='chat' AND (until=0 OR until>unixepoch()))`)
    .bind(id, lease).first<Delivery>()

  let state = 'cancelled', error: string | null = null, nextAt = at
  if (event) {
    const url = botCallbackUrl(env, event.callback_url)
    if (url) {
      // 匿名群：机器人只拿到对外身份
      if (isAnonGroup(event.group_id)) {
        const p = (await messagePeople(publicCtx(env), [{ id: event.message_id, user_id: event.sender_id, created_at: event.created_at, person: { id: event.sender_id, username: event.sender_username } }], event.group_id)).get(event.message_id)
        event.sender_id = Number(p?.id ?? -1); event.sender_username = String(p?.username ?? '鱼友')
      }
      const payload = JSON.stringify({
        type: 'chat.command', event_id: id, installation_id: event.installation_id,
        group_id: event.group_id, message_id: event.message_id,
        bot_username: event.username, sender_id: event.sender_id, sender_username: event.sender_username,
        command: event.command, args: event.args, created_at: event.created_at,
        ...(event.command==='chat' ? {
          chat_name:event.chat_name, conversation_id:event.chat_session_id, end_requested:!!event.chat_end_requested,
          round_limit:event.round_limit, closing_mode:event.chat_end_mode,
          last_turn:!event.chat_end_requested && event.round_limit>0 && Number(event.completed_rounds)+1>=event.round_limit,
        } : {}),
      })
      const timestamp = String(now())
      const secret = await botSigningSecret(key, event.installation_id, event.key_version)
      const signature = await hmacHex(secret, timestamp + '.' + payload)
      const local = env.DEV_LOGIN_KEY && new URL(url).hostname === '127.0.0.1'
      const transport = local ? null : env.PUBLIC_BOT_CALLBACK
      if (!local && !transport && await resolvesPrivate(new URL(url).hostname)) error = '回调地址解析到内网或无法解析，已拒绝'
      else try {
        const options = {
          method: 'POST', body: payload, signal: AbortSignal.timeout(5000),
          headers: {
            'content-type': 'application/json', 'x-jinhuan-event': id,
            'x-jinhuan-timestamp': timestamp, 'x-jinhuan-signature': 'sha256=' + signature,
          },
        }
        const response = transport ? await transport(url,options) : await fetch(url,{...options,redirect:'manual'})
        if (!response.ok) error = 'HTTP ' + response.status
        await response.body?.cancel().catch(() => {})
      } catch { error = '回调连接失败或超时' }
      state = error ? (claimed.attempts >= MAX_ATTEMPTS ? 'failed' : 'pending') : 'delivered'
      if (state === 'pending') nextAt = now() + 30 * 2 ** (claimed.attempts - 1)
    } else { state = 'failed'; error = '回调地址无效' }
  } else { error = '消息或机器人已不可用' }

  await db.prepare(`UPDATE chat_bot_events SET state=CASE WHEN chat_replied_at IS NULL THEN ? ELSE 'delivered' END,
    error=CASE WHEN chat_replied_at IS NULL THEN ? END,next_at=?,lease=NULL WHERE id=? AND lease=?`)
    .bind(state, error, nextAt, id, lease).run()
}

export async function runBotDeliveries(env: Env, at: number) {
  if (!env.CHAT_BOT_WEBHOOK_KEY) return
  const { results } = await env.DB.prepare(`SELECT id,attempts FROM chat_bot_events
    WHERE state IN('pending','delivering') AND next_at<=? ORDER BY next_at,id LIMIT 20`).bind(at)
    .all<{ id: string; attempts: number }>()
  for (let i = 0; i < results.length; i += 4) {
    await Promise.allSettled(results.slice(i, i + 4).map(event => event.attempts < MAX_ATTEMPTS
      ? deliverBotEvent(env, event.id)
      : env.DB.prepare(`UPDATE chat_bot_events SET state='failed',lease=NULL,error='投递超时'
          WHERE id=? AND state IN('pending','delivering') AND next_at<=? AND attempts>=?`)
        .bind(event.id, at, MAX_ATTEMPTS).run()))
  }
}

export async function pruneBotEvents(db: D1Database, at: number) {
  await db.prepare('DELETE FROM chat_bot_events WHERE id IN (SELECT id FROM chat_bot_events WHERE created_at<? ORDER BY created_at,id LIMIT 500)')
    .bind(at - RETENTION).run()
  await db.prepare(`UPDATE chat_bot_persona_choices SET pending_message_id=NULL,pending_text=NULL WHERE (group_id,user_id) IN (
    SELECT p.group_id,p.user_id FROM chat_bot_persona_choices p LEFT JOIN chat_messages m ON m.id=p.pending_message_id
    WHERE p.pending_text IS NOT NULL AND (m.id IS NULL OR m.deleted=1 OR m.created_at<?) LIMIT 500
  )`).bind(at-CHAT_REPLY_WINDOW).run()
}
