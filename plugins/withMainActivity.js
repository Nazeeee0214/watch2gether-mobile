/**
 * Custom Expo Config Plugin: withMainActivity
 *
 * Injects `WebRTCModuleOptions.enableMediaProjectionService = true` into
 * MainActivity so that react-native-webrtc's foreground service is started
 * before getDisplayMedia() is called. Without this flag, the MediaProjection
 * session is granted but the foreground service never starts, causing the
 * capture stream to be all-black immediately after the first frame.
 *
 * This is required for react-native-webrtc >= 106 on Android.
 */
const { withMainActivity } = require('@expo/config-plugins');

const withWebRTCMainActivity = (config) => {
  return withMainActivity(config, (config) => {
    let contents = config.modResults.contents;

    // ── 1. Add import if not already present ────────────────────────────────
    const importLine = 'import com.oney.WebRTCModule.WebRTCModuleOptions';
    if (!contents.includes(importLine)) {
      // Insert after the last existing import block
      contents = contents.replace(
        /^(import .+)(\n(?!import))/m,
        `$1\n${importLine}\n$2`
      );
      console.log('[withMainActivity] Added WebRTCModuleOptions import.');
    }

    // ── 2. Inject options.enableMediaProjectionService = true ───────────────
    const injectedFlag = 'options.enableMediaProjectionService = true';
    if (!contents.includes(injectedFlag)) {
      // Find the onCreate override and inject before super.onCreate(...)
      const onCreatePattern = /(override fun onCreate\(savedInstanceState: Bundle\?\) \{)/;
      if (onCreatePattern.test(contents)) {
        contents = contents.replace(
          onCreatePattern,
          `$1\n    val options: WebRTCModuleOptions = WebRTCModuleOptions.getInstance()\n    options.enableMediaProjectionService = true`
        );
        console.log('[withMainActivity] Injected enableMediaProjectionService = true into onCreate.');
      } else {
        console.warn('[withMainActivity] Could not find onCreate override pattern. Skipping injection.');
      }
    }

    config.modResults.contents = contents;
    return config;
  });
};

module.exports = withWebRTCMainActivity;
