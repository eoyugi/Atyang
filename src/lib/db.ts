import { Pool } from 'pg';

let pool: Pool | undefined;

export const getDatabasePool = (): Pool => {
  if (!import.meta.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not configured.');
  }

  pool ??= new Pool({
    connectionString: import.meta.env.DATABASE_URL,
    options: '-c timezone=Africa/Nairobi',
    max: 5,
    idleTimeoutMillis: 30000
  });

  return pool;
};