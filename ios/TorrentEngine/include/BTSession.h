#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN
/// One foreground-only, selected-file torrent session. All file writes remain
/// inside the supplied application-private directory.
@interface BTTorrentSession : NSObject
- (instancetype)initWithRoot:(NSString *)root;
- (BOOL)startTorrent:(NSData *)metadata expectedMD5:(NSString *)md5 error:(NSError **)error;
- (NSDictionary<NSString *, id> *)snapshot;
- (void)setActive:(BOOL)active;
- (void)stop;
@end
NS_ASSUME_NONNULL_END
