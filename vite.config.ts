import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'vendor-react',
              test: /node_modules[\\/](react|react-dom)[\\/]/,
              priority: 40,
            },
            {
              name: 'vendor-flow',
              test: /node_modules[\\/]@xyflow[\\/]react[\\/]/,
              priority: 35,
            },
            {
              name: 'vendor-motion',
              test: /node_modules[\\/]framer-motion[\\/]/,
              priority: 30,
            },
            {
              name: 'vendor-icons',
              test: /node_modules[\\/]lucide-react[\\/]/,
              priority: 25,
            },
            {
              name: 'vendor-state',
              test: /node_modules[\\/](zustand|clsx|tailwind-merge)[\\/]/,
              priority: 20,
            },
            {
              name: 'vendor',
              test: /node_modules[\\/]/,
              priority: 10,
            },
          ],
        },
      },
    },
  },
});
