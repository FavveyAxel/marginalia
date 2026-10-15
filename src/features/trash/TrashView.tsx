// Vue « Corbeille » : éléments supprimés (avec tout ce qui leur était lié), 30 jours.
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { History, RotateCcw, Search, Trash2, X } from "lucide-react";
import { TRASH_DAYS, TRASH_MS, useStore } from "../../lib/store";
import type { TrashEntry, TrashKind } from "../../lib/types";
import { KIND_LABEL, KIND_PLURAL } from "../history/describe";
import { dayKey, groupByDay } from "../history/dates";
import { KindIcon } from "../history/icons";
import "./trash.css";

const KIND_ORDER: TrashKind[] = [
  "book",
  "draft",
  "highlight",
  "concept",
  "argument",
  "study",
  "plan",
  "card",
  "workspace",
  "group",
  "map",
];
const fold = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Jours restants avant l'effacement (1 = dernier jour). */
export function daysLeft(t: TrashEntry, now = Date.now()): number {
  return Math.max(1, Math.ceil((t.deletedAt + TRASH_MS - now) / 86_400_000));
}
/** « Supprimé aujourd'hui », « Supprimé hier », « Supprimé le 16 septembre ». */
function deletedOn(ts: number): string {
  const k = dayKey(ts);
  if (k === dayKey(Date.now())) return "Supprimé aujourd’hui";
  if (k === dayKey(Date.now() - 86_400_000)) return "Supprimé hier";
  return `Supprimé le ${new Date(ts).toLocaleDateString("fr-FR", { day: "numeric", month: "long" })}`;
}
const daysText = (n: number) => (n <= 1 ? "Dernier jour" : `Encore ${n} jours`);

