// 把普通 MP4 / MOV 重新封装成分片 MP4（fMP4），给小程序的平台播放器用（2026-11-26）。
// 只换封装、不重新编码：每条轨道拆成「初始化段 + 一个媒体段」。只处理第一条视频轨和第一条 AAC 音轨；
// 视频支持 H.264 / H.265，其他编码返回 null（小程序里显示封面，提示暂时播放不了）。
export type Track = { kind: 'video' | 'audio'; codec: string; init: Uint8Array; seg: Uint8Array; duration: number }

type Box = { type: string; start: number; size: number; head: number }
const u32 = (b: Uint8Array, i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0
const u16 = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1]
const i32 = (b: Uint8Array, i: number) => (b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]
const fourcc = (b: Uint8Array, i: number) => String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3])
const u64 = (b: Uint8Array, i: number) => u32(b, i) * 2 ** 32 + u32(b, i + 4)

function boxes(b: Uint8Array, from: number, to: number): Box[] {
  const out: Box[] = []
  let i = from
  while (i + 8 <= to) {
    let size = u32(b, i), head = 8
    if (size === 1) { size = u64(b, i + 8); head = 16 } else if (size === 0) size = to - i
    if (size < head || i + size > to) break
    out.push({ type: fourcc(b, i + 4), start: i, size, head })
    i += size
  }
  return out
}
const kids = (b: Uint8Array, x: Box, skip = 0) => boxes(b, x.start + x.head + skip, x.start + x.size)
const find = (b: Uint8Array, list: Box[], type: string) => list.find((x) => x.type === type)
const raw = (b: Uint8Array, x: Box) => b.subarray(x.start, x.start + x.size)

// ---------- 写盒子 ----------
function join(parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) { out.set(p, at); at += p.length }
  return out
}
function box(type: string, ...parts: Uint8Array[]) {
  const body = join(parts), out = new Uint8Array(8 + body.length)
  new DataView(out.buffer).setUint32(0, out.length)
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
  out.set(body, 8)
  return out
}
const bytes = (...ns: [number, number][]) => { // [值, 字节数]
  const out = new Uint8Array(ns.reduce((n, [, w]) => n + w, 0)), v = new DataView(out.buffer)
  let at = 0
  for (const [n, w] of ns) { if (w === 1) v.setUint8(at, n); else if (w === 2) v.setUint16(at, n); else if (w === 4) v.setUint32(at, n >>> 0); else { v.setUint32(at, Math.floor(n / 2 ** 32)); v.setUint32(at + 4, n >>> 0) } at += w }
  return out
}
const full = (type: string, version: number, flags: number, ...parts: Uint8Array[]) => box(type, bytes([(version << 24) | flags, 4]), ...parts)

// ---------- 编码字符串 ----------
const hex2 = (n: number) => n.toString(16).padStart(2, '0')
function codecOf(b: Uint8Array, entry: Box): string | null {
  const t = entry.type
  if (t === 'avc1' || t === 'avc3') {
    const c = find(b, kids(b, entry, 78), 'avcC')
    if (!c) return null
    const p = c.start + c.head
    return `${t}.${hex2(b[p + 1])}${hex2(b[p + 2])}${hex2(b[p + 3])}`
  }
  if (t === 'hvc1' || t === 'hev1') {
    const c = find(b, kids(b, entry, 78), 'hvcC')
    if (!c) return null
    const p = c.start + c.head, x = b[p + 1]
    const space = ['', 'A', 'B', 'C'][x >> 6], tier = (x >> 5) & 1 ? 'H' : 'L', profile = x & 31
    let compat = u32(b, p + 2), rev = 0
    for (let i = 0; i < 32; i++) { rev = (rev << 1) | (compat & 1); compat >>>= 1 }
    const cons: string[] = []
    for (let i = 0; i < 6; i++) cons.push(b[p + 6 + i].toString(16).toUpperCase())
    while (cons.length > 1 && cons[cons.length - 1] === '0') cons.pop()
    return `${t}.${space}${profile}.${(rev >>> 0).toString(16).toUpperCase()}.${tier}${b[p + 12]}.${cons.join('.')}`
  }
  return null
}
// AAC：在 mp4a 里（QuickTime 可能包在 wave 里）找 esds
function aacOf(b: Uint8Array, entry: Box, skip: number): { codec: string; esds: Uint8Array } | null {
  const search = (list: Box[]): Box | undefined => { for (const x of list) { if (x.type === 'esds') return x; if (x.type === 'wave') { const y = search(kids(b, x)); if (y) return y } } }
  const e = search(kids(b, entry, skip))
  if (!e) return null
  // ES_Descriptor 里找 DecoderConfig(0x04) 和 DecoderSpecificInfo(0x05)
  let i = e.start + e.head + 4, end = e.start + e.size, oti = 0, aot = 2
  const len = () => { let n = 0; for (let k = 0; k < 4; k++) { const c = b[i++]; n = (n << 7) | (c & 127); if (!(c & 128)) break } return n }
  while (i < end) {
    const tag = b[i++], n = len()
    if (tag === 3) { const flags = b[i + 2]; i += 3; if (flags & 128) i += 2; if (flags & 64) i += 1 + b[i]; if (flags & 32) i += 2; continue }
    if (tag === 4) { oti = b[i]; i += 13; continue }
    if (tag === 5) { aot = b[i] >> 3; if (aot === 31) aot = 32 + (((b[i] & 7) << 3) | (b[i + 1] >> 5)); break }
    i += n
  }
  if (oti !== 0x40) return null
  return { codec: `mp4a.40.${aot}`, esds: raw(b, e) }
}

