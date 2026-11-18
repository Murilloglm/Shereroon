/** Executar no backend, com o serviço parado no caso do PGlite. Nunca monta uma rota HTTP. */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { Accounts } from '../src/community/auth.ts';
import { bootstrapAdmin } from '../src/community/global-admin.ts';
import { connectPglite, connectPostgres } from '../src/db/db.ts';
import { MIGRATIONS, migrate } from '../src/db/schema.ts';

const root = resolve(import.meta.dirname, '../..');
if (existsSync(resolve(root, '.env'))) process.loadEnvFile(resolve(root, '.env'));
const db = process.env.DATABASE_URL?.trim()
  ? await connectPostgres(process.env.DATABASE_URL.trim())
  : process.env.NODE_ENV === 'production' ? null : await connectPglite(process.env.PGLITE_DIR || resolve(root, 'server/.data/pglite'));
if (!db) throw new Error('DATABASE_URL é obrigatória em produção.');

async function secret(): Promise<string> {
  if (process.env.COSMIC_BOOTSTRAP_PASSWORD) {
    const password = process.env.COSMIC_BOOTSTRAP_PASSWORD;
    delete process.env.COSMIC_BOOTSTRAP_PASSWORD;
    return password;
  }
  if (!stdin.isTTY) throw new Error('Use um terminal interativo ou forneça COSMIC_BOOTSTRAP_PASSWORD pelo gerenciador de segredos.');
  stdout.write('Senha da conta (entrada oculta): ');
  stdin.setRawMode(true); stdin.resume(); stdin.setEncoding('utf8');
  return new Promise((accept, reject) => {
    let value = '';
    const done = () => { stdin.setRawMode(false); stdin.pause(); stdin.off('data', onData); stdout.write('\n'); };
    const onData = (data: string) => {
      for (const char of data) {
        if (char === '\u0003') { done(); reject(new Error('Cancelado.')); return; }
        if (char === '\r' || char === '\n') { done(); accept(value); return; }
        if (char === '\u007f' || char === '\b') value = value.slice(0, -1);
        else if (char >= ' ' && value.length < 128) value += char;
      }
    };
    stdin.on('data', onData);
  });
}

try {
  const lookup = process.argv.indexOf('--lookup');
  if (lookup !== -1) {
    const rows = await db.tx(async (tx) => {
      await tx.query('SET TRANSACTION READ ONLY');
      return tx.query('SELECT id, username FROM users WHERE username_key = $1 AND NOT is_bot', [(process.argv[lookup + 1] ?? 'Mg').toLowerCase()]);
    });
    console.log(JSON.stringify(rows));
  } else {
    if (process.env.NODE_ENV === 'production') {
      const applied = new Set((await db.query('SELECT id FROM schema_migrations')).map((row) => Number(row.id)));
      if (MIGRATIONS.some((migration) => !applied.has(migration.id))) throw new Error('Há migrações pendentes. Implante e valide o backend antes de inicializar a administração.');
    } else await migrate(db);
    const create = process.argv.includes('--create-mg');
    const accountId = process.env.COSMIC_BOOTSTRAP_USER_ID?.trim();
    if (!create && !accountId) throw new Error('Execute --lookup Mg e configure COSMIC_BOOTSTRAP_USER_ID com o ID encontrado. Para criar uma conta Mg nova, use --create-mg.');
    if (process.env.NODE_ENV === 'production' && !stdin.isTTY) {
      if (create && process.env.COSMIC_BOOTSTRAP_CONFIRM_CREATE !== 'Mg') throw new Error('Confirme a criação da nova conta com COSMIC_BOOTSTRAP_CONFIRM_CREATE=Mg.');
      if (!create && process.env.COSMIC_BOOTSTRAP_CONFIRM_ID !== accountId) throw new Error('Confirme o ID exato com COSMIC_BOOTSTRAP_CONFIRM_ID.');
    }
    if ((await db.query('SELECT 1 FROM global_permissions LIMIT 1')).length) throw new Error('A administração já foi inicializada.');
    const password = await secret();
    let id = accountId;
    if (create) {
      if ((await db.query("SELECT 1 FROM users WHERE username_key = 'mg'")).length) throw new Error('Mg já existe. Use o ID interno dessa conta.');
      const result = await new Accounts(db).register({ username: 'Mg', displayName: 'Mg', password });
      id = result.user.id;
      // O bootstrap não entrega uma sessão sem passar pela tela de login.
      await new Accounts(db).logoutEverywhere(id);
    }
    if (!id) throw new Error('ID da conta ausente.');
    if (stdin.isTTY && !process.env.COSMIC_BOOTSTRAP_USER_ID) {
      const prompt = createInterface({ input: stdin, output: stdout });
      const answer = await prompt.question(`Conta criada: Mg, ID ${id}. Digite o ID para confirmar: `);
      prompt.close();
      if (answer.trim() !== id) throw new Error('Confirmação do ID não confere.');
    }
    await bootstrapAdmin(db, id, password);
    console.log(`Cosmic Admin principal inicializado. ID imutável: ${id}. Entre e configure MFA em Administração Cosmic.`);
  }
} finally { await db.close(); }
