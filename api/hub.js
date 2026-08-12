const { neon } = require('@neondatabase/serverless');

function getDatabaseUrl() {
  return (
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_URL_NON_POOLING
  );
}

module.exports = async function handler(req, res) {
  try {
    const databaseUrl = getDatabaseUrl();

    if (!databaseUrl) {
      return res.status(500).json({
        error: 'Neon database environment variable not found'
      });
    }

    const sql = neon(databaseUrl);

    // Separate table for the Admissions & Enrolments Hub.
    // This does NOT modify the KPI dashboard table.
    await sql`
      CREATE TABLE IF NOT EXISTS admissions_hub_state (
        id INTEGER PRIMARY KEY,
        data JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;

    // Load shared Hub data
    if (req.method === 'GET') {
      const rows = await sql`
        SELECT data, updated_at
        FROM admissions_hub_state
        WHERE id = 1
      `;

      if (!rows.length) {
        return res.status(200).json({
          data: null,
          updated_at: null
        });
      }

      return res.status(200).json(rows[0]);
    }

    // Save shared Hub data
    if (req.method === 'POST') {
      const body =
        typeof req.body === 'string'
          ? JSON.parse(req.body)
          : req.body;

      if (!body || !body.data || typeof body.data !== 'object') {
        return res.status(400).json({
          error: 'Invalid Hub data'
        });
      }

      const data = JSON.stringify(body.data);

      const rows = await sql`
        INSERT INTO admissions_hub_state
          (id, data, updated_at)
        VALUES
          (1, ${data}::jsonb, NOW())

        ON CONFLICT (id)
        DO UPDATE SET
          data = EXCLUDED.data,
          updated_at = NOW()

        RETURNING updated_at
      `;

      return res.status(200).json({
        ok: true,
        updated_at: rows[0].updated_at
      });
    }

    res.setHeader('Allow', 'GET, POST');

    return res.status(405).json({
      error: 'Method not allowed'
    });

  } catch (error) {
    console.error('Admissions Hub API error:', error);

    return res.status(500).json({
      error: error.message || 'Database error'
    });
  }
};
