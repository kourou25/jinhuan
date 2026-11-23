// src/shared/dcoin-packet-rules.ts
var DCOIN_PACKET_MAX = 5e6;
function parseDcoinPacketAmount(value) {
  if (typeof value !== "string" || !/^\d{1,7}(?:\.0{1,2})?$/.test(value)) return null;
  const amount = Number(value);
  return amount >= 1 && amount <= DCOIN_PACKET_MAX ? amount : null;
}
export {
  DCOIN_PACKET_MAX,
  parseDcoinPacketAmount
};
