const assert = require('node:assert/strict');
const test = require('node:test');
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
  assert.equal(delivery.devCode, '123456');
});
