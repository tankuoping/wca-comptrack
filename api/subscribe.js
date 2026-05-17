// Vercel serverless function: POST /api/subscribe
// Saves subscriber to Google Sheets + sends confirmation via Gmail SMTP

const { GoogleSpreadsheet } = require('google-spreadsheet')
const { JWT } = require('google-auth-library')
const nodemailer = require('nodemailer')
const { v4: uuidv4 } = require('uuid')

const SHEET_ID = process.env.GOOGLE_SHEET_ID
const CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL
const PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n')
const GMAIL_USER = process.env.GMAIL_USER           // e.g. tankuoping@gmail.com
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD  // 16-char app password

function createTransport() {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
  })
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { email, countries, events, alerts } = req.body
  if (!email || !email.includes('@')) return res.status(400).json({ error: 'Invalid email' })
  if (!countries || countries.length === 0) return res.status(400).json({ error: 'No countries selected' })

  try {
    const jwt = new JWT({
      email: CLIENT_EMAIL,
      key: PRIVATE_KEY,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    })
    const doc = new GoogleSpreadsheet(SHEET_ID, jwt)
    await doc.loadInfo()

    let sheet = doc.sheetsByTitle['Subscribers']
    if (!sheet) {
      sheet = await doc.addSheet({
        title: 'Subscribers',
        headerValues: ['token','email','countries','events','alert_announced','alert_reg_open','alert_reg_closing','subscribed_at','active'],
      })
    }

    const rows = await sheet.getRows()
    const existing = rows.find(r => r.get('email') === email)
    const token = existing?.get('token') || uuidv4()
    const now = new Date().toISOString()

    if (existing) {
      existing.set('countries', countries.join(','))
      existing.set('events', events.join(','))
      existing.set('alert_announced', alerts.announced ? 'TRUE' : 'FALSE')
      existing.set('alert_reg_open', alerts.regOpen ? 'TRUE' : 'FALSE')
      existing.set('alert_reg_closing', alerts.regClosing ? 'TRUE' : 'FALSE')
      existing.set('active', 'TRUE')
      await existing.save()
    } else {
      await sheet.addRow({
        token, email,
        countries: countries.join(','),
        events: events.join(','),
        alert_announced: alerts.announced ? 'TRUE' : 'FALSE',
        alert_reg_open: alerts.regOpen ? 'TRUE' : 'FALSE',
        alert_reg_closing: alerts.regClosing ? 'TRUE' : 'FALSE',
        subscribed_at: now,
        active: 'TRUE',
      })
    }

    await sendConfirmationEmail(email, countries, events)
    return res.status(200).json({ ok: true })
  } catch (e) {
    console.error('Subscribe error:', e)
    return res.status(500).json({ error: 'Failed to subscribe. Please try again.' })
  }
}

async function sendConfirmationEmail(email, countries, events) {
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD) return
  const eventsText = events.length > 0 ? events.join(', ') : 'Any event'
  const html = `
<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;margin:0;padding:0;background:#f4f4f4;">
<div style="max-width:520px;margin:24px auto;background:#fff;border-radius:8px;overflow:hidden;">
  <div style="background:#003f88;padding:20px 24px;color:#fff;">
    <h1 style="margin:0;font-size:18px;">You're subscribed to WCA CompAlert</h1>
    <p style="margin:4px 0 0;font-size:12px;opacity:0.7;">Competition alerts · WCA-CompTrack</p>
  </div>
  <div style="padding:20px 24px;">
    <p style="font-size:13px;color:#333;">You'll receive email alerts for upcoming WCA competitions matching:</p>
    <table style="width:100%;font-size:13px;margin:12px 0;">
      <tr><td style="color:#888;padding:4px 0;width:80px;">Countries</td><td style="font-weight:700;">${countries.join(', ')}</td></tr>
      <tr><td style="color:#888;padding:4px 0;">Events</td><td style="font-weight:700;">${eventsText}</td></tr>
    </table>
    <p style="font-size:12px;color:#888;margin-top:16px;">To update preferences or unsubscribe, click the link in any future alert email.</p>
  </div>
  <div style="padding:14px 24px 20px;border-top:1px solid #eee;text-align:center;font-size:11px;color:#aaa;">
    WCA-CompTrack · <a href="https://wca-comptrack.vercel.app" style="color:#003f88;">wca-comptrack.vercel.app</a>
  </div>
</div></body></html>`

  const transporter = createTransport()
  await transporter.sendMail({
    from: `WCA CompAlert <${GMAIL_USER}>`,
    to: email,
    subject: '✓ Subscribed to WCA competition alerts',
    html,
  })
}
