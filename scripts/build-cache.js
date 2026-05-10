#!/usr/bin/env node
// Runs nightly via GitHub Actions to pre-build the WCIF cache
// Saves to public/wcif-cache.json

const fs = require('fs')
const path = require('path')

const WCA_BASE = 'https://www.worldcubeassociation.org/api/v0'
const OUT_FILE = path.join(__dirname, '../public/wcif-cache.json')
const DELAY_MS = 350        // ms between requests
const BATCH_SIZE = 3        // parallel fetches per batch
const BATCH_DELAY_MS = 600  // ms between batches

const sleep = ms => new Promise(r => setTimeout(r, ms))

async function fetchJSON(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return res.json()
}

async function fetchAllUpcomingComps() {
  const today = new Date()
  const allComps = []
  for (let m = 0; m < 6; m++) {
    const start = new Date(today)
    start.setMonth(start.getMonth() + m)
    if (m === 0) start.setDate(today.getDate())
    else start.setDate(1)
    const end = new Date(start)
    end.setMonth(end.getMonth() + 1)
    end.setDate(0)
    const startStr = start.toISOString().split('T')[0]
    const endStr = end.toISOString().split('T')[0]

    try {
      let page = 1
      while (true) {
        const data = await fetchJSON(`${WCA_BASE}/competitions?start=${startStr}&end=${endStr}&per_page=100&page=${page}`)
        const comps = Array.isArray(data) ? data : (data.competitions || [])
        if (!comps.length) break
        comps.forEach(c => { if (!allComps.find(x => x.id === c.id)) allComps.push(c) })
        if (comps.length < 100) break
        page++
        await sleep(DELAY_MS)
      }
    } catch (e) {
      console.error(`Month ${m} failed:`, e.message)
    }
    await sleep(DELAY_MS)
  }
  // Sort by date ascending — nearest first
  return allComps.sort((a, b) => new Date(a.start_date) - new Date(b.start_date))
}

async function fetchWcif(compId) {
  for (const wait of [0, 3000, 5000, 8000]) {
    if (wait) await sleep(wait)
    try {
      const res = await fetch(`${WCA_BASE}/competitions/${compId}/wcif/public`)
      if (res.status === 429) { console.log(`  429 on ${compId}, retrying...`); continue }
      if (!res.ok) return null
      return await res.json()
    } catch { continue }
  }
  return null
}

function extractWcifData(comp, wcif) {
  const timezone = wcif?.schedule?.venues?.[0]?.timezone || 'UTC'
  const registrants = (wcif?.persons || [])
    .filter(p => p.wcaId && p.registration?.status === 'accepted')
    .map(p => ({ wcaId: p.wcaId, eventIds: p.registration.eventIds || [] }))
  let firstStart = null
  for (const venue of (wcif?.schedule?.venues || [])) {
    for (const room of (venue.rooms || [])) {
      for (const activity of (room.activities || [])) {
        if ((activity.activityCode || '').startsWith('other-')) continue
        if (!firstStart || new Date(activity.startTime) < new Date(firstStart))
          firstStart = activity.startTime
      }
    }
  }
  return { comp, registrants, timezone, firstStart }
}

async function main() {
  console.log('Fetching upcoming comp list...')
  const comps = await fetchAllUpcomingComps()
  console.log(`Found ${comps.length} upcoming comps`)

  const wcifMap = {}
  let scanned = 0
  const failed = []

  // Process in small batches
  for (let i = 0; i < comps.length; i += BATCH_SIZE) {
    const batch = comps.slice(i, i + BATCH_SIZE)
    const results = await Promise.all(batch.map(c => fetchWcif(c.id)))
    for (let j = 0; j < batch.length; j++) {
      const comp = batch[j]
      const wcif = results[j]
      if (wcif) {
        wcifMap[comp.id] = extractWcifData(comp, wcif)
      } else {
        failed.push(comp.id)
      }
      scanned++
    }
    console.log(`  ${scanned}/${comps.length} scanned...`)
    if (i + BATCH_SIZE < comps.length) await sleep(BATCH_DELAY_MS)
  }

  // Retry failed ones sequentially
  if (failed.length > 0) {
    console.log(`Retrying ${failed.length} failed comps...`)
    for (const compId of failed) {
      await sleep(2000)
      const comp = comps.find(c => c.id === compId)
      const wcif = await fetchWcif(compId)
      if (wcif && comp) {
        wcifMap[compId] = extractWcifData(comp, wcif)
        console.log(`  Recovered: ${compId}`)
      } else {
        console.log(`  Still failed: ${compId}`)
      }
    }
  }

  const cache = {
    builtAt: new Date().toISOString(),
    totalComps: comps.length,
    scannedComps: Object.keys(wcifMap).length,
    wcifMap,
  }

  fs.writeFileSync(OUT_FILE, JSON.stringify(cache))
  console.log(`Cache written to ${OUT_FILE}`)
  console.log(`  Total comps: ${comps.length}`)
  console.log(`  Successfully scanned: ${Object.keys(wcifMap).length}`)
  console.log(`  Failed: ${comps.length - Object.keys(wcifMap).length}`)
}

main().catch(e => { console.error(e); process.exit(1) })
