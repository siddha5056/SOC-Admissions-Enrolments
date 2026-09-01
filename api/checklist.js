const { neon } = require('@neondatabase/serverless');

function getDatabaseUrl() {
  return process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_URL_NON_POOLING;
}

module.exports = async function handler(req, res) {
  try {
    const databaseUrl = getDatabaseUrl();
    if (!databaseUrl) return res.status(500).json({ error: 'Neon database environment variable not found' });
    const sql = neon(databaseUrl);
    await sql`CREATE TABLE IF NOT EXISTS admissions_checklists (
      checklist_date DATE NOT NULL,
      period TEXT NOT NULL CHECK (period IN ('morning','evening')),
      completed_by TEXT NOT NULL DEFAULT '',
      completed_at TIMESTAMPTZ,
      items JSONB NOT NULL DEFAULT '[]'::jsonb,
      notes TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (checklist_date, period)
    )`;

    if (req.method === 'GET') {
      const date = req.query.date;
      if (!date) return res.status(400).json({ error: 'date is required' });
      const rows = await sql`SELECT checklist_date, period, completed_by, completed_at, items, notes, updated_at FROM admissions_checklists WHERE checklist_date = ${date}::date ORDER BY period`;
      return res.status(200).json({ ok: true, data: rows });
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    if (!body.date || !['morning','evening'].includes(body.period)) return res.status(400).json({ error: 'Valid date and period are required' });
    if (!String(body.completedBy || '').trim()) return res.status(400).json({ error: 'Completed by is required' });
    const items = JSON.stringify(Array.isArray(body.items) ? body.items : []);
    const completedAt = body.completedAt || new Date().toISOString();
    await sql`INSERT INTO admissions_checklists (checklist_date, period, completed_by, completed_at, items, notes, updated_at)
      VALUES (${body.date}::date, ${body.period}, ${String(body.completedBy).trim()}, ${completedAt}::timestamptz, ${items}::jsonb, ${body.notes || ''}, NOW())
      ON CONFLICT (checklist_date, period) DO UPDATE SET
        completed_by = EXCLUDED.completed_by,
        completed_at = EXCLUDED.completed_at,
        items = EXCLUDED.items,
        notes = EXCLUDED.notes,
        updated_at = NOW()`;
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Checklist API error:', error);
    return res.status(500).json({ error: error.message || 'Checklist database error' });
  }
};