// ---------- 样本表 ----------
type Samples = { size: number[]; offset: number[]; dur: number[]; cts: number[]; sync: boolean[] }
function samples(b: Uint8Array, stbl: Box[]): Samples | null {
  const g = (t: string) => find(b, stbl, t)
  const stsz = g('stsz'), stsc = g('stsc'), stts = g('stts'), co = g('stco') ?? g('co64')
  if (!stsz || !stsc || !stts || !co) return null
  let p = stsz.start + stsz.head + 4
  const fixed = u32(b, p), n = u32(b, p + 4)
  if (!n || n > 2_000_000) return null
  const size = Array.from({ length: n }, (_, k) => fixed || u32(b, p + 8 + k * 4))
  p = co.start + co.head + 4
  const chunks = u32(b, p), wide = co.type === 'co64', chunkAt = Array.from({ length: chunks }, (_, k) => wide ? u64(b, p + 4 + k * 8) : u32(b, p + 4 + k * 4))
  p = stsc.start + stsc.head + 4
  const runs = Array.from({ length: u32(b, p) }, (_, k) => ({ first: u32(b, p + 4 + k * 12), per: u32(b, p + 8 + k * 12) }))
  const offset: number[] = []
  for (let r = 0, s = 0; r < runs.length && s < n; r++) {
    const last = r + 1 < runs.length ? runs[r + 1].first - 1 : chunks
    for (let c = runs[r].first; c <= last && s < n; c++) {
      let at = chunkAt[c - 1]
      for (let k = 0; k < runs[r].per && s < n; k++) { offset.push(at); at += size[s++] }
    }
  }
  if (offset.length !== n) return null
  const dur: number[] = []
  p = stts.start + stts.head + 4
  for (let e = 0, m = u32(b, p); e < m; e++) for (let k = 0, c = u32(b, p + 4 + e * 8), d = u32(b, p + 8 + e * 8); k < c && dur.length < n; k++) dur.push(d)
  while (dur.length < n) dur.push(dur[dur.length - 1] ?? 1)
  const cts = new Array<number>(n).fill(0), ctts = g('ctts')
  if (ctts) {
    p = ctts.start + ctts.head
    const signed = b[p] === 1
    let s = 0
    for (let e = 0, m = u32(b, p + 4); e < m; e++) for (let k = 0, c = u32(b, p + 8 + e * 8), v = signed ? i32(b, p + 12 + e * 8) : u32(b, p + 12 + e * 8); k < c && s < n; k++) cts[s++] = v
  }
  const stss = g('stss'), sync = new Array<boolean>(n).fill(!stss)
  if (stss) { p = stss.start + stss.head + 4; for (let e = 0, m = u32(b, p); e < m; e++) { const k = u32(b, p + 4 + e * 4) - 1; if (k >= 0 && k < n) sync[k] = true } }
  return { size, offset, dur, cts, sync }
}

