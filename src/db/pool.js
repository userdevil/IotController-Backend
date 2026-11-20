import pg from 'pg';
const { Pool } = pg;

// Lazy pool creation — ensures process.env is populated by dotenv
// before the pool reads connection settings.
let _pool = null;

function getPool() {
  if (!_pool) {
    _pool = new Pool({
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432'),
      database: process.env.DB_NAME || 'iot_controller',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
    });
  }
  return _pool;
}

const pool = {
  query: (...args) => getPool().query(...args),
  connect: () => getPool().connect(),
  end: () => _pool?.end(),
};

export default pool;
