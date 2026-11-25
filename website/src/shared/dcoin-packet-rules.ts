export const DCOIN_PACKET_MAX = 5_000_000

export function parseDcoinPacketAmount(value: unknown) {
  if (typeof value !== 'string' || !/^\d{1,7}(?:\.0{1,2})?$/.test(value)) return null
  const amount = Number(value)
  return amount >= 1 && amount <= DCOIN_PACKET_MAX ? amount : null
}
