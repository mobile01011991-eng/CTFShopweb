import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { defineConfig, loadEnv } from 'vite';

// ── Vite Plugin: save uploaded image to Windows temp + WSL /tmp/ ─────────────
function stegSavePlugin() {
  return {
    name: 'steg-save',
    configureServer(server: any) {
      server.middlewares.use('/api/steg-save', (req: any, res: any, next: any) => {
        if (req.method !== 'POST') { next(); return; }
        let body = '';
        req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
        req.on('end', () => {
          try {
            const { base64, filename } = JSON.parse(body);
            // Strip data URL prefix (data:image/png;base64,...)
            const b64 = base64.includes(',') ? base64.split(',')[1] : base64;
            const buf = Buffer.from(b64, 'base64');

            // Save to Windows temp dir
            const winTmp = path.join(os.tmpdir(), filename || 'steg_upload.png');
            fs.writeFileSync(winTmp, buf);

            // Also copy to WSL /tmp/ via UNC path so the OCR skill can access it
            const wslTmp = `\\\\wsl.localhost\\Ubuntu\\tmp\\${filename || 'steg_upload.png'}`;
            try {
              fs.writeFileSync(wslTmp, buf);
            } catch (wslErr) {
              console.warn('[steg-save] WSL write failed (skill will use Windows path):', wslErr);
            }

            const wslPath = `/tmp/${filename || 'steg_upload.png'}`;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: true, winPath: winTmp, wslPath }));
          } catch (err: any) {
            res.statusCode = 400;
            res.end(JSON.stringify({ ok: false, error: err.message }));
          }
        });
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss(), stegSavePlugin()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.VITE_OPENCLAW_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      port: 5173,
      hmr: process.env.DISABLE_HMR !== 'true',
      proxy: {
        '/api/openclaw': {
          target: 'http://localhost:18789',
          changeOrigin: true,
          rewrite: (path: string) => path.replace(/^\/api\/openclaw/, ''),
        },
      },
    },
  };
});
