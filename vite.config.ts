import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite 5 config — keep minimal. Add path aliases here in later tickets if needed.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
});
