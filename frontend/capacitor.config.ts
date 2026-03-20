import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.vegtab',
  appName: 'Vege-Table',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
};

export default config;
