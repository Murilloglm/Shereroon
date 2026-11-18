import { audioContext } from './audio.ts';
import { alertPrefs } from './groups/alerts.ts';

/** Short ascending/descending cues, generated locally without downloading audio. */
export function playCallSound(event: 'join' | 'leave', deafened: boolean): void {
  if (deafened || !alertPrefs.get().sound) return;
  try {
    const context = audioContext();
    if (context.state !== 'running') return;
    const frequencies = event === 'join' ? [520, 780] : [780, 520];
    for (const [index, frequency] of frequencies.entries()) {
      const at = context.currentTime + index * 0.1;
      const tone = context.createOscillator();
      const gain = context.createGain();
      tone.type = 'sine';
      tone.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.07, at + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.14);
      tone.connect(gain);
      gain.connect(context.destination);
      tone.onended = () => { tone.disconnect(); gain.disconnect(); };
      tone.start(at);
      tone.stop(at + 0.15);
    }
  } catch {
    // Unsupported or blocked audio must never interrupt the call.
  }
}
