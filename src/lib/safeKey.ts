// Clés qui, utilisées comme nom de propriété, touchent au prototype des objets JavaScript. Les données
// reçues (paquet .marginalia, travail à plusieurs) ne les acceptent jamais comme identifiant, clé ou nom
// de fichier : défense en profondeur contre la « pollution de prototype ».
const RESERVED = new Set(['__proto__', 'constructor', 'prototype']);
export const isReservedKey = (s: string): boolean => RESERVED.has(s);
