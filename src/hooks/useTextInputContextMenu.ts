import { useState, useCallback, RefObject } from 'react';
import { readText, writeText } from '@tauri-apps/plugin-clipboard-manager';
import type { ContextMenuItem } from '../components/shared/ContextMenu';

interface ContextMenuState {
  x: number;
  y: number;
  items: ContextMenuItem[];
}

/**
 * Hook for handling clipboard context menus on text inputs/textareas.
 * Provides Cut, Copy, Paste, and Select All operations.
 */
export function useTextInputContextMenu(
  inputRef: RefObject<HTMLInputElement | HTMLTextAreaElement | null>,
  getValue: () => string,
  setValue: (value: string) => void
) {
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  const handleContextMenu = useCallback(async (e: React.MouseEvent) => {
    e.preventDefault();
    const input = inputRef.current;
    if (!input) return;

    // Pre-fetch clipboard using Tauri API for system clipboard access
    let clipboardText = '';
    try {
      clipboardText = await readText() || '';
    } catch {
      // Clipboard read failed - paste will be disabled
    }

    const menuItems: ContextMenuItem[] = [];
    const selectionStart = input.selectionStart || 0;
    const selectionEnd = input.selectionEnd || 0;
    const currentValue = getValue();
    const selectedText = currentValue.substring(selectionStart, selectionEnd);

    if (selectedText) {
      menuItems.push(
        {
          label: 'Cut',
          onClick: async () => {
            await writeText(selectedText);
            const before = currentValue.substring(0, selectionStart);
            const after = currentValue.substring(selectionEnd);
            setValue(before + after);
          },
        },
        { label: 'Copy', onClick: () => writeText(selectedText) }
      );
    }

    if (clipboardText) {
      menuItems.push({
        label: 'Paste',
        onClick: () => {
          const before = currentValue.substring(0, selectionStart);
          const after = currentValue.substring(selectionEnd);
          setValue(before + clipboardText + after);
        },
      });
    }

    if (currentValue) {
      menuItems.push({ label: 'Select All', onClick: () => input.select() });
    }

    // Only show context menu if there are items to display
    if (menuItems.length > 0) {
      setContextMenu({ x: e.clientX, y: e.clientY, items: menuItems });
    }
  }, [inputRef, getValue, setValue]);

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  return {
    contextMenu,
    handleContextMenu,
    closeContextMenu,
  };
}
