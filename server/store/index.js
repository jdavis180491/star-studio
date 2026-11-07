import { createPgStore } from './pg.js';
import { createFileStore } from './file.js';

export async function createStore() {
  if (process.env.DATABASE_URL) {
    const store = await createPgStore(process.env.DATABASE_URL);
    console.log('🗄️  Using Postgres database');
    return store;
  }
  console.log('🗄️  No DATABASE_URL: saving to .data/store.json (fine for testing)');
  return createFileStore();
}
