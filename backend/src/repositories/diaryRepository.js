export function createDiaryRepository(pool) {
  function exec(client) {
    return client || pool;
  }

  return Object.freeze({
    async countByOwner(ownerId, client) {
      const { rows } = await exec(client).query(
        `SELECT COUNT(*)::int AS total FROM diary_entries WHERE owner_id = $1`,
        [ownerId]
      );
      return rows[0].total;
    },

    async listByOwner(ownerId, { category, mood } = {}, client) {
      const conditions = ['owner_id = $1'];
      const params = [ownerId];

      if (category) {
        params.push(category);
        conditions.push(`category = $${params.length}`);
      }
      if (mood) {
        params.push(mood);
        conditions.push(`mood = $${params.length}`);
      }

      const { rows } = await exec(client).query(
        `SELECT id, owner_id, to_char(entry_date, 'YYYY-MM-DD') AS entry_date,
                category, mood,
                title_ciphertext, title_iv, title_tag,
                content_ciphertext, content_iv, content_tag,
                key_version, version, created_at, updated_at
         FROM diary_entries
         WHERE ${conditions.join(' AND ')}
         ORDER BY entry_date DESC, updated_at DESC`,
        params
      );
      return rows;
    },

    async findByIdAndOwner(id, ownerId, client) {
      const { rows } = await exec(client).query(
        `SELECT id, owner_id, to_char(entry_date, 'YYYY-MM-DD') AS entry_date,
                category, mood,
                title_ciphertext, title_iv, title_tag,
                content_ciphertext, content_iv, content_tag,
                key_version, version, created_at, updated_at
         FROM diary_entries
         WHERE id = $1 AND owner_id = $2`,
        [id, ownerId]
      );
      return rows[0] || null;
    },

    async create(
      { id, ownerId, entryDate, category, mood, titleCrypto, contentCrypto, keyVersion },
      client
    ) {
      const { rows } = await exec(client).query(
        `INSERT INTO diary_entries (
           id, owner_id, entry_date, category, mood,
           title_ciphertext, title_iv, title_tag,
           content_ciphertext, content_iv, content_tag,
           key_version, version
         )
         VALUES ($1, $2, $3::date, $4, $5, $6, $7, $8, $9, $10, $11, $12, 1)
         RETURNING id, owner_id, to_char(entry_date, 'YYYY-MM-DD') AS entry_date,
                   category, mood,
                   title_ciphertext, title_iv, title_tag,
                   content_ciphertext, content_iv, content_tag,
                   key_version, version, created_at, updated_at`,
        [
          id,
          ownerId,
          entryDate,
          category,
          mood,
          titleCrypto.ciphertext,
          titleCrypto.iv,
          titleCrypto.tag,
          contentCrypto.ciphertext,
          contentCrypto.iv,
          contentCrypto.tag,
          keyVersion,
        ]
      );
      return rows[0];
    },

    async updateWithVersion(
      { id, ownerId, expectedVersion, entryDate, category, mood, titleCrypto, contentCrypto, keyVersion },
      client
    ) {
      const { rows } = await exec(client).query(
        `UPDATE diary_entries
         SET entry_date = $4::date,
             category = $5,
             mood = $6,
             title_ciphertext = $7,
             title_iv = $8,
             title_tag = $9,
             content_ciphertext = $10,
             content_iv = $11,
             content_tag = $12,
             key_version = $13,
             version = version + 1,
             updated_at = NOW()
         WHERE id = $1 AND owner_id = $2 AND version = $3
         RETURNING id, owner_id, to_char(entry_date, 'YYYY-MM-DD') AS entry_date,
                   category, mood,
                   title_ciphertext, title_iv, title_tag,
                   content_ciphertext, content_iv, content_tag,
                   key_version, version, created_at, updated_at`,
        [
          id,
          ownerId,
          expectedVersion,
          entryDate,
          category,
          mood,
          titleCrypto.ciphertext,
          titleCrypto.iv,
          titleCrypto.tag,
          contentCrypto.ciphertext,
          contentCrypto.iv,
          contentCrypto.tag,
          keyVersion,
        ]
      );
      return rows[0] || null;
    },

    async deleteByIdAndOwner(id, ownerId, client) {
      const { rowCount } = await exec(client).query(
        `DELETE FROM diary_entries WHERE id = $1 AND owner_id = $2`,
        [id, ownerId]
      );
      return rowCount > 0;
    },

    async listWithOutdatedKeyVersion(activeKeyVersion, client) {
      const { rows } = await exec(client).query(
        `SELECT id, owner_id,
                title_ciphertext, title_iv, title_tag,
                content_ciphertext, content_iv, content_tag,
                key_version
         FROM diary_entries
         WHERE key_version <> $1`,
        [activeKeyVersion]
      );
      return rows;
    },

    async updateReencryptedEntry({ id, ownerId, titleCrypto, contentCrypto, keyVersion }, client) {
      await exec(client).query(
        `UPDATE diary_entries
         SET title_ciphertext = $3,
             title_iv = $4,
             title_tag = $5,
             content_ciphertext = $6,
             content_iv = $7,
             content_tag = $8,
             key_version = $9,
             updated_at = NOW()
         WHERE id = $1 AND owner_id = $2`,
        [
          id,
          ownerId,
          titleCrypto.ciphertext,
          titleCrypto.iv,
          titleCrypto.tag,
          contentCrypto.ciphertext,
          contentCrypto.iv,
          contentCrypto.tag,
          keyVersion,
        ]
      );
    },
  });
}
