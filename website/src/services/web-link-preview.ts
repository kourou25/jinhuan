import {webPreviewLink,type WebPreviewLink} from '../../public/social-links.js'
import type {Env} from '../env'
import type {Preview} from './social-preview'

const maxHeadBytes = 160 * 1024
const entity: Record<string,string> = {amp:'&',quot:'"',apos:"'",lt:'<',gt:'>',nbsp:' '}

export function previewText(raw: string, length: number) {
  const text = raw.replace(/&(#(?:x[0-9a-f]+|\d+)|[a-z]+);/gi,(whole,part) => {
    const name = part.toLowerCase()
    if (name[0] !== '#') return entity[name] ?? whole
    const code = name[1] === 'x' ? parseInt(name.slice(2),16) : Number(name.slice(1))
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ' '
  }).replace(/[\p{Cc}\p{Cf}]/gu,' ').replace(/\s+/g,' ').trim()
  const points = [...text]
  return points.length > length ? points.slice(0,length-1).join('')+'…' : text
}

async function readHead(response: Response) {
  const reader = response.body?.getReader()
  if (!reader) return ''
  const decoder = new TextDecoder()
  let total = 0, text = ''
  try {
    while (total < maxHeadBytes) {
      const result = await reader.read()
      if (result.done) return text + decoder.decode()
      const chunk = result.value.subarray(0,maxHeadBytes-total)
      total += chunk.length
      text += decoder.decode(chunk,{stream:true})
      const end = /<\/head\s*>/i.exec(text)
      if (end) return text.slice(0,end.index)
    }
    return text + decoder.decode()
  } finally { await reader.cancel().catch(()=>{}); reader.releaseLock() }
}

export const emptyLinkPreview = (link:WebPreviewLink):Preview => ({title:link.host,description:'',image:null,available:false})

export async function fetchWebLinkPreview(link:WebPreviewLink, request:Env['PUBLIC_LINK_FETCH'], siteHost:string):Promise<Preview> {
  const empty = emptyLinkPreview(link)
  if (!request) return empty
  const signal = AbortSignal.timeout(5000)
  let target = link
  try {
    for (let hop=0; hop<4; hop++) {
      if (target.host.replace(/\.$/,'') === siteHost) return empty
      const response = await request(target.url,signal)
      if ([301,302,303,307,308].includes(response.status)) {
        const location = response.headers.get('location')
        await response.body?.cancel()
        const next = location ? webPreviewLink(new URL(location,target.url).href) : null
        if (!next) return empty
        target = next
        continue
      }
      const type = response.headers.get('content-type') || ''
      if (!response.ok || !/^(?:text\/html|application\/xhtml\+xml)(?:;|$)/i.test(type) ||
          ![null,'identity'].includes(response.headers.get('content-encoding'))) {
        await response.body?.cancel()
        return empty
      }
      const html = await readHead(response)
      const meta = new Map<string,string>()
      const names = new Set(['og:title','og:description','twitter:title','twitter:description','description'])
      await new HTMLRewriter().on('meta',{element(el){
        const name = (el.getAttribute('property') || el.getAttribute('name') || '').toLowerCase()
        if (names.has(name) && !meta.has(name)) meta.set(name,el.getAttribute('content') || '')
      }}).transform(new Response(html)).text()
      const title = previewText(meta.get('og:title') || meta.get('twitter:title') || /<title\b[^>]*>([^<]*)<\/title>/i.exec(html)?.[1] || '',96)
      const description = previewText(meta.get('og:description') || meta.get('twitter:description') || meta.get('description') || '',144)
      return {title:title||link.host,description:description===title?'':description,image:null,available:!!(title||description)}
    }
  } catch { /* Keep the original link usable when metadata is unavailable. */ }
  return empty
}
