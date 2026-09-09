const { neon } = require('@neondatabase/serverless');

module.exports = async function handler(req, res) {
  try {
    const databaseUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_URL_NON_POOLING;
    if (!databaseUrl) return res.status(500).json({ error: 'Database environment variable not found' });

    const sql = neon(databaseUrl);
    const rows = await sql`SELECT data FROM admissions_hub_state WHERE id = 1`;
    let state = rows.length && rows[0].data && typeof rows[0].data === 'object' ? rows[0].data : {};
    const staff = Array.isArray(state.staff) ? state.staff : [];

    const additions = [
      { id: 'amal-mathew', name: 'Amal Mathew', role: 'Student Finance Advisor', rota: [], intro: '', photo: '', active: true, sort: 90 },
      { id: 'dewang-gupta', name: 'Dewang Gupta', role: 'Enrolment Support', rota: [], intro: '', photo: '', active: true, sort: 91 }
    ];

    for (const person of additions) {
      const i = staff.findIndex(p => p.id === person.id || String(p.name || '').toLowerCase() === person.name.toLowerCase());
      if (i >= 0) staff[i] = { ...staff[i], name: person.name, role: person.role, active: true };
      else staff.push(person);
    }

    state.staff = staff;
    const json = JSON.stringify(state);
    await sql`
      INSERT INTO admissions_hub_state (id, data, updated_at)
      VALUES (1, ${json}::jsonb, NOW())
      ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()
    `;

    return res.status(200).json({ ok: true, added: additions.map(p => p.name) });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message || 'Unable to add team members' });
  }
};
