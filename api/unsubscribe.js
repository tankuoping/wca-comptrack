// Vercel serverless function: GET /api/unsubscribe?token=xxx
// One-click unsubscribe — marks subscriber inactive in Google Sheets

const { GoogleSpreadsheet } = require('google-spreadsheet')
const { JWT } = require('google-auth-library')

const SHEET_ID = process.env.GOOGLE_SHEET_ID
const CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL
const PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n')

module.exports = async function handler(req, res) {
  const { token } = req.query
  if (!token) return res.status(400).send(page('Error', 'Invalid unsubscribe link.'))

  try {
    const jwt = new JWT({
      email: CLIENT_EMAIL,
      key: PRIVATE_KEY,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    })
    const doc = new GoogleSpreadsheet(SHEET_ID, jwt)
    await doc.loadInfo()
    const sheet = doc.sheetsByTitle['Subscribers']
    if (!sheet) return res.status(404).send(page('Not found', 'No subscribers found.'))

    const rows = await sheet.getRows()
    const row = rows.find(r => r.get('token') === token)
    if (!row) return res.status(404).send(page('Already unsubscribed', "You're not on our list — maybe already unsubscribed?"))

    row.set('active', 'FALSE')
    await row.save()

    return res.status(200).send(page('Unsubscribed', "You've been removed from WCA CompAlert. No more emails will be sent."))
  } catch (e) {
    console.error('Unsubscribe error:', e)
    return res.status(500).send(page('Error', 'Something went wrong. Please try again.'))
  }
}

function page(title, message) {
  return `<!DOCTYPE html><html><head><title>${title} · WCA CompAlert</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font-family:Arial,sans-serif;background:#f4f4f4;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
.card{background:#fff;border-radius:10px;padding:32px 28px;max-width:380px;text-align:center}
h1{color:#003f88;font-size:20px;margin:0 0 10px}p{color:#555;font-size:14px}
a{color:#003f88;font-size:13px}</style></head>
<body><div class="card">
<div style="font-size:36px;margin-bottom:12px">${title === 'Unsubscribed' ? '✓' : '⚠'}</div>
<h1>${title}</h1><p>${message}</p>
<a href="https://wca-comptrack.vercel.app">← Back to WCA-CompTrack</a>
</div></body></html>`
}
