import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useSettingsStore } from '../stores/settingsStore';
import { logError } from '../lib/logger';
import type { LLMProvider, ApiKeysConfig } from '../lib/types';

const DEFAULT_CONFIG: ApiKeysConfig = {
  anthropic: false,
  openai: false,
  google: false,
};

export function useApiKeys() {
  const [configuredProviders, setConfiguredProviders] =
    useState<ApiKeysConfig>(DEFAULT_CONFIG);
  const { setConfiguredProviders: setStoreProviders } = useSettingsStore();

  const checkApiKeys = useCallback(async () => {
    try {
      const config = await invoke<ApiKeysConfig>('get_configured_providers');
      setConfiguredProviders(config);
      // setStoreProviders also computes and updates voiceModel
      setStoreProviders(config);
      return config;
    } catch (error) {
      logError('useApiKeys.checkApiKeys', error);
      setConfiguredProviders(DEFAULT_CONFIG);
      setStoreProviders(DEFAULT_CONFIG);
      return DEFAULT_CONFIG;
    }
  }, [setStoreProviders]);

  const saveApiKey = useCallback(
    async (provider: LLMProvider, key: string) => {
      await invoke('save_api_key', { provider, key });
      await checkApiKeys();
      // voiceModel is automatically computed in setStoreProviders
    },
    [checkApiKeys]
  );

  const deleteApiKey = useCallback(
    async (provider: LLMProvider) => {
      await invoke('delete_api_key', { provider });
      await checkApiKeys();
    },
    [checkApiKeys]
  );

  const hasAnyApiKey = useCallback((): boolean => {
    return (
      configuredProviders.anthropic ||
      configuredProviders.openai ||
      configuredProviders.google
    );
  }, [configuredProviders]);

  // Check on mount
  useEffect(() => {
    checkApiKeys();
  }, [checkApiKeys]);

  return {
    configuredProviders,
    saveApiKey,
    deleteApiKey,
    hasAnyApiKey,
    checkApiKeys,
  };
}
