// Monte les fenêtres « Partager » et « Recevoir » une fois pour toute l'application, et ouvre
// « Recevoir » quand un fichier « .marginalia » arrive (ouverture, glisser-déposer, sélecteur).
import { useEffect } from 'react';
import { useStore } from '../../lib/store';
import type { PickedFile } from '../../lib/platform';
import { ReceiveDialog } from './ReceiveDialog';
import { ShareDialog } from './ShareDialog';
import { openReceiveDialog, useShareUi } from './shareUi';

export function ShareHost() {
  const send = useShareUi((s) => s.send);
  const receive = useShareUi((s) => s.receive);
  const nonce = useShareUi((s) => s.nonce);
  const closeSend = useShareUi((s) => s.closeSend);
  const closeReceive = useShareUi((s) => s.closeReceive);

  useEffect(() => {
    const on = (e: Event) => {
      const files = (e as CustomEvent<{ files: PickedFile[] }>).detail?.files ?? [];
      if (!files.length) return;
      openReceiveDialog({ file: files[0] });
      if (files.length > 1) useStore.getState().toast('Un seul partage s’ouvre à la fois : ouvrez les autres ensuite.', 'info');
    };
    window.addEventListener('mg:open-share', on);
    return () => window.removeEventListener('mg:open-share', on);
  }, []);

  return (
    <>
      {send && <ShareDialog key={`s${nonce}`} selection={send} onClose={closeSend} />}
      {receive && <ReceiveDialog key={`r${nonce}`} source={receive} onClose={closeReceive} />}
    </>
  );
}
