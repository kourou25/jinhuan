// 逐个迁移路由期间保留原入口，避免在新账号事务尚未验收时同时改动所有业务路由。
export { default } from './index'
export { authenticateChatRealtime, chatRealtimeAuthKey, getChatRealtimeAccess, getChatRealtimeAccessBatch } from './services/chat-realtime-access'
export { hydrateChatRealtimeBatch, projectChatRealtimeBatch } from './services/chat-realtime-projection'
