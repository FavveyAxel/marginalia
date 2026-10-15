// 11. « Livre à côté » : le texte du livre dans un panneau à gauche ou à droite de la carte (le lecteur
// compact de l'éditeur, BookPane). Sélectionner un passage puis le glisser sur la carte (le bouton
// « Sur la carte » de la barre de sélection, ou le texte sélectionné lui-même) crée l'extrait et la
// carte à l'endroit du dépôt ; un clic sur « Sur la carte » la pose au centre de la vue.
import { lazy, Suspense, useMemo, type DragEvent } from 'react';
import { ArrowLeftRight, GripVertical, MapPinPlus, X } from 'lucide-react';
import { CiteActionCtx, type CiteAction } from '../../../../components/selectionCite';
import { PageSkeleton } from '../../../../components/ui';
import { PASSAGE_TYPE, receivePassage, registerCite, startTextDrag } from './passage';
import '../../../editor/side-panel.css';
import './passage.css';

const BookPane = lazy(() => import('../../../editor/BookPane'));

export type BookSideAt = 'left' | 'right';

export function BookSide({
  bookId,
  at,
  onPickBook,
  onSwap,
  onClose,
}: {
  bookId: string | null;
  at: BookSideAt;
  onPickBook(id: string): void;
  onSwap(): void;
  onClose(): void;
}) {
  const cite = useMemo<CiteAction>(
    () => ({
      label: 'Sur la carte',
      title: 'Mettre sur la carte (C) — ou glisser ce bouton sur la carte, à l’endroit voulu',
      icon: <MapPinPlus size={13} />,
      testId: 'sel-to-map',
      register: registerCite,
      onDragStart: (e) => {
        e.stopPropagation();
        e.dataTransfer.setData(PASSAGE_TYPE, '1');
        e.dataTransfer.effectAllowed = 'copy';
      },
    }),
    [],
  );
  const onDragStartCapture = (e: DragEvent<HTMLDivElement>) => {
    const t = e.target as globalThis.Node;
    const el = t instanceof Element ? t : t.parentElement;
    if (el?.closest('.sel-toolbar')) return;
    startTextDrag(e);
  };
  return (
    <aside className={`map-bookside at-${at} anim-fade`} data-testid="map-bookside" aria-label="Livre à côté de la carte">
      <div className="map-bookside-bar">
        <GripVertical size={13} className="map-bookside-grip" aria-hidden />
        <span className="map-bookside-hint">Sélectionnez un passage, puis glissez-le sur la carte</span>
        <button className="icon-btn sm" onClick={onSwap} title={at === 'left' ? 'Mettre le livre à droite' : 'Mettre le livre à gauche'} aria-label="Changer de côté" data-testid="bookside-swap">
          <ArrowLeftRight size={14} />
        </button>
        <button className="icon-btn sm" onClick={onClose} title="Fermer le livre" aria-label="Fermer le livre" data-testid="bookside-close">
          <X size={14} />
        </button>
      </div>
      <div className="map-bookside-body" onDragStartCapture={onDragStartCapture}>
        <CiteActionCtx.Provider value={cite}>
          <Suspense fallback={<PageSkeleton />}>
            <BookPane bookId={bookId} onPickBook={onPickBook} onCiteInput={receivePassage} />
          </Suspense>
        </CiteActionCtx.Provider>
      </div>
    </aside>
  );
}
