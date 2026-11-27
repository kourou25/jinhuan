import { lookup } from 'node:dns/promises'
import http from 'node:http'
import https from 'node:https'
import { BlockList, isIP } from 'node:net'
import { Readable } from 'node:stream'

const v4Denied = new BlockList()
for (const [network, bits] of [
  ['0.0.0.0',8], ['10.0.0.0',8], ['100.64.0.0',10], ['127.0.0.0',8], ['169.254.0.0',16],
  ['172.16.0.0',12], ['192.0.0.0',24], ['192.0.2.0',24], ['192.88.99.0',24], ['192.168.0.0',16],
  ['198.18.0.0',15], ['198.51.100.0',24], ['203.0.113.0',24], ['224.0.0.0',3],
]) v4Denied.addSubnet(network,bits,'ipv4')
const v6Global = new BlockList()
v6Global.addSubnet('2000::',3,'ipv6')
const v6Denied = new BlockList()
for (const [network,bits] of [['2001::',23],['2001:db8::',32],['2002::',16],['3fff::',20]]) {
  v6Denied.addSubnet(network,bits,'ipv6')
}

export const isPublicLinkAddress = ({ address, family }) => family === 4 ? !v4Denied.check(address,'ipv4')
  : family === 6 && v6Global.check(address,'ipv6') && !v6Denied.check(address,'ipv6')

export async function fetchPublicHttp(href, { signal, method = 'GET', headers = {}, body } = {}) {
  const url = new URL(href)
  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  const family = isIP(hostname)
  if (!['http:','https:'].includes(url.protocol) || url.port || url.username || url.password ||
      (!family && (!hostname.includes('.') || !/^[a-z0-9.-]+$/i.test(hostname)))) {
    throw new Error('Invalid public HTTP origin')
  }
  signal?.throwIfAborted()
  let addresses
  if (family) {
    addresses = [{address:hostname,family}]
  } else if (signal) {
    let abortLookup
    try {
      addresses = await Promise.race([lookup(hostname,{all:true}),new Promise((_,reject)=>{
        abortLookup=()=>reject(signal.reason)
        signal.addEventListener('abort',abortLookup,{once:true})
      })])
    } finally { signal.removeEventListener('abort',abortLookup) }
  } else {
    addresses = await lookup(hostname,{all:true})
  }
  if (!addresses.length || !addresses.every(isPublicLinkAddress)) throw new Error('Only public HTTP addresses are permitted')
  const target = addresses.find(address => address.family === 4) ?? addresses[0]

  const transport = url.protocol === 'https:' ? https : http
  return new Promise((resolve,reject)=>{
    const request = transport.request(url,{signal,method,agent:false,autoSelectFamily:false,
      // Keep TLS and Host tied to the URL, and connect only to the already vetted address.
      lookup(_name,_options,done){done(null,target.address,target.family)},
      headers,
    },response=>{
      const status = response.statusCode
      const headers = new Headers()
      for (const name of ['location','content-type','content-encoding']) {
        const value = response.headers[name]
        if (typeof value === 'string') headers.set(name,value)
      }
      const noBody = [204,205,304].includes(status)
      if (noBody) response.resume()
      try { resolve(new Response(noBody ? null : Readable.toWeb(response),{status,headers})) }
      catch (error) { response.destroy(); reject(error) }
    })
    request.on('error',reject)
    request.end(body)
  })
}
