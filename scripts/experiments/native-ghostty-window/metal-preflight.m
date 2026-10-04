// Compile the pinned Ghostty shader source through the system Metal API.
// This is a build prerequisite probe, not evidence of a rendered terminal.
#import <Foundation/Foundation.h>
#import <Metal/Metal.h>

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        if (argc != 2) {
            fprintf(stderr, "usage: metal-preflight <shaders.metal>\n");
            return 2;
        }
        NSError *error = nil;
        NSString *source = [NSString stringWithContentsOfFile:@(argv[1])
                                                    encoding:NSUTF8StringEncoding
                                                       error:&error];
        id<MTLDevice> device = MTLCreateSystemDefaultDevice();
        id<MTLLibrary> library = nil;
        if (source && device) {
            library = [device newLibraryWithSource:source options:nil error:&error];
        }
        NSDictionary *report = @{
            @"device": device.name ?: @"unavailable",
            @"compiled": @(library != nil),
            @"functions": library.functionNames ?: @[],
            @"error": error.localizedDescription ?: @"",
            @"scope": @"Runtime shader compilation only; no terminal or frame"
        };
        NSData *json = [NSJSONSerialization dataWithJSONObject:report
                                                      options:NSJSONWritingPrettyPrinted
                                                        error:NULL];
        fwrite(json.bytes, 1, json.length, stdout);
        fputc('\n', stdout);
        return library ? 0 : 1;
    }
}
