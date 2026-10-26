import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // host: true lets phones on the same Wi-Fi open the dev site (http://<your-pc-ip>:5173)
  server: { port: 5173, open: true, host: true, proxy: { '/api': 'http://localhost:5000' } },
});
