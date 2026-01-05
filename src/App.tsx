import { useEffect } from 'react';
import { AppLayout } from './components/layout/AppLayout';
import { useSessionStore } from './stores/sessionStore';
import { useDiscoveryStore } from './stores/discoveryStore';
import { useSettingsStore } from './stores/settingsStore';
import { useChatStore } from './stores/chatStore';
import { logDebug } from './lib/logger';
import './index.css';

function App() {
  const { loadSessionList, setActiveSessionId } = useSessionStore();
  const { fontScale, increaseFontScale, decreaseFontScale, resetFontScale, theme } = useSettingsStore();

  useEffect(() => {
    // Load session list on app start
    loadSessionList().then(() => {
      // If no active session, create a new one
      if (!useSessionStore.getState().activeSessionId) {
        const newId = crypto.randomUUID();
        setActiveSessionId(newId);
        // Also set the discovery store's active session for proper scoping
        useDiscoveryStore.getState().setActiveSessionId(newId);
      }
    });
  }, [loadSessionList, setActiveSessionId]);

  // Apply font scale to document root
  useEffect(() => {
    document.documentElement.style.setProperty('--font-scale', fontScale.toString());
  }, [fontScale]);

  // Detect platform and add class for platform-specific CSS (e.g., font smoothing)
  useEffect(() => {
    const platform = navigator.platform.toLowerCase();
    const userAgent = navigator.userAgent.toLowerCase();

    logDebug('platform-detection', `navigator.platform: "${navigator.platform}"`);
    logDebug('platform-detection', `navigator.userAgent: "${navigator.userAgent}"`);

    // Check both platform and userAgent for robust detection
    if (platform.includes('linux') || userAgent.includes('linux')) {
      document.documentElement.classList.add('platform-linux');
      logDebug('platform-detection', 'Added class: platform-linux');
    } else if (platform.includes('mac') || userAgent.includes('mac')) {
      document.documentElement.classList.add('platform-macos');
      logDebug('platform-detection', 'Added class: platform-macos');
    } else if (platform.includes('win') || userAgent.includes('windows')) {
      document.documentElement.classList.add('platform-windows');
      logDebug('platform-detection', 'Added class: platform-windows');
    } else {
      logDebug('platform-detection', 'No platform matched!');
    }

    // Log the final classList
    logDebug('platform-detection', `HTML classList: "${document.documentElement.className}"`);

    // Log computed styles on body to verify CSS is applied
    const bodyStyles = window.getComputedStyle(document.body);
    logDebug('font-styles', `body font-family: "${bodyStyles.fontFamily}"`);
    logDebug('font-styles', `body font-weight: "${bodyStyles.fontWeight}"`);
    logDebug('font-styles', `body -webkit-font-smoothing: "${bodyStyles.getPropertyValue('-webkit-font-smoothing')}"`);

    // Check if fonts are loaded
    if (document.fonts) {
      document.fonts.ready.then(() => {
        logDebug('font-loading', 'document.fonts.ready resolved');

        // Log all loaded fonts
        const loadedFonts: string[] = [];
        document.fonts.forEach((font) => {
          loadedFonts.push(`${font.family} ${font.weight} ${font.style} - ${font.status}`);
        });
        logDebug('font-loading', `Loaded fonts (${loadedFonts.length}): ${loadedFonts.join('; ')}`);

        // Check specifically for Noto Sans weights
        const notoWeights = ['400', '500', '600', '700'];
        notoWeights.forEach((weight) => {
          const checkResult = document.fonts.check(`${weight} 16px "Noto Sans"`);
          logDebug('font-loading', `Noto Sans weight ${weight} available: ${checkResult}`);
        });
      });
    } else {
      logDebug('font-loading', 'document.fonts API not available');
    }

    // Test font-medium class rendering after a short delay
    setTimeout(() => {
      const testEl = document.querySelector('.font-medium');
      if (testEl) {
        const testStyles = window.getComputedStyle(testEl);
        logDebug('font-medium-test', `Found .font-medium element`);
        logDebug('font-medium-test', `Computed font-family: "${testStyles.fontFamily}"`);
        logDebug('font-medium-test', `Computed font-weight: "${testStyles.fontWeight}"`);
      } else {
        logDebug('font-medium-test', 'No .font-medium element found on page');
      }
    }, 1000);
  }, []);

  // Apply theme to document root
  useEffect(() => {
    const applyTheme = (isDark: boolean) => {
      if (isDark) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    };

    if (theme === 'system') {
      // Use system preference
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      applyTheme(mediaQuery.matches);

      // Listen for system preference changes
      const handleChange = (e: MediaQueryListEvent) => applyTheme(e.matches);
      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    } else {
      // Use explicit theme setting
      applyTheme(theme === 'dark');
    }
  }, [theme]);

  // Global keyboard listener for font size (Cmd/Ctrl + Plus/Minus/Zero)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Check for Cmd (Mac) or Ctrl (Windows/Linux)
      const isMod = e.metaKey || e.ctrlKey;
      if (!isMod) return;

      // Prevent default browser zoom behavior and handle font scaling
      if (e.key === '=' || e.key === '+') {
        e.preventDefault();
        increaseFontScale();
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        decreaseFontScale();
      } else if (e.key === '0') {
        e.preventDefault();
        resetFontScale();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [increaseFontScale, decreaseFontScale, resetFontScale]);

  // Global keyboard listener for auto-focusing chat input when typing
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Skip if settings modal is open (read current value from store to avoid stale closure)
      if (useSettingsStore.getState().isSettingsOpen) return;

      // Skip if modifier keys are pressed (except Shift for uppercase)
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      // Skip if already in an input element
      const activeElement = document.activeElement;
      if (
        activeElement instanceof HTMLInputElement ||
        activeElement instanceof HTMLTextAreaElement ||
        activeElement?.getAttribute('contenteditable') === 'true'
      ) {
        return;
      }

      // Only handle printable characters (single character keys or special input keys)
      // e.key.length === 1 covers letters, numbers, punctuation, space
      if (e.key.length === 1) {
        useChatStore.getState().focusChatInput();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return <AppLayout />;
}

export default App;
