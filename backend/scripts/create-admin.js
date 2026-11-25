import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../src/config/env.js';
import { createDbPool, withTransaction } from '../src/db/pool.js';
import { hashPassword } from '../src/security/password.js';
import { emailSchema, passwordSchema } from '../src/validators/schemas.js';
import { createUsersRepository } from '../src/repositories/usersRepository.js';
import { createAuditRepository } from '../src/repositories/auditRepository.js';

async function main() {
  const config = loadConfig();
  const pool = createDbPool(config);
  const usersRepo = createUsersRepository(pool);
  const auditRepo = createAuditRepository(pool);

  const rl = readline.createInterface({ input, output });
  try {
    const rawName = (process.env.ADMIN_NAME || (await rl.question('Nombre del administrador: '))).trim();
    const rawEmail = (process.env.ADMIN_EMAIL || (await rl.question('Correo del administrador: '))).trim();
    const rawPassword =
      process.env.ADMIN_PASSWORD ||
      (await rl.question('Contraseña del administrador (mín. 12 caracteres, mayúscula, minúscula, número y símbolo): '));

    if (rawName.length < 2 || rawName.length > 120) {
      throw new Error('El nombre debe tener entre 2 y 120 caracteres.');
    }

    const emailParsed = emailSchema.safeParse(rawEmail);
    if (!emailParsed.success) {
      throw new Error(emailParsed.error.issues[0].message);
    }

    const passwordParsed = passwordSchema.safeParse(rawPassword);
    if (!passwordParsed.success) {
      throw new Error(passwordParsed.error.issues.map((i) => i.message).join(' '));
    }

    const email = emailParsed.data;
    const existing = await usersRepo.findByEmail(email);

    if (existing) {
      if (existing.role === 'admin') {
        console.log(`La cuenta ${email} ya tiene rol de administrador.`);
        return;
      }
      await withTransaction(pool, async (client) => {
        await usersRepo.updateRole(existing.id, 'admin', client);
        await auditRepo.insert(
          {
            eventType: 'role_changed',
            severity: 'warn',
            targetUserId: existing.id,
            details: { source: 'cli_create_admin', previousRole: existing.role, newRole: 'admin' },
          },
          client
        );
      });
      console.log(`Usuario existente ${email} promovido a administrador.`);
      return;
    }

    const passwordHash = await hashPassword(passwordParsed.data);
    await withTransaction(pool, async (client) => {
      const created = await usersRepo.create(
        {
          id: randomUUID(),
          name: rawName,
          email,
          passwordHash,
          role: 'admin',
        },
        client
      );
      await auditRepo.insert(
        {
          eventType: 'admin_created_cli',
          severity: 'warn',
          targetUserId: created.id,
          details: { source: 'cli_create_admin' },
        },
        client
      );
    });

    console.log(`Administrador creado correctamente para ${email}.`);
  } finally {
    rl.close();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('No se pudo crear el administrador:', err.message);
  process.exit(1);
});
