// Animation posée sur une image pendant la reconnaissance de son texte : un faisceau balaie la page,
// les lignes de texte s'éclairent à son passage, des coins de visée encadrent l'image.
// Purement décoratif (aria-hidden) ; la progression chiffrée reste affichée à part.
export function OcrScan({ className = '' }: { className?: string }) {
  return (
    <div className={`ocr-scan ${className}`} aria-hidden="true" data-testid="ocr-scan">
      <span className="ocr-scan-band" />
      <span className="ocr-scan-corners" />
    </div>
  );
}
