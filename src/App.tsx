import { useEffect } from 'react';
import { AppLayout } from './components/layout/AppLayout';
import { useSessionStore } from './stores/sessionStore';
import { useDiscoveryStore } from './stores/discoveryStore';
import { useSettingsStore } from './stores/settingsStore';
import { useChatStore } from './stores/chatStore';
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
    if (platform.includes('linux')) {
      document.documentElement.classList.add('platform-linux');
    } else if (platform.includes('mac')) {
      document.documentElement.classList.add('platform-macos');
    } else if (platform.includes('win')) {
      document.documentElement.classList.add('platform-windows');
    }
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
