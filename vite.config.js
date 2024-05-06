import cssInjectedByJsPlugin from "vite-plugin-css-injected-by-js";
import { defineConfig } from 'vite';
// import fs from 'vite-plugin-fs';

export default defineConfig(({ mode }) => {
	return {
		plugins: [/*fs()*/ cssInjectedByJsPlugin()],
		server: { host: '0.0.0.0', port: 8000 },
		clearScreen: false,
		build: {
			minify: 'esbuild',
			sourcemap: false
		},
		esbuild: {
			pure: mode === 'production' ? [ 'console.log' ] : [],
			keepNames: true,
		},
		manualChunks: undefined,
	}
})
