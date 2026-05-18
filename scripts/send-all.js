// One-time script: sends ALL current upcoming comps to every active subscriber
// Run manually via GitHub Actions → "Send Alerts to All Subscribers"
// Does NOT compare with previous cache — treats everything as new

const fs = require('fs')
const path = require('path')
const nodemailer = require('nodemailer')

const CACHE_FILE = path.join(__dirname, '../public/wcif-cache.json')
const GMAIL_USER = process.env.GMAIL_USER
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD
const SHEET_ID = process.env.GOOGLE_SHEET_ID
const CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL
const PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n')
const APP_URL = 'https://wca-comptrack.vercel.app'

const EVENT_SHORT = {
  '333':'3x3','222':'2x2','444':'4x4','555':'5x5','666':'6x6','777':'7x7',
  '333bf':'3BLD','333fm':'FMC','333oh':'OH','444bf':'4BLD','555bf':'5BLD',
  '333mbf':'MBLD','clock':'Clock','minx':'Mega','pyram':'Pyra','skewb':'Skewb','sq1':'Sq-1',
}

function createTransport() {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
  })
}

async function getSubscribers() {
  const { GoogleSpreadsheet } = require('google-spreadsheet')
  const { JWT } = require('google-auth-library')
  const jwt = new JWT({ email: CLIENT_EMAIL, key: PRIVATE_KEY, scopes: ['https://www.googleapis.com/auth/spreadsheets'] })
  const doc = new GoogleSpreadsheet(SHEET_ID, jwt)
  await doc.loadInfo()
  const sheet = doc.sheetsByTitle['Subscribers']
  if (!sheet) { console.log('No Subscribers sheet found.'); return [] }
  const rows = await sheet.getRows()
  return rows
    .filter(r => r.get('active') === 'TRUE')
    .map(r => ({
      email: r.get('email'),
      token: r.get('token'),
      countries: r.get('countries')?.split(',').filter(Boolean) || [],
      events: r.get('events')?.split(',').filter(Boolean) || [],
    }))
}

function compMatchesSubscriber(comp, sub) {
  if (!sub.countries.includes(comp.country_iso2)) return false
  if (sub.events.length > 0) {
    const compEvents = comp.event_ids || []
    if (!sub.events.some(e => compEvents.includes(e))) return false
  }
  return true
}

function compCard(comp) {
  const d = new Date(comp.start_date + 'T12:00:00')
  const day = d.getDate()
  const mon = d.toLocaleString('en-US', { month: 'short' })
  const events = (comp.event_ids || []).map(e => EVENT_SHORT[e] || e)
  const regOpen = comp.registration_open
    ? new Date(comp.registration_open).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })
    : null
  const regClose = comp.registration_close
    ? new Date(comp.registration_close).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })
    : null
  const wcaUrl = comp.url || `https://www.worldcubeassociation.org/competitions/${comp.id}`
  return `
<div style="border:1px solid #e0e0e0;border-radius:6px;margin-bottom:10px;overflow:hidden;">
  <div style="display:flex;align-items:center;gap:12px;padding:10px 14px;">
    <div style="background:#004d40;color:#fff;border-radius:5px;padding:6px 10px;text-align:center;min-width:44px;flex-shrink:0;">
      <div style="font-size:18px;font-weight:700;line-height:1;">${day}</div>
      <div style="font-size:10px;opacity:0.8;">${mon}</div>
    </div>
    <div style="flex:1;">
      <div style="font-size:13px;font-weight:700;color:#003f88;">${comp.name}</div>
      <div style="font-size:11px;color:#555;margin-top:2px;">${comp.country_iso2} · ${comp.city || ''}</div>
    </div>
  </div>
  <div style="background:#f9f9f9;border-top:1px solid #e0e0e0;padding:7px 14px;display:flex;align-items:center;flex-wrap:wrap;gap:6px;">
    ${events.slice(0, 8).map(e => `<span style="background:#e0f2f1;color:#004d40;font-size:10px;font-weight:700;padding:2px 7px;border-radius:4px;">${e}</span>`).join('')}
    <span style="margin-left:auto;font-size:11px;color:#555;">
      ${regOpen ? `Reg opens: ${regOpen}` : ''}
      ${regClose ? ` · closes: ${regClose}` : ''}
    </span>
    <a href="${wcaUrl}" style="font-size:11px;color:#003f88;text-decoration:none;">View on WCA ↗</a>
  </div>
</div>`
}

