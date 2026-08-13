import type { GeneralSettings } from './types';

export const DEFAULT_SETTINGS: GeneralSettings = {
  // Default to tiled popup windows so every enabled chat opens side-by-side
  // (matches the "multiple popups at once" experience). Switch to tabs in
  // General settings if you prefer a lighter footprint.
  openInWindows: true,
  tileWindows: true,
  autoCloseOnDone: false,
  captureResponseSnippet: true,
  captureTimeoutMs: 45000,
  selectionTrigger: 'both',
  minSelectionLength: 2,
  theme: 'system',
};
