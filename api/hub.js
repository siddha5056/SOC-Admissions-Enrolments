const { neon } = require('@neondatabase/serverless');

function getDatabaseUrl() {
  return (
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_URL_NON_POOLING
  );
}

function emptyDay() {
  return {
    records: {},
    offOver: [],
    interviews: [],
    pff: []
  };
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

    // Separate storage for Admissions & Enrolments Hub.
    // Does not affect the KPI dashboard table.
    await sql`
      CREATE TABLE IF NOT EXISTS admissions_hub_state (
        id INTEGER PRIMARY KEY,
        data JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;

    // Get existing shared Hub state.
    const rows = await sql`
      SELECT data, updated_at
      FROM admissions_hub_state
      WHERE id = 1
    `;

    let state = rows.length ? rows[0].data : {};

    if (!state || typeof state !== 'object') {
      state = {};
    }

    // Simple browser/API test.
    if (req.method === 'GET') {
      return res.status(200).json({
        ok: true,
        data: state,
        updated_at: rows.length ? rows[0].updated_at : null
      });
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');

      return res.status(405).json({
        error: 'Method not allowed'
      });
    }

    const body =
      typeof req.body === 'string'
        ? JSON.parse(req.body)
        : (req.body || {});

    const action = body.action;

    if (!action) {
      return res.status(400).json({
        error: 'Hub action is required'
      });
    }

    let result = null;
    let changed = false;

    function getDay(dateKey) {
      if (!state[dateKey]) {
        state[dateKey] = emptyDay();
      }

      state[dateKey].records =
        state[dateKey].records || {};

      state[dateKey].offOver =
        state[dateKey].offOver || [];

      state[dateKey].interviews =
        state[dateKey].interviews || [];

      state[dateKey].pff =
        state[dateKey].pff || [];

      return state[dateKey];
    }

    switch (action) {

      // =========================================================
      // STAFF
      // =========================================================

      case 'listStaff': {
        result = state.staff || [];
        break;
      }

      case 'seedStaff': {
        if (!Array.isArray(state.staff) || state.staff.length === 0) {
          state.staff = Array.isArray(body.rows)
            ? body.rows
            : [];

          changed = true;
        }

        result = state.staff;
        break;
      }

      case 'saveStaff': {
        if (!body.p || !body.p.id) {
          return res.status(400).json({
            error: 'Invalid staff record'
          });
        }

        const staff = state.staff || [];

        const index = staff.findIndex(
          person => person.id === body.p.id
        );

        if (index >= 0) {
          staff[index] = body.p;
        } else {
          staff.push(body.p);
        }

        state.staff = staff;
        changed = true;

        break;
      }

      case 'deleteStaff': {
        state.staff = (state.staff || []).filter(
          person => person.id !== body.id
        );

        changed = true;
        break;
      }

      // =========================================================
      // LOAD DAY
      // =========================================================

      case 'loadDay': {
        result = state[body.dk] || emptyDay();
        break;
      }

      // =========================================================
      // LOAD WEEK
      // =========================================================

      case 'loadWeek': {
        const output = {};

        (body.keys || []).forEach(dateKey => {
          const day =
            state[dateKey] || emptyDay();

          output[dateKey] = {
            records: day.records || {},
            off: day.offOver || []
          };
        });

        result = output;
        break;
      }

      // =========================================================
      // STAFFING
      // =========================================================

      case 'addWorking': {
        const day = getDay(body.dk);

        if (!day.records[body.id]) {
          day.records[body.id] = {
            activities: []
          };
        }

        changed = true;
        break;
      }

      case 'removeWorking': {
        const day = getDay(body.dk);

        delete day.records[body.id];

        changed = true;
        break;
      }

      // =========================================================
      // SIGN IN
      // =========================================================

      case 'signIn': {
        const day = getDay(body.dk);

        const existing =
          day.records[body.id] || {
            activities: []
          };

        day.records[body.id] = {
          ...existing,

          inAt:
            existing.inAt ||
            body.inAt,

          t:
            existing.t ||
            body.t,

          outAt: null,

          activities:
            existing.activities || []
        };

        changed = true;
        break;
      }

      // =========================================================
      // SIGN OUT
      // =========================================================

      case 'editAttendance': {
  const day = getDay(body.dk);

  if (!body.id) {
    return res.status(400).json({
      error: 'Staff member is required'
    });
  }

  const existing = day.records[body.id] || {
    activities: []
  };

  day.records[body.id] = {
    ...existing,
    inAt: body.inAt || null,
    outAt: body.outAt || null,
    activities: existing.activities || [],
    managerCorrected: true,
    correctedAt: new Date().toISOString()
  };

  changed = true;
  break;
}

      // =========================================================
      // ACTIVITIES
      // =========================================================

      case 'addActivity': {
        const day = getDay(body.dk);

        const record =
          day.records[body.personId] || {
            activities: []
          };

        record.activities = [
          ...(record.activities || []),

          {
            id: body.id,
            text: body.note,
            at: body.at
          }
        ];

        day.records[body.personId] =
          record;

        changed = true;
        break;
      }

      // =========================================================
      // LEAVE / OFF
      // =========================================================

      case 'addLeave': {
        const day = getDay(body.dk);

        if (!day.offOver.includes(body.id)) {
          day.offOver.push(body.id);
        }

        changed = true;
        break;
      }

      case 'removeLeave': {
        const day = getDay(body.dk);

        day.offOver =
          day.offOver.filter(
            id => id !== body.id
          );

        changed = true;
        break;
      }

      // =========================================================
      // INTERVIEWS
      // =========================================================

      case 'addInterview': {
        const day = getDay(body.dk);

        if (!body.p) {
          return res.status(400).json({
            error: 'Interview staff member missing'
          });
        }

        day.interviews.push({
          id: body.id,
          personId: body.p.id,
          name: body.p.name,
          start:
            new Date()
              .toTimeString()
              .slice(0, 5)
        });

        changed = true;
        break;
      }

      case 'setInterview': {
        const day = getDay(body.dk);

        day.interviews =
          day.interviews.map(item =>
            item.id === body.id
              ? {
                  ...item,
                  start: body.start
                }
              : item
          );

        changed = true;
        break;
      }

      case 'removeInterview': {
        const day = getDay(body.dk);

        day.interviews =
          day.interviews.filter(
            item => item.id !== body.id
          );

        changed = true;
        break;
      }

      // =========================================================
      // PFF
      // =========================================================

      case 'addPff': {
        const day = getDay(body.dk);

        day.pff.push({
          id: body.id,
          name: body.name,
          inAt: null
        });

        changed = true;
        break;
      }

      case 'pffSignIn': {
        const day = getDay(body.dk);

        day.pff =
          day.pff.map(item =>
            item.id === body.id
              ? {
                  ...item,
                  inAt:
                    item.inAt ||
                    body.inAt
                }
              : item
          );

        changed = true;
        break;
      }

      case 'removePff': {
        const day = getDay(body.dk);

        day.pff =
          day.pff.filter(
            item => item.id !== body.id
          );

        changed = true;
        break;
      }

      // =========================================================
      // UNKNOWN ACTION
      // =========================================================

      default: {
        return res.status(400).json({
          error:
            'Unknown Hub action: ' +
            action
        });
      }
    }

    // =========================================================
    // SAVE TO NEON
    // =========================================================

    if (changed) {
      const json =
        JSON.stringify(state);

      await sql`
        INSERT INTO admissions_hub_state
          (id, data, updated_at)

        VALUES
          (
            1,
            ${json}::jsonb,
            NOW()
          )

        ON CONFLICT (id)

        DO UPDATE SET
          data = EXCLUDED.data,
          updated_at = NOW()
      `;
    }

    return res.status(200).json({
      ok: true,
      data: result
    });

  } catch (error) {

    console.error(
      'Admissions Hub API error:',
      error
    );

    return res.status(500).json({
      error:
        error.message ||
        'Admissions Hub database error'
    });
  }
};
