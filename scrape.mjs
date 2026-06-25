// Scrapes Pokémon Pokopia favorites data from Serebii into data.json.
// Zero deps (Node 18+ fetch). One-time / re-run when Serebii fills more data.
// ponytail: regex HTML parsing — fragile if Serebii changes table markup;
//           upgrade to a real parser (cheerio) only if it actually breaks.
import { writeFile, mkdir, access } from 'node:fs/promises'

const BASE = 'https://www.serebii.net/pokemonpokopia'
const UA = { 'User-Agent': 'Mozilla/5.0 (pokopia-favorites scraper)' }
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const exists = p => access(p).then(() => true, () => false)
async function download(url, dest) {
  if (await exists(dest)) return false                  // already mirrored
  const r = await fetch(url, { headers: UA })
  if (!r.ok) { console.error('img FAIL', r.status, url); return false }
  await writeFile(dest, Buffer.from(await r.arrayBuffer()))
  return true
}

async function get(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: UA })
      if (r.status === 404) return null
      if (!r.ok) throw new Error('HTTP ' + r.status)
      return await r.text()
    } catch (e) {
      if (i === tries - 1) { console.error('FAIL', url, e.message); return null }
      await sleep(500 * (i + 1))
    }
  }
}

const ent = (s) => s.replace(/&amp;/g, '&').replace(/&eacute;/g, 'é')
  .replace(/&#39;|&rsquo;/g, "'").replace(/&[a-z]+;/g, ' ').trim()

// run async fn over items with a small concurrency pool + politeness delay
async function pool(items, n, fn) {
  const out = []
  let i = 0
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) {
      const idx = i++
      out[idx] = await fn(items[idx], idx)
      await sleep(120)
    }
  }))
  return out
}

