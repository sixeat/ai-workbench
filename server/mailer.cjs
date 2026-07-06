const nodemailer = require('nodemailer');

function parseBoolean(value, fallback = false) {
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function smtpConfigured(env = process.env) {
  return Boolean(env.WORKBENCH_SMTP_HOST);
}

function createTransport(env = process.env) {
  if (!smtpConfigured(env)) return null;
  const port = Number(env.WORKBENCH_SMTP_PORT || 587);
  const authUser = env.WORKBENCH_SMTP_USER || '';
  const authPass = env.WORKBENCH_SMTP_PASS || '';
  return nodemailer.createTransport({
    host: env.WORKBENCH_SMTP_HOST,
    port,
    secure: parseBoolean(env.WORKBENCH_SMTP_SECURE, port === 465),
    auth: authUser || authPass ? { user: authUser, pass: authPass } : undefined,
  });
}

async function sendVerificationEmail({ to, code, purpose = 'register' }, options = {}) {
  const env = options.env || process.env;
  const deploymentMode = options.deploymentMode || env.WORKBENCH_DEPLOYMENT_MODE || 'local';
  const transporter = createTransport(env);
  const from = env.WORKBENCH_SMTP_FROM || env.WORKBENCH_SMTP_USER || 'AI Workbench <no-reply@ai-workbench.local>';
  const appName = env.WORKBENCH_APP_NAME || 'AI Workbench';
  const ttlMinutes = Number(env.WORKBENCH_EMAIL_CODE_TTL_MINUTES || 10);
  const devMode = parseBoolean(env.WORKBENCH_EMAIL_DEV_MODE, false);
  const showDevCode = parseBoolean(env.WORKBENCH_EMAIL_DEV_CODE_VISIBLE, deploymentMode !== 'server');

  if (deploymentMode === 'server' && (devMode || showDevCode)) {
    throw new Error('Email development mode is not allowed in server deployment mode.');
  }

  if (!transporter) {
    const message = `[email:${purpose}] ${to} verification code: ${code}`;
    if (deploymentMode === 'server') {
      throw new Error('SMTP is not configured. Set WORKBENCH_SMTP_HOST before enabling email registration.');
    }
    console.log(message);
    return {
      delivered: false,
      devCode: showDevCode ? code : undefined,
    };
  }

  await transporter.sendMail({
    from,
    to,
    subject: `${appName} verification code`,
    text: `Your ${appName} verification code is ${code}. It expires in ${ttlMinutes} minutes.`,
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.6;color:#111">
        <h2>${appName} verification code</h2>
        <p>Use this code to finish ${purpose}:</p>
        <p style="font-size:28px;font-weight:700;letter-spacing:4px">${code}</p>
        <p>This code expires in ${ttlMinutes} minutes.</p>
      </div>
    `,
  });

  return { delivered: true };
}

module.exports = {
  sendVerificationEmail,
  smtpConfigured,
};
