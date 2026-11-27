// 匿名系列目录：每行一个角色，格式「名字|像素头像特征」。编号 = 行号，上线后只能在末尾追加，不能调换顺序或删除。
// 特征只用来生成 docs/anon-avatar-prompts.md（node scripts/anon-avatars.mjs prompts）。
import { TEXT } from './series'

export type Item = { name: string; look: string }
export type Series = { id: string; name: string; hue: number; style: string; items: Item[] }
export const SERIES_LIST: Series[] = TEXT.map(({ id, name, hue, style, text }) => ({
  id, name, hue, style,
  items: text.trim().split('\n').map((line) => { const [n, look = ''] = line.split('|'); return { name: n.trim(), look: look.trim() } }),
}))
export const SERIES: Record<string, Series> = Object.fromEntries(SERIES_LIST.map((s) => [s.id, s]))