// 1. category index
const favIndex = await get(`${BASE}/favorites.shtml`)
const categories = [...favIndex.matchAll(/\/pokemonpokopia\/favorites\/(\w+)\.shtml"><u>([^<]+)<\/u>/g)]
  .map(m => ({ slug: m[1], name: ent(m[2]) }))
const seen = new Set(); const cats = categories.filter(c => !seen.has(c.slug) && seen.add(c.slug))
console.log(`categories: ${cats.length}`)

// 2. each category page -> items (with category) + pokemon slugs
const items = new Map()        // itemSlug -> {name, slug, icon, categories:Set}
const pokemon = new Map()      // pokeSlug -> {id, name, slug, icon}
for (const cat of cats) {
  const html = await get(`${BASE}/favorites/${cat.slug}.shtml`)
  if (!html) { console.log(`  (no page) ${cat.slug}`); continue }
  // items table rows: <a href="/pokemonpokopia/items/SLUG.shtml">...<img ... alt="NAME"
  for (const m of html.matchAll(/\/pokemonpokopia\/items\/([\w-]+)\.shtml"><img[^>]*alt="([^"]+)"/g)) {
    const slug = m[1]
    const it = items.get(slug) || { slug, name: ent(m[2]), icon: `${BASE}/items/${slug}.png`, categories: new Set() }
    it.categories.add(cat.name)
    items.set(slug, it)
  }
  // pokemon table rows: #001 ... <a href="/pokemonpokopia/pokedex/SLUG.shtml"><img src=".../small/001.png" alt="NAME Image"
  for (const m of html.matchAll(/#(\d+)<\/td>\s*<td[^>]*><a href="\/pokemonpokopia\/pokedex\/([\w-]+)\.shtml"><img src="([^"]+)"\s+alt="([^"]+?)(?: Image)?"/g)) {
    const slug = m[2]
    if (!pokemon.has(slug)) pokemon.set(slug, { id: +m[1], name: ent(m[4]), slug, icon: BASE.replace('/pokemonpokopia','') + m[3] })
  }
  await sleep(120)
}
console.log(`items: ${items.size}, pokemon discovered: ${pokemon.size}`)

// 3. each pokemon dex page -> authoritative habitat, 5 favorites, flavor
const list = [...pokemon.values()]
await pool(list, 6, async (p) => {
  const html = await get(`${BASE}/pokedex/${p.slug}.shtml`)
  if (!html) { p.skip = true; return }
  // Stats table has nested tables, so slice to the next section ("Habitats & Locations") not the first </table>
  const s0 = html.indexOf('>Stats<')
  const end = html.indexOf('Habitats', s0)
  const seg = html.slice(s0, end > s0 ? end : s0 + 2000)
  const hab = seg.match(/\/pokedex\/idealhabitat\/(\w+)\.shtml"><u>([^<]+)</)
  p.habitat = hab ? ent(hab[2]) : null
  p.favorites = [...seg.matchAll(/\/pokemonpokopia\/favorites\/\w+\.shtml"><u>([^<]+)<\/u>/g)].map(m => ent(m[1]))
  const fl = seg.match(/flavors\.shtml"><u>([^<]+)<\/u>/)
  p.flavor = fl ? ent(fl[1]).replace(/ flavors?$/i, '') : null
  // "Habitats & Locations" section = the in-game spots this Pokémon spawns at
  if (end > s0) {
    const hEnd = html.indexOf('<h2', end + 1)
    const hseg = html.slice(end, hEnd > end ? hEnd : end + 4000)
    const sp = new Map()
    for (const m of hseg.matchAll(/\/habitatdex\/([\w-]+)\.shtml">([^<]+)<\/a>/g)) if (!sp.has(m[1])) sp.set(m[1], ent(m[2]))
    p.spawns = [...sp.entries()].map(([slug, name]) => ({ slug, name }))
  } else p.spawns = []
})

const outPokemon = list.filter(p => !p.skip && p.habitat)
  .sort((a, b) => a.id - b.id)
  .map(({ id, name, slug, icon, habitat, favorites, flavor, spawns }) => ({ id, name, slug, icon, habitat, favorites, flavor, spawns: spawns || [] }))
const outItems = [...items.values()].sort((a, b) => a.name.localeCompare(b.name))
  .map(({ name, slug, icon, categories }) => ({ name, slug, icon, categories: [...categories].sort() }))

// "how to make" requirements for every habitat that appears as a spawn spot
const habNames = new Map()
for (const p of outPokemon) for (const s of p.spawns) if (!habNames.has(s.slug)) habNames.set(s.slug, s.name)
const habitats = {}
const find = {}   // pokemonSlug -> { locations, rarity, time, weather } from "Available Pokémon" cells
await pool([...habNames.keys()], 6, async (slug) => {
  const html = await get(`${BASE}/habitatdex/${slug}.shtml`)
  if (!html) return
  const reqs = []
  const ri = html.indexOf('>Requirements<')
  if (ri >= 0) {
    const rseg = html.slice(ri, html.indexOf('</table>', ri))
    for (const row of rseg.split('<tr>').slice(2)) {           // skip header + table open
      const alt = row.match(/alt="([^"]+)"/); if (!alt) continue
      const ic = row.match(/items\/([\w-]+)\.png/)
      const qty = row.match(/class="fooinfo">\s*(\d+)\s*</)
      reqs.push({ name: ent(alt[1]), icon: ic ? `${BASE}/items/${ic[1]}.png` : null, qty: qty ? +qty[1] : null })
    }
  }
  let flavor = ''
  const fi = html.indexOf('>Flavor Text<')
  if (fi >= 0) {
    const fm = html.slice(fi, html.indexOf('</table>', fi)).match(/class="fooinfo"[^>]*>([\s\S]*?)<\/td>/)
    if (fm) flavor = ent(fm[1].replace(/<[^>]+>/g, ' '))
  }
  habitats[slug] = { name: habNames.get(slug), flavor, reqs }
  // "Available Pokémon" section: column-aligned Location/Rarity/Time/Weather per Pokémon
  const ai = html.indexOf('Available Pok')
  if (ai >= 0) {
    const a = html.slice(ai)
    const names = [...a.matchAll(/fooevo"><a href="\/pokemonpokopia\/pokedex\/([\w-]+)\.shtml">[^<]+<\/a>/g)].map(m => m[1])
    const locs = [...a.matchAll(/<b>Location<\/b>:([\s\S]*?)<\/td>/g)].map(m => [...m[1].matchAll(/\/locations\/[\w-]+\.shtml"><u>([^<]+)<\/u>/g)].map(x => ent(x[1])))
    const rars = [...a.matchAll(/<b>Rarity<\/b>:<br \/>\s*([^<]*?)\s*<\/td>/g)].map(m => { const t = ent(m[1]); const r = t.match(/Very Rare|Rare|Common/); return r ? r[0] : t })
    const tws = [...a.matchAll(/<b>Time<\/b><\/td>[\s\S]*?<tr>([\s\S]*?)<\/table>/g)].map(m => {
      const tds = [...m[1].matchAll(/<td valign="top">([\s\S]*?)(?:<\/td>|<\/tr>)/g)].map(x => x[1])
      const words = s => [...(s || '').matchAll(/<br \/>\s*([A-Za-z]+)/g)].map(y => y[1])
      return { time: words(tds[0]), weather: words(tds[1]) }
    })
    for (let i = 0; i < names.length; i++) if (!find[names[i]]) find[names[i]] = {
      locations: locs[i] || [], rarity: rars[i] || '',
      time: tws[i] ? tws[i].time : [], weather: tws[i] ? tws[i].weather : []
    }
  }
})
for (const p of outPokemon) if (find[p.slug]) p.find = find[p.slug]

// mirror every referenced image into ./assets and rewrite icon paths to local
await mkdir(new URL('./assets/pokemon/', import.meta.url), { recursive: true })
await mkdir(new URL('./assets/items/', import.meta.url), { recursive: true })
const refs = []                                          // every icon field that needs rewriting
for (const p of outPokemon) refs.push({ obj: p, url: p.icon, sub: 'pokemon' })
for (const it of outItems) refs.push({ obj: it, url: it.icon, sub: 'items' })
for (const h of Object.values(habitats)) for (const r of h.reqs) if (r.icon) refs.push({ obj: r, url: r.icon, sub: 'items' })
const uniq = new Map()                                    // remoteUrl -> { lp, ok }
for (const r of refs) if (!uniq.has(r.url)) uniq.set(r.url, { lp: `assets/${r.sub}/${r.url.split('/').pop()}` })
console.log(`mirroring ${uniq.size} images...`)
await pool([...uniq.entries()], 8, async ([url, info]) => {
  const dest = new URL('./' + info.lp, import.meta.url)
  await download(url, dest)
  info.ok = await exists(dest)
})
const dl = [...uniq.values()].filter(i => i.ok).length
console.log(`mirrored ${dl}/${uniq.size} images (${uniq.size - dl} missing on Serebii, kept remote url)`)
for (const r of refs) { const info = uniq.get(r.url); r.obj.icon = info.ok ? info.lp : null }  // local if mirrored, else null (missing on Serebii)

await writeFile(new URL('./data.json', import.meta.url),
  JSON.stringify({ scrapedAt: new Date().toISOString(), source: 'serebii.net', pokemon: outPokemon, items: outItems, habitats }, null, 2))
console.log(`wrote data.json: ${outPokemon.length} pokemon, ${outItems.length} items, ${Object.keys(habitats).length} habitats, ${Object.keys(find).length} find-records`)
