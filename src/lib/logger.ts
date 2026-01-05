import { invoke } from '@tauri-apps/api/core';

/**
 * Log errors to the Rust backend (visible in terminal where app runs).
 * In Tauri, browser console is not accessible, so this routes errors to stderr.
 */
export function logError(context: string, error: unknown): void {
  const errorMessage = error instanceof Error ? error.message : String(error);

  // Fire and forget - don't await or handle errors from logging itself
  invoke('log_frontend_error', { context, error: errorMessage }).catch(() => {
    // Silently fail if logging fails - nothing we can do
  });
}

/**
 * Convert an error into a user-friendly message for display in the chat.
 * Analyzes the error string to provide specific guidance.
 */
export function getUserFriendlyErrorMessage(error: unknown): string {
  const errorStr = String(error).toLowerCase();

  // API key issues
  if (errorStr.includes('api key') || errorStr.includes('authentication') || errorStr.includes('unauthorized') || errorStr.includes('401')) {
    return 'API key error. Please check your API key in Settings.';
  }

  // Rate limiting
  if (errorStr.includes('rate limit') || errorStr.includes('too many requests') || errorStr.includes('429')) {
    return 'Rate limit reached. Please wait a moment and try again.';
  }

  // Network/connection issues
  if (errorStr.includes('network') || errorStr.includes('connection') || errorStr.includes('timeout') || errorStr.includes('failed to connect')) {
    return 'Network error. Please check your internet connection and try again.';
  }

  // Server errors
  if (errorStr.includes('500') || errorStr.includes('502') || errorStr.includes('503') || errorStr.includes('internal server error')) {
    return 'The API service is temporarily unavailable. Please try again in a few moments.';
  }

  // Model not available
  if (errorStr.includes('model') && (errorStr.includes('not found') || errorStr.includes('unavailable'))) {
    return 'The selected model is not available. Please try a different model in Settings.';
  }

  // Content/safety filters
  if (errorStr.includes('content') && (errorStr.includes('filter') || errorStr.includes('policy') || errorStr.includes('blocked'))) {
    return 'Your message was blocked by content filters. Please rephrase and try again.';
  }

  // Context length exceeded
  if (errorStr.includes('context') || errorStr.includes('token') && errorStr.includes('limit')) {
    return 'The conversation is too long. Please start a new chat or remove some messages.';
  }

  // Default fallback - show a shortened version of the actual error
  const originalError = String(error);
  if (originalError.length > 100) {
    return `Error: ${originalError.substring(0, 100)}...`;
  }
  return `Error: ${originalError}`;
}
