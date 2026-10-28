// @ts-check
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
	// inline the CSS so the page paints without a second round trip
	build: { inlineStylesheets: 'always' },
});
