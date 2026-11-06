require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcrypt');

(async () => {
  const [email, password, rol] = process.argv.slice(2);
  if (!email || !password) {
    console.log('Uso: node crear-usuario.js <correo> <contraseña> [admin]');
    process.exit(1);
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const hash = await bcrypt.hash(password, 12);
  await pool.query(
    `INSERT INTO users (email, password_hash, is_admin) VALUES ($1,$2,$3)
     ON CONFLICT (email) DO UPDATE SET password_hash = $2, is_admin = $3`,
    [email.toLowerCase(), hash, rol === 'admin']
  );
  console.log(`Listo: ${email} ${rol === 'admin' ? '(administrador)' : ''}`);
  await pool.end();
})();
