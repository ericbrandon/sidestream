// Fetch latest release from GitHub and update download links
(function() {
  const REPO = 'ericbrandon/sidestream';
  const API_URL = `https://api.github.com/repos/${REPO}/releases/latest`;

  // File patterns to match (without version number)
  // Actual filenames:
  // - Sidestream_1.0.5_aarch64.dmg
  // - Sidestream_1.0.5_x64-setup.exe
  // - Sidestream_1.0.1_amd64.deb / Sidestream_1.0.6_arm64.deb
  // - Sidestream-1.0.1-1.x86_64.rpm / Sidestream_1.0.6-1_aarch64.rpm
  // - Sidestream_1.0.1_amd64.AppImage / Sidestream_1.0.6_aarch64.AppImage
  const FILE_PATTERNS = {
    'macos-aarch64': /Sidestream[_-].*_aarch64\.dmg$/i,
    'windows-x64': /Sidestream[_-].*_x64-setup\.exe$/i,
    'linux-deb-amd64': /Sidestream[_-].*_amd64\.deb$/i,
    'linux-deb-arm64': /Sidestream[_-].*_arm64\.deb$/i,
    'linux-rpm-x86_64': /Sidestream[_-].*\.x86_64\.rpm$/i,
    'linux-rpm-aarch64': /Sidestream[_-].*_aarch64\.rpm$/i,
    'linux-appimage-amd64': /Sidestream[_-].*_amd64\.AppImage$/i,
    'linux-appimage-aarch64': /Sidestream[_-].*_aarch64\.AppImage$/i,
  };

  async function fetchLatestRelease() {
    try {
      const response = await fetch(API_URL);
      if (!response.ok) throw new Error('Failed to fetch release');
      return await response.json();
    } catch (error) {
      console.error('Error fetching release:', error);
      return null;
    }
  }

  function findAssetUrl(assets, pattern) {
    const asset = assets.find(a => pattern.test(a.name));
    return asset ? asset.browser_download_url : null;
  }

  function updateDownloadLinks(release) {
    if (!release || !release.assets) return;

    const assets = release.assets;

    // Update all download links by data attribute
    document.querySelectorAll('[data-download]').forEach(link => {
      const type = link.dataset.download;
      const pattern = FILE_PATTERNS[type];
      if (pattern) {
        const url = findAssetUrl(assets, pattern);
        if (url) {
          link.href = url;
        }
      }
    });

    // Update version display if element exists
    const versionEl = document.querySelector('[data-version]');
    if (versionEl && release.tag_name) {
      versionEl.textContent = release.tag_name;
    }
  }

  // Run on page load
  document.addEventListener('DOMContentLoaded', async () => {
    const release = await fetchLatestRelease();
    if (release) {
      updateDownloadLinks(release);
    }
  });
})();
