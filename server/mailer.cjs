const nodemailer = require('nodemailer');

function parseBoolean(value, fallback = false) {
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function smtpConfigured(env = process.env) {
  return Boolean(env.WORKBENCH_SMTP_HOST);
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function purposeLabel(purpose) {
  return String(purpose || '').toLowerCase().includes('password')
    ? '重置密码'
    : '注册账号';
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
  const label = purposeLabel(purpose);
  const safeAppName = escapeHtml(appName);
  const safeLabel = escapeHtml(label);
  const safeCode = escapeHtml(code);

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
      method: 'console',
      expiresInMinutes: ttlMinutes,
      devCode: showDevCode ? code : undefined,
    };
  }

  const info = await transporter.sendMail({
    from,
    to,
    subject: `${appName} 验证码`,
    text: `你正在使用 ${appName} ${label}。验证码是 ${code}，${ttlMinutes} 分钟内有效。如果这不是你本人操作，请忽略这封邮件。`,
    html: `
      <div style="font-family:Arial,'Helvetica Neue',sans-serif;line-height:1.7;color:#101828;background:#f6f7f9;padding:24px">
        <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:18px;padding:28px;border:1px solid #eaecf0">
          <p style="margin:0 0 10px;color:#667085;font-size:13px">${safeAppName}</p>
          <h2 style="margin:0 0 16px;font-size:22px;color:#101828">邮箱验证码</h2>
          <p style="margin:0 0 18px;font-size:14px;color:#344054">你正在${safeLabel}，请在页面中输入下面的验证码：</p>
          <div style="margin:18px 0;padding:18px 20px;border-radius:14px;background:#ecfdf3;color:#027a48;font-size:30px;font-weight:800;letter-spacing:6px;text-align:center">${safeCode}</div>
          <p style="margin:0;color:#667085;font-size:13px">验证码 ${ttlMinutes} 分钟内有效。如果这不是你本人操作，请忽略这封邮件。</p>
        </div>
      </div>
    `,
  });

  return {
    delivered: true,
    method: 'smtp',
    expiresInMinutes: ttlMinutes,
    messageId: info.messageId,
  };
}

module.exports = {
  createTransport,
  sendVerificationEmail,
  smtpConfigured,
};
