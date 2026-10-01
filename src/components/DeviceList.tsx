import type { DeviceAdapter } from "../devices";

type Props = {
  devices: DeviceAdapter[];
  selectedId: string;
  onSelect: (id: string) => void;
};

export function DeviceList({ devices, selectedId, onSelect }: Props) {
  return (
    <aside className="device-list" aria-label="设备列表">
      <h2 className="device-list-title">设备</h2>
      <ul className="device-list-items">
        {devices.map((d) => {
          const selected = d.id === selectedId;
          return (
            <li key={d.id}>
              <button
                type="button"
                className={selected ? "device-item selected" : "device-item"}
                onClick={() => onSelect(d.id)}
                aria-pressed={selected}
              >
                <span className="device-item-name">{d.name}</span>
                <span className="device-item-desc">{d.description}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
