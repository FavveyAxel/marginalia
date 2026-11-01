// Style Skeuomorphisme : le liège de la carte suit le déplacement et le zoom, comme si les cartes
// étaient épinglées dessus. On expose la vue (--vx, --vy, --vz) au fond de la carte, sans re-rendu.
import { useLayoutEffect } from 'react';
import { useStore as useFlowStore } from '@xyflow/react';

export function CorkSync() {
  const [x, y, z] = useFlowStore((s) => s.transform);
  const dom = useFlowStore((s) => s.domNode);
  useLayoutEffect(() => {
    if (!dom) return;
    dom.style.setProperty('--vx', `${x}px`);
    dom.style.setProperty('--vy', `${y}px`);
    dom.style.setProperty('--vz', String(z));
  }, [dom, x, y, z]);
  return null;
}
