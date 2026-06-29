import { defineConfig, type PluginOption } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: process.env.GITHUB_PAGES ? '/weekly-availability-scheduler/' : '/',
  plugins: [react() as PluginOption],
});
