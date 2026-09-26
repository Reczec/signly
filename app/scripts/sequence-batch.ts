import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { encodeSequence } from '../src/recognition/sequence'
const manifestPath=resolve(process.argv[2] ?? '../research/word-signs/manifests/poc-v1.json')
const root=resolve(dirname(manifestPath),'..')
const manifest=JSON.parse(await readFile(manifestPath,'utf8'))
await mkdir(resolve(root,'cache/features'),{recursive:true})
let done=0
for(const clip of manifest.clips) {
  const raw=JSON.parse(await readFile(resolve(root,`cache/landmarks/${clip.id}.json`),'utf8'))
  if(raw.videoSha256!==clip.sha256) throw new Error(`Video checksum mismatch for ${clip.id}`)
  const sequence=encodeSequence(raw.frames)
  await writeFile(resolve(root,`cache/features/${clip.id}.json`),JSON.stringify({...sequence,id:clip.id,videoSha256:clip.sha256}))
  done++
}
console.log(`Encoded ${done} real clips with the shared browser/Node preprocessing implementation.`)