function buildEmail(subscriber, matchingComps) {
  if (matchingComps.length === 0) return null

  const unsubUrl = `${APP_URL}/api/unsubscribe?token=${subscriber.token}`
  const subject = `🏆 ${matchingComps.length} upcoming WCA competition${matchingComps.length > 1 ? 's' : ''} · ${subscriber.countries.join(', ')}`

  const html = `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;margin:0;padding:0;background:#f4f4f4;">
<div style="max-width:520px;margin:24px auto;background:#fff;border-radius:8px;overflow:hidden;">
  <div style="background:#003f88;padding:20px 24px;color:#fff;">
    <h1 style="margin:0;font-size:18px;">${matchingComps.length} upcoming competition${matchingComps.length > 1 ? 's' : ''}</h1>
    <p style="margin:4px 0 0;font-size:12px;opacity:0.7;">Matching: ${subscriber.countries.join(', ')}${subscriber.events.length > 0 ? ' · ' + subscriber.events.map(e => EVENT_SHORT[e] || e).join(', ') : ''}</p>
  </div>
  <div style="padding:16px 24px;">
    <p style="font-size:12px;color:#888;margin:0 0 14px;">Here are all upcoming WCA competitions matching your alert preferences:</p>
    ${matchingComps.map(compCard).join('')}
    <div style="text-align:center;padding:16px 0 8px;">
      <a href="${APP_URL}" style="display:inline-block;background:#00695c;color:#fff;font-size:13px;font-weight:700;padding:10px 24px;border-radius:6px;text-decoration:none;">View on WCA-CompTrack ↗</a>
    </div>
  </div>
  <div style="padding:14px 24px 20px;border-top:1px solid #eee;text-align:center;font-size:11px;color:#aaa;">
    You're receiving this because you subscribed to WCA CompAlert.<br>
    <a href="${APP_URL}/subscribe" style="color:#003f88;">Manage preferences</a> &nbsp;·&nbsp;
    <a href="${unsubUrl}" style="color:#003f88;">Unsubscribe</a>
  </div>
</div></body></html>`

  return { subject, html }
}

async function main() {
  if (!fs.existsSync(CACHE_FILE)) {
    console.error('Cache file not found. Run build-cache.js first.')
    process.exit(1)
  }

  const cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'))
  const allComps = Object.values(cache.wcifMap).map(d => d.comp)

  // Only include comps that haven't started yet
  const today = new Date().toISOString().split('T')[0]
  const upcomingComps = allComps.filter(c => c.end_date >= today)

  console.log(`Cache has ${allComps.length} comps, ${upcomingComps.length} still upcoming`)

  console.log('Loading subscribers...')
  const subscribers = await getSubscribers()
  console.log(`${subscribers.length} active subscribers`)

  if (subscribers.length === 0) {
    console.log('No subscribers. Done.')
    return
  }

  const transporter = createTransport()
  let sent = 0

  for (const sub of subscribers) {
    const matching = upcomingComps.filter(c => compMatchesSubscriber(c, sub))
    console.log(`  ${sub.email}: ${matching.length} matching comps`)

    const email = buildEmail(sub, matching)
    if (!email) {
      console.log(`    → No matching comps, skipping`)
      continue
    }

    try {
      await transporter.sendMail({
        from: `WCA CompAlert <${GMAIL_USER}>`,
        to: sub.email,
        subject: email.subject,
        html: email.html,
      })
      console.log(`    → Sent!`)
      sent++
    } catch (e) {
      console.error(`    → Failed: ${e.message}`)
    }
    await new Promise(r => setTimeout(r, 300))
  }

  console.log(`\nDone. Sent to ${sent}/${subscribers.length} subscribers.`)
}

main().catch(e => { console.error(e); process.exit(1) })
