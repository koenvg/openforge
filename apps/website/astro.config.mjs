import { defineConfig } from 'astro/config';

const siteUrl = normalizeSiteUrl(process.env.OPENFORGE_WEBSITE_URL ?? process.env.RAILWAY_PUBLIC_DOMAIN);

export default defineConfig({
  output: 'static',
  ...(siteUrl ? { site: siteUrl } : {})
});

function normalizeSiteUrl(value) {
  const trimmed = value?.trim();

  if (!trimmed) {
    return undefined;
  }
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const url = new URL(withProtocol);

  url.hash = '';
  url.search = '';
  url.pathname = url.pathname.replace(/\/+$/, '');

  return url.toString();
}
