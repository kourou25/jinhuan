// live-app.js 是从线上提取的无类型 JS，这里只声明被 TS 模块用到的出口。
declare const worker: ExportedHandler<import('../env').Env>
export default worker
export function b33Internal(db: D1Database, gid: number): Promise<boolean>
export const farewellRelease: { farmClosed(t: number): boolean; FARM_CLOSE_AT: number; [k: string]: any }
export function guessAdmissionSql(questions: string, uid: string | number, at: string | number, roomId?: string | number): string
export function rejectPendingGuess(c: any, p: any, u: any, roomId?: number): Promise<void>
export function guessSubmissionSignals(c: any): Promise<unknown>
export const CHAT_SELECT: string
export function atReads(c: { env: import('../env').Env }, rows: import('../services/chat-realtime-projection').ChatRealtimeRow[]): Promise<Map<number, Record<string, boolean>>>
export function decorateMsgs(
  c: { env: import('../env').Env; get(key: string): unknown },
  rows: import('../services/chat-realtime-projection').ChatRealtimeRow[],
  shared: {
    decorations: import('../services/chat-message-hydrate').ChatDecorations; reads: Map<number, Record<string, boolean>>
    packets: import('../services/chat-packet-projection').ChatPacketPublicMap; joinedAt: number; historyFloor: number
  },
): Promise<Array<{ id: number; [field: string]: unknown }>>
