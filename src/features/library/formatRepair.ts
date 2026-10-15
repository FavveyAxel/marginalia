// Réparation au démarrage : un fichier importé comme « texte » alors que c'est une image, un PDF ou
// un EPUB (nom sans extension, extension trompeuse) est reconnu d'après son contenu et rouvert
// dans le bon lecteur. Avant, l'ouvrir affichait des mégaoctets de caractères et figeait l'app.
import { useEffect } from 'react';
import { useStore } from '../../lib/store';
import { host } from '../../lib/platform';
import { sniffFile } from '../../lib/sniff';
import { imageThumbnail } from '../reader/image/decode';

let done = false;

export async function repairMisdetectedBooks(): Promise<number> {
  let n = 0;
  for (const b of useStore.getState().books.filter((x) => x.format === 'txt')) {
    try {
      const data = await host.readFile(b.id, b.fileName);
      const s = sniffFile(data);
      if (!s.format || !s.ext) continue;
      const fileName = `source.${s.ext}`;
      if (fileName !== b.fileName) {
        await host.storeFile(b.id, fileName, data);
        await host.deleteFile(b.id, b.fileName).catch(() => undefined);
      }
      const cover = s.format === 'image' ? await imageThumbnail(data, fileName).catch(() => null) : b.cover;
      useStore.getState().updateBook(b.id, { format: s.format, fileName, cover: cover ?? b.cover });
      n++;
    } catch (e) {
      console.error('Réparation du format impossible :', b.title, e);
    }
  }
  if (n) useStore.getState().toast(n === 1 ? '1 document réparé : il s’ouvre maintenant dans le bon lecteur' : `${n} documents réparés`, 'success');
  return n;
}

export function useFormatRepair() {
  const ready = useStore((s) => s.ready);
  useEffect(() => {
    if (!ready || done) return;
    done = true;
    void repairMisdetectedBooks();
  }, [ready]);
}
