// Load environment variables from .env and expose them to the Expo app via extra
// This file replaces app.json during runtime config resolution
require('dotenv').config();

/** @type {import('@expo/config').ExpoConfig} */
module.exports = {
  expo: {
    name: 'ai-travel-assistant',
    slug: 'ai-travel-assistant',
    version: '1.0.0',
    orientation: 'portrait',
    icon: './assets/icon.png',
    userInterfaceStyle: 'light',
    newArchEnabled: true,
    splash: {
      image: './assets/splash-icon.png',
      resizeMode: 'contain',
      backgroundColor: '#ffffff',
    },
    ios: {
      supportsTablet: true,
      infoPlist: {
        NSMicrophoneUsageDescription: 'This app uses the microphone to let you talk and get responses about the location.',
      },
    },
    android: {
      adaptiveIcon: {
        foregroundImage: './assets/adaptive-icon.png',
        backgroundColor: '#ffffff',
      },
      edgeToEdgeEnabled: true,
      permissions: [
        'RECORD_AUDIO',
      ],
    },
    web: {
      favicon: './assets/favicon.png',
    },
    extra: {
      openaiApiKey: process.env.OPENAI_API_KEY || null,
      // Make sure this is available in EAS as well when building
    },
  },
};


