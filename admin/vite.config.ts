import { defineConfig, loadEnv } from 'vite';
import { parseHubOrigin } from './src/origin';

export default defineConfig(({ mode }) => {
  const settings = loadEnv(mode, process.cwd(), 'KAPE_DOZ_ADMIN_');
  const configured = process.env.KAPE_DOZ_ADMIN_HUB_ORIGIN ?? settings.KAPE_DOZ_ADMIN_HUB_ORIGIN ?? 'http://127.0.0.1:4000';
  const proxy = configured ? { '/api/v1': { target: parseHubOrigin(configured), changeOrigin: true } } : undefined;
  return { server: { host: '0.0.0.0', port: 5173, strictPort: true, proxy }, preview: { host: '0.0.0.0', port: 5173, strictPort: true, proxy } };
});
