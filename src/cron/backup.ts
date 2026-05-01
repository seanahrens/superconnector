// Monthly SQL dump of D1 → R2. Defense-in-depth on top of D1's built-in
// 30-day Time Travel: if a bug or migration corrupts state and we don't
// notice within 30 days, the R2 dumps still exist.
//
// Total cost at our scale: $0/mo (R2 free tier covers; dumps are ~tens
// of KB).

import type { Env } from '../../worker-configuration';

const PREFIX = 'superconnector/backups';
const RETENTION = 24; // keep the most recent 24 monthly dumps (~2 years)

interface ColumnInfo {
  name: string;
  type: string;
}

export async function runBackup(env: Env): Promise<{ key: string; size: number; rows: number }> {
  const tables = await listUserTables(env);
  const parts: string[] = [];
  parts.push('-- superconnector D1 backup');
  parts.push(`-- generated ${new Date().toISOString()}`);
  parts.push('PRAGMA foreign_keys = OFF;');
  parts.push('BEGIN TRANSACTION;');

  let rowCount = 0;
  for (const t of tables) {
    const cols = await tableColumns(env, t);
    if (cols.length === 0) continue;

    const colList = cols.map((c) => quoteIdent(c.name)).join(', ');
    const rows = await env.DB.prepare(`SELECT * FROM ${quoteIdent(t)}`).all<Record<string, unknown>>();
    const list = rows.results ?? [];
    if (list.length === 0) continue;

    parts.push(`-- table: ${t} (${list.length} rows)`);
    for (const r of list) {
      const values = cols.map((c) => sqlLiteral(r[c.name])).join(', ');
      parts.push(`INSERT INTO ${quoteIdent(t)} (${colList}) VALUES (${values});`);
      rowCount++;
    }
    parts.push('');
  }

  parts.push('COMMIT;');
  parts.push('PRAGMA foreign_keys = ON;');
  const body = parts.join('\n');

  const date = new Date().toISOString().slice(0, 10);
  const key = `${PREFIX}/${date}.sql`;
  await env.BACKUPS.put(key, body, {
    httpMetadata: { contentType: 'application/sql' },
  });

  // Retention: list, sort newest-first, keep N, delete the rest.
  const list = await env.BACKUPS.list({ prefix: `${PREFIX}/` });
  const sorted = list.objects.sort((a, b) => b.key.localeCompare(a.key));
  for (const obj of sorted.slice(RETENTION)) {
    await env.BACKUPS.delete(obj.key);
  }

  return { key, size: body.length, rows: rowCount };
}

async function listUserTables(env: Env): Promise<string[]> {
  const r = await env.DB.prepare(
    `SELECT name FROM sqlite_master
      WHERE type = 'table'
        AND name NOT LIKE 'sqlite_%'
        AND name NOT LIKE '_cf_%'
        AND name NOT LIKE 'd1_%'
      ORDER BY name`,
  ).all<{ name: string }>();
  return (r.results ?? []).map((x) => x.name);
}

async function tableColumns(env: Env, table: string): Promise<ColumnInfo[]> {
  const r = await env.DB.prepare(`PRAGMA table_info(${quoteIdent(table)})`).all<{
    name: string;
    type: string;
  }>();
  return (r.results ?? []).map((c) => ({ name: c.name, type: c.type }));
}

function quoteIdent(s: string): string {
  return `"${s.replace(/"/g, '""')}"`;
}

function sqlLiteral(v: unknown): string {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (v instanceof Uint8Array) {
    let hex = '';
    for (const b of v) hex += b.toString(16).padStart(2, '0');
    return `X'${hex}'`;
  }
  // String — escape single quotes by doubling.
  return `'${String(v).replace(/'/g, "''")}'`;
}
