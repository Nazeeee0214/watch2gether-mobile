/**
 * Custom Expo Config Plugin: withScreenShare
 *
 * Injects the required Android permissions and the react-native-webrtc
 * ScreenCaptureService foreground service declaration into AndroidManifest.xml.
 *
 * Without this, getDisplayMedia() captures one frame then goes black because
 * Android kills the MediaProjection session when there is no active foreground service.
 */
const { withAndroidManifest } = require('@expo/config-plugins');

const withScreenShare = (config) => {
  return withAndroidManifest(config, (config) => {
    const androidManifest = config.modResults;
    const mainApplication = androidManifest.manifest.application[0];

    // ── Permissions ────────────────────────────────────────────────────────────
    if (!androidManifest.manifest['uses-permission']) {
      androidManifest.manifest['uses-permission'] = [];
    }

    const permissions = androidManifest.manifest['uses-permission'];

    const ensurePermission = (name) => {
      const exists = permissions.some((p) => p.$?.['android:name'] === name);
      if (!exists) {
        permissions.push({ $: { 'android:name': name } });
        console.log(`[withScreenShare] Added permission: ${name}`);
      }
    };

    // Required for any foreground service on Android 9+
    ensurePermission('android.permission.FOREGROUND_SERVICE');
    // Required specifically for MediaProjection foreground services on Android 14+
    ensurePermission('android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION');

    // ── Foreground Service Declaration ─────────────────────────────────────────
    if (!mainApplication.service) {
      mainApplication.service = [];
    }

    const serviceClass =
      'com.oney.WebRTCModule.MediaProjectionService';

    const alreadyDeclared = mainApplication.service.some(
      (s) => s.$?.['android:name'] === serviceClass
    );

    if (!alreadyDeclared) {
      mainApplication.service.push({
        $: {
          'android:name': serviceClass,
          // Tells Android this service will use MediaProjection
          'android:foregroundServiceType': 'mediaProjection',
          // Must be false — this service is only for internal use by this app
          'android:exported': 'false',
        },
      });
      console.log(`[withScreenShare] Registered MediaProjectionService`);
    }

    return config;
  });
};

module.exports = withScreenShare;
