import { randomUUID } from 'node:crypto';

/**
 * TEST-ONLY MOCK REPOSITORY (BASE SIMULADA EXCLUSIVAMENTE PARA PRUEBAS UNITARIAS)
 * No se utiliza en producción ni en desarrollo del servidor; la persistencia real
 * siempre usa PostgreSQL (backend/src/repositories/*.js).
 */
export function createInMemoryTestStore() {
  const users = new Map();
  const sessions = new Map();
  const entries = new Map();
  const resetTokens = new Map();
  const auditLogs = [];
  const rateLimits = new Map();

  // Simula serialización transaccional (equivalente a SELECT ... FOR UPDATE / advisory lock).
  let txChain = Promise.resolve();
  function withTx(workFn) {
    const next = txChain.then(() => workFn({ __mockTx: true }));
    txChain = next.catch(() => {});
    return next;
  }

  const usersRepo = {
    async findByEmail(email) {
      for (const u of users.values()) {
        if (u.email === email) return { ...u };
      }
      return null;
    },
    async findById(id) {
      const u = users.get(id);
      return u ? { ...u } : null;
    },
    async findByIdForUpdate(id) {
      const u = users.get(id);
      return u ? { ...u } : null;
    },
    async lockUsersForUpdate(ids) {
      const uniqueSorted = [...new Set(ids)].sort();
      return uniqueSorted.map((id) => users.get(id)).filter(Boolean).map((u) => ({ ...u }));
    },
    async acquireRoleMutationLock() {
      // Ya serializado por txChain en el repositorio simulado.
    },
    async lockRowForUpdate(id) {
      return users.has(id) ? { id } : null;
    },
    async create({ id, name, email, passwordHash, role = 'user' }) {
      const now = new Date();
      const row = {
        id,
        name,
        email,
        password_hash: passwordHash,
        role,
        auth_version: 1,
        phone_ciphertext: null,
        phone_iv: null,
        phone_tag: null,
        phone_key_version: null,
        sensitive_note_ciphertext: null,
        sensitive_note_iv: null,
        sensitive_note_tag: null,
        sensitive_note_key_version: null,
        failed_login_attempts: 0,
        locked_until: null,
        created_at: now,
        updated_at: now,
      };
      users.set(id, row);
      return { ...row };
    },
    async updateProfile({ id, name, phoneCrypto, sensitiveNoteCrypto }) {
      const u = users.get(id);
      if (!u) return null;
      u.name = name;
      u.phone_ciphertext = phoneCrypto ? phoneCrypto.ciphertext : null;
      u.phone_iv = phoneCrypto ? phoneCrypto.iv : null;
      u.phone_tag = phoneCrypto ? phoneCrypto.tag : null;
      u.phone_key_version = phoneCrypto ? phoneCrypto.keyVersion : null;
      u.sensitive_note_ciphertext = sensitiveNoteCrypto ? sensitiveNoteCrypto.ciphertext : null;
      u.sensitive_note_iv = sensitiveNoteCrypto ? sensitiveNoteCrypto.iv : null;
      u.sensitive_note_tag = sensitiveNoteCrypto ? sensitiveNoteCrypto.tag : null;
      u.sensitive_note_key_version = sensitiveNoteCrypto ? sensitiveNoteCrypto.keyVersion : null;
      u.updated_at = new Date();
      return { ...u };
    },
    async updatePassword(id, passwordHash) {
      const u = users.get(id);
      if (!u) return null;
      u.password_hash = passwordHash;
      u.auth_version += 1;
      u.failed_login_attempts = 0;
      u.locked_until = null;
      u.updated_at = new Date();
      return { id: u.id, auth_version: u.auth_version };
    },
    async incrementFailedLogin(id, { maxAttempts, lockoutBaseSeconds }) {
      const u = users.get(id);
      if (!u) return null;
      u.failed_login_attempts += 1;
      if (u.failed_login_attempts >= maxAttempts) {
        const exponent = Math.min(u.failed_login_attempts - maxAttempts, 6);
        const seconds = Math.min(lockoutBaseSeconds * 2 ** exponent, 3600);
        const candidate = Date.now() + seconds * 1000;
        const current = u.locked_until ? new Date(u.locked_until).getTime() : 0;
        u.locked_until = new Date(Math.max(current, candidate));
      }
      u.updated_at = new Date();
      return { failed_login_attempts: u.failed_login_attempts, locked_until: u.locked_until };
    },
    async resetLoginFailures(id) {
      const u = users.get(id);
      if (!u) return;
      u.failed_login_attempts = 0;
      u.locked_until = null;
    },
    async listAllForAdmin() {
      return Array.from(users.values()).map((u) => ({ ...u }));
    },
    async countAdmins() {
      let c = 0;
      for (const u of users.values()) if (u.role === 'admin') c += 1;
      return c;
    },
    async updateRole(id, role) {
      const u = users.get(id);
      if (!u) return null;
      u.role = role;
      u.auth_version += 1;
      u.updated_at = new Date();
      return {
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        auth_version: u.auth_version,
        created_at: u.created_at,
        updated_at: u.updated_at,
      };
    },
  };

  const sessionsRepo = {
    async create({ idHash, userId, csrfToken, ipAddress, userAgent, expiresAt, absoluteExpiresAt }) {
      const row = {
        id_hash: idHash,
        user_id: userId,
        csrf_token: csrfToken,
        ip_address: ipAddress,
        user_agent: userAgent,
        expires_at: expiresAt,
        absolute_expires_at: absoluteExpiresAt,
        created_at: new Date(),
        last_seen_at: new Date(),
      };
      sessions.set(idHash, row);
      return row;
    },
    async findActiveByIdHash(idHash) {
      const s = sessions.get(idHash);
      if (!s) return null;
      const now = Date.now();
      if (new Date(s.expires_at).getTime() <= now || new Date(s.absolute_expires_at).getTime() <= now) {
        return null;
      }
      const u = users.get(s.user_id);
      if (!u) return null;
      return { ...s, name: u.name, email: u.email, role: u.role };
    },
    async touch(idHash, newExpiresAt) {
      const s = sessions.get(idHash);
      if (!s) return;
      s.last_seen_at = new Date();
      s.expires_at = new Date(Math.min(newExpiresAt.getTime(), new Date(s.absolute_expires_at).getTime()));
    },
    async deleteByIdHash(idHash) {
      sessions.delete(idHash);
    },
    async deleteAllForUser(userId) {
      for (const [k, s] of sessions.entries()) {
        if (s.user_id === userId) sessions.delete(k);
      }
    },
  };

  const diaryRepo = {
    async countByOwner(ownerId) {
      let c = 0;
      for (const e of entries.values()) if (e.owner_id === ownerId) c += 1;
      return c;
    },
    async listByOwner(ownerId, { category, mood } = {}) {
      return Array.from(entries.values())
        .filter((e) => e.owner_id === ownerId && (!category || e.category === category) && (!mood || e.mood === mood))
        .sort((a, b) => b.entry_date.localeCompare(a.entry_date) || b.updated_at - a.updated_at)
        .map((e) => ({ ...e }));
    },
    async findByIdAndOwner(id, ownerId) {
      const e = entries.get(id);
      if (!e || e.owner_id !== ownerId) return null;
      return { ...e };
    },
    async create({ id, ownerId, entryDate, category, mood, titleCrypto, contentCrypto, keyVersion }) {
      const now = new Date();
      const row = {
        id,
        owner_id: ownerId,
        entry_date: entryDate,
        category,
        mood,
        title_ciphertext: titleCrypto.ciphertext,
        title_iv: titleCrypto.iv,
        title_tag: titleCrypto.tag,
        content_ciphertext: contentCrypto.ciphertext,
        content_iv: contentCrypto.iv,
        content_tag: contentCrypto.tag,
        key_version: keyVersion,
        version: 1,
        created_at: now,
        updated_at: now,
      };
      entries.set(id, row);
      return { ...row };
    },
    async updateWithVersion({ id, ownerId, expectedVersion, entryDate, category, mood, titleCrypto, contentCrypto, keyVersion }) {
      const e = entries.get(id);
      if (!e || e.owner_id !== ownerId || e.version !== expectedVersion) return null;
      e.entry_date = entryDate;
      e.category = category;
      e.mood = mood;
      e.title_ciphertext = titleCrypto.ciphertext;
      e.title_iv = titleCrypto.iv;
      e.title_tag = titleCrypto.tag;
      e.content_ciphertext = contentCrypto.ciphertext;
      e.content_iv = contentCrypto.iv;
      e.content_tag = contentCrypto.tag;
      e.key_version = keyVersion;
      e.version += 1;
      e.updated_at = new Date();
      return { ...e };
    },
    async deleteByIdAndOwner(id, ownerId) {
      const e = entries.get(id);
      if (!e || e.owner_id !== ownerId) return false;
      entries.delete(id);
      return true;
    },
  };

  const passwordResetRepo = {
    async create({ id, userId, tokenHash, expiresAt }) {
      resetTokens.set(tokenHash, {
        id,
        user_id: userId,
        token_hash: tokenHash,
        expires_at: expiresAt,
        consumed_at: null,
      });
    },
    async invalidateAllForUser(userId) {
      for (const t of resetTokens.values()) {
        if (t.user_id === userId && !t.consumed_at) t.consumed_at = new Date();
      }
    },
    async invalidateById(id) {
      for (const t of resetTokens.values()) {
        if (t.id === id && !t.consumed_at) t.consumed_at = new Date();
      }
    },
    async findActiveUserIdByHash(tokenHash) {
      const t = resetTokens.get(tokenHash);
      if (!t || t.consumed_at || new Date(t.expires_at).getTime() <= Date.now()) {
        return null;
      }
      return t.user_id;
    },
    async consumeAtomic(tokenHash) {
      const t = resetTokens.get(tokenHash);
      if (!t || t.consumed_at || new Date(t.expires_at).getTime() <= Date.now()) {
        return null;
      }
      t.consumed_at = new Date();
      return { id: t.id, user_id: t.user_id };
    },
  };

  const auditRepo = {
    async insert({ eventType, severity = 'info', actorUserId = null, targetUserId = null, ipAddress = null, requestPath = null, details = {} }) {
      const row = {
        id: randomUUID(),
        event_type: eventType,
        severity,
        actor_user_id: actorUserId,
        target_user_id: targetUserId,
        ip_address: ipAddress,
        request_path: requestPath ? String(requestPath).split('?')[0].slice(0, 200) : null,
        details,
        created_at: new Date(),
      };
      auditLogs.unshift(row);
      return row;
    },
    async listRecent(limit = 100) {
      return auditLogs.slice(0, limit).map((l) => ({
        ...l,
        actor_email: l.actor_user_id ? users.get(l.actor_user_id)?.email || null : null,
        target_email: l.target_user_id ? users.get(l.target_user_id)?.email || null : null,
      }));
    },
    async countRecentFailedLogins({ ipAddress, targetUserId, windowMinutes = 15 }) {
      const cutoff = Date.now() - windowMinutes * 60 * 1000;
      return auditLogs.filter(
        (l) =>
          l.event_type === 'login_failed' &&
          l.created_at.getTime() >= cutoff &&
          (targetUserId ? l.target_user_id === targetUserId : l.ip_address === (ipAddress || 'unknown'))
      ).length;
    },
  };

  const rateLimitRepo = {
    async consumeHit(bucketKey, windowMs) {
      const now = Date.now();
      const existing = rateLimits.get(bucketKey);
      if (!existing || existing.windowResetAt.getTime() <= now) {
        const next = { hitCount: 1, windowResetAt: new Date(now + windowMs) };
        rateLimits.set(bucketKey, next);
        return next;
      }
      existing.hitCount += 1;
      return { ...existing };
    },
  };

  return {
    raw: { users, sessions, entries, resetTokens, auditLogs, rateLimits },
    withTx,
    repositories: {
      usersRepo,
      sessionsRepo,
      diaryRepo,
      passwordResetRepo,
      auditRepo,
      rateLimitRepo,
    },
  };
}
