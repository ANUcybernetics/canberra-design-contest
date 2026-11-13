// Serves the preview on all interfaces so it can be opened over Tailscale.
import { defineConfig } from 'vite';

export default defineConfig({
    server: {
        host: true,
        port: 5180,
        strictPort: true,
        allowedHosts: ['localhost', 'hectar', '.ts.net'],
    },
    worker: { format: 'es' },
    // Three pages: the survey and plans, the traced streets over satellite
    // imagery, and No. 10 drawn as a modern street map.
    build: { rollupOptions: { input: { main: 'index.html', streets: 'streets.html', styled: 'styled.html' } } },
});
