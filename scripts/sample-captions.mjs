import postgres from 'postgres';
import fs from 'fs';

const env = fs.readFileSync('.env.local', 'utf8');
const dbUrl = env.match(/DATABASE_URL="([^"]+)"/)?.[1]?.replace(/\\n/g, '');

const sql = postgres(dbUrl);

const rows = await sql`
  SELECT caption, media_ig_id
  FROM media_snapshots
  WHERE caption ILIKE '%comment%'
  ORDER BY captured_at DESC
  LIMIT 300
`;

console.log('Total rows with "comment":', rows.length);

const seen = new Set();
let count = 0;
for (const row of rows) {
  if (!row.caption || count >= 30) continue;
  const lines = row.caption.split('\n').filter(l => /comment/i.test(l));
  const key = lines.join('|').slice(0, 80);
  if (seen.has(key)) continue;
  seen.add(key);
  count++;
  console.log('---', row.media_ig_id);
  lines.slice(0, 5).forEach(l => console.log(' >', l.trim().slice(0, 130)));
}

await sql.end();
