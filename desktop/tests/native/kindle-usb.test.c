#include <assert.h>
#include <stddef.h>
#include <stdint.h>
#include <stdlib.h>

/* Keep the libmtp-supported table static like the real API; only result buffers are owned. */
void *fixture_calloc(size_t count, size_t size);
void fixture_free(void *pointer);
#define calloc fixture_calloc
#define free fixture_free
#include "../../native/kindle-usb.h"
#undef calloc
#undef free

/* Unsafe libusb entry points are deliberately undeclared: implicit calls fail the fixture build. */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define MAX_DEVICES 8
#define MAX_CONFIGS 4

struct libusb_context { int unused; };

struct test_device {
  struct libusb_device_descriptor descriptor;
  uint8_t bus;
  uint8_t address;
  int descriptor_error;
  int config_error[MAX_CONFIGS];
  struct libusb_config_descriptor configs[MAX_CONFIGS];
  struct libusb_interface interfaces[MAX_CONFIGS];
  struct libusb_interface_descriptor alternates[MAX_CONFIGS][3];
};

struct libusb_device { struct test_device *test; };

static libusb_context test_context;
static struct test_device test_devices[MAX_DEVICES];
static struct libusb_device usb_devices[MAX_DEVICES];
static libusb_device *usb_device_list[MAX_DEVICES + 1];
static size_t test_device_count;
static LIBMTP_device_entry_t supported_entries[4];
static int supported_count;
static int init_result;
static int list_result;
static int table_result;
static int descriptor_calls;
static int config_calls;
static int invalid_supported_free;
static int fail_allocation;

void *fixture_calloc(size_t count, size_t size) {
  if (fail_allocation) return NULL;
  return calloc(count, size);
}

void fixture_free(void *pointer) {
  if (!pointer) return;
  for (int i = 0; i < supported_count; ++i) {
    if (pointer == &supported_entries[i]) {
      invalid_supported_free++;
      return;
    }
  }
  free(pointer);
}

int LIBMTP_Get_Supported_Devices_List(LIBMTP_device_entry_t **devices, int *count) {
  if (table_result) return table_result;
  *devices = supported_entries;
  *count = supported_count;
  return 0;
}

int libusb_init(libusb_context **context) {
  if (init_result) return init_result;
  *context = &test_context;
  return 0;
}

ssize_t libusb_get_device_list(libusb_context *context, libusb_device ***devices) {
  (void)context;
  if (list_result < 0) return list_result;
  for (size_t i = 0; i < test_device_count; ++i) {
    usb_devices[i].test = &test_devices[i];
    usb_device_list[i] = &usb_devices[i];
  }
  usb_device_list[test_device_count] = NULL;
  *devices = usb_device_list;
  return (ssize_t)test_device_count;
}

int libusb_get_device_descriptor(libusb_device *device, struct libusb_device_descriptor *descriptor) {
  descriptor_calls++;
  if (device->test->descriptor_error) return -1;
  *descriptor = device->test->descriptor;
  return 0;
}

int libusb_get_config_descriptor(libusb_device *device, uint8_t index, struct libusb_config_descriptor **config) {
  config_calls++;
  if (device->test->config_error[index]) return -1;
  *config = &device->test->configs[index];
  return 0;
}

void libusb_free_config_descriptor(struct libusb_config_descriptor *config) { (void)config; }
uint8_t libusb_get_bus_number(libusb_device *device) { return device->test->bus; }
uint8_t libusb_get_device_address(libusb_device *device) { return device->test->address; }
void libusb_free_device_list(libusb_device **devices, int unref_devices) { (void)devices; (void)unref_devices; }
void libusb_exit(libusb_context *context) { (void)context; }

static void reset_fixture(void) {
  memset(test_devices, 0, sizeof(test_devices));
  memset(usb_devices, 0, sizeof(usb_devices));
  memset(usb_device_list, 0, sizeof(usb_device_list));
  memset(supported_entries, 0, sizeof(supported_entries));
  test_device_count = 0;
  supported_count = 0;
  init_result = list_result = table_result = 0;
  descriptor_calls = config_calls = invalid_supported_free = 0;
  fail_allocation = 0;
}

static struct test_device *add_device(uint16_t vendor, uint16_t product, uint8_t configurations) {
  assert(test_device_count < MAX_DEVICES);
  struct test_device *device = &test_devices[test_device_count];
  device->descriptor.idVendor = vendor;
  device->descriptor.idProduct = product;
  device->descriptor.bNumConfigurations = configurations;
  device->bus = (uint8_t)(3 + test_device_count);
  device->address = (uint8_t)(9 + test_device_count);
  usb_device_list[test_device_count] = &usb_devices[test_device_count];
  ++test_device_count;
  return device;
}

