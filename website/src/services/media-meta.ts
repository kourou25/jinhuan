// 上传文件去掉元信息（2026-11-26）：拍摄地点（GPS）、设备型号、序列号、拍摄时间、作者、软件、缩略图等。
// 所有图片 / 视频上传都走这里（网站上传、发帖、群聊、私信、头像、漂流瓶、死如秋叶、小程序）；「作为文件发送」的附件保持原样。
// 原则：
// - 只删数据，不重新编码，画质不变；文件结构解析失败的图片直接拒收，不能带着定位悄悄存下来。
// - JPEG 保留方向：原图带「方向」标记时补一个只含方向的最小 EXIF，否则手机竖拍的照片会横着显示。
// - JPEG 结束标记后附带的内容（多图 MPF 的副图、厂商尾巴）整段去掉：副图里常有自己的一份 EXIF 和定位。
// - MP4 / MOV 不改文件长度：元信息盒子原地改成 free 并清零，索引里的偏移量不会失效；再清掉各轨道的创建 / 修改时间。
export class MediaMetaError extends Error {}

const ascii = (b: Uint8Array, i: number, n: number) => String.fromCharCode(...b.subarray(i, i + n))
const join = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) { out.set(p, at); at += p.length }
  return out
}
const bad = (): never => { throw new MediaMetaError('bad_media') }

export function scrubMedia(bytes: Uint8Array, mime: string): Uint8Array {
  if (mime === 'image/jpeg') return scrubJpeg(bytes)
  if (mime === 'image/png') return scrubPng(bytes)
  if (mime === 'image/webp') return scrubWebp(bytes)
  if (mime === 'image/gif') return scrubGif(bytes)
  if (mime === 'video/mp4' || mime === 'video/quicktime') return scrubIsoVideo(bytes)
  return bytes // WebM 等：没有常见的定位字段，原样保存
}

// ---------- JPEG ----------
// 读 EXIF 里的方向（0x0112），没有或读不出返回 1。JPEG 的 APP1 以 Exif\0\0 开头；PNG eXIf、WebP EXIF 一般直接是 TIFF
function exifOrientation(seg: Uint8Array): number {
  const t = ascii(seg, 0, 6) === 'Exif\0\0' ? seg.subarray(6) : seg, le = ascii(t, 0, 2) === 'II'
  if (!le && ascii(t, 0, 2) !== 'MM') return 1
  const dv = new DataView(t.buffer, t.byteOffset, t.byteLength)
  const u16 = (o: number) => dv.getUint16(o, le), u32 = (o: number) => dv.getUint32(o, le)
  try {
    const ifd = u32(4), n = u16(ifd)
    for (let i = 0; i < n; i++) {
      const e = ifd + 2 + i * 12
      if (u16(e) === 0x0112) { const v = u16(e + 8); return v >= 1 && v <= 8 ? v : 1 }
    }
  } catch { /* 坏的 EXIF 当没有方向 */ }
  return 1
}
// 只含方向的最小 TIFF（大端，1 个条目的 IFD0）；JPEG 再加 Exif\0\0 前缀
const orientationTiff = (v: number) => [0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, v, 0, 0, 0, 0, 0, 0]
function orientationApp1(v: number) {
  const body = [0x45, 0x78, 0x69, 0x66, 0, 0, ...orientationTiff(v)], len = body.length + 2
  return Uint8Array.from([0xff, 0xe1, len >> 8, len & 255, ...body])
}
function scrubJpeg(b: Uint8Array) {
  if (b[0] !== 0xff || b[1] !== 0xd8) bad()
  const out: Uint8Array[] = [b.subarray(0, 2)]
  let i = 2, orientation = 1, insertAt = 1
  while (true) {
    if (i + 2 > b.length || b[i] !== 0xff) bad()
    const m = b[i + 1]
    if (m === 0xff) { i++; continue } // 填充
    if (m === 0xd9) { out.push(b.subarray(i, i + 2)); break } // 结束：后面附带的内容全部丢掉
    if (m >= 0xd0 && m <= 0xd7) { out.push(b.subarray(i, i + 2)); i += 2; continue }
    if (i + 4 > b.length) bad()
    const len = (b[i + 2] << 8) | b[i + 3]
    if (len < 2 || i + 2 + len > b.length) bad()
    const seg = b.subarray(i, i + 2 + len), data = seg.subarray(4)
    if (m === 0xda) {
      // 扫描数据：跳到下一个真正的标记（FF 后面不是 00、也不是重置标记 D0–D7）
      out.push(seg)
      let j = i + 2 + len
      while (j + 1 < b.length && !(b[j] === 0xff && b[j + 1] !== 0 && !(b[j + 1] >= 0xd0 && b[j + 1] <= 0xd7))) j++
      if (j + 1 >= b.length) bad()
      out.push(b.subarray(i + 2 + len, j))
      i = j
      continue
    }
    const app2Icc = m === 0xe2 && ascii(data, 0, 12) === 'ICC_PROFILE\0'
    if (m === 0xe1 && orientation === 1) orientation = exifOrientation(data)
    // 保留：JFIF（APP0）、色彩配置（APP2 ICC）、Adobe（APP14）和所有图像结构段；
    // 去掉：EXIF / XMP（APP1）、多图 MPF 等其他 APP2、APP3–APP13（含 IPTC）、APP15、注释
    const meta = (m >= 0xe1 && m <= 0xef && m !== 0xee && !app2Icc) || m === 0xfe
    if (!meta) { out.push(seg); if (m === 0xe0) insertAt = out.length }
    i += 2 + len
  }
  if (orientation !== 1) out.splice(insertAt, 0, orientationApp1(orientation))
  return join(out)
}

