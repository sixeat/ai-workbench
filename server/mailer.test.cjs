const assert = require('node:assert/strict');
const test = require('node:test');
const nodemailer = require('nodemailer');
const { sendVerificationEmail } = require('./mailer.cjs');

test('server mode rejects email development mode and visible dev codes', async () => {
  await assert.rejects(
    () => sendVerificationEmail(
      { to: 'user@example.com', code: '123456' },
      {
        deploymentMode: 'server',
        env: {
          WORKBENCH_DEPLOYMENT_MODE: 'server',
          WORKBENCH_EMAIL_DEV_MODE: 'true',
        },
      }
    ),
    /development mode/
  );

  await assert.rejects(
    () => sendVerificationEmail(
      { to: 'user@example.com', code: '123456' },
      {
        deploymentMode: 'server',
        env: {
          WORKBENCH_DEPLOYMENT_MODE: 'server',
          WORKBENCH_EMAIL_DEV_CODE_VISIBLE: 'true',
        },
      }
    ),
    /development mode/
  );
});

test('local mode can return a visible development verification code', async () => {
  const delivery = await sendVerificationEmail(
    { to: 'user@example.com', code: '123456' },
    {
      deploymentMode: 'local',
      env: {
        WORKBENCH_DEPLOYMENT_MODE: 'local',
        WORKBENCH_EMAIL_DEV_CODE_VISIBLE: 'true',
      },
    }
  );

  assert.equal(delivery.delivered, false);
  assert.equal(delivery.method, 'console');
  assert.equal(delivery.expiresInMinutes, 10);
  assert.equal(delivery.devCode, '123456');
});

test('smtp mode sends a localized verification email and returns delivery metadata', async () => {
  const originalCreateTransport = nodemailer.createTransport;
  const sent = [];
  nodemailer.createTransport = (config) => ({
    async sendMail(message) {
      sent.push({ config, message });
      return { messageId: 'smtp-message-1' };
    },
  });

  try {
    const delivery = await sendVerificationEmail(
      { to: 'user@example.com', code: '234567', purpose: 'register' },
      {
        deploymentMode: 'server',
        env: {
          WORKBENCH_DEPLOYMENT_MODE: 'server',
          WORKBENCH_APP_NAME: '测试工作台',
          WORKBENCH_EMAIL_CODE_TTL_MINUTES: '12',
          WORKBENCH_SMTP_HOST: 'smtp.example.com',
          WORKBENCH_SMTP_PORT: '465',
          WORKBENCH_SMTP_SECURE: 'true',
          WORKBENCH_SMTP_USER: 'mailer@example.com',
          WORKBENCH_SMTP_PASS: 'secret',
          WORKBENCH_SMTP_FROM: 'AI Workbench <mailer@example.com>',
        },
      }
    );

    assert.equal(delivery.delivered, true);
    assert.equal(delivery.method, 'smtp');
    assert.equal(delivery.expiresInMinutes, 12);
    assert.equal(delivery.messageId, 'smtp-message-1');
    assert.equal(sent.length, 1);
    assert.equal(sent[0].config.host, 'smtp.example.com');
    assert.equal(sent[0].config.secure, true);
    assert.equal(sent[0].message.to, 'user@example.com');
    assert.match(sent[0].message.subject, /验证码/);
    assert.match(sent[0].message.text, /234567/);
    assert.match(sent[0].message.html, /邮箱验证码/);
  } finally {
    nodemailer.createTransport = originalCreateTransport;
  }
});
