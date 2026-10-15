// Feuilles de styles de toutes les vues, dans l'ordre exact où elles se chargeaient avant le
// découpage du code (src/lazyViews.ts). Les vues étant désormais chargées à la demande, leurs styles
// seraient sinon ajoutés plus tard et dans un autre ordre, ce qui pourrait changer la cascade.
// Avec build.cssCodeSplit: false (vite.config.ts), elles forment une seule feuille chargée d'emblée.
// Une nouvelle feuille importée par un composant n'a pas besoin d'être ajoutée ici (elle sera
// chargée avec lui) ; l'ajouter fixe seulement sa place dans la cascade.
import '../features/library/library.css';
import '../features/workspaces/workspaces.css';
import '../features/home/home.css';
import '../components/multiselect.css';
import '../features/reader/html/html-reader.css';
import '../features/reader/pdf/pdf-reader.css';
import '../features/reader/image/image-reader.css';
import '../features/reader/reader-tools.css';
import '../features/reader/bookmarks/bookmarks.css';
import '../features/annotations/annotations.css';
import '../features/study/study.css';
import '@xyflow/react/dist/style.css';
import '@fontsource/caveat/400.css';
import '@fontsource/caveat/600.css';
import '../features/map/map.css';
import '../features/editor/side-panel.css';
import '../features/map/ui/passage/passage.css';
import '../features/map/ui/present/present.css';
import '../features/map/ui/convert/convert.css';
import '../features/map/ui/compare/compare.css';
import '../features/map/ui/stage/stage.css';
import '../features/reader/reader.css';
import '../features/concepts/concepts.css';
import '../features/annotations/all-extracts.css';
import '../features/arguments/arguments.css';
import '../features/revision/revision.css';
import '../features/plans/plans.css';
import '../features/editor/editor.css';
import 'superdoc/style.layered.css';
import '../features/editor/notes-outline.css';
import '../features/editor/find.css';
import '../features/editor/comments.css';
import '../features/editor/spell/spell.css';
import '../features/editor/style-review.css';
import '../features/editor/versions.css';
import '../features/editor/focus.css';
import '../components/command.css';
import '../features/trash/trash.css';
import '../features/history/history.css';
import '../features/help/help.css';
import '../features/map/board/board.css';
