/* Trusted negative targets for the private image preflight, never session owners. */
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

int main(int argc, char **argv) {
    if (argc != 2 || strcmp(argv[1], "--check-image")) return 80;
    int descriptors = 0;
    for (int fd = 3; fd < getdtablesize(); fd++) {
        if (fcntl(fd, F_GETFD) >= 0) descriptors++;
    }
    int has_secret = getenv("OPENFORGE_APP_DATA_DIR") != NULL;
    FILE *audit = fopen("probe-audit", "a");
    if (!audit) return 81;
    fprintf(audit, "%d %d %d\n", getpid(), descriptors, has_secret);
    if (fclose(audit)) return 82;
    if (descriptors || has_secret) return 83;
    const char *name = strrchr(argv[0], '/');
    name = name ? name + 1 : argv[0];
    if (!strcmp(name, "unresponsive")) {
        for (;;) pause();
    }
    if (!strcmp(name, "empty-response")) return 0;
    if (!strcmp(name, "oversized-response")) {
        for (int i = 0; i < 8192; i++) putchar('x');
        return 0;
    }
    printf("{\"protocol\":%d,\"stateFormat\":%d,\"authorityCodec\":\"%s\","
           "\"architecture\":\"%s\",\"imageVersion\":%d}\n",
           !strcmp(name, "wrong-protocol") ? 99 : 1,
           !strcmp(name, "wrong-state") ? 99 : 2,
           !strcmp(name, "wrong-codec") ? "incompatible" : "ghostty-de9fd9b0-v1",
           !strcmp(name, "wrong-architecture") ? "unsupported" : "aarch64",
           !strcmp(name, "wrong-version") ? 0 : 2);
    return 0;
}
