const REPO = 'ericbrandon/sidestream';
const API_URL = `https://api.github.com/repos/${REPO}/releases/latest`;
const DOWNLOAD_URL = 'https://sidestream-app.com/download.html';

// Current app version - should match package.json
export const APP_VERSION = '1.0.7';

export interface UpdateInfo {
  updateAvailable: boolean;
  latestVersion: string;
  changelog: string;
  downloadUrl: string;
}

interface GitHubRelease {
  tag_name: string;
  body: string;
  html_url: string;
}

/**
 * Compare two semantic version strings.
 * Returns: 1 if a > b, -1 if a < b, 0 if equal
 */
function compareVersions(a: string, b: string): number {
  // Strip 'v' prefix if present
  const cleanA = a.replace(/^v/, '');
  const cleanB = b.replace(/^v/, '');

  const partsA = cleanA.split('.').map(Number);
  const partsB = cleanB.split('.').map(Number);

  const maxLen = Math.max(partsA.length, partsB.length);

  for (let i = 0; i < maxLen; i++) {
    const numA = partsA[i] || 0;
    const numB = partsB[i] || 0;

    if (numA > numB) return 1;
    if (numA < numB) return -1;
  }

  return 0;
}

// Set to true to test the update modal without a real GitHub release
const TEST_MODE = false;

/**
 * Check for updates by fetching the latest release from GitHub.
 * Returns update info if a newer version is available, null otherwise.
 */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  // TEST MODE: Return fake update info for UI testing
  if (TEST_MODE) {
    return {
      updateAvailable: true,
      latestVersion: '1.0.7',
      changelog: `## What's New in v1.0.7

### Features
- Added automatic update checking on app launch
- New update notification modal with changelog display

### Improvements
- Better error handling for API requests
- Improved dark mode styling

### Bug Fixes
- Fixed issue with session persistence
- Resolved memory leak in discovery mode`,
      downloadUrl: DOWNLOAD_URL,
    };
  }

  try {
    const response = await fetch(API_URL);
    if (!response.ok) {
      console.error('Failed to fetch latest release:', response.status);
      return null;
    }

    const release: GitHubRelease = await response.json();
    const latestVersion = release.tag_name.replace(/^v/, '');

    // Check if latest version is newer than current
    if (compareVersions(latestVersion, APP_VERSION) > 0) {
      return {
        updateAvailable: true,
        latestVersion,
        changelog: release.body || 'No changelog available.',
        downloadUrl: DOWNLOAD_URL,
      };
    }

    return null;
  } catch (error) {
    console.error('Error checking for updates:', error);
    return null;
  }
}
