import { Gamepad2 } from 'lucide-react';

/** Ícone do jogo: o do próprio executável, quando a pessoa vinculou pelo aplicativo; senão, um controle. */
export function GameIcon({ icon, size = 32 }: { icon: string | null; size?: number }) {
  return icon ? (
    <img src={icon} alt="" className="shrink-0 rounded-md" style={{ width: size, height: size }} />
  ) : (
    <span className="flex shrink-0 items-center justify-center rounded-md bg-brand-500/20 text-brand-300" style={{ width: size, height: size }}>
      <Gamepad2 className="size-1/2" aria-hidden="true" />
    </span>
  );
}
