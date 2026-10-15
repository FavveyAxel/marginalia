// Mise en page et affichage (zoom, teinte de la page) : dans la barre du haut de l'éditeur, après le
// bouton de concentration. Ils règlent la page entière, pas le texte sélectionné : la barre de mise
// en forme, en dessous, reste ainsi sur une seule ligne. En concentration, ils s'effacent et
// reviennent avec la barre du haut (focus.tsx), comme les autres boutons.
import { FileText } from 'lucide-react';
import type { DocEngine } from './engine';
import { Popover, usePop } from './Popover';
import { MenuRow, keepFocus } from './controls';
import { MenuButton, type StructuralOp } from './Toolbar';
import { PageSetupPanel } from './PageSetup';
import { PAGE_TINTS, type PageTint } from './view';
import { fmtKeys } from '../../lib/keys';

const ZOOMS = [75, 100, 125, 150, 200];

/** Bouton « Mise en page » (format, marges, numéros de page, présentation universitaire). */
export function PageSetupButton({ engine, editable, structural }: { engine: () => DocEngine | null; editable: boolean; structural: StructuralOp }) {
  const pop = usePop();
  const e = engine();
  return (
    <>
      <button
        className={`icon-btn ed-top-page ${pop.isOpen ? 'active' : ''}`}
        disabled={!editable}
        onMouseDown={keepFocus}
        onClick={(ev) => pop.toggle(ev.currentTarget)}
        title="Mise en page : format, marges, numéros de page"
        aria-label="Mise en page"
        aria-haspopup="dialog"
        aria-expanded={pop.isOpen}
        data-tb="page"
      >
        <FileText size={16} />
      </button>
      <Popover pop={pop} label="Mise en page" className="ed-menu ed-page-menu">
        {e && (
          <PageSetupPanel
            engine={e}
            op={structural}
            onAcademic={() => {
              pop.close();
              const cur = engine();
              if (cur) void structural('Présentation universitaire appliquée', () => cur.applyAcademicLayout());
            }}
          />
        )}
      </Popover>
    </>
  );
}

/** Menu « Affichage » : zoom de la page (⌘+ / ⌘- / ⌘0 dans le texte) et teinte de la page. */
export function ZoomMenu({ zoom, setZoom, zoomFit, tint, setTint }: { zoom: number; setZoom: (z: number | 'fit') => void; zoomFit?: boolean; tint?: PageTint; setTint?: (t: PageTint) => void }) {
  return (
    <MenuButton label="Affichage : zoom et teinte de la page" tb="zoom" text={`${zoom} %`} menuClass="ed-zoom-menu ed-view-menu" className="ed-tb-zoom ed-top-zoom">
      {(close) => (
        <>
          <div className="ed-menu-head">Zoom</div>
          <MenuRow label="Ajuster à la largeur" shortcut={fmtKeys('⌘0')} checked={!!zoomFit} onClick={() => (close(), setZoom('fit'))} data-zoom="fit" />
          {ZOOMS.map((z) => (
            <MenuRow key={z} label={`${z} %`} checked={!zoomFit && zoom === z} onClick={() => (close(), setZoom(z))} data-zoom={String(z)} />
          ))}
          {setTint && (
            <>
              <div className="divider" />
              <div className="ed-menu-head">Page</div>
              {PAGE_TINTS.map((t) => (
                <MenuRow
                  key={t.id}
                  icon={<span className={`ed-tint-swatch ${t.id}`} style={t.swatch ? { background: t.swatch } : undefined} />}
                  label={t.label}
                  checked={tint === t.id}
                  onClick={() => (close(), setTint(t.id))}
                  data-tint={t.id}
                />
              ))}
              <p className="ed-pop-note">Affichage seulement : le fichier Word, les exports et l’impression gardent les couleurs du document.</p>
            </>
          )}
        </>
      )}
    </MenuButton>
  );
}
