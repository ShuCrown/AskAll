import type { GeneralSettings } from '@/lib/types';

interface Props {
  settings: GeneralSettings;
  onChange: (settings: GeneralSettings) => void | Promise<void>;
}

export function GeneralTab({ settings, onChange }: Props) {
  function update<K extends keyof GeneralSettings>(key: K, value: GeneralSettings[K]) {
    void onChange({ ...settings, [key]: value });
  }

  return (
    <>
      <section className="section">
        <div className="section-head">
          <div>
            <h2>Trigger</h2>
            <div className="sub">How AskAll appears when you select text</div>
          </div>
        </div>
        <div className="section-body">
          <div className="field-row">
            <div className="field-label">
              <div className="title">Selection trigger</div>
              <div className="desc">
                Show the floating action bar on selection, require the hotkey, or both.
              </div>
            </div>
            <div className="field-control">
              <div className="radio-group">
                {(['fab', 'hotkey', 'both'] as const).map((v) => (
                  <label key={v}>
                    <input
                      type="radio"
                      name="trigger"
                      checked={settings.selectionTrigger === v}
                      onChange={() => update('selectionTrigger', v)}
                    />
                    <span>
                      {v === 'fab' ? 'Floating bar' : v === 'hotkey' ? 'Hotkey only' : 'Both'}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          <div className="field-row">
            <div className="field-label">
              <div className="title">Minimum selection length</div>
              <div className="desc">Ignore selections shorter than this many characters.</div>
            </div>
            <div className="field-control">
              <input
                type="number"
                className="input num-input"
                min={1}
                max={200}
                value={settings.minSelectionLength}
                onChange={(e) =>
                  update('minSelectionLength', Math.max(1, Number(e.target.value) || 1))
                }
              />
            </div>
          </div>

          <div className="field-row">
            <div className="field-label">
              <div className="title">Ask-all hotkey</div>
              <div className="desc">
                Fires AskAll on the current selection. Rebind in
                <code> chrome://extensions/shortcuts</code>.
              </div>
            </div>
            <div className="field-control">
              <code className="badge badge-mode">Ctrl+Shift+L</code>
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <div>
            <h2>Windows &amp; tabs</h2>
            <div className="sub">Where each chat opens when AskAll fires</div>
          </div>
        </div>
        <div className="section-body">
          <ToggleRow
            title="Open each chat in its own window"
            desc="Use separate popup windows instead of background tabs. Closer to a multi-chat dashboard."
            checked={settings.openInWindows}
            onChange={(v) => update('openInWindows', v)}
          />
          <ToggleRow
            title="Tile windows across the screen"
            desc="Auto-position each window in a grid so all chats are visible at once."
            checked={settings.tileWindows}
            onChange={(v) => update('tileWindows', v)}
            disabled={!settings.openInWindows}
          />
          <ToggleRow
            title="Auto-close chat once the answer is captured"
            desc="Closes the tab/window after the response snippet is saved to history."
            checked={settings.autoCloseOnDone}
            onChange={(v) => update('autoCloseOnDone', v)}
          />
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <div>
            <h2>Answer capture</h2>
            <div className="sub">Best-effort scraping of the first answer for your history log</div>
          </div>
        </div>
        <div className="section-body">
          <ToggleRow
            title="Capture response snippet"
            desc="Poll the chat page for the first answer chunk and store it locally. Disable if you only need the conversation link."
            checked={settings.captureResponseSnippet}
            onChange={(v) => update('captureResponseSnippet', v)}
          />
          <div className="field-row">
            <div className="field-label">
              <div className="title">Capture timeout</div>
              <div className="desc">
                How long to wait for an answer before giving up on snippet capture (ms).
              </div>
            </div>
            <div className="field-control">
              <input
                type="number"
                className="input num-input"
                min={5000}
                max={120000}
                step={1000}
                value={settings.captureTimeoutMs}
                onChange={(e) =>
                  update(
                    'captureTimeoutMs',
                    Math.max(5000, Number(e.target.value) || 45000),
                  )
                }
              />
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <div>
            <h2>Appearance</h2>
            <div className="sub">Theme used by this settings page and the popup</div>
          </div>
        </div>
        <div className="section-body">
          <div className="field-row">
            <div className="field-label">
              <div className="title">Theme</div>
              <div className="desc">Follows your OS setting when “System” is selected.</div>
            </div>
            <div className="field-control">
              <div className="radio-group">
                {(['light', 'dark', 'system'] as const).map((v) => (
                  <label key={v}>
                    <input
                      type="radio"
                      name="theme"
                      checked={settings.theme === v}
                      onChange={() => update('theme', v)}
                    />
                    <span>
                      {v === 'light' ? 'Light' : v === 'dark' ? 'Dark' : 'System'}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

function ToggleRow({
  title,
  desc,
  checked,
  onChange,
  disabled,
}: {
  title: string;
  desc: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className={`field-row ${disabled ? 'disabled-row' : ''}`}>
      <div className="field-label">
        <div className="title">{title}</div>
        <div className="desc">{desc}</div>
      </div>
      <div className="field-control">
        <label className="toggle" title={checked ? 'On' : 'Off'}>
          <input
            type="checkbox"
            checked={checked}
            disabled={disabled}
            onChange={(e) => onChange(e.target.checked)}
          />
          <span className="track" />
          <span className="thumb" />
        </label>
      </div>
    </div>
  );
}
