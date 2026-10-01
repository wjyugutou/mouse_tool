interface Props {
  open: boolean;
  onClose: () => void;
  autoIntervalSec: number;
  onAutoIntervalSecChange: (sec: number) => void;
}

export function SettingsPanel({
  open,
  onClose,
  autoIntervalSec,
  onAutoIntervalSecChange,
}: Props) {
  if (!open) return null;

  return (
    <div className="settings-backdrop" onClick={onClose} role="presentation">
      <div
        className="settings-panel"
        role="dialog"
        aria-label="设置"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="settings-header">
          <h2>设置</h2>
          <button
            type="button"
            className="settings-close"
            onClick={onClose}
            aria-label="关闭设置"
          >
            <span className="i-mdi-close text-16px" />
          </button>
        </div>
        <label className="settings-field">
          <span>自动刷新间隔（秒）</span>
          <input
            type="number"
            min={3}
            max={60}
            step={1}
            value={autoIntervalSec}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isFinite(n)) {
                onAutoIntervalSecChange(
                  Math.min(60, Math.max(3, Math.round(n))),
                );
              }
            }}
          />
        </label>
        <p className="settings-hint">
          电量约每 3 秒上报一次，建议 ≥ 5 秒。
        </p>
      </div>
    </div>
  );
}
