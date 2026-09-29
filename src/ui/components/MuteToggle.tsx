import { useState } from 'react';
import { setSfxMuted } from '../audio/sfx';
import { setVoiceMuted } from '../audio/voice';
import { loadMuted, saveMuted } from '../store/progress';
import { DwellButton } from './dwell';
import { Icon } from './Icon';

export function MuteToggle() {
  const [muted, setMuted] = useState(loadMuted);
  const toggle = () => {
    const next = !muted;
    setMuted(next);
    saveMuted(next);
    setSfxMuted(next);
    setVoiceMuted(next);
  };
  return (
    <DwellButton
      size="sm"
      variant="ghost"
      onSelect={toggle}
      ariaLabel={muted ? 'Включить звук' : 'Выключить звук'}
    >
      <Icon name={muted ? 'mute' : 'volume'} size={24} />
      <span className="hide-sm">{muted ? 'Звук выкл' : 'Звук'}</span>
    </DwellButton>
  );
}
