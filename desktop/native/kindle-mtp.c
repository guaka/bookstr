/* Small libmtp process boundary for Kindle e-readers. Only Amazon USB devices
 * are exposed, and writes are confined to their existing Documents folder. */
#include <libmtp.h>
#include <inttypes.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <sys/stat.h>
#include "kindle-usb.h"

static void json_string(const char *value) {
  putchar('"');
  for (const unsigned char *p = (const unsigned char *)(value ? value : ""); *p; ++p) {
    if (*p == '"' || *p == '\\') { putchar('\\'); putchar(*p); }
    else if (*p < 32) printf("\\u%04x", *p);
    else putchar(*p);
  }
  putchar('"');
}

static void device_id(char *target, size_t size, LIBMTP_raw_device_t *raw) {
  snprintf(target, size, "%u-%u", raw->bus_location, raw->devnum);
}

static LIBMTP_mtpdevice_t *open_kindle(const char *id) {
  LIBMTP_raw_device_t *raw = NULL;
  int count = 0;
  if (kindle_raw_devices(&raw, &count) != 0) {
    fputs("Kindle USB discovery failed while opening the device.\n", stderr);
    return NULL;
  }
  LIBMTP_mtpdevice_t *device = NULL;
  for (int i = 0; i < count; ++i) {
    char candidate[40];
    device_id(candidate, sizeof(candidate), &raw[i]);
    if (raw[i].device_entry.vendor_id == 0x1949 && strcmp(candidate, id) == 0) {
      device = LIBMTP_Open_Raw_Device_Uncached(&raw[i]);
      if (!device) fputs("Kindle MTP open failed; reconnect in USB transfer mode and close other transfer apps.\n", stderr);
      break;
    }
  }
  free(raw);
  return device;
}

typedef struct { uint32_t folder_id; uint32_t storage_id; } documents_ref_t;

static void free_file_list(LIBMTP_file_t *files) {
  while (files) {
    LIBMTP_file_t *next = files->next;
    LIBMTP_destroy_file_t(files);
    files = next;
  }
}

static int find_documents(LIBMTP_mtpdevice_t *device, documents_ref_t *documents) {
  if (LIBMTP_Get_Storage(device, LIBMTP_STORAGE_SORTBY_NOTSORTED) != 0) return 0;
  for (LIBMTP_devicestorage_t *storage = device->storage; storage; storage = storage->next) {
    LIBMTP_file_t *entries = LIBMTP_Get_Files_And_Folders(device, storage->id, LIBMTP_FILES_AND_FOLDERS_ROOT);
    for (LIBMTP_file_t *entry = entries; entry; entry = entry->next) {
      if (entry->filetype == LIBMTP_FILETYPE_FOLDER && entry->filename && strcasecmp(entry->filename, "documents") == 0) {
        documents->folder_id = entry->item_id;
        documents->storage_id = storage->id;
        free_file_list(entries);
        return 1;
      }
    }
    free_file_list(entries);
  }
  return 0;
}

static int list_devices(void) {
  LIBMTP_raw_device_t *raw = NULL;
  int count = 0;
  if (kindle_raw_devices(&raw, &count) != 0) {
    fputs("Kindle USB discovery failed.\n", stderr);
    puts("[]");
    return 0;
  }
  putchar('[');
  int printed = 0;
  for (int i = 0; i < count; ++i) {
    if (raw[i].device_entry.vendor_id != 0x1949) continue;
    // Discover Amazon USB candidates without opening MTP; preview opens the device.
    char id[40];
    device_id(id, sizeof(id), &raw[i]);
    if (printed++) putchar(',');
    printf("{\"id\":"); json_string(id);
    printf(",\"name\":\"Kindle\"}");
  }
  puts("]");
  free(raw);
  return 0;
}

static void print_files(LIBMTP_mtpdevice_t *device, uint32_t storage_id, uint32_t folder_id,
                        int depth, int *printed) {
  if (depth > 8) return;
  LIBMTP_file_t *files = LIBMTP_Get_Files_And_Folders(device, storage_id, folder_id);
  for (LIBMTP_file_t *file = files; file; file = file->next) {
    if (file->filetype == LIBMTP_FILETYPE_FOLDER) {
      print_files(device, storage_id, file->item_id, depth + 1, printed);
      continue;
    }
    if (!file->filename || !file->filesize) continue;
    if ((*printed)++) putchar(',');
    printf("{\"id\":\"%" PRIu32 "\",\"name\":", file->item_id);
    json_string(file->filename);
    printf(",\"size\":%" PRIu64 "}", file->filesize);
  }
  free_file_list(files);
}

static int list_files(LIBMTP_mtpdevice_t *device) {
  documents_ref_t documents;
  if (!find_documents(device, &documents)) {
    fputs("Kindle Documents folder could not be read during preview.\n", stderr);
    return 1;
  }
  putchar('[');
  int printed = 0;
  print_files(device, documents.storage_id, documents.folder_id, 0, &printed);
  puts("]");
  return 0;
}

