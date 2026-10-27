import { useState, useEffect, useRef } from 'react';

interface Props {
  title: string;
  placeholder: string;
  initialValue?: string;
  open: boolean;
  onClose: () => void;
  onSave: (value: string) => Promise<void>;
}

export default function GenericModal({
  title,
  placeholder,
  initialValue = '',
  open,
  onClose,
  onSave,
}: Props) {
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setValue(initialValue);
      setError('');
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open, initialValue]);

  if (!open) return null;

  async function handleSave() {
    const v = value.trim();
    if (!v) { setError('Please enter a value'); return; }
    setSaving(true);
    try {
      await onSave(v);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter') handleSave();
    if (e.key === 'Escape') onClose();
  }

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-box">
        <h2 className="modal-title">{title}</h2>
        <div className="form-group">
          <input
            ref={inputRef}
            className="form-input"
            type="text"
            placeholder={placeholder}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKey}
          />
        </div>
        {error && <p style={{ color: '#ef5350', fontSize: '0.85rem', marginBottom: 8 }}>{error}</p>}
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
