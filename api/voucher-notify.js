// Vercel serverless function — sends email when a voucher code is clicked
// Setup: add RESEND_API_KEY to your Vercel environment variables
// Get a free API key at https://resend.com (100 emails/day free)

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { code, page, ts, ua } = req.body || {};

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    // No API key configured — silently succeed so the frontend doesn't error
    return res.status(200).json({ ok: true, note: 'RESEND_API_KEY not set' });
  }

  const html = `
    <div style="font-family:sans-serif;max-width:500px;margin:0 auto;">
      <h2 style="color:#D0021B;">🏷️ Voucher clicked: <strong>${code}</strong></h2>
      <table style="border-collapse:collapse;width:100%;font-size:14px;">
        <tr><td style="padding:6px 12px;background:#f5f5f5;font-weight:600;">Code</td><td style="padding:6px 12px;">${code}</td></tr>
        <tr><td style="padding:6px 12px;background:#f5f5f5;font-weight:600;">Page</td><td style="padding:6px 12px;">${page}</td></tr>
        <tr><td style="padding:6px 12px;background:#f5f5f5;font-weight:600;">Time</td><td style="padding:6px 12px;">${ts}</td></tr>
        <tr><td style="padding:6px 12px;background:#f5f5f5;font-weight:600;">Browser</td><td style="padding:6px 12px;font-size:11px;color:#666;">${ua}</td></tr>
      </table>
    </div>`;

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'SwissNewbie <onboarding@resend.dev>',
        to: ['j.m.feusi@gmail.com'],
        subject: `🏷️ ${code} clicked on SwissNewbie`,
        html
      })
    });
    const data = await r.json();
    return res.status(200).json({ ok: true, data });
  } catch (e) {
    return res.status(200).json({ ok: false, error: e.message });
  }
}