// ---------- PNG ----------
const PNG_DROP = new Set(['eXIf', 'tEXt', 'iTXt', 'zTXt', 'tIME'])
const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
const crc32 = (d: Uint8Array) => { let c = 0xffffffff; for (const x of d) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
function pngChunk(type: string, data: number[]) {
  const td = Uint8Array.from([...type].map((ch) => ch.charCodeAt(0)).concat(data)), n = data.length, c = crc32(td)
  return join([Uint8Array.from([n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255]), td, Uint8Array.from([c >>> 24, (c >> 16) & 255, (c >> 8) & 255, c & 255])])
}
function scrubPng(b: Uint8Array) {
  if (ascii(b, 1, 3) !== 'PNG') bad()
  const out: Uint8Array[] = [b.subarray(0, 8)]
  let i = 8, orientation = 1
  while (true) {
    if (i + 12 > b.length) bad()
    const len = ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0, type = ascii(b, i + 4, 4), end = i + 12 + len
    if (end > b.length) bad()
    if (type === 'eXIf') orientation = exifOrientation(b.subarray(i + 8, i + 8 + len))
    // 方向标记放回原来 eXIf 的位置（必须在图像数据之前）
    if (type === 'IDAT' && orientation !== 1) { out.push(pngChunk('eXIf', orientationTiff(orientation))); orientation = 1 }
    if (!PNG_DROP.has(type)) out.push(b.subarray(i, end))
    i = end
    if (type === 'IEND') return join(out)
  }
}

// ---------- WebP ----------
function scrubWebp(b: Uint8Array) {
  if (ascii(b, 0, 4) !== 'RIFF' || ascii(b, 8, 4) !== 'WEBP') bad()
  const out: Uint8Array[] = []
  let i = 12, flagsAt = -1, size = 0, orientation = 1
  while (i + 8 <= b.length) {
    const type = ascii(b, i, 4), len = (b[i + 4] | (b[i + 5] << 8) | (b[i + 6] << 16) | (b[i + 7] << 24)) >>> 0
    const end = i + 8 + len + (len & 1)
    if (i + 8 + len > b.length) bad()
    if (type === 'EXIF') orientation = exifOrientation(b.subarray(i + 8, i + 8 + len))
    if (type !== 'EXIF' && type !== 'XMP ') {
      if (type === 'VP8X') flagsAt = size + 8
      const chunk = b.subarray(i, Math.min(end, b.length))
      out.push(chunk); size += chunk.length
    }
    i = end
  }
  if (!out.length) bad()
  // 方向不是默认值且有扩展头（只有 VP8X 文件才能带 EXIF）时，放回只含方向的 EXIF（规范要求在图像数据之后）
  const keepOrientation = orientation !== 1 && flagsAt >= 0
  if (keepOrientation) { const t = orientationTiff(orientation); out.push(Uint8Array.from([0x45, 0x58, 0x49, 0x46, t.length, 0, 0, 0, ...t])) }
  const body = join(out)
  if (flagsAt >= 0) body[flagsAt] = (body[flagsAt] & ~(0x08 | 0x04)) | (keepOrientation ? 0x08 : 0) // EXIF / XMP 标记按实际情况改
  const head = b.slice(0, 12), total = body.length + 4
  head[4] = total & 255; head[5] = (total >> 8) & 255; head[6] = (total >> 16) & 255; head[7] = (total >>> 24) & 255
  return join([head, body])
}

// ---------- GIF ----------
// 去掉注释扩展和除循环播放（NETSCAPE2.0 / ANIMEXTS1.0）以外的应用扩展（XMP 等）
function scrubGif(b: Uint8Array) {
  if (ascii(b, 0, 3) !== 'GIF') bad()
  const skipBlocks = (j: number) => { while (true) { if (j >= b.length) bad(); const n = b[j]; j += 1 + n; if (n === 0) return j } }
  let i = 13
  if (b[10] & 0x80) i += 3 * (1 << ((b[10] & 7) + 1))
  const out: Uint8Array[] = [b.subarray(0, i)]
  while (true) {
    if (i >= b.length) bad()
    const t = b[i]
    if (t === 0x3b) { out.push(b.subarray(i, i + 1)); return join(out) }
    if (t === 0x2c) {
      let j = i + 10
      if (b[i + 9] & 0x80) j += 3 * (1 << ((b[i + 9] & 7) + 1))
      j = skipBlocks(j + 1)
      out.push(b.subarray(i, j)); i = j
      continue
    }
    if (t !== 0x21) bad()
    const label = b[i + 1], end = skipBlocks(i + 2)
    const app = label === 0xff ? ascii(b, i + 3, Math.min(11, b[i + 2])) : ''
    const drop = label === 0xfe || (label === 0xff && app !== 'NETSCAPE2.0' && app !== 'ANIMEXTS1.0')
    if (!drop) out.push(b.subarray(i, end))
    i = end
  }
}

// ---------- MP4 / MOV ----------
// 原地处理，长度不变。udta（©xyz 定位、©mak 品牌、©mod 型号、©swr 软件、©day 日期……）、meta（苹果 keys：
// location.ISO6709、make、model、software、creationdate）和 XMP 的 uuid 盒子改成 free 并清零；
// mvhd / tkhd / mdhd 的创建、修改时间清零。
const XMP_UUID = 'be7acfcb97a942e89c71999491e3afac'
const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'edts', 'minf', 'stbl', 'mvex', 'moof', 'traf'])
function scrubIsoVideo(src: Uint8Array) {
  if (ascii(src, 4, 4) !== 'ftyp') bad()
  const b = new Uint8Array(src), dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
  const blank = (at: number, size: number) => { b.set([0x66, 0x72, 0x65, 0x65], at + 4); b.fill(0, at + 8, at + size) } // 'free'
  const moov: [number, number][] = []
  const walk = (start: number, end: number, depth: number) => {
    let i = start
    while (i + 8 <= end) {
      let size = dv.getUint32(i), head = 8
      const type = ascii(b, i + 4, 4)
      if (size === 1) { if (i + 16 > end) bad(); size = Number(dv.getBigUint64(i + 8)); head = 16 }
      else if (size === 0) size = end - i
      if (size < head || i + size > end) { if (depth === 0) return; bad() }
      if (type === 'udta' || type === 'meta' || (type === 'uuid' && [...b.subarray(i + 8, i + 24)].map((x) => x.toString(16).padStart(2, '0')).join('') === XMP_UUID)) blank(i, size)
      else if (type === 'mvhd' || type === 'tkhd' || type === 'mdhd') {
        const v = b[i + head], at = i + head + 4
        if (v === 1 && at + 16 <= i + size) b.fill(0, at, at + 16)
        else if (v === 0 && at + 8 <= i + size) b.fill(0, at, at + 8)
      } else if (CONTAINERS.has(type) && depth < 8) {
        if (depth === 0 && type === 'moov') moov.push([i, i + size])
        walk(i + head, i + size, depth + 1)
      }
      i += size
    }
  }
  // 结构解析不了的视频不拒收（不少剪辑软件写出的文件不规范）：至少做下面的兜底
  try { walk(0, b.length, 0) } catch { moov.length = 0 }
  // 兜底：个别机型把 ISO 6709 坐标串写在别处，数字统一改成 0（长度不变）。
  // 只扫元信息区域（moov）；解析失败时扫除去前 64KB 之外的末尾 1MB 以内——绝不碰 mdat 里的画面数据所在的整段文件
  const ranges = moov.length ? moov : [[0, Math.min(b.length, 65536)], [Math.max(65536, b.length - 1048576), b.length]] as [number, number][]
  for (const [s, e] of ranges) {
    const text = new TextDecoder('latin1').decode(b.subarray(s, e))
    for (const m of text.matchAll(/[+-]\d{2}\.\d{3,}[+-]\d{3}\.\d{3,}(?:[+-]\d+(?:\.\d+)?)?(?:CRS[A-Za-z0-9_:]*)?\//g)) {
      for (let j = 0; j < m[0].length; j++) if (m[0][j] >= '0' && m[0][j] <= '9') b[s + m.index! + j] = 0x30
    }
    // ©xyz（定位）在解析失败时也按原样清零
    if (!moov.length) for (let k = s + 4; k + 4 < e; k++) if (b[k] === 0xa9 && b[k + 1] === 0x78 && b[k + 2] === 0x79 && b[k + 3] === 0x7a) {
      const len = ((b[k - 4] << 24) | (b[k - 3] << 16) | (b[k - 2] << 8) | b[k - 1]) >>> 0
      if (len >= 8 && len < 1024 && k - 4 + len <= e) b.fill(0, k + 4, k - 4 + len)
    }
  }
  return b
}
