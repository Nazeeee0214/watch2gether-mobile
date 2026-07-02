export const ResolveVideoSource = (inputUrl: string): { type: 'DIRECT' | 'PLATFORM'; finalUrl: string } => {
  if (!inputUrl) {
    return { type: 'PLATFORM', finalUrl: '' };
  }
  const isDirectFile = /\.(mp4|m3u8|mkv|webm)(\?.*)?$/i.test(inputUrl);
  
  if (isDirectFile) {
    // Expo uses EXPO_PUBLIC_ environment variables
    const proxyPrefix = process.env.EXPO_PUBLIC_CORS_PROXY_URL || "https://watch2gether-1-sznt.onrender.com/";
    return {
      type: 'DIRECT',
      finalUrl: `${proxyPrefix}${inputUrl}`
    };
  }
  
  return {
    type: 'PLATFORM',
    finalUrl: inputUrl
  };
};

export const getYouTubeVideoId = (url: string): string | null => {
  if (!url) return null;
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
  const match = url.match(regExp);
  return (match && match[2].length === 11) ? match[2] : null;
};
