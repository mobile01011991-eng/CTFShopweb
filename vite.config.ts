import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss()],
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
      // ── Middleware: save uploaded stego image to temp + WSL ──────────────
      middlewares: [
        (req: any, res: any, next: any) => {
          if (req.method === 'POST' && req.url === '/api/steg-save') {
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

                // Also copy to WSL /tmp/ via UNC path so the skill can access it
                const wslTmp = `\\\\wsl.localhost\\Ubuntu\\tmp\\${filename || 'steg_upload.png'}`;
                try {
                  fs.mkdirSync(path.dirname(wslTmp), { recursive: true });
                  fs.writeFileSync(wslTmp, buf);
                } catch (wslErr) {
                  // WSL write failed — skill will use Windows path
                  console.warn('[steg-save] WSL write failed:', wslErr);
                }

                const wslPath = `/tmp/${filename || 'steg_upload.png'}`;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ ok: true, winPath: winTmp, wslPath }));
              } catch (err: any) {
                res.statusCode = 400;
                res.end(JSON.stringify({ ok: false, error: err.message }));
              }
            });
          } else {
            next();
          }
        },
      ],
    },
  };
});
