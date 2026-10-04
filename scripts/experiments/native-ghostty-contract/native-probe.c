/* Compile-only positive control. Does not create a surface or PTY. */
#include <ghostty.h>

ghostty_surface_t (*const create_surface)(ghostty_app_t,
                                         const ghostty_surface_config_s *) =
    ghostty_surface_new;
void (*const draw_surface)(ghostty_surface_t) = ghostty_surface_draw;
void (*const paste_to_child)(ghostty_surface_t, const char *, uintptr_t) =
    ghostty_surface_text;
