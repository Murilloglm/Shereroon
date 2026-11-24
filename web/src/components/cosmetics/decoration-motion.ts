import { useEffect, useRef } from 'react';

// Um observador para todos os avatares. A animação é CSS; não há trabalho JS a cada quadro.
const visible = new Map<Element, boolean>();
let observer: IntersectionObserver | undefined;
const updateVisibility = () => {
  for (const [element, intersects] of visible) {
    element.setAttribute('data-motion-visible', String(intersects && !document.hidden));
  }
};

export function useDecorationVisibility(animate: boolean, itemId: string) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!animate || !element) return;
    if (visible.size === 0) document.addEventListener('visibilitychange', updateVisibility);
    visible.set(element, true);
    if (typeof IntersectionObserver !== 'undefined') {
      observer ??= new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (visible.has(entry.target)) {
            visible.set(entry.target, entry.isIntersecting);
            entry.target.setAttribute('data-motion-visible', String(entry.isIntersecting && !document.hidden));
          }
        }
      });
      observer.observe(element);
    }
    element.setAttribute('data-motion-visible', String(!document.hidden));
    return () => {
      observer?.unobserve(element);
      visible.delete(element);
      if (visible.size === 0) {
        observer?.disconnect();
        observer = undefined;
        document.removeEventListener('visibilitychange', updateVisibility);
      }
    };
  }, [animate, itemId]);
  return ref;
}
