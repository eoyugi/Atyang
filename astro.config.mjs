import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import tailwind from '@astrojs/tailwind';

export default defineConfig({
  server: {
    host: true
  },
  output: 'server',
  adapter: node({
    mode: 'standalone'
  }),
  integrations: [tailwind()]
});
