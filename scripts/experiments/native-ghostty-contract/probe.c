/* Mixed-header diagnostic. The audited headers collide in one translation unit.
 * Separate native-only and VT-only controls establish declaration availability.
 * This failure is not, by itself, proof that a bridge cannot be written.
 */
#include <ghostty.h>
#include <ghostty/vt/snapshot.h>

GhosttyResult (*const snapshot_ready)(GhosttySnapshotDecoder, GhosttyTerminal *) =
    ghostty_snapshot_decoder_ready;
GhosttyResult (*const snapshot_next)(GhosttySnapshotDecoder) =
    ghostty_snapshot_decoder_next;

ghostty_surface_t (*const create_surface)(ghostty_app_t,
                                         const ghostty_surface_config_s *) =
    ghostty_surface_new;
void (*const draw_surface)(ghostty_surface_t) = ghostty_surface_draw;
void (*const paste_to_child)(ghostty_surface_t, const char *, uintptr_t) =
    ghostty_surface_text;
