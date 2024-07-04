require('dotenv').config();
const fs = require('fs');

export default {
  build: {
    outDir: 'build',
  },
  server: {
    host: '0.0.0.0',
    origin: 'https://activities.kilik.org',
    port: 5173,
    https: process.env.SSL_CRT_FILE
      ? {
          key: fs.readFileSync(process.env.SSL_KEY_FILE),
          cert: fs.readFileSync(process.env.SSL_CRT_FILE),
        }
      : null,
    proxy: {
      '/createRoom': {
        target: 'http://activities:8080', // Proxy to the backend server
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
  host: true,
};
