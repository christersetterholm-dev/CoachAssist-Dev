import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    base: '/',
    plugins: [react(), tailwindcss()],
    resolve: {
      dedupe: ['react', 'react-dom'],
      alias: {
        'react': path.resolve(__dirname, 'node_modules/react'),
        'react-dom': path.resolve(__dirname, 'node_modules/react-dom'),
        '@': path.resolve(__dirname, '.'),
        'firebase/app': path.resolve(__dirname, 'src/lib/firebase.ts'),
        'firebase/auth': path.resolve(__dirname, 'src/lib/firebase.ts'),
        'firebase/firestore': path.resolve(__dirname, 'src/lib/firebase.ts'),
        'firebase/storage': path.resolve(__dirname, 'src/lib/firebase.ts'),
      },
    },
    optimizeDeps: {
      // Skanna bara appens riktiga startfil. Annars hittar Vite gamla färdigbyggda
      // filer (deploy/index.html -> assets/*.js) och kräver paket som inte används.
      entries: ['index.html'],
      exclude: ['firebase', 'firebase/app', 'firebase/auth', 'firebase/firestore', 'firebase/storage'],
    }
  };
});
