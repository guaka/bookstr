#include <jni.h>
#include <libtorrent/session.hpp>
#include <libtorrent/torrent_info.hpp>
#include <libtorrent/torrent_handle.hpp>
#include <libtorrent/torrent_status.hpp>
#include <libtorrent/add_torrent_params.hpp>
#include <libtorrent/read_resume_data.hpp>
#include <libtorrent/write_resume_data.hpp>
#include <libtorrent/alert_types.hpp>
#include <fstream>
#include <sstream>
#include <chrono>
#include <thread>
#include <algorithm>
namespace lt = libtorrent;
namespace {
std::string text(JNIEnv* env, jstring value) {
    if (!value) return {};
    const char* chars = env->GetStringUTFChars(value, nullptr);
    std::string result(chars); env->ReleaseStringUTFChars(value, chars); return result;
}
void fail(JNIEnv* env, std::exception const& error) {
    env->ThrowNew(env->FindClass("java/lang/IllegalStateException"), error.what());
}
struct Engine {
    std::unique_ptr<lt::session> session;
    lt::torrent_handle handle;
    std::string root, path, failure;
    int64_t size = 0;
    bool saved = false;
    std::chrono::steady_clock::time_point last_save = std::chrono::steady_clock::now();
    void collect() {
        std::vector<lt::alert*> alerts;
        session->pop_alerts(&alerts);
        for (auto* alert : alerts) {
            if (auto* data = lt::alert_cast<lt::save_resume_data_alert>(alert)) {
                auto bytes = lt::write_resume_data_buf(data->params);
                std::ofstream out(root + "/resume.tmp", std::ios::binary | std::ios::trunc);
                out.write(bytes.data(), bytes.size()); out.close();
                if (out) std::rename((root + "/resume.tmp").c_str(), (root + "/resume.dat").c_str());
                saved = true;
            } else if (auto* error = lt::alert_cast<lt::torrent_error_alert>(alert)) failure = error->error.message();
            else if (lt::alert_cast<lt::save_resume_data_failed_alert>(alert)) saved = true;
        }
    }
    ~Engine() {
        if (!session || !handle.is_valid()) return;
        handle.pause(); handle.save_resume_data(lt::torrent_handle::flush_disk_cache);
        saved = false;
        const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(2);
        while (!saved && std::chrono::steady_clock::now() < deadline) {
            session->wait_for_alert(std::chrono::milliseconds(50)); collect();
        }
    }
};
bool safe(std::string const& path) {
    if (path.empty() || path[0] == '/' || path.find('\\') != std::string::npos || path.find(':') != std::string::npos) return false;
    std::istringstream parts(path); std::string part;
    while (std::getline(parts, part, '/')) if (part == ".." || part == ".") return false;
    return true;
}
}
extern "C" JNIEXPORT jlong JNICALL Java_app_bookstr_download_NativeTorrentEngine_create(JNIEnv* env, jobject, jstring root, jbyteArray metadata, jstring hash, jstring filename) {
    try {
        auto engine = std::make_unique<Engine>();
        engine->root = text(env, root);
        const auto md5 = text(env, hash), selected = text(env, filename);
        const auto count = env->GetArrayLength(metadata);
        if (count < 1 || count > 16 * 1024 * 1024 || md5.size() != 32 || md5.find_first_not_of("0123456789abcdef") != std::string::npos) throw std::runtime_error("Invalid torrent metadata");
        if (!selected.empty() && (selected.size() > 16 || selected.find_first_not_of("0123456789") != std::string::npos)) throw std::runtime_error("Invalid edition filename");
        std::vector<char> bytes(count);
        env->GetByteArrayRegion(metadata, 0, count, reinterpret_cast<jbyte*>(bytes.data()));
        lt::error_code ec;
        auto info = std::make_shared<lt::torrent_info>(bytes.data(), count, ec);
        if (ec) throw std::runtime_error(ec.message());
        lt::file_index_t chosen(-1);
        for (auto index : info->files().file_range()) {
            if (!safe(info->files().file_path(index)) || (info->files().file_flags(index) & lt::file_storage::flag_symlink)) throw std::runtime_error("Unsafe torrent path");
            auto name_view = info->files().file_name(index);
            std::string name(name_view.data(), name_view.size());
            auto base = name.substr(0, name.find('.'));
            std::transform(base.begin(), base.end(), base.begin(), [](unsigned char c) { return std::tolower(c); });
            if (selected.empty() ? base == md5 : name == selected) {
                if (chosen != lt::file_index_t(-1)) throw std::runtime_error("Ambiguous edition in torrent");
                chosen = index;
            }
        }
        if (chosen == lt::file_index_t(-1)) throw std::runtime_error("Edition absent from torrent");
        engine->size = info->files().file_size(chosen);
        if (engine->size < 1 || engine->size > int64_t(8) * 1024 * 1024 * 1024) throw std::runtime_error("Unsupported edition size");
        // Never use remote names as local paths. Unwanted boundary pieces go to the partfile.
        for (auto index : info->files().file_range()) info->rename_file(index, index == chosen ? "payload" : "unselected/" + std::to_string(static_cast<int>(index)));
        engine->path = engine->root + "/payload";
        lt::settings_pack settings;
        // Find useful peers sooner in sparse book swarms without imposing a rate cap.
        settings.set_int(lt::settings_pack::connections_limit, 120);
        settings.set_int(lt::settings_pack::connection_speed, 60);
        settings.set_bool(lt::settings_pack::announce_to_all_trackers, true);
        settings.set_bool(lt::settings_pack::announce_to_all_tiers, true);
        settings.set_int(lt::settings_pack::aio_threads, 2);
        settings.set_int(lt::settings_pack::alert_mask, lt::alert_category::error | lt::alert_category::storage | lt::alert_category::status);
        settings.set_bool(lt::settings_pack::enable_lsd, false);
        settings.set_str(lt::settings_pack::dht_bootstrap_nodes, "router.bittorrent.com:6881,router.utorrent.com:6881,dht.transmissionbt.com:6881");
        engine->session = std::make_unique<lt::session>(settings);
        lt::add_torrent_params params;
        std::ifstream resume(engine->root + "/resume.dat", std::ios::binary);
        if (resume) {
            std::vector<char> saved((std::istreambuf_iterator<char>(resume)), {});
            auto restored = lt::read_resume_data({saved.data(), static_cast<long>(saved.size())}, ec);
            if (!ec && restored.info_hashes == info->info_hashes()) params = std::move(restored);
        }
        params.ti = info; params.save_path = engine->root;
        params.renamed_files.clear();
        params.file_priorities.assign(info->num_files(), lt::dont_download);
        params.file_priorities[static_cast<int>(chosen)] = lt::default_priority;
        params.flags &= ~lt::torrent_flags::auto_managed;
        params.flags &= ~lt::torrent_flags::paused;
        engine->handle = engine->session->add_torrent(params, ec);
        if (ec) throw std::runtime_error(ec.message());
        return reinterpret_cast<jlong>(engine.release());
    } catch (std::exception const& error) { fail(env, error); return 0; }
}
extern "C" JNIEXPORT jobjectArray JNICALL Java_app_bookstr_download_NativeTorrentEngine_snapshot(JNIEnv* env, jobject, jlong pointer) {
    auto* engine = reinterpret_cast<Engine*>(pointer);
    try {
        engine->collect(); auto status = engine->handle.status();
        bool ready = status.is_finished && status.state != lt::torrent_status::checking_files && status.state != lt::torrent_status::checking_resume_data;
        if (std::chrono::steady_clock::now() - engine->last_save > std::chrono::seconds(10)) {
            // Checkpoint changed resume state without forcing an active transfer to flush.
            // The destructor still flushes before verification, pause, and shutdown.
            engine->handle.save_resume_data(lt::torrent_handle::only_if_modified); engine->last_save = std::chrono::steady_clock::now();
        }
        const std::string error = engine->failure.empty() ? (status.errc ? status.errc.message() : "") : engine->failure;
        const std::string values[] = { !error.empty() ? "failed" : ready ? "ready" : status.num_peers ? "downloading" : "finding-peers",
            std::to_string(status.total_wanted_done), std::to_string(engine->size), engine->path, error };
        auto result = env->NewObjectArray(5, env->FindClass("java/lang/String"), nullptr);
        for (int i = 0; i < 5; ++i) { auto value = env->NewStringUTF(values[i].c_str()); env->SetObjectArrayElement(result, i, value); env->DeleteLocalRef(value); }
        return result;
    } catch (std::exception const& error) { fail(env, error); return nullptr; }
}
extern "C" JNIEXPORT void JNICALL Java_app_bookstr_download_NativeTorrentEngine_destroy(JNIEnv*, jobject, jlong pointer) { delete reinterpret_cast<Engine*>(pointer); }
