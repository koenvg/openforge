/* An older, compatible image reports its contract without a startup marker. */
#include <CommonCrypto/CommonDigest.h>
#include <fcntl.h>
#include <limits.h>
#include <stdio.h>
#include <string.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <unistd.h>

#ifndef PROTOCOL_VERSION
#error PROTOCOL_VERSION must match the session protocol
#endif

int main(int argc, char **argv) {
    if (argc != 2 || strcmp(argv[1], "--check-image") != 0) return 1;
    int fd = open(argv[0], O_RDONLY);
    if (fd < 0) return 2;
    struct stat info;
    if (fstat(fd, &info) != 0 || info.st_size <= 0 || info.st_size > UINT_MAX) return 3;
    void *bytes = mmap(NULL, (size_t)info.st_size, PROT_READ, MAP_PRIVATE, fd, 0);
    if (bytes == MAP_FAILED) return 4;
    unsigned char digest[CC_SHA256_DIGEST_LENGTH];
    if (CC_SHA256(bytes, (CC_LONG)info.st_size, digest) == NULL) return 5;
    if (munmap(bytes, (size_t)info.st_size) != 0 || close(fd) != 0) return 6;
    printf("{\"protocol\":%d,\"stateFormat\":1,\"authorityCodec\":\"ghostty-de9fd9b0-worker-v1\",\"architecture\":\"aarch64\",\"imageVersion\":\"older-markerless-image\",\"sha256\":\"", PROTOCOL_VERSION);
    for (size_t i = 0; i < sizeof(digest); i++) printf("%02x", digest[i]);
    puts("\",\"stateDigest\":null}");
    return 0;
}
