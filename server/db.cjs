const fs = require('fs');
const Database = require('better-sqlite3');
const { DATA_DIR, DB_PATH } = require('./dataPaths.cjs');
const { DEFAULT_USER_ID } = require('./defaults.cjs');

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT,
      email TEXT,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'local',
      password_hash TEXT,
      is_enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL,
      key_scope TEXT NOT NULL CHECK (key_scope IN ('user', 'server')),
      provider_id TEXT NOT NULL,
      name TEXT,
      base_url TEXT,
      encrypted_key TEXT,
      models_json TEXT,
      allowed_capabilities_json TEXT,
      is_enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (owner_user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS assets (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      storage_driver TEXT NOT NULL DEFAULT 'local-fs',
      url TEXT NOT NULL,
      legacy_url TEXT,
      file_name TEXT,
      file_path TEXT,
      mime TEXT,
      prompt TEXT,
      negative_prompt TEXT,
      model TEXT,
      provider_id TEXT,
      width INTEGER,
      height INTEGER,
      seed INTEGER,
      size_bytes INTEGER,
      metadata_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      node_type TEXT NOT NULL,
      provider_id TEXT,
      model TEXT,
      status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
      credit_cost INTEGER NOT NULL DEFAULT 0,
      credit_status TEXT NOT NULL DEFAULT 'none' CHECK (credit_status IN ('none', 'free', 'charged', 'refunded')),
      credit_key_scope TEXT,
      input_json TEXT,
      output_json TEXT,
      error_json TEXT,
      duration_ms INTEGER,
      retry_of TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS credit_accounts (
      user_id TEXT PRIMARY KEY,
      balance INTEGER NOT NULL DEFAULT 0,
      reserved_balance INTEGER NOT NULL DEFAULT 0,
      total_granted INTEGER NOT NULL DEFAULT 0,
      total_used INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS credit_transactions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      task_id TEXT,
      type TEXT NOT NULL CHECK (type IN ('grant', 'debit', 'refund', 'admin_adjustment', 'free_usage')),
      amount INTEGER NOT NULL,
      balance_after INTEGER NOT NULL,
      reserved_after INTEGER NOT NULL DEFAULT 0,
      actor_user_id TEXT,
      description TEXT,
      metadata_json TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (task_id) REFERENCES tasks(id),
      FOREIGN KEY (actor_user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS workflows (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      nodes_json TEXT NOT NULL,
      edges_json TEXT NOT NULL,
      metadata_json TEXT,
      node_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS workflow_versions (
      id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      version_number INTEGER NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      nodes_json TEXT NOT NULL,
      edges_json TEXT NOT NULL,
      metadata_json TEXT,
      node_count INTEGER NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'save',
      created_at TEXT NOT NULL,
      FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id),
      UNIQUE(workflow_id, version_number)
    );

    CREATE TABLE IF NOT EXISTS task_outputs (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      asset_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (task_id) REFERENCES tasks(id),
      FOREIGN KEY (asset_id) REFERENCES assets(id)
    );

    CREATE TABLE IF NOT EXISTS task_logs (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      level TEXT NOT NULL DEFAULT 'info',
      event TEXT NOT NULL,
      message TEXT,
      data_json TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS asset_collections (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      category TEXT NOT NULL DEFAULT 'general',
      cover_asset_id TEXT,
      metadata_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (cover_asset_id) REFERENCES assets(id)
    );

    CREATE TABLE IF NOT EXISTS asset_collection_items (
      id TEXT PRIMARY KEY,
      collection_id TEXT NOT NULL,
      asset_id TEXT NOT NULL,
      role TEXT,
      note TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (collection_id) REFERENCES asset_collections(id) ON DELETE CASCADE,
      FOREIGN KEY (asset_id) REFERENCES assets(id),
      UNIQUE(collection_id, asset_id)
    );

    CREATE TABLE IF NOT EXISTS model_capabilities (
      id TEXT PRIMARY KEY,
      provider_id TEXT NOT NULL,
      model_pattern TEXT NOT NULL,
      capabilities_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS platform_models (
      id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      description TEXT,
      capability TEXT NOT NULL CHECK (capability IN ('chat', 'imageGeneration', 'videoGeneration')),
      model TEXT NOT NULL,
      capabilities_json TEXT,
      is_enabled INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 100,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS platform_model_routes (
      id TEXT PRIMARY KEY,
      platform_model_id TEXT NOT NULL,
      api_key_id TEXT NOT NULL,
      provider_id TEXT,
      upstream_model TEXT,
      priority INTEGER NOT NULL DEFAULT 100,
      is_enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (platform_model_id) REFERENCES platform_models(id) ON DELETE CASCADE,
      FOREIGN KEY (api_key_id) REFERENCES api_keys(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      ip_address TEXT,
      user_agent TEXT,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS email_verifications (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      purpose TEXT NOT NULL,
      code_hash TEXT NOT NULL,
      payload_json TEXT,
      expires_at TEXT NOT NULL,
      consumed_at TEXT,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS invitation_codes (
      id TEXT PRIMARY KEY,
      code_hash TEXT NOT NULL UNIQUE,
      label TEXT,
      role TEXT NOT NULL DEFAULT 'user',
      max_uses INTEGER NOT NULL DEFAULT 1,
      used_count INTEGER NOT NULL DEFAULT 0,
      expires_at TEXT,
      created_by TEXT,
      disabled_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (created_by) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      actor_user_id TEXT,
      action TEXT NOT NULL,
      target_type TEXT,
      target_id TEXT,
      ip_address TEXT,
      user_agent TEXT,
      metadata_json TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (actor_user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_assets_user_created ON assets(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_workflows_user_updated ON workflows(user_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_workflow_versions_workflow_created ON workflow_versions(workflow_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_workflow_versions_user_created ON workflow_versions(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_asset_collections_user_created ON asset_collections(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_asset_collection_items_collection ON asset_collection_items(collection_id, sort_order, created_at);
    CREATE INDEX IF NOT EXISTS idx_tasks_user_created ON tasks(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_credit_transactions_user_created ON credit_transactions(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_credit_transactions_task ON credit_transactions(task_id);
    CREATE INDEX IF NOT EXISTS idx_credit_transactions_created ON credit_transactions(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_task_outputs_task ON task_outputs(task_id);
    CREATE INDEX IF NOT EXISTS idx_task_logs_task_created ON task_logs(task_id, created_at ASC);
    CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id, expires_at);
    CREATE INDEX IF NOT EXISTS idx_email_verifications_email ON email_verifications(email, purpose, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_invitation_codes_created ON invitation_codes(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_created ON audit_logs(actor_user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_platform_models_enabled ON platform_models(is_enabled, sort_order, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_platform_model_routes_model ON platform_model_routes(platform_model_id, is_enabled, priority);
  `);

  ensureColumn('users', 'username', 'TEXT');
  ensureColumn('users', 'email', 'TEXT');
  ensureColumn('users', 'password_hash', 'TEXT');
  ensureColumn('users', 'is_enabled', 'INTEGER NOT NULL DEFAULT 1');
  ensureColumn('sessions', 'ip_address', 'TEXT');
  ensureColumn('sessions', 'user_agent', 'TEXT');
  ensureColumn('email_verifications', 'attempt_count', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('api_keys', 'models_json', 'TEXT');
  ensureColumn('api_keys', 'allowed_capabilities_json', 'TEXT');
  ensureColumn('assets', 'size_bytes', 'INTEGER');
  ensureColumn('tasks', 'credit_cost', "INTEGER NOT NULL DEFAULT 0");
  ensureColumn('tasks', 'credit_status', "TEXT NOT NULL DEFAULT 'none'");
  ensureColumn('tasks', 'credit_key_scope', 'TEXT');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username)');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_tasks_credit_status ON tasks(credit_status, status)');
}

function ensureDefaultUser() {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT OR IGNORE INTO users (id, username, email, name, role, is_enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(DEFAULT_USER_ID, 'local', 'local@ai-workbench.local', 'Local User', 'local', 1, now, now);
  db.prepare(`
    UPDATE users
    SET username = COALESCE(username, ?),
        email = COALESCE(email, ?),
        is_enabled = COALESCE(is_enabled, 1),
        updated_at = ?
    WHERE id = ?
  `).run('local', 'local@ai-workbench.local', now, DEFAULT_USER_ID);
}

function ensureCreditAccountsForExistingUsers() {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT OR IGNORE INTO credit_accounts (
      user_id, balance, reserved_balance, total_granted, total_used, created_at, updated_at
    )
    SELECT id, 0, 0, 0, 0, ?, ?
    FROM users
  `).run(now, now);
}

function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((item) => item.name);
  if (columns.includes(column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function jsonStringify(value) {
  return value == null ? null : JSON.stringify(value);
}

function jsonParse(value, fallback = null) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function rowToAsset(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type,
    storageDriver: row.storage_driver,
    url: row.url,
    legacyUrl: row.legacy_url,
    fileName: row.file_name,
    filePath: row.file_path,
    mime: row.mime,
    prompt: row.prompt,
    negativePrompt: row.negative_prompt,
    model: row.model,
    providerId: row.provider_id,
    width: row.width,
    height: row.height,
    seed: row.seed,
    sizeBytes: row.size_bytes,
    metadata: jsonParse(row.metadata_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToTask(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    kind: row.node_type,
    nodeType: row.node_type,
    providerId: row.provider_id,
    model: row.model,
    status: row.status,
    creditCost: Number(row.credit_cost || 0),
    creditStatus: row.credit_status || 'none',
    creditKeyScope: row.credit_key_scope || '',
    input: jsonParse(row.input_json, null),
    output: jsonParse(row.output_json, null),
    error: jsonParse(row.error_json, null),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    durationMs: row.duration_ms,
    retryOf: row.retry_of,
  };
}

function rowToTaskLog(row) {
  if (!row) return null;
  return {
    id: row.id,
    taskId: row.task_id,
    level: row.level,
    event: row.event,
    message: row.message || '',
    data: jsonParse(row.data_json, {}),
    createdAt: row.created_at,
  };
}

function rowToWorkflow(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    description: row.description || '',
    nodes: jsonParse(row.nodes_json, []),
    edges: jsonParse(row.edges_json, []),
    metadata: jsonParse(row.metadata_json, {}),
    nodeCount: row.node_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToWorkflowVersion(row) {
  if (!row) return null;
  return {
    id: row.id,
    workflowId: row.workflow_id,
    userId: row.user_id,
    versionNumber: row.version_number,
    name: row.name,
    description: row.description || '',
    nodes: jsonParse(row.nodes_json, []),
    edges: jsonParse(row.edges_json, []),
    metadata: jsonParse(row.metadata_json, {}),
    nodeCount: row.node_count,
    source: row.source || 'save',
    createdAt: row.created_at,
  };
}

function rowToAssetCollection(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    description: row.description,
    category: row.category,
    coverAssetId: row.cover_asset_id,
    metadata: jsonParse(row.metadata_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToApiKey(row, includeSecret = false) {
  if (!row) return null;
  const key = {
    id: row.id,
    ownerUserId: row.owner_user_id,
    keyScope: row.key_scope,
    providerId: row.provider_id,
    name: row.name,
    baseUrl: row.base_url,
    models: jsonParse(row.models_json, []),
    allowedCapabilities: jsonParse(row.allowed_capabilities_json, {}),
    isEnabled: Boolean(row.is_enabled),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (includeSecret) key.encryptedKey = row.encrypted_key;
  return key;
}

function rowToPlatformModel(row) {
  if (!row) return null;
  return {
    id: row.id,
    displayName: row.display_name,
    description: row.description || '',
    capability: row.capability,
    model: row.model,
    capabilities: jsonParse(row.capabilities_json, {}),
    isEnabled: Boolean(row.is_enabled),
    sortOrder: Number(row.sort_order || 100),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToPlatformModelRoute(row) {
  if (!row) return null;
  return {
    id: row.id,
    platformModelId: row.platform_model_id,
    apiKeyId: row.api_key_id,
    providerId: row.provider_id || '',
    upstreamModel: row.upstream_model || '',
    priority: Number(row.priority || 100),
    isEnabled: Boolean(row.is_enabled),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    apiKey: row.key_name !== undefined
      ? {
        id: row.api_key_id,
        name: row.key_name || '',
        providerId: row.key_provider_id || '',
        keyScope: row.key_scope || '',
        isEnabled: Boolean(row.key_is_enabled),
      }
      : undefined,
  };
}

function rowToUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    name: row.name,
    role: row.role,
    isEnabled: Boolean(row.is_enabled),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToEmailVerification(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    purpose: row.purpose,
    codeHash: row.code_hash,
    payload: jsonParse(row.payload_json, {}),
    expiresAt: row.expires_at,
    consumedAt: row.consumed_at,
    attemptCount: Number(row.attempt_count || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToInvitationCode(row) {
  if (!row) return null;
  return {
    id: row.id,
    label: row.label,
    role: row.role,
    maxUses: row.max_uses,
    usedCount: row.used_count,
    expiresAt: row.expires_at,
    createdBy: row.created_by,
    disabledAt: row.disabled_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToAuditLog(row) {
  if (!row) return null;
  return {
    id: row.id,
    actorUserId: row.actor_user_id,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    ipAddress: row.ip_address,
    userAgent: row.user_agent,
    metadata: jsonParse(row.metadata_json, {}),
    createdAt: row.created_at,
  };
}

function rowToSession(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    tokenHash: row.token_hash,
    ipAddress: row.ip_address,
    userAgent: row.user_agent,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToUserWithSecret(row) {
  const user = rowToUser(row);
  if (!user) return null;
  return {
    ...user,
    passwordHash: row.password_hash,
  };
}

function getUser(id, includeSecret = false) {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  return includeSecret ? rowToUserWithSecret(row) : rowToUser(row);
}

function getUserByUsername(username, includeSecret = false) {
  const row = db.prepare('SELECT * FROM users WHERE lower(username) = lower(?)').get(username);
  return includeSecret ? rowToUserWithSecret(row) : rowToUser(row);
}

function getUserByEmail(email, includeSecret = false) {
  const row = db.prepare('SELECT * FROM users WHERE lower(email) = lower(?)').get(email);
  return includeSecret ? rowToUserWithSecret(row) : rowToUser(row);
}

function listUsers(options = null) {
  if (!options) {
    return db.prepare('SELECT * FROM users ORDER BY created_at DESC')
      .all()
      .map(rowToUser);
  }

  const query = normalizeUserQuery(options);
  const { where, params } = buildUserWhere(query);
  return db.prepare(`
    SELECT * FROM users
    ${where}
    ORDER BY created_at DESC
    LIMIT @limit OFFSET @offset
  `).all({ ...params, limit: query.limit, offset: query.offset }).map(rowToUser);
}

function countUsers(options = null) {
  if (!options) return countAllUsers();
  const query = normalizeUserQuery(options);
  const { where, params } = buildUserWhere(query);
  return db.prepare(`
    SELECT COUNT(*) AS count FROM users
    ${where}
  `).get(params).count;
}

function createUser(user) {
  const now = new Date().toISOString();
  const id = user.id || require('crypto').randomUUID();
  const email = user.email ? String(user.email).trim().toLowerCase() : null;
  const username = user.username || email;
  db.prepare(`
    INSERT INTO users (id, username, email, name, role, password_hash, is_enabled, created_at, updated_at)
    VALUES (@id, @username, @email, @name, @role, @passwordHash, @isEnabled, @createdAt, @updatedAt)
  `).run({
    id,
    username,
    email,
    name: user.name || username || email || 'User',
    role: user.role || 'user',
    passwordHash: user.passwordHash || null,
    isEnabled: user.isEnabled === false ? 0 : 1,
    createdAt: user.createdAt || now,
    updatedAt: user.updatedAt || now,
  });
  return getUser(id);
}

function upsertBootstrapUser(user) {
  const existing = user.email
    ? getUserByEmail(user.email, true)
    : getUserByUsername(user.username, true);
  if (existing) {
    const now = new Date().toISOString();
    db.prepare(`
      UPDATE users
      SET name = @name,
          username = COALESCE(@username, username),
          email = COALESCE(@email, email),
          role = @role,
          password_hash = COALESCE(@passwordHash, password_hash),
          is_enabled = 1,
          updated_at = @updatedAt
      WHERE id = @id
    `).run({
      id: existing.id,
      username: user.username || null,
      email: user.email ? String(user.email).trim().toLowerCase() : null,
      name: user.name || existing.name,
      role: user.role || existing.role,
      passwordHash: user.passwordHash || null,
      updatedAt: now,
    });
    return getUser(existing.id);
  }
  return createUser(user);
}

function updateUserPassword(userId, passwordHash) {
  const now = new Date().toISOString();
  const result = db.prepare(`
    UPDATE users
    SET password_hash = ?,
        updated_at = ?
    WHERE id = ?
  `).run(passwordHash, now, userId);
  return result.changes > 0 ? getUser(userId) : null;
}

function updateUserStatus(userId, isEnabled) {
  const now = new Date().toISOString();
  const result = db.prepare(`
    UPDATE users
    SET is_enabled = ?,
        updated_at = ?
    WHERE id = ?
  `).run(isEnabled ? 1 : 0, now, userId);
  return result.changes > 0 ? getUser(userId) : null;
}

function createSession({ userId, tokenHash, expiresAt, ipAddress = '', userAgent = '' }) {
  const now = new Date().toISOString();
  const id = require('crypto').randomUUID();
  db.prepare(`
    INSERT INTO sessions (id, user_id, token_hash, ip_address, user_agent, expires_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, userId, tokenHash, ipAddress || null, userAgent || null, expiresAt, now, now);
  return {
    id,
    userId,
    tokenHash,
    ipAddress: ipAddress || null,
    userAgent: userAgent || null,
    expiresAt,
    createdAt: now,
    updatedAt: now,
  };
}

function getSessionByTokenHash(tokenHash) {
  const row = db.prepare(`
    SELECT sessions.*, users.username, users.email, users.name, users.role, users.is_enabled
    FROM sessions
    JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ?
  `).get(tokenHash);
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    tokenHash: row.token_hash,
    ipAddress: row.ip_address,
    userAgent: row.user_agent,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    user: {
      id: row.user_id,
      username: row.username,
      email: row.email,
      name: row.name,
      role: row.role,
      isEnabled: Boolean(row.is_enabled),
    },
  };
}

function deleteSessionByTokenHash(tokenHash) {
  const result = db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
  return result.changes > 0;
}

function deleteSessionForUser(sessionId, userId) {
  const result = db.prepare('DELETE FROM sessions WHERE id = ? AND user_id = ?').run(sessionId, userId);
  return result.changes > 0;
}

function listSessionsForUser(userId) {
  return db.prepare(`
    SELECT * FROM sessions
    WHERE user_id = ?
      AND expires_at > ?
    ORDER BY created_at DESC
  `).all(userId, new Date().toISOString()).map(rowToSession);
}

function deleteSessionsForUser(userId) {
  return db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId).changes;
}

function deleteExpiredSessions(now = new Date().toISOString()) {
  return db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now).changes;
}

function createEmailVerification({ email, purpose, codeHash, payload, expiresAt }) {
  const now = new Date().toISOString();
  const id = require('crypto').randomUUID();
  db.prepare(`
    INSERT INTO email_verifications (
      id, email, purpose, code_hash, payload_json, expires_at, consumed_at, attempt_count, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, NULL, 0, ?, ?)
  `).run(id, email, purpose, codeHash, jsonStringify(payload || {}), expiresAt, now, now);
  return getEmailVerification(id);
}

function getEmailVerification(id) {
  return rowToEmailVerification(db.prepare('SELECT * FROM email_verifications WHERE id = ?').get(id));
}

function getLatestEmailVerification(email, purpose) {
  return rowToEmailVerification(db.prepare(`
    SELECT * FROM email_verifications
    WHERE lower(email) = lower(?)
      AND purpose = ?
      AND consumed_at IS NULL
    ORDER BY created_at DESC
    LIMIT 1
  `).get(email, purpose));
}

function consumeEmailVerification(id) {
  const now = new Date().toISOString();
  const result = db.prepare(`
    UPDATE email_verifications
    SET consumed_at = ?,
        updated_at = ?
    WHERE id = ?
      AND consumed_at IS NULL
  `).run(now, now, id);
  return result.changes > 0;
}

function incrementEmailVerificationAttempts(id) {
  const now = new Date().toISOString();
  const result = db.prepare(`
    UPDATE email_verifications
    SET attempt_count = attempt_count + 1,
        updated_at = ?
    WHERE id = ?
      AND consumed_at IS NULL
  `).run(now, id);
  if (result.changes === 0) return null;
  return getEmailVerification(id);
}

function createInvitationCode({ codeHash, label = '', role = 'user', maxUses = 1, expiresAt = null, createdBy = null }) {
  const now = new Date().toISOString();
  const id = require('crypto').randomUUID();
  db.prepare(`
    INSERT INTO invitation_codes (
      id, code_hash, label, role, max_uses, used_count, expires_at, created_by, disabled_at, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, 0, ?, ?, NULL, ?, ?)
  `).run(id, codeHash, label || null, role, Math.max(1, Number(maxUses) || 1), expiresAt || null, createdBy || null, now, now);
  return getInvitationCode(id);
}

function getInvitationCode(id) {
  return rowToInvitationCode(db.prepare('SELECT * FROM invitation_codes WHERE id = ?').get(id));
}

function getInvitationCodeByHash(codeHash) {
  return rowToInvitationCode(db.prepare('SELECT * FROM invitation_codes WHERE code_hash = ?').get(codeHash));
}

function listInvitationCodes(options = 100) {
  const query = normalizeInvitationQuery(options);
  const { where, params } = buildInvitationWhere(query);
  return db.prepare(`
    SELECT * FROM invitation_codes
    ${where}
    ORDER BY created_at DESC
    LIMIT @limit OFFSET @offset
  `).all({ ...params, limit: query.limit, offset: query.offset }).map(rowToInvitationCode);
}

function countInvitationCodes(options = null) {
  if (!options) return db.prepare('SELECT COUNT(*) AS count FROM invitation_codes').get().count;
  const query = normalizeInvitationQuery(options);
  const { where, params } = buildInvitationWhere(query);
  return db.prepare(`
    SELECT COUNT(*) AS count FROM invitation_codes
    ${where}
  `).get(params).count;
}

function consumeInvitationCode(id) {
  const now = new Date().toISOString();
  const result = db.prepare(`
    UPDATE invitation_codes
    SET used_count = used_count + 1,
        updated_at = ?
    WHERE id = ?
      AND disabled_at IS NULL
      AND used_count < max_uses
      AND (expires_at IS NULL OR expires_at > ?)
  `).run(now, id, now);
  return result.changes > 0;
}

function disableInvitationCode(id) {
  const now = new Date().toISOString();
  const result = db.prepare(`
    UPDATE invitation_codes
    SET disabled_at = COALESCE(disabled_at, ?),
        updated_at = ?
    WHERE id = ?
  `).run(now, now, id);
  return result.changes > 0 ? getInvitationCode(id) : null;
}

function createAuditLog(log) {
  const now = new Date().toISOString();
  const id = log.id || require('crypto').randomUUID();
  db.prepare(`
    INSERT INTO audit_logs (
      id, actor_user_id, action, target_type, target_id, ip_address, user_agent, metadata_json, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    log.actorUserId || null,
    log.action,
    log.targetType || null,
    log.targetId || null,
    log.ipAddress || null,
    log.userAgent || null,
    jsonStringify(log.metadata || {}),
    log.createdAt || now
  );
  return rowToAuditLog(db.prepare('SELECT * FROM audit_logs WHERE id = ?').get(id));
}

function clampNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(number)));
}

function normalizeListQuery(options = 100, fallbackLimit = 100, maxLimit = 500) {
  if (typeof options === 'number') {
    return {
      limit: clampNumber(options, fallbackLimit, 1, maxLimit),
      offset: 0,
    };
  }

  return {
    limit: clampNumber(options?.limit, fallbackLimit, 1, maxLimit),
    offset: clampNumber(options?.offset, 0, 0, 100_000),
  };
}

function escapeLike(value) {
  return String(value || '').replace(/[\\%_]/g, '\\$&');
}

function normalizeUserQuery(options = {}) {
  const base = normalizeListQuery(options, 100, 500);
  return {
    ...base,
    search: String(options.search || options.q || '').trim(),
    role: String(options.role || '').trim(),
    status: String(options.status || '').trim(),
  };
}

function buildUserWhere(query) {
  const clauses = [];
  const params = {};

  if (query.search) {
    params.search = `%${escapeLike(query.search.toLowerCase())}%`;
    clauses.push(`(
      lower(coalesce(id, '')) LIKE @search ESCAPE '\\'
      OR lower(coalesce(username, '')) LIKE @search ESCAPE '\\'
      OR lower(coalesce(email, '')) LIKE @search ESCAPE '\\'
      OR lower(coalesce(name, '')) LIKE @search ESCAPE '\\'
    )`);
  }

  if (query.role) {
    params.role = query.role;
    clauses.push('role = @role');
  }

  if (query.status === 'enabled') {
    clauses.push('is_enabled = 1');
  } else if (query.status === 'disabled') {
    clauses.push('is_enabled = 0');
  }

  return {
    where: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '',
    params,
  };
}

function normalizeInvitationQuery(options = {}) {
  const base = normalizeListQuery(options, 100, 500);
  return {
    ...base,
    search: String(options.search || options.q || '').trim(),
    role: String(options.role || '').trim(),
    status: String(options.status || '').trim(),
    now: options.now || new Date().toISOString(),
  };
}

function buildInvitationWhere(query) {
  const clauses = [];
  const params = { now: query.now };
  const activeSql = `disabled_at IS NULL
    AND used_count < max_uses
    AND (expires_at IS NULL OR expires_at > @now)`;

  if (query.search) {
    params.search = `%${escapeLike(query.search.toLowerCase())}%`;
    clauses.push(`(
      lower(coalesce(id, '')) LIKE @search ESCAPE '\\'
      OR lower(coalesce(label, '')) LIKE @search ESCAPE '\\'
      OR lower(coalesce(role, '')) LIKE @search ESCAPE '\\'
    )`);
  }

  if (query.role) {
    params.role = query.role;
    clauses.push('role = @role');
  }

  if (query.status === 'active') {
    clauses.push(`(${activeSql})`);
  } else if (query.status === 'inactive') {
    clauses.push(`NOT (${activeSql})`);
  } else if (query.status === 'disabled') {
    clauses.push('disabled_at IS NOT NULL');
  } else if (query.status === 'expired') {
    clauses.push('disabled_at IS NULL AND expires_at IS NOT NULL AND expires_at <= @now');
  } else if (query.status === 'used') {
    clauses.push('disabled_at IS NULL AND used_count >= max_uses');
  }

  return {
    where: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '',
    params,
  };
}

function normalizeAuditLogQuery(options = 100) {
  if (typeof options === 'number') {
    return {
      limit: clampNumber(options, 100, 1, 500),
      offset: 0,
    };
  }

  return {
    limit: clampNumber(options.limit, 100, 1, 500),
    offset: clampNumber(options.offset, 0, 0, 100_000),
    action: String(options.action || '').trim(),
    targetType: String(options.targetType || '').trim(),
    targetId: String(options.targetId || '').trim(),
    actorUserId: String(options.actorUserId || '').trim(),
    search: String(options.search || options.q || '').trim(),
  };
}

function auditLogWhere(options = {}) {
  const query = normalizeAuditLogQuery(options);
  const where = [];
  const params = [];

  if (query.action) {
    where.push('action = ?');
    params.push(query.action);
  }
  if (query.targetType) {
    where.push('target_type = ?');
    params.push(query.targetType);
  }
  if (query.targetId) {
    where.push('target_id = ?');
    params.push(query.targetId);
  }
  if (query.actorUserId) {
    where.push('actor_user_id = ?');
    params.push(query.actorUserId);
  }
  if (query.search) {
    const like = `%${query.search}%`;
    where.push(`(
      action LIKE ?
      OR target_type LIKE ?
      OR target_id LIKE ?
      OR ip_address LIKE ?
      OR user_agent LIKE ?
      OR metadata_json LIKE ?
    )`);
    params.push(like, like, like, like, like, like);
  }

  return {
    query,
    clause: where.length > 0 ? `WHERE ${where.join(' AND ')}` : '',
    params,
  };
}

function listAuditLogs(options = 100) {
  const { query, clause, params } = auditLogWhere(options);
  return db.prepare(`
    SELECT * FROM audit_logs
    ${clause}
    ORDER BY created_at DESC, id DESC
    LIMIT ?
    OFFSET ?
  `).all(...params, query.limit, query.offset).map(rowToAuditLog);
}

function countAuditLogs(options = {}) {
  const { clause, params } = auditLogWhere(options);
  const row = db.prepare(`
    SELECT COUNT(*) AS count FROM audit_logs
    ${clause}
  `).get(...params);
  return Number(row?.count || 0);
}

function createTask(task) {
  const now = new Date().toISOString();
  const id = task.id || require('crypto').randomUUID();
  db.prepare(`
    INSERT INTO tasks (
      id, user_id, node_type, provider_id, model, status,
      credit_cost, credit_status, credit_key_scope,
      input_json, output_json, error_json, duration_ms, retry_of, created_at, updated_at
    )
    VALUES (
      @id, @userId, @nodeType, @providerId, @model, @status,
      @creditCost, @creditStatus, @creditKeyScope,
      @inputJson, @outputJson, @errorJson, @durationMs, @retryOf, @createdAt, @updatedAt
    )
  `).run({
    id,
    userId: task.userId || DEFAULT_USER_ID,
    nodeType: task.nodeType,
    providerId: task.providerId || null,
    model: task.model || null,
    status: task.status || 'running',
    creditCost: Math.max(0, Number(task.creditCost || 0) || 0),
    creditStatus: task.creditStatus || 'none',
    creditKeyScope: task.creditKeyScope || null,
    inputJson: jsonStringify(task.input),
    outputJson: jsonStringify(task.output),
    errorJson: jsonStringify(task.error),
    durationMs: task.durationMs || null,
    retryOf: task.retryOf || null,
    createdAt: task.createdAt || now,
    updatedAt: task.updatedAt || now,
  });
  return getTask(id);
}

function upsertApiKey(apiKey) {
  const now = new Date().toISOString();
  const id = apiKey.id || require('crypto').randomUUID();
  db.prepare(`
    INSERT INTO api_keys (
      id, owner_user_id, key_scope, provider_id, name, base_url,
      encrypted_key, models_json, allowed_capabilities_json, is_enabled, created_at, updated_at
    )
    VALUES (
      @id, @ownerUserId, @keyScope, @providerId, @name, @baseUrl,
      @encryptedKey, @modelsJson, @allowedCapabilitiesJson, @isEnabled, @createdAt, @updatedAt
    )
    ON CONFLICT(id) DO UPDATE SET
      owner_user_id = excluded.owner_user_id,
      key_scope = excluded.key_scope,
      provider_id = excluded.provider_id,
      name = excluded.name,
      base_url = excluded.base_url,
      encrypted_key = COALESCE(excluded.encrypted_key, api_keys.encrypted_key),
      models_json = excluded.models_json,
      allowed_capabilities_json = excluded.allowed_capabilities_json,
      is_enabled = excluded.is_enabled,
      updated_at = excluded.updated_at
  `).run({
    id,
    ownerUserId: apiKey.ownerUserId || DEFAULT_USER_ID,
    keyScope: apiKey.keyScope || 'user',
    providerId: apiKey.providerId,
    name: apiKey.name || null,
    baseUrl: apiKey.baseUrl || null,
    encryptedKey: apiKey.encryptedKey || null,
    modelsJson: jsonStringify(Array.isArray(apiKey.models) ? apiKey.models : []),
    allowedCapabilitiesJson: jsonStringify(apiKey.allowedCapabilities || {}),
    isEnabled: apiKey.isEnabled === false ? 0 : 1,
    createdAt: apiKey.createdAt || now,
    updatedAt: now,
  });
  return getApiKey(id);
}

function getApiKey(id, includeSecret = false) {
  return rowToApiKey(db.prepare('SELECT * FROM api_keys WHERE id = ?').get(id), includeSecret);
}

function getApiKeyForUser(id, userId = DEFAULT_USER_ID, includeSecret = false) {
  const row = db.prepare(`
    SELECT * FROM api_keys
    WHERE id = ?
      AND (owner_user_id = ? OR key_scope = 'server')
  `).get(id, userId);
  return rowToApiKey(row, includeSecret);
}

function apiKeyListOptions(options = {}) {
  const hasPagination = options.limit !== undefined || options.offset !== undefined;
  return {
    limit: hasPagination ? Math.max(1, Math.min(500, Number(options.limit || 100) || 100)) : null,
    offset: Math.max(0, Number(options.offset || 0) || 0),
    search: String(options.search || options.q || '').trim().toLowerCase(),
    providerId: String(options.providerId || '').trim(),
    keyScope: ['user', 'server'].includes(options.keyScope) ? options.keyScope : '',
    status: ['enabled', 'disabled'].includes(options.status) ? options.status : '',
  };
}

function apiKeyWhereClause(userId = DEFAULT_USER_ID, includeServer = true, options = {}) {
  const query = apiKeyListOptions(options);
  const conditions = includeServer
    ? ['(owner_user_id = ? OR key_scope = \'server\')']
    : ['owner_user_id = ?'];
  const params = [userId];

  if (query.search) {
    conditions.push('(LOWER(COALESCE(name, \'\')) LIKE ? OR LOWER(provider_id) LIKE ? OR LOWER(COALESCE(base_url, \'\')) LIKE ?)');
    const like = `%${query.search}%`;
    params.push(like, like, like);
  }
  if (query.providerId) {
    conditions.push('provider_id = ?');
    params.push(query.providerId);
  }
  if (query.keyScope) {
    conditions.push('key_scope = ?');
    params.push(query.keyScope);
  }
  if (query.status === 'enabled') conditions.push('is_enabled = 1');
  if (query.status === 'disabled') conditions.push('is_enabled = 0');

  return {
    clause: conditions.join(' AND '),
    params,
    query,
  };
}

function listApiKeys(userId = DEFAULT_USER_ID, includeServer = true, options = {}) {
  const { clause, params, query } = apiKeyWhereClause(userId, includeServer, options);
  const limitClause = query.limit ? 'LIMIT ? OFFSET ?' : '';
  const limitParams = query.limit ? [query.limit, query.offset] : [];
  const rows = db.prepare(`
    SELECT * FROM api_keys
    WHERE ${clause}
    ORDER BY created_at DESC
    ${limitClause}
  `).all(...params, ...limitParams);
  return rows.map((row) => rowToApiKey(row));
}

function countApiKeys(userId = DEFAULT_USER_ID, includeServer = true, options = {}) {
  const { clause, params } = apiKeyWhereClause(userId, includeServer, options);
  const row = db.prepare(`
    SELECT COUNT(*) AS count
    FROM api_keys
    WHERE ${clause}
  `).get(...params);
  return Number(row?.count || 0);
}

function deleteApiKey(id, userId = DEFAULT_USER_ID) {
  const result = db.prepare(`
    DELETE FROM api_keys
    WHERE id = ? AND (owner_user_id = ? OR key_scope = 'server')
  `).run(id, userId);
  return result.changes > 0;
}

function platformModelListOptions(options = {}) {
  return {
    capability: ['chat', 'imageGeneration', 'videoGeneration'].includes(options.capability) ? options.capability : '',
    includeDisabled: Boolean(options.includeDisabled),
    limit: Math.max(1, Math.min(500, Number(options.limit || 100) || 100)),
    offset: Math.max(0, Number(options.offset || 0) || 0),
    search: String(options.search || options.q || '').trim().toLowerCase(),
  };
}

function platformModelWhereClause(options = {}) {
  const query = platformModelListOptions(options);
  const conditions = [];
  const params = [];

  if (!query.includeDisabled) conditions.push('is_enabled = 1');
  if (query.capability) {
    conditions.push('capability = ?');
    params.push(query.capability);
  }
  if (query.search) {
    conditions.push('(LOWER(display_name) LIKE ? OR LOWER(model) LIKE ? OR LOWER(COALESCE(description, \'\')) LIKE ?)');
    const like = `%${query.search}%`;
    params.push(like, like, like);
  }

  return {
    clause: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '',
    params,
    query,
  };
}

function listPlatformModels(options = {}) {
  const { clause, params, query } = platformModelWhereClause(options);
  return db.prepare(`
    SELECT * FROM platform_models
    ${clause}
    ORDER BY sort_order ASC, updated_at DESC, display_name ASC
    LIMIT ? OFFSET ?
  `).all(...params, query.limit, query.offset).map(rowToPlatformModel);
}

function countPlatformModels(options = {}) {
  const { clause, params } = platformModelWhereClause(options);
  const row = db.prepare(`
    SELECT COUNT(*) AS count
    FROM platform_models
    ${clause}
  `).get(...params);
  return Number(row?.count || 0);
}

function getPlatformModel(id) {
  return rowToPlatformModel(db.prepare('SELECT * FROM platform_models WHERE id = ?').get(id));
}

function upsertPlatformModel(model) {
  const now = new Date().toISOString();
  const id = model.id || require('crypto').randomUUID();
  db.prepare(`
    INSERT INTO platform_models (
      id, display_name, description, capability, model, capabilities_json,
      is_enabled, sort_order, created_at, updated_at
    )
    VALUES (
      @id, @displayName, @description, @capability, @model, @capabilitiesJson,
      @isEnabled, @sortOrder, @createdAt, @updatedAt
    )
    ON CONFLICT(id) DO UPDATE SET
      display_name = excluded.display_name,
      description = excluded.description,
      capability = excluded.capability,
      model = excluded.model,
      capabilities_json = excluded.capabilities_json,
      is_enabled = excluded.is_enabled,
      sort_order = excluded.sort_order,
      updated_at = excluded.updated_at
  `).run({
    id,
    displayName: model.displayName,
    description: model.description || null,
    capability: model.capability,
    model: model.model,
    capabilitiesJson: jsonStringify(model.capabilities || {}),
    isEnabled: model.isEnabled === false ? 0 : 1,
    sortOrder: Number.isFinite(Number(model.sortOrder)) ? Number(model.sortOrder) : 100,
    createdAt: model.createdAt || now,
    updatedAt: now,
  });
  return getPlatformModel(id);
}

function deletePlatformModel(id) {
  const result = db.prepare('DELETE FROM platform_models WHERE id = ?').run(id);
  return result.changes > 0;
}

function listPlatformModelRoutes(platformModelId, options = {}) {
  const includeDisabled = Boolean(options.includeDisabled);
  const enabledClause = includeDisabled ? '' : 'AND platform_model_routes.is_enabled = 1';
  return db.prepare(`
    SELECT
      platform_model_routes.*,
      api_keys.name AS key_name,
      api_keys.provider_id AS key_provider_id,
      api_keys.key_scope AS key_scope,
      api_keys.is_enabled AS key_is_enabled
    FROM platform_model_routes
    JOIN api_keys ON api_keys.id = platform_model_routes.api_key_id
    WHERE platform_model_routes.platform_model_id = ?
      ${enabledClause}
    ORDER BY platform_model_routes.priority ASC, platform_model_routes.created_at ASC
  `).all(platformModelId).map(rowToPlatformModelRoute);
}

function getPlatformModelRoute(id) {
  return rowToPlatformModelRoute(db.prepare(`
    SELECT
      platform_model_routes.*,
      api_keys.name AS key_name,
      api_keys.provider_id AS key_provider_id,
      api_keys.key_scope AS key_scope,
      api_keys.is_enabled AS key_is_enabled
    FROM platform_model_routes
    JOIN api_keys ON api_keys.id = platform_model_routes.api_key_id
    WHERE platform_model_routes.id = ?
  `).get(id));
}

function upsertPlatformModelRoute(route) {
  const now = new Date().toISOString();
  const id = route.id || require('crypto').randomUUID();
  db.prepare(`
    INSERT INTO platform_model_routes (
      id, platform_model_id, api_key_id, provider_id, upstream_model,
      priority, is_enabled, created_at, updated_at
    )
    VALUES (
      @id, @platformModelId, @apiKeyId, @providerId, @upstreamModel,
      @priority, @isEnabled, @createdAt, @updatedAt
    )
    ON CONFLICT(id) DO UPDATE SET
      platform_model_id = excluded.platform_model_id,
      api_key_id = excluded.api_key_id,
      provider_id = excluded.provider_id,
      upstream_model = excluded.upstream_model,
      priority = excluded.priority,
      is_enabled = excluded.is_enabled,
      updated_at = excluded.updated_at
  `).run({
    id,
    platformModelId: route.platformModelId,
    apiKeyId: route.apiKeyId,
    providerId: route.providerId || null,
    upstreamModel: route.upstreamModel || null,
    priority: Number.isFinite(Number(route.priority)) ? Number(route.priority) : 100,
    isEnabled: route.isEnabled === false ? 0 : 1,
    createdAt: route.createdAt || now,
    updatedAt: now,
  });
  return getPlatformModelRoute(id);
}

function deletePlatformModelRoute(id) {
  const result = db.prepare('DELETE FROM platform_model_routes WHERE id = ?').run(id);
  return result.changes > 0;
}

function updateTask(id, updates) {
  const existing = getTask(id);
  if (!existing) return null;
  const next = {
    status: updates.status ?? existing.status,
    outputJson: updates.output !== undefined ? jsonStringify(updates.output) : jsonStringify(existing.output),
    errorJson: updates.error !== undefined ? jsonStringify(updates.error) : jsonStringify(existing.error),
    durationMs: updates.durationMs ?? existing.durationMs,
    updatedAt: new Date().toISOString(),
  };
  db.prepare(`
    UPDATE tasks
    SET status = @status,
        output_json = @outputJson,
        error_json = @errorJson,
        duration_ms = @durationMs,
        updated_at = @updatedAt
    WHERE id = @id
  `).run({ id, ...next });
  return getTask(id);
}

function addTaskLog(taskId, log) {
  const now = new Date().toISOString();
  const id = log.id || require('crypto').randomUUID();
  db.prepare(`
    INSERT INTO task_logs (id, task_id, level, event, message, data_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    taskId,
    log.level || 'info',
    log.event || 'event',
    log.message || null,
    jsonStringify(log.data || {}),
    log.createdAt || now
  );
  return rowToTaskLog(db.prepare('SELECT * FROM task_logs WHERE id = ?').get(id));
}

function listTaskLogs(taskId, limit = 100) {
  return db.prepare(`
    SELECT * FROM task_logs
    WHERE task_id = ?
    ORDER BY created_at ASC
    LIMIT ?
  `).all(taskId, Number(limit || 100)).map(rowToTaskLog);
}

function listQueuedTasks(limit = 10, nodeTypes = []) {
  const normalizedTypes = Array.isArray(nodeTypes)
    ? nodeTypes.map(String).filter(Boolean)
    : [];
  if (normalizedTypes.length === 0) {
    return db.prepare(`
      SELECT * FROM tasks
      WHERE status = 'queued'
      ORDER BY created_at ASC
      LIMIT ?
    `).all(Number(limit || 10)).map(rowToTask);
  }

  const placeholders = normalizedTypes.map(() => '?').join(', ');
  return db.prepare(`
    SELECT * FROM tasks
    WHERE status = 'queued'
      AND node_type IN (${placeholders})
    ORDER BY created_at ASC
    LIMIT ?
  `).all(...normalizedTypes, Number(limit || 10)).map(rowToTask);
}

function countQueuedTasks(nodeTypes = []) {
  const normalizedTypes = Array.isArray(nodeTypes)
    ? nodeTypes.map(String).filter(Boolean)
    : [];
  if (normalizedTypes.length === 0) {
    const row = db.prepare(`
      SELECT COUNT(*) AS count
      FROM tasks
      WHERE status = 'queued'
    `).get();
    return Number(row?.count || 0);
  }

  const placeholders = normalizedTypes.map(() => '?').join(', ');
  const row = db.prepare(`
    SELECT COUNT(*) AS count
    FROM tasks
    WHERE status = 'queued'
      AND node_type IN (${placeholders})
  `).get(...normalizedTypes);
  return Number(row?.count || 0);
}

function claimQueuedTask(id) {
  const now = new Date().toISOString();
  const result = db.prepare(`
    UPDATE tasks
    SET status = 'running',
        updated_at = ?
    WHERE id = ?
      AND status = 'queued'
  `).run(now, id);
  return result.changes > 0 ? getTask(id) : null;
}

function elapsedTaskMs(task) {
  const startedAt = new Date(task?.updatedAt || task?.createdAt || '').getTime();
  return Number.isFinite(startedAt) ? Math.max(0, Date.now() - startedAt) : 0;
}

function addTaskRelationshipId(ids, value) {
  if (value == null || value === '') return;
  if (Array.isArray(value)) {
    for (const item of value) addTaskRelationshipId(ids, item);
    return;
  }
  if (typeof value === 'object') {
    addTaskRelationshipId(ids, value.taskId || value.task_id || value.id);
    return;
  }
  ids.add(String(value));
}

function collectTaskRelationshipIds(value, depth = 0, ids = new Set()) {
  if (!value || typeof value !== 'object' || depth > 4) return ids;
  if (Array.isArray(value)) {
    for (const item of value) collectTaskRelationshipIds(item, depth + 1, ids);
    return ids;
  }

  addTaskRelationshipId(ids, value.upstreamTaskId);
  addTaskRelationshipId(ids, value.upstreamTaskIds);
  addTaskRelationshipId(ids, value.sourceTaskId);
  addTaskRelationshipId(ids, value.parentTaskId);
  addTaskRelationshipId(ids, value.retryOf);
  addTaskRelationshipId(ids, value.upstream);

  for (const key of ['upstreamTasks', 'sourceTasks', 'parentTasks']) {
    collectTaskRelationshipIds(value[key], depth + 1, ids);
  }

  return ids;
}

function interruptedTaskLogData(task) {
  const upstreamTaskIds = [
    ...collectTaskRelationshipIds(task?.input || {}),
    ...collectTaskRelationshipIds(task?.output || {}),
  ];
  return {
    durationMs: elapsedTaskMs(task),
    nodeType: task.nodeType,
    providerId: task.providerId,
    model: task.model,
    ...(upstreamTaskIds.length > 0 ? { upstreamTaskIds: [...new Set(upstreamTaskIds)] } : {}),
  };
}

function markRunningTasksInterrupted(message = 'Task was interrupted by a server restart.', nodeTypes = []) {
  const normalizedTypes = Array.isArray(nodeTypes)
    ? nodeTypes.map(String).filter(Boolean)
    : [];
  const running = normalizedTypes.length > 0
    ? db.prepare(`
      SELECT * FROM tasks
      WHERE status = 'running'
        AND node_type IN (${normalizedTypes.map(() => '?').join(', ')})
    `).all(...normalizedTypes).map(rowToTask)
    : db.prepare(`
      SELECT * FROM tasks
      WHERE status = 'running'
    `).all().map(rowToTask);
  for (const task of running) {
    const logData = interruptedTaskLogData(task);
    updateTask(task.id, {
      status: 'failed',
      error: {
        message,
        recoverable: true,
        ...logData,
      },
      durationMs: task.durationMs ?? logData.durationMs,
    });
    addTaskLog(task.id, {
      level: 'warn',
      event: 'recovered_interrupted_task',
      message,
      data: logData,
    });
  }
  return running.length;
}

function upsertWorkflow(workflow, options = {}) {
  const now = new Date().toISOString();
  const existing = workflow.id ? getWorkflowForUser(workflow.id, workflow.userId || DEFAULT_USER_ID) : null;
  const id = workflow.id || require('crypto').randomUUID();
  const createdAt = existing?.createdAt || workflow.createdAt || now;
  const nodeCount = Number.isInteger(workflow.nodeCount)
    ? workflow.nodeCount
    : Array.isArray(workflow.nodes) ? workflow.nodes.length : 0;

  db.prepare(`
    INSERT INTO workflows (
      id, user_id, name, description, nodes_json, edges_json, metadata_json, node_count, created_at, updated_at
    )
    VALUES (
      @id, @userId, @name, @description, @nodesJson, @edgesJson, @metadataJson, @nodeCount, @createdAt, @updatedAt
    )
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      description = excluded.description,
      nodes_json = excluded.nodes_json,
      edges_json = excluded.edges_json,
      metadata_json = excluded.metadata_json,
      node_count = excluded.node_count,
      updated_at = excluded.updated_at
    WHERE workflows.user_id = excluded.user_id
  `).run({
    id,
    userId: workflow.userId || DEFAULT_USER_ID,
    name: workflow.name || 'Untitled workflow',
    description: workflow.description || null,
    nodesJson: jsonStringify(Array.isArray(workflow.nodes) ? workflow.nodes : []),
    edgesJson: jsonStringify(Array.isArray(workflow.edges) ? workflow.edges : []),
    metadataJson: jsonStringify(workflow.metadata || {}),
    nodeCount,
    createdAt,
    updatedAt: workflow.updatedAt || now,
  });

  const saved = getWorkflowForUser(id, workflow.userId || DEFAULT_USER_ID);
  if (saved && options.createVersion !== false) {
    createWorkflowVersion(saved, {
      source: options.versionSource || workflow.versionSource || (existing ? 'save' : 'create'),
    });
  }
  return saved;
}

function getWorkflowForUser(id, userId = DEFAULT_USER_ID) {
  return rowToWorkflow(db.prepare('SELECT * FROM workflows WHERE id = ? AND user_id = ?').get(id, userId));
}

function workflowListOptions(options = {}) {
  if (typeof options === 'number') {
    return {
      limit: Math.max(1, Math.min(500, Number(options) || 100)),
      offset: 0,
      search: '',
    };
  }

  return {
    limit: Math.max(1, Math.min(500, Number(options.limit || 100) || 100)),
    offset: Math.max(0, Number(options.offset || 0) || 0),
    search: String(options.search || '').trim(),
  };
}

function workflowSearchWhere(search) {
  if (!search) return { clause: '', params: {} };
  return {
    clause: `
      AND (
        lower(id) LIKE @searchLike OR
        lower(name) LIKE @searchLike OR
        lower(COALESCE(description, '')) LIKE @searchLike
      )
    `,
    params: { searchLike: `%${search.toLowerCase()}%` },
  };
}

function listWorkflows(userId = DEFAULT_USER_ID, options = {}) {
  const query = workflowListOptions(options);
  const search = workflowSearchWhere(query.search);
  return db.prepare(`
    SELECT * FROM workflows
    WHERE user_id = @userId
      ${search.clause}
    ORDER BY updated_at DESC, created_at DESC
    LIMIT @limit OFFSET @offset
  `).all({
    userId,
    limit: query.limit,
    offset: query.offset,
    ...search.params,
  }).map(rowToWorkflow);
}

function countWorkflows(userId = DEFAULT_USER_ID, options = {}) {
  const query = workflowListOptions(options);
  const search = workflowSearchWhere(query.search);
  const row = db.prepare(`
    SELECT COUNT(*) AS count
    FROM workflows
    WHERE user_id = @userId
      ${search.clause}
  `).get({
    userId,
    ...search.params,
  });
  return Number(row?.count || 0);
}

function deleteWorkflow(id, userId = DEFAULT_USER_ID) {
  const result = db.prepare('DELETE FROM workflows WHERE id = ? AND user_id = ?').run(id, userId);
  return result.changes > 0;
}

function nextWorkflowVersionNumber(workflowId) {
  const row = db.prepare(`
    SELECT COALESCE(MAX(version_number), 0) + 1 AS next_number
    FROM workflow_versions
    WHERE workflow_id = ?
  `).get(workflowId);
  return Number(row?.next_number || 1);
}

function createWorkflowVersion(workflow, options = {}) {
  const now = options.createdAt || new Date().toISOString();
  const id = options.id || require('crypto').randomUUID();
  const versionNumber = options.versionNumber || nextWorkflowVersionNumber(workflow.id);
  db.prepare(`
    INSERT INTO workflow_versions (
      id, workflow_id, user_id, version_number, name, description, nodes_json, edges_json,
      metadata_json, node_count, source, created_at
    )
    VALUES (
      @id, @workflowId, @userId, @versionNumber, @name, @description, @nodesJson, @edgesJson,
      @metadataJson, @nodeCount, @source, @createdAt
    )
  `).run({
    id,
    workflowId: workflow.id,
    userId: workflow.userId || DEFAULT_USER_ID,
    versionNumber,
    name: workflow.name || 'Untitled workflow',
    description: workflow.description || null,
    nodesJson: jsonStringify(Array.isArray(workflow.nodes) ? workflow.nodes : []),
    edgesJson: jsonStringify(Array.isArray(workflow.edges) ? workflow.edges : []),
    metadataJson: jsonStringify(workflow.metadata || {}),
    nodeCount: Number.isInteger(workflow.nodeCount)
      ? workflow.nodeCount
      : Array.isArray(workflow.nodes) ? workflow.nodes.length : 0,
    source: options.source || 'save',
    createdAt: now,
  });
  return getWorkflowVersionForUser(workflow.id, id, workflow.userId || DEFAULT_USER_ID);
}

function workflowVersionListOptions(options = {}) {
  if (typeof options === 'number') {
    return {
      limit: Math.max(1, Math.min(500, Number(options) || 50)),
      offset: 0,
    };
  }

  return {
    limit: Math.max(1, Math.min(500, Number(options.limit || 50) || 50)),
    offset: Math.max(0, Number(options.offset || 0) || 0),
  };
}

function listWorkflowVersions(workflowId, userId = DEFAULT_USER_ID, options = {}) {
  const query = workflowVersionListOptions(options);
  return db.prepare(`
    SELECT * FROM workflow_versions
    WHERE workflow_id = ?
      AND user_id = ?
    ORDER BY version_number DESC
    LIMIT ? OFFSET ?
  `).all(workflowId, userId, query.limit, query.offset).map(rowToWorkflowVersion);
}

function countWorkflowVersions(workflowId, userId = DEFAULT_USER_ID) {
  const row = db.prepare(`
    SELECT COUNT(*) AS count
    FROM workflow_versions
    WHERE workflow_id = ?
      AND user_id = ?
  `).get(workflowId, userId);
  return Number(row?.count || 0);
}

function getWorkflowVersionForUser(workflowId, versionId, userId = DEFAULT_USER_ID) {
  return rowToWorkflowVersion(db.prepare(`
    SELECT * FROM workflow_versions
    WHERE workflow_id = ?
      AND id = ?
      AND user_id = ?
  `).get(workflowId, versionId, userId));
}

function restoreWorkflowVersion(workflowId, versionId, userId = DEFAULT_USER_ID) {
  const version = getWorkflowVersionForUser(workflowId, versionId, userId);
  if (!version) return null;
  return upsertWorkflow({
    id: workflowId,
    userId,
    name: version.name,
    description: version.description,
    nodes: version.nodes,
    edges: version.edges,
    metadata: {
      ...version.metadata,
      restoredFromVersionId: version.id,
      restoredFromVersionNumber: version.versionNumber,
    },
    nodeCount: version.nodeCount,
    versionSource: 'restore',
  });
}

function insertAsset(asset) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO assets (
      id, user_id, type, storage_driver, url, legacy_url, file_name, file_path, mime,
      prompt, negative_prompt, model, provider_id, width, height, seed, size_bytes, metadata_json,
      created_at, updated_at
    )
    VALUES (
      @id, @userId, @type, @storageDriver, @url, @legacyUrl, @fileName, @filePath, @mime,
      @prompt, @negativePrompt, @model, @providerId, @width, @height, @seed, @sizeBytes, @metadataJson,
      @createdAt, @updatedAt
    )
  `).run({
    id: asset.id,
    userId: asset.userId || DEFAULT_USER_ID,
    type: asset.type,
    storageDriver: asset.storageDriver || 'local-fs',
    url: asset.url,
    legacyUrl: asset.legacyUrl || null,
    fileName: asset.fileName || null,
    filePath: asset.filePath || null,
    mime: asset.mime || null,
    prompt: asset.prompt || null,
    negativePrompt: asset.negativePrompt || null,
    model: asset.model || null,
    providerId: asset.providerId || null,
    width: asset.width || null,
    height: asset.height || null,
    seed: asset.seed || null,
    sizeBytes: Number.isFinite(Number(asset.sizeBytes)) ? Number(asset.sizeBytes) : null,
    metadataJson: jsonStringify(asset.metadata || {}),
    createdAt: asset.createdAt || now,
    updatedAt: asset.updatedAt || now,
  });
  return getAsset(asset.id);
}

function linkTaskAsset(taskId, assetId) {
  db.prepare(`
    INSERT INTO task_outputs (id, task_id, asset_id, created_at)
    VALUES (?, ?, ?, ?)
  `).run(require('crypto').randomUUID(), taskId, assetId, new Date().toISOString());
}

function getAsset(id) {
  return rowToAsset(db.prepare('SELECT * FROM assets WHERE id = ?').get(id));
}

function getAssetForUser(id, userId = DEFAULT_USER_ID) {
  return rowToAsset(db.prepare('SELECT * FROM assets WHERE id = ? AND user_id = ?').get(id, userId));
}

function normalizeListAssetsOptions(options = 100) {
  if (typeof options === 'number') {
    return {
      limit: clampNumber(options, 100, 1, 500),
      offset: 0,
    };
  }

  return {
    limit: clampNumber(options.limit, 100, 1, 500),
    offset: clampNumber(options.offset, 0, 0, 100_000),
  };
}

function listAssets(userId = DEFAULT_USER_ID, options = 100) {
  const query = normalizeListAssetsOptions(options);
  return db.prepare(`
    SELECT * FROM assets
    WHERE user_id = ?
    ORDER BY created_at DESC, id DESC
    LIMIT ?
    OFFSET ?
  `).all(userId, query.limit, query.offset).map(rowToAsset);
}

function createAssetCollection(collection) {
  const now = new Date().toISOString();
  const id = collection.id || require('crypto').randomUUID();
  db.prepare(`
    INSERT INTO asset_collections (
      id, user_id, name, description, category, cover_asset_id, metadata_json, created_at, updated_at
    )
    VALUES (
      @id, @userId, @name, @description, @category, @coverAssetId, @metadataJson, @createdAt, @updatedAt
    )
  `).run({
    id,
    userId: collection.userId || DEFAULT_USER_ID,
    name: collection.name,
    description: collection.description || null,
    category: collection.category || 'general',
    coverAssetId: collection.coverAssetId || null,
    metadataJson: jsonStringify(collection.metadata || {}),
    createdAt: collection.createdAt || now,
    updatedAt: collection.updatedAt || now,
  });
  return getAssetCollection(id);
}

function updateAssetCollection(id, userId = DEFAULT_USER_ID, updates = {}) {
  const existing = getAssetCollection(id);
  if (!existing || existing.userId !== userId) return null;
  const hasCoverAssetId = Object.prototype.hasOwnProperty.call(updates, 'coverAssetId');
  const next = {
    id,
    name: updates.name ?? existing.name,
    description: updates.description ?? existing.description,
    category: updates.category ?? existing.category,
    coverAssetId: hasCoverAssetId ? updates.coverAssetId || null : existing.coverAssetId,
    metadataJson: updates.metadata !== undefined ? jsonStringify(updates.metadata) : jsonStringify(existing.metadata),
    updatedAt: new Date().toISOString(),
  };
  db.prepare(`
    UPDATE asset_collections
    SET name = @name,
        description = @description,
        category = @category,
        cover_asset_id = @coverAssetId,
        metadata_json = @metadataJson,
        updated_at = @updatedAt
    WHERE id = @id
  `).run(next);
  return getAssetCollection(id);
}

function deleteAssetCollection(id, userId = DEFAULT_USER_ID) {
  const result = db.prepare('DELETE FROM asset_collections WHERE id = ? AND user_id = ?').run(id, userId);
  return result.changes > 0;
}

function getAssetCollection(id) {
  return rowToAssetCollection(db.prepare('SELECT * FROM asset_collections WHERE id = ?').get(id));
}

function getAssetCollectionForUser(id, userId = DEFAULT_USER_ID) {
  return rowToAssetCollection(db.prepare('SELECT * FROM asset_collections WHERE id = ? AND user_id = ?').get(id, userId));
}

function normalizeListAssetCollectionQuery(options = {}) {
  return {
    limit: Math.max(1, Math.min(500, Number(options.limit || 100) || 100)),
    offset: Math.max(0, Math.min(100_000, Number(options.offset || 0) || 0)),
    search: String(options.search || '').trim().toLowerCase(),
  };
}

function assetCollectionSearchWhere(query) {
  if (!query.search) {
    return {
      clause: 'WHERE user_id = @userId',
      params: { userId: query.userId },
    };
  }
  return {
    clause: `
      WHERE user_id = @userId
        AND (
          LOWER(name) LIKE @search ESCAPE '\\'
          OR LOWER(category) LIKE @search ESCAPE '\\'
          OR LOWER(COALESCE(description, '')) LIKE @search ESCAPE '\\'
          OR LOWER(COALESCE(metadata_json, '')) LIKE @search ESCAPE '\\'
          OR EXISTS (
            SELECT 1
            FROM asset_collection_items
            JOIN assets ON assets.id = asset_collection_items.asset_id
            WHERE asset_collection_items.collection_id = asset_collections.id
              AND assets.user_id = asset_collections.user_id
              AND (
                LOWER(COALESCE(asset_collection_items.role, '')) LIKE @search ESCAPE '\\'
                OR LOWER(COALESCE(asset_collection_items.note, '')) LIKE @search ESCAPE '\\'
                OR LOWER(COALESCE(assets.file_name, '')) LIKE @search ESCAPE '\\'
                OR LOWER(COALESCE(assets.prompt, '')) LIKE @search ESCAPE '\\'
                OR LOWER(COALESCE(assets.model, '')) LIKE @search ESCAPE '\\'
                OR LOWER(COALESCE(assets.provider_id, '')) LIKE @search ESCAPE '\\'
                OR LOWER(COALESCE(assets.type, '')) LIKE @search ESCAPE '\\'
                OR LOWER(COALESCE(assets.url, '')) LIKE @search ESCAPE '\\'
              )
          )
        )
    `,
    params: { userId: query.userId, search: `%${escapeLike(query.search)}%` },
  };
}

function countAssetCollections(userId = DEFAULT_USER_ID, options = {}) {
  const query = normalizeListAssetCollectionQuery(options);
  const where = assetCollectionSearchWhere({ ...query, userId });
  const row = db.prepare(`
    SELECT COUNT(*) AS count
    FROM asset_collections
    ${where.clause}
  `).get(where.params);
  return row?.count || 0;
}

function listAssetCollections(userId = DEFAULT_USER_ID, options = {}) {
  const query = normalizeListAssetCollectionQuery(options);
  const where = assetCollectionSearchWhere({ ...query, userId });
  return db.prepare(`
    SELECT * FROM asset_collections
    ${where.clause}
    ORDER BY updated_at DESC, created_at DESC
    LIMIT @limit
    OFFSET @offset
  `).all({
    ...where.params,
    limit: query.limit,
    offset: query.offset,
  }).map(rowToAssetCollection);
}

function addAssetToCollection({ collectionId, assetId, userId = DEFAULT_USER_ID, role = '', note = '' }) {
  const collection = getAssetCollection(collectionId);
  const asset = getAsset(assetId);
  if (!collection || collection.userId !== userId || !asset || asset.userId !== userId) return null;

  const now = new Date().toISOString();
  const sortOrder = db.prepare(`
    SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order
    FROM asset_collection_items
    WHERE collection_id = ?
  `).get(collectionId).next_order;

  db.prepare(`
    INSERT INTO asset_collection_items (
      id, collection_id, asset_id, role, note, sort_order, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(collection_id, asset_id) DO UPDATE SET
      role = excluded.role,
      note = excluded.note,
      updated_at = excluded.updated_at
  `).run(require('crypto').randomUUID(), collectionId, assetId, role || null, note || null, sortOrder, now, now);

  if (!collection.coverAssetId && asset.type === 'image') {
    updateAssetCollection(collectionId, userId, { coverAssetId: assetId });
  } else {
    updateAssetCollection(collectionId, userId, {});
  }

  return getAssetCollection(collectionId);
}

function removeAssetFromCollection(collectionId, assetId, userId = DEFAULT_USER_ID) {
  const collection = getAssetCollection(collectionId);
  if (!collection || collection.userId !== userId) return false;
  const result = db.prepare(`
    DELETE FROM asset_collection_items
    WHERE collection_id = ? AND asset_id = ?
  `).run(collectionId, assetId);
  return result.changes > 0;
}

function listCollectionAssets(collectionId, userId = DEFAULT_USER_ID) {
  const collection = getAssetCollection(collectionId);
  if (!collection || collection.userId !== userId) return [];
  return db.prepare(`
    SELECT assets.*, asset_collection_items.role AS library_role, asset_collection_items.note AS library_note,
      asset_collection_items.sort_order AS library_sort_order
    FROM asset_collection_items
    JOIN assets ON assets.id = asset_collection_items.asset_id
    WHERE asset_collection_items.collection_id = ?
    ORDER BY asset_collection_items.sort_order ASC, asset_collection_items.created_at ASC
  `).all(collectionId).map((row) => ({
    ...rowToAsset(row),
    libraryRole: row.library_role,
    libraryNote: row.library_note,
    librarySortOrder: row.library_sort_order,
  }));
}

function reorderCollectionAssets({ collectionId, userId = DEFAULT_USER_ID, assetIds = [] }) {
  const collection = getAssetCollection(collectionId);
  if (!collection || collection.userId !== userId) return null;

  const currentAssets = listCollectionAssets(collectionId, userId);
  const currentIds = currentAssets.map((asset) => asset.id);
  const currentIdSet = new Set(currentIds);
  const requestedIds = [...new Set(assetIds.map((assetId) => String(assetId || '').trim()).filter(Boolean))];
  const orderedRequestedIds = requestedIds.filter((assetId) => currentIdSet.has(assetId));
  const orderedIds = [
    ...orderedRequestedIds,
    ...currentIds.filter((assetId) => !orderedRequestedIds.includes(assetId)),
  ];
  const now = new Date().toISOString();

  const updateOrder = db.transaction((ids) => {
    ids.forEach((assetId, index) => {
      db.prepare(`
        UPDATE asset_collection_items
        SET sort_order = ?,
            updated_at = ?
        WHERE collection_id = ?
          AND asset_id = ?
      `).run(index + 1, now, collectionId, assetId);
    });
  });
  updateOrder(orderedIds);
  updateAssetCollection(collectionId, userId, {});

  return {
    collection: getAssetCollection(collectionId),
    reordered: orderedRequestedIds.length,
    skipped: requestedIds.length - orderedRequestedIds.length,
  };
}

function listTaskAssets(taskId, userId = null) {
  const userFilter = userId ? 'AND assets.user_id = ?' : '';
  const params = userId ? [taskId, userId] : [taskId];
  return db.prepare(`
    SELECT assets.*
    FROM task_outputs
    JOIN assets ON assets.id = task_outputs.asset_id
    WHERE task_outputs.task_id = ?
      ${userFilter}
    ORDER BY task_outputs.created_at ASC
  `).all(...params).map(rowToAsset);
}

function getTask(id) {
  return rowToTask(db.prepare('SELECT * FROM tasks WHERE id = ?').get(id));
}

function getTaskForUser(id, userId = DEFAULT_USER_ID) {
  return rowToTask(db.prepare('SELECT * FROM tasks WHERE id = ? AND user_id = ?').get(id, userId));
}

function normalizeListTasksOptions(options = 100) {
  if (typeof options === 'number') {
    return {
      limit: clampNumber(options, 100, 1, 500),
      offset: 0,
    };
  }

  return {
    limit: clampNumber(options.limit, 100, 1, 500),
    offset: clampNumber(options.offset, 0, 0, 100_000),
  };
}

function listTasks(userId = DEFAULT_USER_ID, options = 100) {
  const query = normalizeListTasksOptions(options);
  return db.prepare(`
    SELECT * FROM tasks
    WHERE user_id = ?
    ORDER BY created_at DESC, id DESC
    LIMIT ?
    OFFSET ?
  `).all(userId, query.limit, query.offset).map(rowToTask);
}

function countTasks(userId = DEFAULT_USER_ID) {
  return db.prepare('SELECT COUNT(*) AS count FROM tasks WHERE user_id = ?').get(userId).count;
}

function countAssets(userId = DEFAULT_USER_ID) {
  return db.prepare('SELECT COUNT(*) AS count FROM assets WHERE user_id = ?').get(userId).count;
}

function countAllTasks() {
  return db.prepare('SELECT COUNT(*) AS count FROM tasks').get().count;
}

function countAllAssets() {
  return db.prepare('SELECT COUNT(*) AS count FROM assets').get().count;
}

function countAllUsers() {
  return db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
}

function countEnabledUsers() {
  return db.prepare('SELECT COUNT(*) AS count FROM users WHERE is_enabled = 1').get().count;
}

function sumAssetBytes(userId = DEFAULT_USER_ID, filters = {}) {
  const conditions = ['user_id = ?'];
  const params = [userId];

  if (filters.providerId) {
    conditions.push('provider_id = ?');
    params.push(filters.providerId);
  }

  if (filters.since) {
    conditions.push('created_at >= ?');
    params.push(filters.since);
  }

  const row = db.prepare(`
    SELECT COALESCE(SUM(COALESCE(size_bytes, 0)), 0) AS total
    FROM assets
    WHERE ${conditions.join(' AND ')}
  `).get(...params);

  return Number(row?.total || 0);
}

function upsertModelCapability(providerId, modelPattern, capabilities) {
  const id = `${providerId}:${modelPattern}`;
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO model_capabilities (id, provider_id, model_pattern, capabilities_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      capabilities_json = excluded.capabilities_json,
      updated_at = excluded.updated_at
  `).run(id, providerId, modelPattern, JSON.stringify(capabilities), now, now);
}

function modelCapabilityListOptions(options = {}) {
  const hasPagination = options.limit !== undefined || options.offset !== undefined;
  return {
    limit: hasPagination ? Math.max(1, Math.min(500, Number(options.limit || 500) || 500)) : null,
    offset: Math.max(0, Number(options.offset || 0) || 0),
    search: String(options.search || options.q || '').trim().toLowerCase(),
    providerId: String(options.providerId || '').trim(),
  };
}

function modelCapabilityWhereClause(options = {}) {
  const query = modelCapabilityListOptions(options);
  const conditions = ['1 = 1'];
  const params = [];

  if (query.search) {
    conditions.push('(LOWER(provider_id) LIKE ? OR LOWER(model_pattern) LIKE ?)');
    const like = `%${query.search}%`;
    params.push(like, like);
  }
  if (query.providerId) {
    conditions.push('provider_id = ?');
    params.push(query.providerId);
  }

  return {
    clause: conditions.join(' AND '),
    params,
    query,
  };
}

function listModelCapabilities(options = {}) {
  const { clause, params, query } = modelCapabilityWhereClause(options);
  const limitClause = query.limit ? 'LIMIT ? OFFSET ?' : '';
  const limitParams = query.limit ? [query.limit, query.offset] : [];
  return db.prepare(`
    SELECT * FROM model_capabilities
    WHERE ${clause}
    ORDER BY provider_id, model_pattern
    ${limitClause}
  `)
    .all(...params, ...limitParams)
    .map((row) => ({
      id: row.id,
      providerId: row.provider_id,
      modelPattern: row.model_pattern,
      capabilities: jsonParse(row.capabilities_json, {}),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
}

function countModelCapabilities(options = {}) {
  const { clause, params } = modelCapabilityWhereClause(options);
  const row = db.prepare(`
    SELECT COUNT(*) AS count
    FROM model_capabilities
    WHERE ${clause}
  `).get(...params);
  return Number(row?.count || 0);
}

migrate();
ensureDefaultUser();
ensureCreditAccountsForExistingUsers();

module.exports = {
  DEFAULT_USER_ID,
  DB_PATH,
  addTaskLog,
  claimQueuedTask,
  db,
  createSession,
  createTask,
  createEmailVerification,
  createUser,
  consumeEmailVerification,
  consumeInvitationCode,
  createAuditLog,
  createInvitationCode,
  countApiKeys,
  countAuditLogs,
  countInvitationCodes,
  countModelCapabilities,
  countPlatformModels,
  countWorkflowVersions,
  countWorkflows,
  countUsers,
  deleteExpiredSessions,
  deleteSessionByTokenHash,
  deleteSessionForUser,
  deleteSessionsForUser,
  disableInvitationCode,
  getEmailVerification,
  getInvitationCode,
  getInvitationCodeByHash,
  getLatestEmailVerification,
  getSessionByTokenHash,
  getTask,
  getTaskForUser,
  getWorkflowForUser,
  getUser,
  getUserByEmail,
  getUserByUsername,
  listUsers,
  listAuditLogs,
  listInvitationCodes,
  listSessionsForUser,
  incrementEmailVerificationAttempts,
  updateUserPassword,
  updateUserStatus,
  updateTask,
  upsertWorkflow,
  createWorkflowVersion,
  deleteWorkflow,
  deletePlatformModel,
  deletePlatformModelRoute,
  getWorkflowVersionForUser,
  getPlatformModel,
  getPlatformModelRoute,
  listWorkflowVersions,
  restoreWorkflowVersion,
  listTasks,
  listQueuedTasks,
  countQueuedTasks,
  listTaskLogs,
  listWorkflows,
  listTaskAssets,
  markRunningTasksInterrupted,
  countTasks,
  countAssets,
  countAssetCollections,
  countAllTasks,
  countAllAssets,
  countAllUsers,
  countEnabledUsers,
  sumAssetBytes,
  createAssetCollection,
  updateAssetCollection,
  deleteAssetCollection,
  getAssetCollection,
  getAssetCollectionForUser,
  listAssetCollections,
  addAssetToCollection,
  removeAssetFromCollection,
  listCollectionAssets,
  reorderCollectionAssets,
  insertAsset,
  getAsset,
  getAssetForUser,
  listAssets,
  linkTaskAsset,
  upsertModelCapability,
  listModelCapabilities,
  listPlatformModels,
  listPlatformModelRoutes,
  upsertApiKey,
  getApiKey,
  getApiKeyForUser,
  listApiKeys,
  deleteApiKey,
  upsertPlatformModel,
  upsertPlatformModelRoute,
  upsertBootstrapUser,
};