static int report_transfer_progress(uint64_t sent, uint64_t total, const void *data) {
  static int previous_percent = -1;
  static const char *previous_action = NULL;
  const char *action = data;
  int percent = total ? (int)((double)sent * 100.0 / (double)total) : 0;
  if (previous_action != action || percent < previous_percent || percent >= previous_percent + 10 || percent == 100) {
    printf("{\"progress\":true,\"phase\":\"%s\",\"percent\":%d}\n", action, percent);
    fflush(stdout);
    previous_action = action;
    previous_percent = percent;
  }
  return 0;
}

static int receive_file(LIBMTP_mtpdevice_t *device, const char *id, const char *destination) {
  char *end = NULL;
  unsigned long value = strtoul(id, &end, 10);
  if (!id[0] || !end || *end || value > UINT32_MAX) return 1;
  if (LIBMTP_Get_File_To_File(device, (uint32_t)value, destination, report_transfer_progress, "verifying") != 0) return 1;
  puts("{\"ok\":true}");
  return 0;
}

static int send_file(LIBMTP_mtpdevice_t *device, const char *source, const char *name) {
  if (!name[0] || strchr(name, '/') || strchr(name, '\\')) return 1;
  struct stat info;
  if (stat(source, &info) != 0 || !S_ISREG(info.st_mode)) return 1;
  documents_ref_t documents;
  if (!find_documents(device, &documents)) return 1;
  LIBMTP_file_t *existing = LIBMTP_Get_Files_And_Folders(device, documents.storage_id, documents.folder_id);
  for (LIBMTP_file_t *it = existing; it; it = it->next) {
    if (it->filename && strcmp(it->filename, name) == 0) {
      free_file_list(existing);
      return 1;
    }
  }
  free_file_list(existing);
  LIBMTP_file_t *file = LIBMTP_new_file_t();
  file->filename = strdup(name);
  file->filesize = (uint64_t)info.st_size;
  file->parent_id = documents.folder_id;
  file->storage_id = documents.storage_id;
  file->filetype = LIBMTP_FILETYPE_UNKNOWN;
  int result = LIBMTP_Send_File_From_File(device, source, file, report_transfer_progress, "copying");
  if (result == 0) printf("{\"id\":\"%" PRIu32 "\"}\n", file->item_id);
  LIBMTP_destroy_file_t(file);
  return result == 0 ? 0 : 1;
}

static int serve_session(LIBMTP_mtpdevice_t *device) {
  documents_ref_t documents;
  if (!find_documents(device, &documents)) return 1;
  uint64_t free_bytes = 0;
  for (LIBMTP_devicestorage_t *storage = device->storage; storage; storage = storage->next) {
    if (storage->id == documents.storage_id) free_bytes = storage->FreeSpaceInBytes;
  }
  printf("{\"ready\":true,\"freeBytes\":%" PRIu64 "}\n", free_bytes);
  fflush(stdout);
  char line[65536];
  while (fgets(line, sizeof(line), stdin)) {
    size_t length = strlen(line);
    if (!length || line[length - 1] != '\n') return 2;
    line[length - 1] = '\0';
    char *save = NULL;
    char *action = strtok_r(line, "\t", &save);
    char *first = strtok_r(NULL, "\t", &save);
    char *second = strtok_r(NULL, "\t", &save);
    char *extra = strtok_r(NULL, "\t", &save);
    int result = 2;
    LIBMTP_Clear_Errorstack(device);
    if (action && !extra) {
      if (!strcmp(action, "files") && !first) result = list_files(device);
      else if (!strcmp(action, "get") && first && second) result = receive_file(device, first, second);
      else if (!strcmp(action, "put") && first && second) result = send_file(device, first, second);
    }
    if (result || LIBMTP_Get_Errorstack(device)) {
      LIBMTP_Dump_Errorstack(device);
      LIBMTP_Clear_Errorstack(device);
      puts("{\"error\":\"Kindle operation failed\"}");
    } else puts("{\"complete\":true}");
    fflush(stdout);
  }
  return 0;
}

int main(int argc, char **argv) {
  LIBMTP_Init();
  if (argc == 2 && strcmp(argv[1], "devices") == 0) return list_devices();
  if (argc < 3) return 2;
  LIBMTP_mtpdevice_t *device = open_kindle(argv[2]);
  if (!device) { fputs("Kindle is disconnected or in use.\n", stderr); return 1; }
  int result = 2;
  if (argc == 3 && strcmp(argv[1], "session") == 0) result = serve_session(device);
  else if (argc == 3 && strcmp(argv[1], "files") == 0) result = list_files(device);
  else if (argc == 5 && strcmp(argv[1], "get") == 0) result = receive_file(device, argv[3], argv[4]);
  else if (argc == 5 && strcmp(argv[1], "put") == 0) result = send_file(device, argv[3], argv[4]);
  LIBMTP_Release_Device(device);
  return result;
}
