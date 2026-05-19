"""Memory layer: episodic + semantic stores.

Plan §3 in machine form.

Two stores. Vector embeddings sit underneath as an index but are not
the memory itself — Phase 1 keeps embeddings optional (the schema is
ready, the retriever fallback path lands in chunk 6). Salience is
*input* to write, not work the store performs: the agent's structured
extraction call in the turn loop computes it and hands it to
[`MemoryStore.write_episodic`][glashaus.memory.store.MemoryStore.write_episodic].

Convention: any SELECT that joins `episodic` ↔ `episodic_vec` (or the
semantic equivalents) uses `LEFT JOIN`. Records without embeddings must
still surface in non-vector retrieval paths.
"""

from glashaus.memory.store import MemoryStore
from glashaus.memory.types import Affect, EpisodicMemory, SemanticMemory

__all__ = [
    "Affect",
    "EpisodicMemory",
    "MemoryStore",
    "SemanticMemory",
]
