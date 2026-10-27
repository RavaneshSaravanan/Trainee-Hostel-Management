import dotenv from 'dotenv';
dotenv.config();
import { connectDB } from './config/db.js';
import app from './server.js';

await connectDB();
const server = app.listen(5098, async () => {
  try {
    console.log('--- Testing /api/public ---');
    const pubRes = await fetch('http://127.0.0.1:5098/api/public');
    console.log('Public status:', pubRes.status);
    const pubData = await pubRes.json();
    console.log('Public data:', pubData);

    console.log('--- Testing /api/login ---');
    const loginRes = await fetch('http://127.0.0.1:5098/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'superadmin', password: 'superadmin123' })
    });
    console.log('Login status:', loginRes.status);
    const loginData = await loginRes.json();
    console.log('Login data:', loginData.ok ? 'OK' : loginData);

  } catch (err) {
    console.error('Test error:', err);
  } finally {
    server.close();
    process.exit(0);
  }
});
