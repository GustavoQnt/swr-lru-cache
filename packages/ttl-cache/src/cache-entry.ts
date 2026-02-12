/**
 * Representa um item no cache com metadados de TTL e SWR.
 * Inclui ponteiros prev/next para a lista duplamente encadeada (LRU).
 */
export class CacheEntry<K, V> {
  key: K;
  value: V;
  /** Momento em que o TTL expira (valor "stale" fica servível apenas se swrMs > 0) */
  expiresAt: number;
  /** Fim da janela SWR. Depois disso, entry está totalmente expirada. */
  staleUntil: number;
  // Ponteiros para a lista duplamente encadeada (LRU ordering)
  prev: CacheEntry<K, V> | null = null;
  next: CacheEntry<K, V> | null = null;

  constructor(key: K, value: V, expiresAt: number, staleUntil: number) {
    this.key = key;
    this.value = value;
    this.expiresAt = expiresAt;
    this.staleUntil = staleUntil;
  }

  /** Verifica se o item está dentro do TTL (fresco e pode ser servido direto) */
  isFresh(now: number): boolean {
    return now < this.expiresAt;
  }

  /**
   * Verifica se o item está na janela SWR (passado TTL, mas ainda dentro da janela SWR).
   * Neste estado, o valor pode ser servido mas deve ser revalidado em background.
   */
  isStale(now: number): boolean {
    return now >= this.expiresAt && now < this.staleUntil;
  }

  /** Verifica se o item está completamente expirado (fora do TTL e da janela SWR) */
  isExpired(now: number): boolean {
    return now >= this.staleUntil;
  }
}
