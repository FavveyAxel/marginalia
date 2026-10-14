// Types minimaux de nspell 2.1.5 (paquet sans déclarations).
declare module 'nspell' {
  interface NSpell {
    correct(word: string): boolean;
    suggest(word: string): string[];
    add(word: string, model?: string): NSpell;
    remove(word: string): NSpell;
    personal(dic: string): NSpell;
  }
  function nspell(dictionary: { aff: string; dic: string }): NSpell;
  export default nspell;
}
