function normalizeBootstrapAdmin(env = {}) {
  const email = String(env.WORKBENCH_ADMIN_EMAIL || env.WORKBENCH_ADMIN_USERNAME || '').trim().toLowerCase();
  const username = String(env.WORKBENCH_ADMIN_USERNAME || email).trim();
  const password = String(env.WORKBENCH_ADMIN_PASSWORD || '').trim();

  if (!email && !password) return null;
  if (!email || !password) {
    throw new Error('Both WORKBENCH_ADMIN_EMAIL and WORKBENCH_ADMIN_PASSWORD are required when bootstrapping an admin user.');
  }

  return {
    email,
    username: username || email,
    password,
  };
}

function bootstrapAdminUser(options = {}) {
  const {
    env = process.env,
    hashPassword,
    upsertBootstrapUser,
  } = options;
  const admin = normalizeBootstrapAdmin(env);
  if (!admin) return { bootstrapped: false, reason: 'not_configured' };

  if (typeof hashPassword !== 'function') throw new Error('hashPassword dependency is required.');
  if (typeof upsertBootstrapUser !== 'function') throw new Error('upsertBootstrapUser dependency is required.');

  const user = upsertBootstrapUser({
    email: admin.email,
    username: admin.username,
    name: admin.username,
    role: 'admin',
    passwordHash: hashPassword(admin.password),
  });

  return {
    bootstrapped: true,
    email: admin.email,
    user,
  };
}

module.exports = {
  bootstrapAdminUser,
  normalizeBootstrapAdmin,
};
