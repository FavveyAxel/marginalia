// Panneau droit « Extraits » de l'éditeur : recherche, filtre par livre, insertion en citation + note.
import { useMemo, useState } from "react";
import { Copy, CornerDownLeft, Search, X } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "../../lib/store";
import type { Book, Highlight } from "../../lib/types";
import { formatCitation, formatFootnote, locatorOf } from "../../lib/citation";
import { CategoryDot } from "../../components/ui";

export function quoteText(h: Highlight): string {
  return `« ${h.text.replace(/\s+/g, " ").trim()} »`;
}

const norm = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export function ExtractsPane({
  onInsert,
  onClose,
  disabled,
}: {
  onInsert: (h: Highlight, book: Book) => void;
  onClose: () => void;
  disabled: boolean;
}) {
  const highlights = useStore(useShallow((s) => s.highlights));
  const books = useStore(useShallow((s) => s.books));
  const [q, setQ] = useState("");
  const [bookId, setBookId] = useState<string>("");
  const byId = useMemo(() => new Map(books.map((b) => [b.id, b])), [books]);
  const withHl = useMemo(() => {
    const ids = new Set(highlights.map((h) => h.bookId));
    return books
      .filter((b) => ids.has(b.id))
      .sort((a, b) => a.title.localeCompare(b.title, "fr"));
  }, [books, highlights]);
  const list = useMemo(() => {
    const nq = norm(q.trim());
    return highlights
      .filter((h) => byId.has(h.bookId) && h.text.trim())
      .filter((h) => !bookId || h.bookId === bookId)
      .filter(
        (h) =>
          !nq ||
          norm(
            `${h.text} ${h.note} ${byId.get(h.bookId)?.title ?? ""} ${byId.get(h.bookId)?.author ?? ""}`,
          ).includes(nq),
      )
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 300);
  }, [highlights, byId, q, bookId]);

  return (
    <aside className="ed-extracts panel anim-slide" aria-label="Extraits">
      <div className="ed-extracts-head">
        <h2>Extraits</h2>
        <button
          className="icon-btn sm"
          onClick={onClose}
          aria-label="Fermer le panneau"
        >
          <X size={15} />
        </button>
      </div>
      <div className="ed-extracts-filters">
        <label className="ed-search">
          <Search size={14} />
          <input
            className="input"
            placeholder="Rechercher"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Rechercher dans les extraits"
          />
        </label>
        <select
          className="input ed-select"
          value={bookId}
          onChange={(e) => setBookId(e.target.value)}
          aria-label="Filtrer par livre"
        >
          <option value="">Tous les livres</option>
          {withHl.map((b) => (
            <option key={b.id} value={b.id}>
              {b.title}
            </option>
          ))}
        </select>
      </div>
      <div className="ed-extracts-list">
        {list.length === 0 ? (
          <div className="ed-extracts-empty">
            {highlights.length === 0 ? (
              <>
                <strong>Pas encore d’extraits</strong>
                <span>
                  Surlignez des passages dans vos lectures : ils apparaîtront
                  ici, prêts à être cités.
                </span>
              </>
            ) : (
              <>
                <strong>Aucun résultat</strong>
                <span>Essayez un autre mot ou un autre livre.</span>
              </>
            )}
          </div>
        ) : (
          list.map((h) => {
            const b = byId.get(h.bookId)!;
            const loc = locatorOf(h);
            return (
              <div key={h.id} className="ed-xt" data-hl={h.id}>
                <p className="ed-xt-text">
                  {h.text.replace(/\s+/g, " ").trim()}
                </p>
                <div className="ed-xt-foot">
                  <div className="ed-xt-meta">
                    {h.category && <CategoryDot id={h.category} size={7} />}
                    <span
                      className="truncate"
                      title={`${b.author ? b.author + ", " : ""}${b.title}`}
                    >
                      {b.title}
                      {loc ? ` · ${loc}` : ""}
                    </span>
                  </div>
                  <div className="ed-xt-actions">
                    <button
                      className="icon-btn sm"
                      title="Copier la citation"
                      aria-label="Copier la citation"
                      onClick={() => {
                        navigator.clipboard
                          ?.writeText(formatCitation(h, b))
                          .then(
                            () => useStore.getState().toast("Citation copiée"),
                            () =>
                              useStore
                                .getState()
                                .toast("Copie impossible", "error"),
                          );
                      }}
                    >
                      <Copy size={13} />
                    </button>
                    <button
                      className="btn btn-sm ed-xt-insert"
                      disabled={disabled}
                      onClick={() => onInsert(h, b)}
                      title={`Note : ${formatFootnote(h, b)}`}
                    >
                      <CornerDownLeft size={13} /> Insérer
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}
