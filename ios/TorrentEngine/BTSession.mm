#import "BTSession.h"
#include <libtorrent/session.hpp>
#include <libtorrent/torrent_info.hpp>
#include <libtorrent/torrent_handle.hpp>
#include <libtorrent/torrent_status.hpp>
#include <libtorrent/add_torrent_params.hpp>
#include <libtorrent/read_resume_data.hpp>
#include <libtorrent/write_resume_data.hpp>
#include <libtorrent/alert_types.hpp>
#include <fstream>

namespace lt = libtorrent;
@implementation BTTorrentSession {
    std::unique_ptr<lt::session> _session;
    lt::torrent_handle _handle;
    NSString *_root;
    NSString *_selectedPath;
    NSString *_failure;
    BOOL _active;
    int64_t _size;
}
- (instancetype)initWithRoot:(NSString *)root {
    if ((self = [super init])) { _root = [root copy]; _active = YES; }
    return self;
}
- (BOOL)startTorrent:(NSData *)metadata expectedMD5:(NSString *)md5 error:(NSError **)error {
    return [self startTorrent:metadata expectedMD5:md5 selectedFilename:nil error:error];
}
- (BOOL)startTorrent:(NSData *)metadata expectedMD5:(NSString *)md5 selectedFilename:(NSString *)selectedFilename error:(NSError **)error {
    try {
        [self stop];
        _failure = nil;
        if (metadata.length == 0 || metadata.length > 16 * 1024 * 1024 || md5.length != 32)
            throw std::runtime_error("Invalid torrent metadata");
        if (selectedFilename && (selectedFilename.length == 0 || selectedFilename.length > 16 ||
            [selectedFilename rangeOfCharacterFromSet:[[NSCharacterSet characterSetWithCharactersInString:@"0123456789"] invertedSet]].location != NSNotFound))
            throw std::runtime_error("Invalid selected filename");
        lt::error_code ec;
        auto info = std::make_shared<lt::torrent_info>((char const *)metadata.bytes, (int)metadata.length, ec);
        if (ec) throw std::runtime_error(ec.message());
        lt::file_index_t chosen(-1);
        for (auto index : info->files().file_range()) {
            auto name = info->files().file_name(index);
            NSString *filename = [[NSString alloc] initWithBytes:name.data() length:name.size() encoding:NSUTF8StringEncoding];
            NSString *hash = [filename.lowercaseString componentsSeparatedByString:@"."].firstObject;
            if (selectedFilename ? [filename isEqualToString:selectedFilename] : [hash isEqualToString:md5.lowercaseString]) {
                if (chosen != lt::file_index_t(-1)) throw std::runtime_error("Ambiguous edition in torrent");
                chosen = index;
            }
        }
        if (chosen == lt::file_index_t(-1)) {
            if (error) *error = [NSError errorWithDomain:@"BookstrTorrent" code:2 userInfo:@{NSLocalizedDescriptionKey:@"This edition is absent from the torrent"}];
            return NO;
        }
        _size = info->files().file_size(chosen);
        if (_size < 1 || _size > int64_t(8) * 1024 * 1024 * 1024 || (info->files().file_flags(chosen) & lt::file_storage::flag_symlink))
            throw std::runtime_error("Unsupported torrent file");
        NSString *relative = [NSString stringWithUTF8String:info->files().file_path(chosen).c_str()];
        if ([relative isAbsolutePath] || [relative.pathComponents containsObject:@".."])
            throw std::runtime_error("Unsafe torrent path");
        _selectedPath = [_root stringByAppendingPathComponent:relative];
        lt::settings_pack settings;
        settings.set_int(lt::settings_pack::connections_limit, 60);
        settings.set_int(lt::settings_pack::aio_threads, 2);
        settings.set_int(lt::settings_pack::alert_mask, lt::alert_category::error | lt::alert_category::storage | lt::alert_category::status);
        settings.set_str(lt::settings_pack::dht_bootstrap_nodes, "router.bittorrent.com:6881,router.utorrent.com:6881,dht.transmissionbt.com:6881");
        _session = std::make_unique<lt::session>(settings);
        lt::add_torrent_params params;
        NSData *resume = [NSData dataWithContentsOfFile:[_root stringByAppendingPathComponent:@"resume.dat"]];
        if (resume) {
            auto saved = lt::read_resume_data({(char const *)resume.bytes, (long)resume.length}, ec);
            if (!ec && saved.info_hashes == info->info_hashes()) params = std::move(saved);
        }
        params.ti = info;
        params.save_path = _root.UTF8String;
        params.file_priorities.assign(info->num_files(), lt::dont_download);
        params.file_priorities[static_cast<int>(chosen)] = lt::default_priority;
        params.flags &= ~lt::torrent_flags::auto_managed;
        params.flags &= ~lt::torrent_flags::paused;
        _handle = _session->add_torrent(params, ec);
        if (ec) throw std::runtime_error(ec.message());
        if (!_active) _session->pause();
        return YES;
    } catch (std::exception const &exception) {
        [self stop];
        if (error) *error = [NSError errorWithDomain:@"BookstrTorrent" code:1 userInfo:@{NSLocalizedDescriptionKey:[NSString stringWithUTF8String:exception.what()]}];
        return NO;
    }
}
- (void)collectAlerts {
    if (!_session) return;
    std::vector<lt::alert *> alerts;
    _session->pop_alerts(&alerts);
    for (auto alert : alerts) {
        if (auto saved = lt::alert_cast<lt::save_resume_data_alert>(alert)) {
            auto bytes = lt::write_resume_data_buf(saved->params);
            NSData *data = [NSData dataWithBytes:bytes.data() length:bytes.size()];
            [data writeToFile:[_root stringByAppendingPathComponent:@"resume.dat"] atomically:YES];
        } else if (auto failed = lt::alert_cast<lt::torrent_error_alert>(alert)) {
            _failure = [NSString stringWithUTF8String:failed->error.message().c_str()];
        }
    }
}
- (NSDictionary<NSString *,id> *)snapshot {
    [self collectAlerts];
    if (!_session || !_handle.is_valid()) return @{@"state":@"idle"};
    auto status = _handle.status();
    if (_failure || status.errc) return @{@"state":@"failed", @"error":_failure ?: [NSString stringWithUTF8String:status.errc.message().c_str()]};
    BOOL complete = status.is_finished && status.state != lt::torrent_status::checking_files && status.state != lt::torrent_status::checking_resume_data;
    if (complete) _handle.save_resume_data(lt::torrent_handle::flush_disk_cache);
    return @{@"state":complete ? @"ready" : (!_active ? @"paused" : (status.num_peers ? @"downloading" : @"finding-peers")),
        @"bytes":@(status.total_wanted_done), @"size":@(_size), @"peers":@(status.num_peers),
        @"seeds":@(status.num_seeds), @"rate":@(status.download_payload_rate), @"path":_selectedPath};
}
- (void)setActive:(BOOL)active {
    _active = active;
    if (!_session) return;
    if (active) _session->resume();
    else { _handle.save_resume_data(lt::torrent_handle::flush_disk_cache); _session->pause(); }
    [self collectAlerts];
}
- (void)stop {
    if (_session && _handle.is_valid()) { _handle.save_resume_data(lt::torrent_handle::flush_disk_cache); [self collectAlerts]; }
    _handle = lt::torrent_handle();
    _session.reset();
}
- (void)dealloc { [self stop]; }
@end
