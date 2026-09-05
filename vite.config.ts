import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
export default defineConfig(({ mode }) => ({
 base: mode === 'pages' ? '/yumingxing_catalog/' : '/',
 publicDir: mode === 'pages' ? 'publication' : 'public',
 plugins:[react()],
 resolve:{alias:{'@':fileURLToPath(new URL('.',import.meta.url))}},
 server:{host:'127.0.0.1',port:5173,strictPort:true,proxy:{'/api':'http://127.0.0.1:3000','/media':'http://127.0.0.1:3000'}},
 build:{outDir: mode === 'pages' ? 'dist-pages' : 'dist', ...(mode === 'pages' ? { rollupOptions: { input: { catalogue: fileURLToPath(new URL('./index.html', import.meta.url)), admin: fileURLToPath(new URL('./admin/index.html', import.meta.url)) } } } : {})}
}));