static void add_mtp_interface(struct test_device *device, uint8_t configuration) {
  device->alternates[configuration][0] = (struct libusb_interface_descriptor){
    .bInterfaceClass = LIBUSB_CLASS_IMAGE, .bInterfaceSubClass = 1, .bInterfaceProtocol = 1,
  };
  device->interfaces[configuration] = (struct libusb_interface){
    .altsetting = device->alternates[configuration], .num_altsetting = 1,
  };
  device->configs[configuration] = (struct libusb_config_descriptor){
    .bNumInterfaces = 1, .interface = &device->interfaces[configuration],
  };
}

static void test_known_and_unknown_amazon_devices(void) {
  reset_fixture();
  supported_entries[0] = (LIBMTP_device_entry_t){
    .vendor = "Other", .vendor_id = 0x1234, .product_id = 0x0001,
  };
  supported_entries[1] = (LIBMTP_device_entry_t){
    .vendor = "Amazon", .vendor_id = 0x1949, .product = "Known Kindle",
    .product_id = 0x0001, .device_flags = 0x12345678,
  };
  supported_count = 2;
  (void)add_device(0x1949, 0x0001, 1);
  struct test_device *unknown = add_device(0x1949, 0x9999, 2);
  add_mtp_interface(unknown, 1);

  LIBMTP_raw_device_t *devices = NULL;
  int count = 0;
  assert(kindle_raw_devices(&devices, &count) == 0);
  assert(count == 2);
  assert(devices[0].device_entry.device_flags == 0x12345678);
  assert(devices[0].device_entry.product_id == 0x0001);
  assert(devices[0].bus_location == 3 && devices[0].devnum == 9);
  assert(devices[1].device_entry.vendor_id == 0x1949);
  assert(devices[1].device_entry.product_id == 0x9999);
  assert(devices[1].device_entry.device_flags == 0);
  assert(devices[1].bus_location == 4 && devices[1].devnum == 10);
  assert(config_calls == 2);
  assert(invalid_supported_free == 0);
  free(devices);
}

static void test_filters_before_configuration_queries(void) {
  reset_fixture();
  struct test_device *storage_only = add_device(0x1949, 0x1010, 1);
  storage_only->alternates[0][0] = (struct libusb_interface_descriptor){
    .bInterfaceClass = 8, .bInterfaceSubClass = 6, .bInterfaceProtocol = 80,
  };
  storage_only->alternates[0][1] = (struct libusb_interface_descriptor){
    .bInterfaceClass = LIBUSB_CLASS_IMAGE, .bInterfaceSubClass = 0, .bInterfaceProtocol = 1,
  };
  storage_only->alternates[0][2] = (struct libusb_interface_descriptor){
    .bInterfaceClass = LIBUSB_CLASS_IMAGE, .bInterfaceSubClass = 1, .bInterfaceProtocol = 2,
  };
  storage_only->interfaces[0] = (struct libusb_interface){ .altsetting = storage_only->alternates[0], .num_altsetting = 3 };
  storage_only->configs[0] = (struct libusb_config_descriptor){ .bNumInterfaces = 1, .interface = &storage_only->interfaces[0] };
  (void)add_device(0x1234, 0x5678, 3);

  LIBMTP_raw_device_t *devices = NULL;
  int count = 0;
  assert(kindle_raw_devices(&devices, &count) == 0);
  assert(count == 0);
  assert(descriptor_calls == 2);
  assert(config_calls == 1);
  assert(devices != NULL);
  free(devices);
}

static void test_errors_and_empty_lists(void) {
  LIBMTP_raw_device_t *devices = NULL;
  int count = -1;

  reset_fixture();
  init_result = -1;
  assert(kindle_raw_devices(&devices, &count) == -1 && devices == NULL && count == 0);

  reset_fixture();
  list_result = -1;
  assert(kindle_raw_devices(&devices, &count) == -1 && devices == NULL && count == 0);

  reset_fixture();
  assert(kindle_raw_devices(&devices, &count) == 0 && devices == NULL && count == 0);

  reset_fixture();
  (void)add_device(0x1949, 0x0001, 0);
  test_devices[0].descriptor_error = 1;
  assert(kindle_raw_devices(&devices, &count) == 0 && count == 0);
  free(devices);

  reset_fixture();
  (void)add_device(0x1949, 0x0001, 0);
  table_result = -1;
  assert(kindle_raw_devices(&devices, &count) == -1 && devices == NULL && count == 0);

  reset_fixture();
  (void)add_device(0x1949, 0x0001, 1);
  test_devices[0].config_error[0] = 1;
  assert(kindle_raw_devices(&devices, &count) == 0 && count == 0);
  assert(config_calls == 1);
  free(devices);
}

static void test_allocation_failure(void) {
  reset_fixture();
  (void)add_device(0x1949, 0x0001, 0);
  fail_allocation = 1;
  LIBMTP_raw_device_t *devices = NULL;
  int count = 7;
  assert(kindle_raw_devices(&devices, &count) == -1);
  assert(devices == NULL && count == 0);
}

int main(void) {
  test_known_and_unknown_amazon_devices();
  test_filters_before_configuration_queries();
  test_errors_and_empty_lists();
  test_allocation_failure();
  puts("kindle-usb native fixture: ok");
  return 0;
}
