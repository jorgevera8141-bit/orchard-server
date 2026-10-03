const { app, pool, getSession, requireAuth, requireAdmin } = require('./server');

let sessionRows;

function responseRecorder(){
  return {
    statusCode: 200,
    body: null,
    status(code){ this.statusCode = code; return this; },
    json(body){ this.body = body; return this; }
  };
}

beforeEach(() => {
  sessionRows = [{ worker_id: 7, worker_name: 'Current Name', role: 'Worker' }];
  jest.spyOn(pool, 'query').mockImplementation(async sql => {
    const query = String(sql);
    if(query.includes('FROM orchard_auth_sessions s')) return { rows: sessionRows };
    return { rows: [] };
  });
});

afterEach(() => jest.restoreAllMocks());

describe('authorization regression coverage', () => {
  test('active shifts route requires sign-in', () => {
    const route = app.router.stack.find(layer => layer.route?.path === '/api/shifts/active');
    expect(route.route.stack[0].handle).toBe(requireAuth);
  });

  test('weekly shifts require sign-in and worker management requires admin access', () => {
    const weeklyRoute = app.router.stack.find(layer => layer.route?.path === '/api/shifts/weekly');
    const workersRoute = app.router.stack.find(layer => layer.route?.path === '/api/workers');
    expect(weeklyRoute.route.stack[0].handle).toBe(requireAuth);
    expect(workersRoute.route.stack[0].handle).toBe(requireAdmin);
  });

  test('inactive workers no longer have a valid session', async () => {
    sessionRows = [];
    expect(await getSession('inactive-worker-token')).toBeNull();
    expect(pool.query.mock.calls[0][0]).toContain('JOIN orchard_workers');
    expect(pool.query.mock.calls[0][0]).toContain('w.active=TRUE');
  });

  test('requireAuth rejects inactive or expired sessions', async () => {
    sessionRows = [];
    const req = { headers: { authorization: 'Bearer inactive-token' } };
    const res = responseRecorder();
    await requireAuth(req, res, jest.fn());
    expect(res.statusCode).toBe(401);
  });

  test('admin access uses the worker current role, not the session snapshot', async () => {
    const req = { headers: { authorization: 'Bearer demoted-token' } };
    const res = responseRecorder();
    const next = jest.fn();
    await requireAdmin(req, res, next);
    expect(res.statusCode).toBe(403);
    expect(res.body.message).toBe('Admin access required');
    expect(next).not.toHaveBeenCalled();
  });
});
