import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://mdduck.com',
  output: 'static',
  trailingSlash: 'always',
  devToolbar: { enabled: false },
});
