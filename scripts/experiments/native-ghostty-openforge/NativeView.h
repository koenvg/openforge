#import <AppKit/AppKit.h>
#import "ghostty-hosted.h"

// No IME, clipboard, accessibility, or native menu integration yet.
@interface OFGhosttyView : NSView
@property(nonatomic) ghostty_surface_t surface;
@end
