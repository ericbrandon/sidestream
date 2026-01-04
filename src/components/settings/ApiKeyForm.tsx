import { useState, useEffect, useRef } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { readText, writeText } from '@tauri-apps/plugin-clipboard-manager';
import { Button } from '../shared/Button';
import { Input } from '../shared/Input';
import { ContextMenu, type ContextMenuItem } from '../shared/ContextMenu';
import { useApiKeys } from '../../hooks/useApiKeys';
import type { LLMProvider } from '../../lib/types';

interface ProviderConfig {
  provider: LLMProvider;
  name: string;
  placeholder: string;
  validateFn: (key: string) => string | null;
  consoleUrl: string;
  consoleName: string;
}

const PROVIDERS: ProviderConfig[] = [
  {
    provider: 'anthropic',
    name: 'Anthropic',
    placeholder: 'sk-ant-...',
    validateFn: (key) => {
      if (!key.trim()) return 'API key is required';
      if (!key.startsWith('sk-ant-')) return 'Should start with sk-ant-';
      return null;
    },
    consoleUrl: 'https://console.anthropic.com/settings/keys',
    consoleName: 'console.anthropic.com',
  },
  {
    provider: 'openai',
    name: 'OpenAI',
    placeholder: 'sk-...',
    validateFn: (key) => {
      if (!key.trim()) return 'API key is required';
      if (!key.startsWith('sk-')) return 'Should start with sk-';
      return null;
    },
    consoleUrl: 'https://platform.openai.com/api-keys',
    consoleName: 'platform.openai.com',
  },
  {
    provider: 'google',
    name: 'Google Gemini',
    placeholder: 'AIza...',
    validateFn: (key) => {
      if (!key.trim()) return 'API key is required';
      if (key.length < 20) return 'Invalid API key format';
      return null;
    },
    consoleUrl: 'https://aistudio.google.com/app/apikey',
    consoleName: 'aistudio.google.com',
  },
];

interface ApiKeyFormProps {
  highlight?: boolean;
}

