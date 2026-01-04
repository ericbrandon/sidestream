import { Modal } from '../shared/Modal';
import { Button } from '../shared/Button';

interface ApiKeyRequiredModalProps {
  isOpen: boolean;
  onOpenSettings: () => void;
}

export function ApiKeyRequiredModal({
  isOpen,
  onOpenSettings,
}: ApiKeyRequiredModalProps) {
  return (
    <Modal isOpen={isOpen} onClose={onOpenSettings} title="API Key Required">
      <div className="space-y-4">
        <p className="text-gray-600">
          To use this program, please enter at least one AI provider's API key in
          the settings.
        </p>
        <p className="text-sm text-gray-500">
          You can configure API keys for Anthropic Claude, OpenAI, or Google
          Gemini.
        </p>
        <div className="flex justify-end">
          <Button onClick={onOpenSettings}>Open Settings</Button>
        </div>
      </div>
    </Modal>
  );
}
