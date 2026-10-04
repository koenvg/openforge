#include <assert.h>
#include <ghostty-hosted.h>

int main(void) {
  // Invalid constructor inputs fail before touching an application or view.
  assert(ghostty_surface_new_hosted(NULL, NULL, NULL) == NULL);
  return 0;
}