// ---------- 拼初始化段和媒体段 ----------
const FTYP = box('ftyp', new TextEncoder().encode('isom'), bytes([0x200, 4]), new TextEncoder().encode('isomiso6mp41'))
function initOf(b: Uint8Array, mvhd: Box, trak: Box, id: number, stsd: Uint8Array): Uint8Array {
  const tk = kids(b, trak), mdia = find(b, tk, 'mdia')!, md = kids(b, mdia), minf = find(b, md, 'minf')!, mi = kids(b, minf)
  const keep = (list: Box[], types: string[]) => list.filter((x) => types.includes(x.type)).map((x) => raw(b, x))
  const empty = (t: string) => full(t, 0, 0, bytes([0, 4]))
  const stbl = box('stbl', stsd, empty('stts'), empty('stsc'), full('stsz', 0, 0, bytes([0, 4], [0, 4])), empty('stco'))
  const newMinf = box('minf', ...keep(mi, ['vmhd', 'smhd', 'dinf']), stbl)
  const newMdia = box('mdia', ...keep(md, ['mdhd', 'hdlr']), newMinf)
  const newTrak = box('trak', ...keep(tk, ['tkhd']), newMdia)
  const mvex = box('mvex', full('trex', 0, 0, bytes([id, 4], [1, 4], [0, 4], [0, 4], [0, 4])))
  return join([FTYP, box('moov', raw(b, mvhd), newTrak, mvex)])
}
function segOf(b: Uint8Array, id: number, s: Samples, video: boolean): Uint8Array {
  const n = s.size.length, base = s.cts[0] ?? 0
  const flags = 0x001 | 0x100 | 0x200 | 0x400 | (video ? 0x800 : 0)
  const per = 12 + (video ? 4 : 0)
  const entries = new Uint8Array(n * per), v = new DataView(entries.buffer)
  for (let k = 0; k < n; k++) {
    const o = k * per
    v.setUint32(o, s.dur[k]); v.setUint32(o + 4, s.size[k])
    v.setUint32(o + 8, s.sync[k] ? 0x02000000 : 0x01010000)
    if (video) v.setInt32(o + 12, s.cts[k] - base) // 第一帧从 0 开始显示
  }
  const build = (dataOffset: number) => box('moof', full('mfhd', 0, 0, bytes([1, 4])),
    box('traf', full('tfhd', 0, 0x020000, bytes([id, 4])), full('tfdt', 1, 0, bytes([0, 8])),
      full('trun', 1, flags, bytes([n, 4], [dataOffset, 4]), entries)))
  const moofSize = build(0).length
  const total = s.size.reduce((a, x) => a + x, 0), mdat = new Uint8Array(8 + total)
  new DataView(mdat.buffer).setUint32(0, mdat.length); mdat.set([0x6d, 0x64, 0x61, 0x74], 4)
  for (let k = 0, at = 8; k < n; k++) { mdat.set(b.subarray(s.offset[k], s.offset[k] + s.size[k]), at); at += s.size[k] }
  return join([build(moofSize + 8), mdat])
}
// QuickTime 的 mp4a 可能是 v1 / v2 声音描述，浏览器只认 v0：重写成 v0，带上 esds
function audioEntry(b: Uint8Array, e: Box, esds: Uint8Array): Uint8Array {
  const p = e.start + 8, ch = u16(b, p + 16) || 2, bits = u16(b, p + 18) || 16
  let rate = u32(b, p + 24)
  if (u16(b, p + 8) === 2) rate = Math.round(new DataView(b.buffer, b.byteOffset + p + 32, 8).getFloat64(0)) * 65536
  return box('mp4a', bytes([0, 4], [0, 2], [1, 2], [0, 4], [0, 4], [ch, 2], [bits, 2], [0, 2], [0, 2], [rate, 4]), esds)
}

export function fragment(b: Uint8Array): Track[] | null {
  const moov = find(b, boxes(b, 0, b.length), 'moov')
  if (!moov) return null
  const mv = kids(b, moov), mvhd = find(b, mv, 'mvhd')
  if (!mvhd) return null
  const out: Track[] = []
  for (const trak of mv.filter((x) => x.type === 'trak')) {
    const tk = kids(b, trak), tkhd = find(b, tk, 'tkhd'), mdia = tkhd && find(b, tk, 'mdia')
    if (!mdia) continue
    const md = kids(b, mdia), hdlr = find(b, md, 'hdlr'), mdhd = find(b, md, 'mdhd'), minf = find(b, md, 'minf')
    if (!hdlr || !mdhd || !minf) continue
    const handler = fourcc(b, hdlr.start + hdlr.head + 8), kind = handler === 'vide' ? 'video' : handler === 'soun' ? 'audio' : null
    if (!kind || out.some((t) => t.kind === kind)) continue
    const stblBox = find(b, kids(b, minf), 'stbl'), stbl = stblBox ? kids(b, stblBox) : []
    const stsd = find(b, stbl, 'stsd')
    if (!stsd) continue
    const entry = boxes(b, stsd.start + stsd.head + 8, stsd.start + stsd.size)[0]
    if (!entry) continue
    let codec: string | null = null, stsdOut: Uint8Array
    if (kind === 'video') {
      codec = codecOf(b, entry)
      stsdOut = full('stsd', 0, 0, bytes([1, 4]), raw(b, entry))
    } else {
      if (entry.type !== 'mp4a') continue
      const ver = u16(b, entry.start + 16), skip = 28 + (ver === 1 ? 16 : ver === 2 ? 36 : 0)
      const aac = aacOf(b, entry, skip)
      if (!aac) continue
      codec = aac.codec
      stsdOut = full('stsd', 0, 0, bytes([1, 4]), audioEntry(b, entry, aac.esds))
    }
    if (!codec) { if (kind === 'video') return null; continue }
    const s = samples(b, stbl)
    if (!s) { if (kind === 'video') return null; continue }
    const v1 = b[mdhd.start + mdhd.head] === 1, scale = u32(b, mdhd.start + mdhd.head + (v1 ? 20 : 12)) || 1
    const id = u32(b, tkhd.start + tkhd.head + (b[tkhd.start + tkhd.head] === 1 ? 20 : 12))
    out.push({ kind, codec, init: initOf(b, mvhd, trak, id, stsdOut), seg: segOf(b, id, s, kind === 'video'), duration: s.dur.reduce((a, x) => a + x, 0) / scale })
  }
  return out.some((t) => t.kind === 'video') ? out.sort((a) => (a.kind === 'video' ? -1 : 1)) : null
}
