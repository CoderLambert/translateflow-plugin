type Props = {
  id: string;
  label: string;
  description?: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
};

export function SettingSwitch({ id, label, description, checked, disabled, onChange }: Props) {
  const descriptionId = description ? `${id}Description` : undefined;
  return <label className="setting-switch" htmlFor={id}>
    <span className="setting-switch-copy">
      <strong>{label}</strong>
      {description ? <span id={descriptionId} className="setting-switch-description">{description}</span> : null}
    </span>
    <input id={id} className="tf-switch setting-switch-control" type="checkbox" role="switch"
      aria-label={label} aria-describedby={descriptionId} disabled={disabled} checked={checked}
      onChange={event => onChange(event.target.checked)} />
  </label>;
}
