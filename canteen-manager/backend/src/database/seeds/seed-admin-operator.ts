import 'reflect-metadata';
import * as bcrypt from 'bcrypt';
import { AppDataSource } from '../data-source';
import { Operator, OperatorRole } from '../../operators/operator.entity';
import { BCRYPT_COST } from '../../operators/operator-public';

async function seedAdmin(): Promise<void> {
  const username = process.env['SEED_ADMIN_USERNAME'];
  const password = process.env['SEED_ADMIN_PASSWORD'];

  if (!username || !password) {
    console.log('SEED_ADMIN_USERNAME / SEED_ADMIN_PASSWORD not set — skipping admin seed.');
    return;
  }

  await AppDataSource.initialize();

  try {
    const repo = AppDataSource.getRepository(Operator);
    const existing = await repo.findOne({ where: { username } });

    if (existing) {
      console.log(`Admin operator "${username}" already exists — skipping.`);
      return;
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
    const admin = repo.create({
      username,
      passwordHash,
      displayName: 'System Admin',
      role: OperatorRole.ADMIN,
      isActive: true,
    });

    await repo.save(admin);
    console.log(`Admin operator "${username}" created successfully.`);
  } finally {
    await AppDataSource.destroy();
  }
}

seedAdmin().catch((err: unknown) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
