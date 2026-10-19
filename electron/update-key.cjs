// Clé PUBLIQUE (Ed25519) qui vérifie le manifeste des mises à jour (latest.json + latest.json.sig,
// joints à chaque Release GitHub). La clé privée correspondante n'est jamais dans le dépôt : la CI la
// lit dans le secret MARGINALIA_UPDATE_KEY. Sans manifeste signé par cette clé, rien n'est installé.
'use strict';

module.exports = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAGX2vSLt9surNkG8a9r1cVqAB77kKvs6JxWJ3co2Z07Q=
-----END PUBLIC KEY-----
`;
