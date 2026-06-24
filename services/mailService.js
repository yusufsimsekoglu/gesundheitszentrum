const axios = require("axios");

async function sendeVerifizierungsCode(emailAdresse, code) {
  await axios.post(
    "https://api.brevo.com/v3/smtp/email",
    {
      sender: {
        name: "Gesundheitszentrum am Donaupark",
        email: process.env.MAIL_FROM
      },
      to: [{ email: emailAdresse }],
      subject: "Ihr Bestätigungscode – Terminbuchung",
      textContent: `Ihr Bestätigungscode lautet: ${code}\n\nDieser Code ist 10 Minuten gültig.\nFalls Sie keine Terminbuchung vorgenommen haben, ignorieren Sie diese E-Mail.`,
      htmlContent: `
        <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;border-radius:8px;overflow:hidden">
          <div style="background:#8B1A1A;padding:24px 32px">
            <p style="color:#C9A84C;font-size:1.1rem;font-weight:bold;margin:0">✚ Gesundheitszentrum am Donaupark</p>
          </div>
          <div style="padding:32px;background:#fff;border:1px solid #e8e8e8">
            <h2 style="margin:0 0 12px;color:#1a1a1a;font-size:1.3rem">Ihr Bestätigungscode</h2>
            <p style="color:#555;margin:0 0 24px;line-height:1.6">
              Bitte geben Sie diesen Code im Chat ein, um Ihre E-Mail-Adresse zu bestätigen:
            </p>
            <div style="background:#f5f5f5;border-radius:8px;padding:24px;text-align:center;margin:0 0 24px">
              <span style="font-size:2.4rem;font-weight:bold;letter-spacing:12px;color:#8B1A1A;font-family:monospace">${code}</span>
            </div>
            <p style="color:#999;font-size:0.82rem;margin:0;line-height:1.5">
              Dieser Code ist <strong>10 Minuten</strong> gültig.<br>
              Falls Sie keine Terminbuchung vorgenommen haben, ignorieren Sie diese E-Mail.
            </p>
          </div>
          <div style="background:#f9f9f9;padding:14px 32px;border:1px solid #e8e8e8;border-top:none">
            <p style="margin:0;font-size:0.78rem;color:#bbb">Musterstraße 12 · 94469 Deggendorf · 0991 123456</p>
          </div>
        </div>
      `
    },
    {
      headers: {
        "api-key": process.env.BREVO_API_KEY,
        "Content-Type": "application/json"
      },
      timeout: 10000
    }
  );
}

module.exports = { sendeVerifizierungsCode };
