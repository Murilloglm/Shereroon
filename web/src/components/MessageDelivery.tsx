import type { Delivery } from '../lib/messages.ts';

export function MessageDelivery({ message, retry, retryTestId = 'message-retry' }: { message: Delivery; retry: (id: string) => unknown; retryTestId?: string }) {
  if (!message.delivery) return null;
  return (
    <p className={message.delivery === 'failed' ? 'mt-1 text-xs text-live-300' : 'mt-1 text-[11px] text-fog-500'} data-testid="message-delivery" role={message.delivery === 'failed' ? 'alert' : undefined}>
      {message.delivery === 'sending' ? 'Enviando…' : message.delivery === 'sent' ? 'Enviada' : <>{message.deliveryError || 'Falha ao enviar.'} <button type="button" className="font-bold underline" onClick={() => void retry(message.clientId!)} data-testid={retryTestId}>Tentar novamente</button></>}
    </p>
  );
}
