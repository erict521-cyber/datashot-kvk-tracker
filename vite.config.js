import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/datashot-kvk-tracker/',
  plugins: [react()],
});
