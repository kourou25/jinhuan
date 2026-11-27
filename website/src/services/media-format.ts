import { fail } from '../lib/http'
import { scrubMedia, MediaMetaError } from './media-meta'

const ascii = (bytes: Uint8Array, start: number, length: number) => String.fromCharCode(...bytes.slice(start, start + length))

export function sniffImage(bytes: Uint8Array): [string, string] | null {
  if (bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71) return ['image/png', 'png']
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return ['image/jpeg', 'jpg']
  if (bytes[0] === 71 && bytes[1] === 73 && bytes[2] === 70) return ['image/gif', 'gif']
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return ['image/webp', 'webp']
  return null
}

export function sniffVideo(bytes: Uint8Array): [string, string] | 'heic' | null {
  if (ascii(bytes, 4, 4) === 'ftyp') {
    const brand = ascii(bytes, 8, 4)
    if (/^(heic|heix|hevc|mif1|msf1|avif)$/.test(brand)) return 'heic'
    return brand === 'qt  ' ? ['video/quicktime', 'mov'] : ['video/mp4', 'mp4']
  }
  if (bytes[0] === 26 && bytes[1] === 69 && bytes[2] === 223 && bytes[3] === 163) return ['video/webm', 'webm']
  return null
}

// 上传的图片 / 视频去元信息；结构坏掉的图片拒收，不带着定位存下来
export function cleanMedia(bytes: Uint8Array, mime: string, lenient = false) {
	try {
		return scrubMedia(bytes, mime);
	} catch (error) {
		if (error instanceof MediaMetaError && lenient) return bytes; // 转发站内已有的旧文件：解析不了就保留原样，不让转发失败
		if (error instanceof MediaMetaError) fail(415, mime.startsWith("video/") ? "视频文件已损坏，请换一个" : "图片文件已损坏，请换一张");
		throw error;
	}
}
