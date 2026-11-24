import { decoOf } from '../shared/deco'

export function wearsRemInChat(rawDeco: unknown) {
  const deco = decoOf(rawDeco)
  return deco?.rem === true && deco.sc !== 'post'
}

export const nextRemFormSql = `CASE WHEN ? THEN COALESCE((
  SELECT 1 - rem_form FROM chat_messages
  WHERE group_id = ? AND user_id = ? AND rem_form IS NOT NULL
  ORDER BY id DESC LIMIT 1
), 0) END`

export function remChatForm(value: unknown) {
  return value === 0 ? 'white' : value === 1 ? 'black' : null
}
