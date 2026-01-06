import { Modal } from '../shared/Modal';
import { useSettingsStore } from '../../stores/settingsStore';
import { openUrl } from '@tauri-apps/plugin-opener';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export function UpdateModal() {
  const { updateInfo, showUpdateModal, dismissUpdate } = useSettingsStore();

  if (!showUpdateModal || !updateInfo) {
    return null;
  }

  const handleUpdate = async () => {
    await openUrl(updateInfo.downloadUrl);
    dismissUpdate();
  };

  return (
    <Modal isOpen={true} onClose={dismissUpdate} title={`Update Available: v${updateInfo.latestVersion}`}>
      <div className="space-y-4">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          A new version of Sidestream is available. Here's what's new:
        </p>

        {/* Changelog */}
        <div className="max-h-64 overflow-y-auto bg-stone-50 dark:bg-gray-900 rounded-lg p-4 border border-stone-200 dark:border-gray-700">
          <div className="prose prose-sm dark:prose-invert max-w-none prose-headings:text-base prose-headings:font-semibold prose-p:my-2 prose-ul:my-2 prose-li:my-0">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {updateInfo.changelog}
            </ReactMarkdown>
          </div>
        </div>

        {/* Buttons */}
        <div className="flex justify-end gap-3 pt-2">
          <button
            onClick={dismissUpdate}
            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-stone-100 dark:bg-gray-700 hover:bg-stone-200 dark:hover:bg-gray-600 rounded-lg transition-colors"
          >
            Not Now
          </button>
          <button
            onClick={handleUpdate}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
          >
            Update
          </button>
        </div>
      </div>
    </Modal>
  );
}