export function ApiKeyForm({ highlight }: ApiKeyFormProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { configuredProviders, saveApiKey, deleteApiKey } = useApiKeys();
  const [apiKeys, setApiKeys] = useState<Record<LLMProvider, string>>({
    anthropic: '',
    openai: '',
    google: '',
  });
  const [errors, setErrors] = useState<Record<LLMProvider, string>>({
    anthropic: '',
    openai: '',
    google: '',
  });
  const [successes, setSuccesses] = useState<Record<LLMProvider, boolean>>({
    anthropic: false,
    openai: false,
    google: false,
  });
  const [isHighlighted, setIsHighlighted] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);

    // Handle highlight animation
    useEffect(() => {
      if (highlight) {
        setIsHighlighted(true);
        containerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        // Remove highlight after animation
        const timer = setTimeout(() => setIsHighlighted(false), 2000);
        return () => clearTimeout(timer);
      }
    }, [highlight]);

    const handleSubmit = async (providerConfig: ProviderConfig) => {
      const { provider, validateFn } = providerConfig;
      const key = apiKeys[provider];
      const validationError = validateFn(key);

      if (validationError) {
        setErrors((prev) => ({ ...prev, [provider]: validationError }));
        return;
      }

      try {
        await saveApiKey(provider, key.trim());
        setApiKeys((prev) => ({ ...prev, [provider]: '' }));
        setSuccesses((prev) => ({ ...prev, [provider]: true }));
        setErrors((prev) => ({ ...prev, [provider]: '' }));
      } catch (err) {
        setErrors((prev) => ({
          ...prev,
          [provider]: err instanceof Error ? err.message : 'Failed to save API key',
        }));
      }
    };

    const handleDelete = async (provider: LLMProvider) => {
      try {
        await deleteApiKey(provider);
        setSuccesses((prev) => ({ ...prev, [provider]: false }));
      } catch (err) {
        setErrors((prev) => ({
          ...prev,
          [provider]: err instanceof Error ? err.message : 'Failed to delete API key',
        }));
      }
    };

    const handleInputContextMenu = async (e: React.MouseEvent<HTMLInputElement>, provider: LLMProvider) => {
      e.preventDefault();
      const input = e.currentTarget;
      const menuItems: ContextMenuItem[] = [];
      const selectedText = input.value.substring(input.selectionStart || 0, input.selectionEnd || 0);

      // Pre-fetch clipboard using Tauri API for system clipboard access
      let clipboardText = '';
      try {
        clipboardText = await readText() || '';
      } catch {
        // Clipboard read failed - paste will be disabled
      }

      if (selectedText) {
        menuItems.push(
          { label: 'Cut', onClick: async () => {
            await writeText(selectedText);
            const before = input.value.substring(0, input.selectionStart || 0);
            const after = input.value.substring(input.selectionEnd || 0);
            setApiKeys((prev) => ({ ...prev, [provider]: before + after }));
          }},
          { label: 'Copy', onClick: () => writeText(selectedText) }
        );
      }

      if (clipboardText) {
        menuItems.push({
          label: 'Paste',
          onClick: () => {
            const before = input.value.substring(0, input.selectionStart || 0);
            const after = input.value.substring(input.selectionEnd || 0);
            setApiKeys((prev) => ({ ...prev, [provider]: before + clipboardText + after }));
          }
        });
      }

      if (apiKeys[provider]) {
        menuItems.push({ label: 'Select All', onClick: () => input.select() });
      }

      // Only show context menu if there are items to display
      if (menuItems.length > 0) {
        setContextMenu({ x: e.clientX, y: e.clientY, items: menuItems });
      }
    };

    return (
      <>
        <div
          ref={containerRef}
          className={`space-y-4 transition-all duration-500 ${
            isHighlighted ? 'ring-2 ring-blue-400 ring-offset-2 dark:ring-offset-gray-800 rounded-lg' : ''
          }`}
        >
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">API Keys</h3>

          <div className="space-y-4">
            {PROVIDERS.map((providerConfig) => {
              const { provider, name, placeholder, consoleUrl, consoleName } = providerConfig;
              const isConfigured = configuredProviders[provider];

              return (
                <div
                  key={provider}
                  className="p-3 border border-stone-200 dark:border-gray-700 rounded-lg space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-600 dark:text-gray-300">{name}</span>
                    {isConfigured && (
                      <span className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
                        <span className="w-2 h-2 bg-green-500 rounded-full" />
                        Configured
                      </span>
                    )}
                  </div>

                  <div className="flex gap-2">
                    <Input
                      type="password"
                      value={apiKeys[provider]}
                      onChange={(e) =>
                        setApiKeys((prev) => ({ ...prev, [provider]: e.target.value }))
                      }
                      onContextMenu={(e) => handleInputContextMenu(e, provider)}
                      placeholder={isConfigured ? '••••••••' : placeholder}
                      error={errors[provider]}
                      className="flex-1"
                    />
                    <Button
                      type="button"
                      onClick={() => handleSubmit(providerConfig)}
                    >
                      {isConfigured ? 'Update' : 'Save'}
                    </Button>
                    {isConfigured && (
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => handleDelete(provider)}
                      >
                        Delete
                      </Button>
                    )}
                  </div>

                  {successes[provider] && (
                    <p className="text-sm text-green-600 dark:text-green-400">API key saved!</p>
                  )}

                  <p className="text-xs text-stone-500 dark:text-gray-400">
                    Get your key from{' '}
                    <button
                      className="text-blue-600 dark:text-blue-400 hover:underline"
                      onClick={() => openUrl(consoleUrl)}
                    >
                      {consoleName}
                    </button>
                  </p>
                </div>
              );
            })}
          </div>

          <p className="text-xs text-stone-500 dark:text-gray-400">
            Your API keys are stored securely on your device and never sent to our
            servers.
          </p>
        </div>

        {contextMenu && (
          <ContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            items={contextMenu.items}
            onClose={() => setContextMenu(null)}
          />
        )}
      </>
    );
}