export function TrashView() {
  const trash = useStore((s) => s.trash);
  const books = useStore((s) => s.books);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<TrashKind | "">("");
  const [by, setBy] = useState<"date" | "type">("date");
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const [busy, setBusy] = useState(false);

  const counts = useMemo(() => {
    const m = new Map<TrashKind, number>();
    for (const t of trash) m.set(t.kind, (m.get(t.kind) ?? 0) + 1);
    return m;
  }, [trash]);

  const bookTitle = (id: string | null) =>
    id
      ? (books.find((b) => b.id === id)?.title ??
        trash.find((t) => t.kind === "book" && t.refId === id)?.title ??
        null)
      : null;

  const filtered = useMemo(() => {
    const q = fold(query.trim());
    return [...trash]
      .filter(
        (t) =>
          (!kind || t.kind === kind) &&
          (!q ||
            fold(`${t.title} ${t.detail} ${KIND_LABEL[t.kind]}`).includes(q)),
      )
      .sort((a, b) => b.deletedAt - a.deletedAt);
  }, [trash, kind, query]);

  // Sections : un jour (« Aujourd'hui », « Hier »…) ou une nature d'élément, du plus récent au plus ancien.
  const sections = useMemo(() => {
    if (by === "date")
      return groupByDay(filtered, (t) => t.deletedAt).map((d) => ({
        key: d.key,
        label: d.label,
        items: d.items,
        kind: null as TrashKind | null,
      }));
    return KIND_ORDER.map((k) => ({
      key: k,
      label: cap(KIND_PLURAL[k]),
      items: filtered.filter((t) => t.kind === k),
      kind: k as TrashKind | null,
    })).filter((g) => g.items.length);
  }, [filtered, by]);

  const empty = async () => {
    setBusy(true);
    await useStore.getState().purgeTrash(undefined, "empty");
    setBusy(false);
    setConfirmEmpty(false);
    useStore.getState().toast("Corbeille vidée", "success");
  };

  let i = 0;
  return (
    <>
      <header className="topbar">
        <span className="spacer" />
        {trash.length > 0 && (
          <div className="tr-empty-anchor">
            <button
              className="btn btn-sm tr-empty-btn"
              onClick={() => setConfirmEmpty((v) => !v)}
              aria-expanded={confirmEmpty}
              aria-haspopup="dialog"
            >
              <Trash2 size={14} /> Vider la corbeille
            </button>
            {confirmEmpty && (
              <EmptyConfirm
                n={trash.length}
                busy={busy}
                onCancel={() => setConfirmEmpty(false)}
                onConfirm={empty}
              />
            )}
          </div>
        )}
      </header>

      <div className="tr-scroll">
        <div className="tr-page anim-view">
          <div className="tr-head">
            <h1 className="page-title">Corbeille</h1>
            <p className="tr-lede">
              Ce que vous supprimez reste ici {TRASH_DAYS} jours, avec tout ce
              qui y était lié : extraits, cartes, liens, place dans les espaces.
              Restaurer remet tout en place.
            </p>
          </div>

          {trash.length === 0 ? (
            <div className="empty tr-emptystate">
              <Trash2 size={26} />
              <h3>La corbeille est vide</h3>
              <p>
                Ce que vous supprimez y reste {TRASH_DAYS} jours, avec ses
                extraits et ses liens, avant d’être effacé.
              </p>
              <button
                className="btn"
                onClick={() =>
                  useStore.getState().navigate({ name: "history" })
                }
              >
                <History size={14} /> Voir l’historique
              </button>
            </div>
          ) : (
            <>
              <div className="tr-filters">
                <div className="tr-search">
                  <Search size={14} />
                  <input
                    className="input"
                    placeholder="Un titre, un mot…"
                    aria-label="Rechercher dans la corbeille"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                  {query && (
                    <button
                      className="icon-btn sm"
                      aria-label="Effacer la recherche"
                      onClick={() => setQuery("")}
                    >
                      <X size={13} />
                    </button>
                  )}
                </div>
                <div className="tr-filter-row">
                  <div
                    className="tr-chips"
                    role="group"
                    aria-label="Type d’élément"
                  >
                    <button
                      className={`chip ${kind === "" ? "active" : ""}`}
                      aria-pressed={kind === ""}
                      onClick={() => setKind("")}
                    >
                      Tout <span className="tr-n">{trash.length}</span>
                    </button>
                    {KIND_ORDER.filter((k) => counts.get(k)).map((k) => (
                      <button
                        key={k}
                        className={`chip ${kind === k ? "active" : ""}`}
                        aria-pressed={kind === k}
                        onClick={() => setKind(kind === k ? "" : k)}
                        data-kind={k}
                      >
                        <KindIcon kind={k} size={12} /> {cap(KIND_PLURAL[k])}{" "}
                        <span className="tr-n">{counts.get(k)}</span>
                      </button>
                    ))}
                  </div>
                  <div
                    className="segmented tr-by"
                    role="group"
                    aria-label="Regrouper"
                  >
                    <button
                      className={by === "date" ? "active" : ""}
                      aria-pressed={by === "date"}
                      onClick={() => setBy("date")}
                    >
                      Par date
                    </button>
                    <button
                      className={by === "type" ? "active" : ""}
                      aria-pressed={by === "type"}
                      onClick={() => setBy("type")}
                    >
                      Par type
                    </button>
                  </div>
                </div>
              </div>

              {filtered.length === 0 ? (
                <div className="empty">
                  <h3>Rien ne correspond</h3>
                  <p>
                    Aucun élément de la corbeille ne correspond à cette
                    recherche.
                  </p>
                  <button
                    className="btn"
                    onClick={() => {
                      setQuery("");
                      setKind("");
                    }}
                  >
                    Effacer les filtres
                  </button>
                </div>
              ) : (
                sections.map((d) => (
                  <section key={d.key} className="tr-day" aria-label={d.label}>
                    <h2 className="tr-day-title">
                      {d.label}{" "}
                      <span className="tr-day-n">{d.items.length}</span>
                    </h2>
                    <ul className="tr-list anim-stagger">
                      {d.items.map((t) => (
                        <TrashRow
                          key={t.id}
                          t={t}
                          index={i++}
                          parent={
                            t.kind !== "book" ? bookTitle(t.bookId) : null
                          }
                          showDate={by === "type"}
                        />
                      ))}
                    </ul>
                  </section>
                ))
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function EmptyConfirm({
  n,
  busy,
  onCancel,
  onConfirm,
}: {
  n: number;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const keep = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    keep.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);
  return (
    <div
      className="floating tr-pop anim-scale"
      role="alertdialog"
      aria-labelledby="tr-pop-t"
      aria-describedby="tr-pop-d"
    >
      <strong id="tr-pop-t">Vider la corbeille ?</strong>
      <p id="tr-pop-d">
        {n > 1 ? `Les ${n} éléments` : "L’élément"} et leurs fichiers seront
        effacés. Vous ne pourrez plus les restaurer.
      </p>
      <div className="tr-pop-actions">
        <button className="btn btn-sm" ref={keep} onClick={onCancel}>
          Garder
        </button>
        <button
          className="btn btn-sm btn-danger"
          disabled={busy}
          onClick={onConfirm}
        >
          Vider la corbeille
        </button>
      </div>
    </div>
  );
}

function TrashRow({
  t,
  index,
  parent,
  showDate,
}: {
  t: TrashEntry;
  index: number;
  parent: string | null;
  showDate: boolean;
}) {
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState("");
  const left = daysLeft(t);
  const frac = Math.min(
    1,
    Math.max(0, (t.deletedAt + TRASH_MS - Date.now()) / TRASH_MS),
  );

  const restore = () => {
    const r = useStore.getState().restoreFromTrash(t.id);
    if (!r.ok) setError(r.message);
  };
  const purge = async () => {
    await useStore.getState().purgeTrash([t.id], "manual");
    useStore
      .getState()
      .toast(`« ${t.title} » supprimé définitivement`, "success");
  };

  const quote = t.kind === "highlight";
  return (
    <li
      className={`tr-row ${confirm ? "confirming" : ""}`}
      style={{ "--i": index } as CSSProperties}
      data-trash={t.id}
      data-kind={t.kind}
    >
      <span className="tr-icon" aria-hidden>
        <KindIcon kind={t.kind} />
      </span>
      <div className="tr-body">
        <div className={`tr-title ${quote ? "quote" : ""}`}>
          {quote ? `« ${t.title} »` : t.title}
        </div>
        <div className="tr-meta">
          {parent && (
            <span className="truncate">
              {t.kind === "highlight" ? "Extrait de" : "Lié à"} « {parent} »
            </span>
          )}
          {t.detail && <span>{t.detail}</span>}
          {showDate && <span>{deletedOn(t.deletedAt)}</span>}
        </div>
        {error && (
          <p className="tr-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <div
        className="tr-time"
        title={`Effacé le ${new Date(t.deletedAt + TRASH_MS).toLocaleDateString("fr-FR", { day: "numeric", month: "long" })}`}
      >
        <span className={`tr-left ${left <= 3 ? "soon" : ""}`}>
          {daysText(left)}
        </span>
        <span className="tr-gauge" aria-hidden>
          <i style={{ width: `${frac * 100}%` }} />
        </span>
      </div>
      <div className="tr-actions">
        {confirm ? (
          <span
            className="tr-confirm anim-fade"
            role="group"
            aria-label="Confirmer la suppression définitive"
          >
            <span className="tr-confirm-q">Supprimer définitivement ?</span>
            <button
              className="btn btn-sm btn-ghost"
              onClick={() => setConfirm(false)}
              autoFocus
            >
              Garder
            </button>
            <button className="btn btn-sm btn-danger" onClick={purge}>
              Supprimer
            </button>
          </span>
        ) : (
          <>
            <button className="btn btn-sm" onClick={restore}>
              <RotateCcw size={13} /> Restaurer
            </button>
            <button
              className="icon-btn sm tr-del"
              title="Supprimer définitivement"
              aria-label={`Supprimer définitivement « ${t.title} »`}
              onClick={() => setConfirm(true)}
            >
              <X size={14} />
            </button>
          </>
        )}
      </div>
    </li>
  );
}
