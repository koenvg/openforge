/* Compile-only positive control. Does not decode or render a snapshot. */
#include <ghostty/vt/snapshot.h>

GhosttyResult (*const snapshot_ready)(GhosttySnapshotDecoder, GhosttyTerminal *) =
    ghostty_snapshot_decoder_ready;
GhosttyResult (*const snapshot_next)(GhosttySnapshotDecoder) =
    ghostty_snapshot_decoder_next;
